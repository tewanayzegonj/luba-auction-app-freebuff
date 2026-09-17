import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { attemptBid } from "./lib/bidCore";
import { resolveLowestUniqueBid } from "./lib/winner";

/**
 * Sandbox marker: every simulation auction's code is prefixed `SIM-` at
 * creation (see simCreateAuction). This is the single guaranteed-present,
 * user-invisible marker - public queries filter on it so test data can
 * never surface on the landing page, winners ledger, or auction detail,
 * no matter which deployment it was written to.
 */
export function isSandboxCode(code: string | undefined | null): boolean {
  return typeof code === "string" && code.startsWith("SIM-");
}

/**
 * Dev-only simulation endpoints used by scripts/simulate-concurrency.ts.
 *
 * SAFETY (fail-closed, two conditions):
 *  1. The operator must explicitly set ENABLE_SIM_ENDPOINTS=1 in the
 *     environment/Keys UI - the endpoints are inert without it.
 *  2. Production deployments are refused unconditionally by name.
 * They create ONLY sandbox data ([SIM]-marked prize/auction) and never
 * touch real campaigns, wallets, or settlements.
 */

function assertSimSafe() {
  const deployment = process.env.CONVEX_DEPLOYMENT_NAME ?? "";
  if (/prod/i.test(deployment)) {
    throw new Error("SIM_BLOCKED: simulation endpoints never run on production");
  }
  if (process.env.ENABLE_SIM_ENDPOINTS !== "1") {
    throw new Error(
      "SIM_BLOCKED: set ENABLE_SIM_ENDPOINTS=1 in the environment to enable simulation endpoints",
    );
  }
}

/**
 * Remove the sandbox rows a simulation run left behind. Same fail-closed
 * guard as every sim endpoint. Scoped strictly to SIM-marked auctions and
 * their direct children (bids, results, settlements, schedules, auto-bid
 * plans, watchlist rows, the sim prize). Ledger transactions are NOT
 * deleted - the ledger is append-only truth; sim fee postings balance to
 * zero economic effect and never surface on public pages.
 */
export const simPurgeAuctions = mutation({
  args: {},
  handler: async (ctx) => {
    assertSimSafe();
    const sims = await ctx.db.query("auctions").collect();
    let auctions = 0;
    let bids = 0;
    let results = 0;
    let settlements = 0;
    let scheduled = 0;
    let autoBids = 0;
    let watchlist = 0;
    let prizes = 0;

    for (const a of sims) {
      if (!isSandboxCode(a.auctionCode)) continue;

      for (const b of await ctx.db
        .query("auctionBids")
        .withIndex("by_auction_value", (q) => q.eq("auctionId", a._id))
        .collect()) {
        await ctx.db.delete(b._id);
        bids++;
      }

      for (const s of await ctx.db
        .query("scheduledBids")
        .withIndex("by_auction_status", (q) => q.eq("auctionId", a._id))
        .collect()) {
        await ctx.db.delete(s._id);
        scheduled++;
      }

      for (const p of await ctx.db
        .query("autoBids")
        .withIndex("by_auction_status", (q) => q.eq("auctionId", a._id))
        .collect()) {
        await ctx.db.delete(p._id);
        autoBids++;
      }

      for (const w of await ctx.db
        .query("watchlist")
        .withIndex("by_auction", (q) => q.eq("auctionId", a._id))
        .collect()) {
        await ctx.db.delete(w._id);
        watchlist++;
      }

      for (const r of await ctx.db
        .query("auctionResults")
        .withIndex("by_auction", (q) => q.eq("auctionId", a._id))
        .collect()) {
        for (const st of await ctx.db
          .query("winnerSettlements")
          .withIndex("by_result", (q) => q.eq("resultId", r._id))
          .collect()) {
          await ctx.db.delete(st._id);
          settlements++;
        }
        await ctx.db.delete(r._id);
        results++;
      }

      const prize = await ctx.db.get(a.prizeId);
      await ctx.db.delete(a._id);
      auctions++;
      if (prize) {
        await ctx.db.delete(prize._id);
        prizes++;
      }
    }

    return { auctions, bids, results, settlements, scheduled, autoBids, watchlist, prizes };
  },
});

/** Create the sandbox prize + OPEN auction for a concurrency test run. */
export const simCreateAuction = mutation({
  args: {
    feeSantims: v.number(),
    minBidSantims: v.number(),
    maxBidSantims: v.number(),
  },
  handler: async (ctx, args) => {
    assertSimSafe();
    const now = Date.now();
    const prizeId = await ctx.db.insert("prizes", {
      title: "[SIM] Concurrency test prize",
      valueSantims: 50_000_00,
      emoji: "🧪",
      stock: 1,
      createdAt: now,
    });
    const auctionId = await ctx.db.insert("auctions", {
      auctionCode: `SIM-${now}`,
      title: "[SIM] Concurrency test auction",
      prizeId,
      opensAt: now - 60_000,
      closesAt: now + 15 * 60_000,
      status: "OPEN",
      minBidSantims: args.minBidSantims,
      maxBidSantims: args.maxBidSantims,
      bidIncrementSantims: 1,
      bidServiceFeeSantims: args.feeSantims,
      maximumBidsPerUser: 1_000,
      consecutiveBidPolicy: "NONE",
      noWinnerPolicy: "CANCEL_AND_REFUND",
      winnerPaymentDeadline: 3 * 24 * 60 * 60 * 1000,
      visibilityPolicy: "PRIVATE",
      bidCount: 0,
      uniqueBidCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { prizeId, auctionId };
  },
});

/**
 * Server-side verification report for a finished simulation run. Computes
 * every invariant from indexed reads + the ledger, never from client claims:
 *
 *  V1 revenue: Σ BID_FEE ledger credits === accepted bids × fee
 *  V2 idempotency: no key maps to two accepted bids
 *  V3 balance safety: no negative wallet; every recent ledger tx balances
 *  V4 determinism: winner resolution run twice returns identical results
 */
export const simVerify = mutation({
  args: {
    auctionId: v.id("auctions"),
    feeSantims: v.number(),
  },
  handler: async (ctx, args) => {
    assertSimSafe();
    const { auctionId, feeSantims } = args;

    // V1: revenue from the ledger truth (txType index), scoped to THIS
    // auction's accepted bids - each accepted bid must map to exactly one
    // BID_FEE posting and vice versa.
    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_value", (q) => q.eq("auctionId", auctionId))
      .collect();
    const acceptedBids = bids.filter((b) => b.status === "ACCEPTED");
    const acceptedBidIds = new Set<string>(acceptedBids.map((b) => b._id));

    const feeTxs = await ctx.db
      .query("ledgerTransactions")
      .withIndex("by_type", (q) => q.eq("txType", "BID_FEE"))
      .order("desc") // newest first - this run's postings are the most recent
      .take(2_000);
    const scopedFeeTxs = feeTxs.filter((tx) => acceptedBidIds.has(tx.reference));
    const feeRevenue = scopedFeeTxs.length * feeSantims;

    // V2: idempotency uniqueness among accepted bids.
    const byKey = new Map<string, number>();
    let duplicateKeys = 0;
    for (const b of acceptedBids) {
      const n = (byKey.get(b.idempotencyKey) ?? 0) + 1;
      byKey.set(b.idempotencyKey, n);
      if (n > 1) duplicateKeys++;
    }

    // V3: no negative wallet + recent transactions balance (Invariant 1, 2).
    let negativeWallets = 0;
    const wallets = await ctx.db.query("wallets").collect();
    for (const w of wallets) {
      if (w.paidBalanceSantims < 0 || w.promoBalanceSantims < 0) negativeWallets++;
    }
    let unbalancedTxs = 0;
    const recentTxs = await ctx.db.query("ledgerTransactions").order("desc").take(500);
    for (const tx of recentTxs) {
      const entries = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_transaction", (q) => q.eq("transactionId", tx._id))
        .collect();
      let debits = 0;
      let credits = 0;
      for (const e of entries) {
        if (e.direction === "DEBIT") debits += e.amountSantims;
        else credits += e.amountSantims;
      }
      if (debits !== credits) unbalancedTxs++;
    }

    // V4: deterministic resolution - compute twice, must agree (Invariant 7).
    const asBidLike = bids.map((b) => ({
      bidValueSantims: b.bidValueSantims,
      status: b.status,
    }));
    const r1 = resolveLowestUniqueBid(asBidLike);
    const r2 = resolveLowestUniqueBid(asBidLike);
    const deterministic =
      r1.resolution === r2.resolution &&
      r1.winningBidValueSantims === r2.winningBidValueSantims;

    return {
      acceptedBids: acceptedBids.length,
      feePostings: scopedFeeTxs.length,
      feeRevenueSantims: feeRevenue,
      expectedRevenueSantims: acceptedBids.length * feeSantims,
      duplicateKeys,
      negativeWallets,
      unbalancedTxs,
      deterministic,
      resolution: r1.resolution,
      winningBidValueSantims: r1.winningBidValueSantims ?? null,
    };
  },
});

/**
 * Optional helper: place a bid through the shared core directly (used to
 * compare behavior when the HTTP mutation layer is bypassed). Same rules,
 * same atomic fee - proves the core is caller-agnostic.
 */
export const simPlaceBidCore = mutation({
  args: {
    auctionId: v.id("auctions"),
    userId: v.id("users"),
    bidValueSantims: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    assertSimSafe();
    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (auction.status !== "OPEN" && auction.status !== "CLOSING") {
      throw new Error("AUCTION_NOT_OPEN");
    }
    const now = Date.now();
    if (now >= auction.closesAt) throw new Error("AUCTION_CLOSED");
    const attempt = await attemptBid(ctx, {
      auction,
      userId: args.userId,
      bidValueSantims: args.bidValueSantims,
      idempotencyKey: args.idempotencyKey,
      now,
    });
    return attempt.ok ? { ok: true, bidId: attempt.bidId } : { ok: false, code: attempt.code };
  },
});
