import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { formatSantims } from "../../lib/money";
import { refundUser } from "./finance";
import { insertAuditLog, insertNotification } from "./notifications";
import { resolveLowestUniqueBid } from "./winner";

/**
 * Auction settlement — spec §27–32.
 * Deterministic winner resolution from ACCEPTED bids only.
 * Guarded by a uniqueness fence: one result per auction (Invariant 6),
 * so two concurrent workers cannot both settle the same auction (spec §31).
 */
export async function settleAuctionInternal(
  ctx: MutationCtx,
  auctionId: Id<"auctions">,
): Promise<{ resultId: Id<"auctionResults">; replayed: boolean }> {
  const now = Date.now();
  const auction = await ctx.db.get(auctionId);
  if (!auction) throw new Error("AUCTION_NOT_FOUND");
  // Accept CLOSED auctions, plus a recoverable SETTLING state from a crashed
  // previous settlement attempt (the result-row fence prevents double settle).
  if (auction.status !== "CLOSED" && auction.status !== "SETTLING") {
    throw new Error(`AUCTION_NOT_CLOSED_${auction.status}`);
  }

  // Closure locking (spec §31): the unique by_auction result row is the
  // fence. If a result exists, settlement already happened.
  const existing = await ctx.db
    .query("auctionResults")
    .withIndex("by_auction", (q) => q.eq("auctionId", auctionId))
    .unique();
  if (existing) return { resultId: existing._id, replayed: true };

  const bids = await ctx.db
    .query("auctionBids")
    .withIndex("by_auction_value", (q) => q.eq("auctionId", auctionId))
    .collect();

  const resolution = resolveLowestUniqueBid(
    bids.map((b) => ({ bidValueSantims: b.bidValueSantims, status: b.status })),
  );

  let resultId: Id<"auctionResults">;
  if (resolution.resolution === "WINNER") {
    const winningBids = bids.filter(
      (b) =>
        b.status === "ACCEPTED" &&
        b.bidValueSantims === resolution.winningBidValueSantims,
    );
    // Unique value → exactly one accepted bid holds it.
    const winningBid = winningBids[0];

    resultId = await ctx.db.insert("auctionResults", {
      auctionId,
      resolution: "WINNER",
      winnerUserId: winningBid.userId,
      winningBidValueSantims: winningBid.bidValueSantims,
      winningBidId: winningBid._id,
      totalBids: bids.filter((b) => b.status === "ACCEPTED").length,
      resolvedAt: now,
    });

    await ctx.db.insert("winnerSettlements", {
      auctionId,
      resultId,
      winnerUserId: winningBid.userId,
      winningBidValueSantims: winningBid.bidValueSantims,
      paymentDeadline: now + auction.winnerPaymentDeadline,
      status: "PENDING_PAYMENT",
    });

    await insertNotification(ctx, {
      userId: winningBid.userId,
      type: "WINNER_ANNOUNCED",
      title: "🎉 You won!",
      body: `Lowest unique bid ${formatSantims(winningBid.bidValueSantims)} ETB in ${auction.auctionCode}. Pay by the deadline to claim your prize.`,
      auctionId,
      now,
    });
  } else {
    resultId = await ctx.db.insert("auctionResults", {
      auctionId,
      resolution: "NO_WINNER",
      totalBids: bids.filter((b) => b.status === "ACCEPTED").length,
      resolvedAt: now,
      noWinnerPolicyApplied: auction.noWinnerPolicy,
    });

    // CANCEL_AND_REFUND: refund every bid service fee (spec §29).
    if (auction.noWinnerPolicy === "CANCEL_AND_REFUND") {
      const seen = new Set<Id<"users">>();
      for (const bid of bids) {
        if (bid.status !== "ACCEPTED") continue;
        const fee = bid.bidServiceFeeSantims;
        if (!seen.has(bid.userId)) seen.add(bid.userId);
        await refundUser(ctx, {
          userId: bid.userId,
          amountSantims: fee,
          reason: `No-winner refund (${auction.auctionCode})`,
          reference: bid._id,
          idempotencyKey: `REFUND:${bid._id}`,
          now,
        });
        ctx.db.patch(bid._id, { status: "REFUNDED" });
      }
    }
  }

  ctx.db.patch(auctionId, { status: "COMPLETED", updatedAt: now });

  await ctx.db.insert("outboxEvents", {
    eventType: "AUCTION_SETTLED",
    payload: { auctionId, resultId, resolution: resolution.resolution },
    processed: false,
    createdAt: now,
  });

  await insertAuditLog(ctx, {
    action: "AUCTION_SETTLED",
    resource: `auction:${auctionId}`,
    details: `resolution=${resolution.resolution} winningValue=${resolution.winningBidValueSantims ?? "none"}`,
    now,
  });

  return { resultId, replayed: false };
}
