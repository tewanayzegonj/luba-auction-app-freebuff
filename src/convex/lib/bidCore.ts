import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { chargeBidFee } from "./finance";
import { LedgerError } from "./ledger";
import { isConsecutiveBidAllowed } from "./winner";

/**
 * Shared bid-attempt core — the single rules path for every way a bid enters
 * the system (user click, scheduled bid, future bot/API). Phase 6 hardening:
 *
 *  - Validation is fully index-driven (per-user index only — never a scan of
 *    the whole auction's bid set), so a heavily contested auction does not
 *    slow individual bids down.
 *  - The bid row and its fee posting commit in one transaction (spec §15).
 *  - Auction aggregate counters are NOT touched here: per-bid counter patches
 *    on the auction document serialize every concurrent bidder through OCC
 *    retries. Display counters move via a separate throttled reconciler.
 */

export type BidRejectionCode =
  | "BID_OUT_OF_RANGE"
  | "BID_NOT_ON_INCREMENT"
  | "BID_LIMIT_REACHED"
  | "CONSECUTIVE_BID_BLOCKED"
  | "INSUFFICIENT_BALANCE"
  | `LEDGER_ERROR:${string}`;

export type BidAttemptResult =
  | { ok: true; bidId: Id<"auctionBids"> }
  | { ok: false; code: BidRejectionCode };

/**
 * Attempt one bid against `auction`. Assumes the caller has already verified
 * authentication, eligibility, auction OPEN/CLOSING state, server-vs-closesAt
 * timing, rate limits, and idempotency replay — those differ per caller.
 */
export async function attemptBid(
  ctx: MutationCtx,
  args: {
    auction: Doc<"auctions">;
    userId: Id<"users">;
    bidValueSantims: number;
    idempotencyKey: string;
    now: number;
  },
): Promise<BidAttemptResult> {
  const { auction, userId, bidValueSantims, idempotencyKey, now } = args;

  // Rule 5: within allowed range.
  if (
    bidValueSantims < auction.minBidSantims ||
    bidValueSantims > auction.maxBidSantims
  ) {
    return { ok: false, code: "BID_OUT_OF_RANGE" };
  }

  // Rule 6: increment grid.
  if (
    auction.bidIncrementSantims > 0 &&
    (bidValueSantims - auction.minBidSantims) % auction.bidIncrementSantims !== 0
  ) {
    return { ok: false, code: "BID_NOT_ON_INCREMENT" };
  }

  // Rule 7 + Rule 9: per-user cap and consecutive policy — one small indexed
  // read of THIS user's bids on THIS auction (bounded by the cap itself).
  const myBids = await ctx.db
    .query("auctionBids")
    .withIndex("by_auction_user", (q) =>
      q.eq("auctionId", auction._id).eq("userId", userId),
    )
    .collect();
  const acceptedValues: number[] = [];
  for (const b of myBids) {
    if (b.status === "ACCEPTED") acceptedValues.push(b.bidValueSantims);
  }
  if (acceptedValues.length >= auction.maximumBidsPerUser) {
    return { ok: false, code: "BID_LIMIT_REACHED" };
  }
  if (
    auction.consecutiveBidPolicy !== "NONE" &&
    !isConsecutiveBidAllowed(
      auction.consecutiveBidPolicy,
      auction.bidIncrementSantims,
      bidValueSantims,
      acceptedValues,
    )
  ) {
    return { ok: false, code: "CONSECUTIVE_BID_BLOCKED" };
  }

  // Create the bid row, then charge the fee in the same transaction. If the
  // wallet cannot cover it, the bid row is removed before commit (spec §15:
  // no half-bid, no half-payment).
  const bidId = await ctx.db.insert("auctionBids", {
    auctionId: auction._id,
    userId,
    bidValueSantims,
    bidServiceFeeSantims: auction.bidServiceFeeSantims,
    idempotencyKey,
    acceptedAt: now,
    status: "ACCEPTED",
  });

  try {
    await chargeBidFee(ctx, {
      userId,
      feeSantims: auction.bidServiceFeeSantims,
      bidId,
      now,
    });
  } catch (err) {
    ctx.db.delete(bidId);
    if (err instanceof LedgerError) {
      return {
        ok: false,
        code:
          err.message === "INSUFFICIENT_FUNDS"
            ? "INSUFFICIENT_BALANCE"
            : `LEDGER_ERROR:${err.message}`,
      };
    }
    throw err;
  }

  return { ok: true, bidId };
}
