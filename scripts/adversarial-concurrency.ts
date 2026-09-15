/**
 * Phase 6 — Adversarial concurrency tests (spec §60: failure tests).
 *
 * Complements scripts/simulate-concurrency.ts with the two scenarios users
 * actually cause in the final minutes of an auction:
 *
 *   A. Double-click double-spend: ONE user fires the SAME bid (same
 *      idempotency key) 10× concurrently. Must yield exactly ONE accepted
 *      bid and ONE fee charge; the other 9 calls return the replayed
 *      original result (Invariant 4).
 *   B. Insufficient-funds race: a wallet funded for exactly 2 bids fires
 *      5 concurrent bids. At most 2 may be accepted, the rest must be
 *      clean typed rejections (INSUFFICIENT_BALANCE / RATE_LIMITED) —
 *      never a negative balance, never a crash (Invariant 2).
 *
 * Usage (after ENABLE_SIM_ENDPOINTS=1 is set in the environment):
 *   CONVEX_URL=https://<dev-deployment>.convex.cloud bun scripts/adversarial-concurrency.ts
 */

const CONVEX_URL = process.env.CONVEX_URL ?? "";
if (!CONVEX_URL) {
  console.error(
    "Set CONVEX_URL, e.g.\n" +
      "  CONVEX_URL=https://rare-mandrill-850.convex.cloud bun scripts/adversarial-concurrency.ts",
  );
  process.exit(1);
}
if (/prod/i.test(CONVEX_URL)) {
  console.error("REFUSING: this script must never run against a production deployment.");
  process.exit(1);
}

const { ConvexHttpClient } = await import("convex/browser");
const { anyApi } = await import("convex/server");
const api = anyApi;
const ETB = (s: number) => `${(s / 100).toFixed(2)}`;

async function newUser(): Promise<ConvexHttpClient> {
  const c = new ConvexHttpClient(CONVEX_URL);
  const res = (await c.action(api.auth.signIn, {
    provider: "anonymous",
    params: {},
  })) as { tokens?: { token?: string } };
  if (res?.tokens?.token) c.setAuth(res.tokens.token);
  return c;
}

async function fund(c: ConvexHttpClient, amountSantims: number) {
  const { merchantReference } = (await c.mutation(api.payments.initiateTopUp, {
    amountSantims,
    provider: "manual",
  })) as { merchantReference: string };
  await c.mutation(api.payments.confirmManualTopUp, {
    merchantReference,
    succeeded: true,
  });
}

async function main() {
  const boot = new ConvexHttpClient(CONVEX_URL);
  const fee = 10_00;
  const { auctionId } = (await boot.mutation(api.sim.simCreateAuction, {
    feeSantims: fee,
    minBidSantims: 1_00,
    maxBidSantims: 50_00,
  })) as { auctionId: string };
  console.log(`sandbox auction ${auctionId}\n`);

  let failed = false;

  // ── TEST A: double-click — same key × 10 concurrent ────────────────────
  const a = await newUser();
  await fund(a, 100_00);
  const key = `dblclk-${Date.now()}`;
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      a
        .mutation(api.auctions.placeBid, {
          auctionId,
          bidValueSantims: 5_00,
          idempotencyKey: key,
          acceptedTerms: true,
        })
        .then((r) => ({ ok: true as const, r: r as { bidId: string | null; replayed: boolean } }))
        .catch((e) => ({ ok: false as const, err: String(e).slice(0, 80) })),
    ),
  );
  const aAccepted = results.filter((r) => r.ok && r.r.bidId && !r.r.replayed);
  const aReplays = results.filter((r) => r.ok && r.r.bidId && r.r.replayed);
  const aErrs = results.filter((r) => !r.ok);
  const uniqueBids = new Set(aAccepted.map((r) => (r.ok ? r.r.bidId : null))).size;
  console.log(
    `TEST A (same key ×10 concurrent): accepted=${aAccepted.length} unique-bids=${uniqueBids} replays=${aReplays.length} errors=${aErrs.length}`,
  );
  if (uniqueBids === 1 && aAccepted.length === 1 && aErrs.length === 0) {
    console.log("  ✓ exactly ONE bid, ONE charge — double-click is idempotent (Invariant 4)");
  } else {
    failed = true;
    console.log("  ✘ FAILED — duplicate charges or unexpected errors");
  }

  // ── TEST B: insufficient-funds race — 2-bid wallet, 5 concurrent bids ──
  const b = await newUser();
  await fund(b, 2 * fee);
  const run = Date.now();
  const bResults = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      b
        .mutation(api.auctions.placeBid, {
          auctionId,
          bidValueSantims: 10_00 + i,
          idempotencyKey: `${run}-B${i}`,
          acceptedTerms: true,
        })
        .then(() => ({ ok: true as const }))
        .catch((e) => ({ ok: false as const, err: String(e) })),
    ),
  );
  const bAccepted = bResults.filter((r) => r.ok).length;
  const bRejected = bResults.filter((r) => !r.ok);
  const cleanRejects = bRejected.filter((r) =>
    /INSUFFICIENT_BALANCE|RATE_LIMITED/.test(r.err),
  ).length;
  const crashes = bRejected.length - cleanRejects;
  console.log(
    `TEST B (2-bid wallet, 5 concurrent): accepted=${bAccepted} rejected=${bRejected.length} (clean=${cleanRejects}) crashes=${crashes}`,
  );
  if (bAccepted <= 2 && crashes === 0) {
    console.log(
      `  ✓ wallet spent at most ${ETB(2 * fee)} ETB; every rejection was a typed business code (Invariant 2)`,
    );
  } else {
    failed = true;
    console.log("  ✘ FAILED — overspend or unhandled error");
  }

  // ── Ledger-wide verification ────────────────────────────────────────────
  const v = (await boot.mutation(api.sim.simVerify, { auctionId, feeSantims: fee })) as {
    negativeWallets: number;
    unbalancedTxs: number;
  };
  console.log(`ledger check: negativeWallets=${v.negativeWallets} unbalancedTxs=${v.unbalancedTxs}`);
  if (v.negativeWallets === 0 && v.unbalancedTxs === 0) {
    console.log("  ✓ no negative balances, every transaction balances (Invariants 1, 2)");
  } else {
    failed = true;
    console.log("  ✘ FAILED — ledger invariant violated");
  }

  console.log(failed ? "\n  ✘ RESULT: FAILED\n" : "\n  ✅ ADVERSARIAL RESULT: PASSED\n");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("crashed:", e);
  process.exit(1);
});
