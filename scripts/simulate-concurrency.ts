/**
 * Phase 6 — Automated concurrency test (spec §60: concurrency tests).
 *
 * Simulates 100–500 virtual users hammering `placeBid` on ONE auction at the
 * same split-second, then verifies the financial invariants server-side:
 *
 *   V1  Every wallet deduction matches exactly one accepted bid
 *       (Σ BID_FEE ledger postings === accepted bids × fee).
 *   V2  No idempotency key produced two different bids (no double charges).
 *   V3  No unhandled OCC/concurrency errors — every rejection is a typed
 *       business code, never a crash.
 *   V4  No negative balances; every recent ledger transaction balances.
 *   V5  Winner resolution is deterministic (computed twice, identical).
 *
 * Virtual users are created with the app's anonymous auth provider — the
 * same production sign-in path the web client uses — so the test exercises
 * the real mutation stack end to end.
 *
 * Setup (once, in the dev environment):
 *   - Add ENABLE_SIM_ENDPOINTS=1 to the project's environment/Keys UI.
 *   - Endpoints are additionally refused on any production deployment.
 *
 * Usage:
 *   CONVEX_URL=https://<dev-deployment>.convex.cloud bun scripts/simulate-concurrency.ts [users] [bidsPerUser]
 */

const CONVEX_URL = process.env.CONVEX_URL ?? "";
if (!CONVEX_URL) {
  console.error(
    "Set CONVEX_URL to the dev deployment, e.g.\n" +
      "  CONVEX_URL=https://rare-mandrill-850.convex.cloud bun scripts/simulate-concurrency.ts 100 3",
  );
  process.exit(1);
}
if (/prod/i.test(CONVEX_URL)) {
  console.error("REFUSING: this script must never run against a production deployment.");
  process.exit(1);
}

const { ConvexHttpClient } = await import("convex/browser");
const { anyApi } = await import("convex/server");

const api = anyApi; // untyped gateway — the test asserts the shapes it consumes

const USERS = Math.min(Math.max(Number(process.argv[2] ?? 100), 2), 500);
const BIDS_PER_USER = Math.min(Math.max(Number(process.argv[3] ?? 3), 1), 20);
const ETB = (santims: number) => `${(santims / 100).toFixed(2)}`;

type Outcome =
  | { kind: "accepted"; userId: number; valueSantims: number; replayed: boolean }
  | { kind: "rejected"; userId: number; code: string }
  | { kind: "crashed"; userId: number; error: string };

const BUSINESS_CODES = [
  "RATE_LIMITED",
  "AUCTION_NOT_OPEN",
  "AUCTION_CLOSED",
  "BID_OUT_OF_RANGE",
  "BID_NOT_ON_INCREMENT",
  "BID_LIMIT_REACHED",
  "CONSECUTIVE_BID_BLOCKED",
  "INSUFFICIENT_BALANCE",
  "TERMS_NOT_ACCEPTED",
  "USER_NOT_ELIGIBLE",
  "SELF_EXCLUDED",
];

/** Create one virtual user through the production anonymous-auth path. */
async function createVirtualUser(client: ConvexHttpClient): Promise<string | null> {
  try {
    const res = (await client.action(api.auth.signIn, {
      provider: "anonymous",
      params: {},
    })) as { tokens?: { token?: string } } | null;
    const token = res?.tokens?.token;
    if (token) client.setAuth(token);
    return token ?? null;
  } catch (err) {
    console.warn(
      `  ⚠ sign-in failed: ${err instanceof Error ? err.message.slice(0, 120) : err}`,
    );
    return null;
  }
}

async function main() {
  console.log(`\n▶ LUBA concurrency simulation — ${USERS} users × ${BIDS_PER_USER} bids each`);
  console.log(`  target: ${CONVEX_URL}\n`);

  // ── 1. Sandbox auction (dev-gated sim endpoint) ─────────────────────────
  const feeSantims = 10_00;
  const client0 = new ConvexHttpClient(CONVEX_URL);
  const { auctionId } = (await client0.mutation(api.sim.simCreateAuction, {
    feeSantims,
    minBidSantims: 1_00,
    maxBidSantims: 50_00,
  })) as { prizeId: string; auctionId: string };
  console.log(`  sandbox auction ${auctionId}`);

  // ── 2. Virtual users + funded wallets ───────────────────────────────────
  const fundAmount = BIDS_PER_USER * feeSantims + feeSantims;
  const setup = async (u: number): Promise<string | null> => {
    const c = new ConvexHttpClient(CONVEX_URL);
    const token = await createVirtualUser(c);
    if (!token) return null;
    try {
      const { merchantReference } = (await c.mutation(api.payments.initiateTopUp, {
        amountSantims: fundAmount,
        provider: "manual",
      })) as { merchantReference: string };
      await c.mutation(api.payments.confirmManualTopUp, {
        merchantReference,
        succeeded: true,
      });
      return token;
    } catch (err) {
      console.warn(`  ⚠ setup failed for user ${u}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  };
  const settled = await Promise.all(Array.from({ length: USERS }, (_, u) => setup(u)));
  const signedIn = settled.filter((t): t is string => t !== null);
  console.log(`  signed in + funded ${signedIn.length}/${USERS} virtual users (${ETB(fundAmount)} ETB each)`);
  if (signedIn.length < USERS) {
    console.warn("  ⚠ some sign-ins failed — continuing with who we have");
  }

  // ── 3. THE STAMPEDE — every user fires every bid with zero stagger ──────
  const outcomes: Outcome[] = [];
  const valueFor = (u: number, b: number) => 1_00 + ((u * 7 + b * 3) % 4_900);
  const run = Date.now();
  const keyFor = (u: number, b: number) => `sim-${run}-${u}-${b}`;

  const t0 = performance.now();
  await Promise.all(
    signedIn.map(async (token, u) => {
      const c = new ConvexHttpClient(CONVEX_URL);
      c.setAuth(token);
      for (let b = 0; b < BIDS_PER_USER; b++) {
        // Respect the server's 1.5s anti-bot floor between a single user's
        // own bids; users still stampede in parallel on their first bid.
        if (b > 0) await new Promise((r) => setTimeout(r, 1_700));
        const valueSantims = valueFor(u, b);
        try {
          const res = (await c.mutation(api.auctions.placeBid, {
            auctionId,
            bidValueSantims: valueSantims,
            idempotencyKey: keyFor(u, b),
            acceptedTerms: true,
          })) as { bidId: string | null; replayed: boolean };
          if (res?.bidId) {
            outcomes.push({ kind: "accepted", userId: u, valueSantims, replayed: res.replayed });
          } else {
            outcomes.push({ kind: "rejected", userId: u, code: "IDEMPOTENT_REPLAY_NO_BID" });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const business = BUSINESS_CODES.some((code) => message.includes(code));
          outcomes.push(
            business
              ? { kind: "rejected", userId: u, code: message.split(":")[0].slice(0, 60) }
              : { kind: "crashed", userId: u, error: message.slice(0, 300) },
          );
        }
      }
    }),
  );
  const elapsedMs = Math.round(performance.now() - t0);

  // ── 4. Report ───────────────────────────────────────────────────────────
  const accepted = outcomes.filter((o) => o.kind === "accepted");
  const rejected = outcomes.filter((o) => o.kind === "rejected");
  const crashed = outcomes.filter((o) => o.kind === "crashed");
  const replays = accepted.filter((o) => o.replayed).length;
  const byCode = new Map<string, number>();
  for (const r of rejected) byCode.set(r.code, (byCode.get(r.code) ?? 0) + 1);

  console.log(
    `\n  ── burst complete in ${elapsedMs}ms (${Math.round(outcomes.length / (elapsedMs / 1000))} ops/s)`,
  );
  console.log(
    `     accepted ${accepted.length} · rejected ${rejected.length} · crashed ${crashed.length} · idempotent-replays ${replays}`,
  );
  for (const [code, n] of byCode) console.log(`       · ${code}: ${n}`);

  let failed = false;

  if (crashed.length > 0) {
    failed = true;
    console.error("\n  ✘ V3 FAILED — unhandled errors (must be typed business codes):");
    for (const c of crashed.slice(0, 5)) console.error(`     user ${c.userId}: ${c.error}`);
  } else {
    console.log("  ✓ V3 no unhandled concurrency/OCC errors surfaced");
  }

  // ── 5. Server-side invariant verification (dev-gated sim endpoint) ──────
  try {
    const v = (await client0.mutation(api.sim.simVerify, { auctionId, feeSantims })) as {
      acceptedBids: number;
      feePostings: number;
      feeRevenueSantims: number;
      expectedRevenueSantims: number;
      duplicateKeys: number;
      negativeWallets: number;
      unbalancedTxs: number;
      deterministic: boolean;
      resolution: string;
      winningBidValueSantims: number | null;
    };

    const deductionsMatch =
      v.acceptedBids === accepted.length - replays && v.feePostings === v.acceptedBids;
    if (deductionsMatch && v.feeRevenueSantims === v.expectedRevenueSantims) {
      console.log(
        `  ✓ V1 deductions match bids: ${v.acceptedBids} accepted × ${ETB(feeSantims)} = ${ETB(v.feeRevenueSantims)} ETB revenue`,
      );
    } else {
      failed = true;
      console.error(
        `  ✘ V1 FAILED — client-accepted ${accepted.length - replays} vs server ${v.acceptedBids}; ` +
          `fee postings ${v.feePostings}; revenue ${ETB(v.feeRevenueSantims)} vs expected ${ETB(v.expectedRevenueSantims)}`,
      );
    }

    if (v.duplicateKeys === 0) {
      console.log("  ✓ V2 every idempotency key produced at most one accepted bid");
    } else {
      failed = true;
      console.error(`  ✘ V2 FAILED — ${v.duplicateKeys} keys produced duplicate accepted bids`);
    }

    if (v.negativeWallets === 0 && v.unbalancedTxs === 0) {
      console.log("  ✓ V4 no negative balances; all recent ledger transactions balance");
    } else {
      failed = true;
      console.error(
        `  ✘ V4 FAILED — ${v.negativeWallets} negative wallet(s), ${v.unbalancedTxs} unbalanced transaction(s)`,
      );
    }

    if (v.deterministic) {
      console.log(
        `  ✓ V5 deterministic resolution: ${v.resolution}` +
          (v.winningBidValueSantims !== null ? ` @ ${ETB(v.winningBidValueSantims)} ETB` : " (no unique bid)"),
      );
    } else {
      failed = true;
      console.error("  ✘ V5 FAILED — winner resolution is nondeterministic");
    }
  } catch (err) {
    failed = true;
    console.error(
      `\n  ✘ server-side verification unavailable: ${err instanceof Error ? err.message : err}\n` +
        "    → set ENABLE_SIM_ENDPOINTS=1 in the project environment and re-run",
    );
  }

  console.log(failed ? "\n  ✘ RESULT: FAILED\n" : "\n  ✅ RESULT: PASSED\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Simulation crashed:", err);
  process.exit(1);
});
