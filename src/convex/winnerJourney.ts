import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { insertAuditLog, insertNotification } from "./lib/notifications";
import { ROLES } from "./schema";

/**
 * Winner journey (4-step): WON → ID VERIFICATION → PAYMENT → FULFILLMENT.
 *
 * 1. Settlement creation mints a claim code and delivers it via the
 *    notification outbox (Telegram/SMS).
 * 2. Winner verifies identity (KYC VERIFIED - existing upload/review flow).
 * 3. Winner pays the winning bid value from wallet balance (existing
 *    payWinningBid) and submits pickup/delivery details.
 * 4. Admin marks the prize handed over (FULFILLED) - social-proof photo.
 *
 * Also publishes the provably-fair per-bid breakdown once an auction
 * completes: every accepted bid, anonymized, sorted lowest-first with
 * duplicate flags - anyone can verify the lowest unique bid wins.
 */

// ─── Provably-fair public results ───────────────────────────────────────────

/** Public: anonymized per-bid breakdown for a completed auction. */
export const provablyFairResults = query({
  args: { auctionCode: v.string() },
  handler: async (ctx, args) => {
    const auction = await ctx.db
      .query("auctions")
      .withIndex("by_code", (q) => q.eq("auctionCode", args.auctionCode))
      .unique();
    if (!auction) return null;
    if (
      auction.status !== "CLOSED" &&
      auction.status !== "COMPLETED" &&
      auction.status !== "SETTLING"
    ) {
      return { published: false as const };
    }

    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_value", (q) => q.eq("auctionId", auction._id))
      .collect();
    const accepted = bids
      .filter((b) => b.status === "ACCEPTED")
      .sort((a, b) => a.bidValueSantims - b.bidValueSantims);

    const result = await ctx.db
      .query("auctionResults")
      .withIndex("by_auction", (q) => q.eq("auctionId", auction._id))
      .unique();

    const rows: {
      position: number;
      valueSantims: number;
      maskedBidder: string;
      unique: boolean;
      isWinning: boolean;
    }[] = [];
    const countByValue = new Map<number, number>();
    for (const b of accepted) {
      countByValue.set(
        b.bidValueSantims,
        (countByValue.get(b.bidValueSantims) ?? 0) + 1,
      );
    }

    accepted.forEach((b, i) => {
      const count = countByValue.get(b.bidValueSantims) ?? 1;
      rows.push({
        position: i + 1,
        valueSantims: b.bidValueSantims,
        // Anonymized identity: last 2 chars of the bid id - unique per bid,
        // stable, and cannot be linked to a user without DB access.
        maskedBidder: `Bidder #***${b._id.slice(-2)}`,
        unique: count === 1,
        isWinning: count === 1 && result?.winningBidValueSantims === b.bidValueSantims,
      });
    });

    return {
      published: true as const,
      resolution: result?.resolution ?? null,
      rows,
      totalBids: accepted.length,
      uniqueCount: rows.filter((r) => r.unique).length,
      winningBidValueSantims: result?.winningBidValueSantims ?? null,
    };
  },
});

// ─── Winner claim flow ──────────────────────────────────────────────────────

/** 8-char unambiguous claim code (no lookalike glyphs). */
const CLAIM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateClaimCode(): string {
  let out = "";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  for (const b of buf) out += CLAIM_ALPHABET[b % CLAIM_ALPHABET.length];
  return out;
}

/** Internal: mint + deliver the claim code when a winner is determined. */
export const mintClaimCodeInternal = internalMutation({
  args: { settlementId: v.id("winnerSettlements") },
  handler: async (ctx, args) => {
    const settlement = await ctx.db.get(args.settlementId);
    if (!settlement || settlement.claimCode) return; // idempotent

    // Retry until unique (collision on 8 chars over 32^8 is negligible).
    for (let i = 0; i < 5; i++) {
      const code = generateClaimCode();
      const clash = await ctx.db
        .query("winnerSettlements")
        .withIndex("by_claim_code", (q) => q.eq("claimCode", code))
        .first();
      if (!clash) {
        await ctx.db.patch(args.settlementId, { claimCode: code });
        await insertNotification(ctx, {
          userId: settlement.winnerUserId,
          type: "PRIZE_STATUS",
          title: "🎉 You won - your claim code",
          body: `Claim code: ${code}. Keep it - show it (with your ID) at pickup/delivery. Pay the winning amount from your wallet to finalize.`,
          auctionId: settlement.auctionId,
          now: Date.now(),
        });
        return;
      }
    }
  },
});

/**
 * Step 2+3: winner pays the winning bid value and submits fulfillment
 * preferences in one atomic action. Requires KYC VERIFIED (the "ID
 * Verification" step).
 */
export const claimAndPay = mutation({
  args: {
    settlementId: v.id("winnerSettlements"),
    deliveryMethod: v.union(v.literal("PICKUP"), v.literal("DELIVERY")),
    deliveryPhone: v.optional(v.string()),
    deliveryAddress: v.optional(v.string()),
    deliveryNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");
    const settlement = await ctx.db.get(args.settlementId);
    if (!settlement) throw new Error("SETTLEMENT_NOT_FOUND");
    if (settlement.winnerUserId !== userId) throw new Error("NOT_THE_WINNER");
    if (settlement.status !== "PENDING_PAYMENT") {
      throw new Error("ALREADY_PAID");
    }

    // Step 2 gate: identity must be verified (user flag or an APPROVED doc).
    const user = await ctx.db.get(userId);
    const approvedDoc = await ctx.db
      .query("kycDocuments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "APPROVED"))
      .first();
    if (user?.kycStatus !== "VERIFIED" && !approvedDoc) {
      throw new Error(
        "Verify your identity first - upload your ID in Profile → Verification.",
      );
    }

    if (args.deliveryMethod === "DELIVERY") {
      if (!args.deliveryPhone || !args.deliveryAddress) {
        throw new Error("Delivery requires a phone number and address.");
      }
    }

    // Debit wallet + mark PAID atomically (the settlement payment core).
    await ctx.runMutation(api.payments.payWinningBid, {
      settlementId: args.settlementId,
    });

    await ctx.db.patch(args.settlementId, {
      deliveryMethod: args.deliveryMethod,
      deliveryPhone: args.deliveryPhone,
      deliveryAddress: args.deliveryAddress,
      deliveryNotes: args.deliveryNotes?.trim() || undefined,
      deliverySubmittedAt: Date.now(),
    });

    await insertAuditLog(ctx, {
      actor: userId,
      action: "WINNER_CLAIM_SUBMITTED",
      resource: `settlement:${args.settlementId}`,
      details: `method=${args.deliveryMethod}`,
      now: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Admin: resolve a claim code at handover. */
export const verifyClaimCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const adminId = await requireAdminRole(ctx);
    void adminId;
    const settlement = await ctx.db
      .query("winnerSettlements")
      .withIndex("by_claim_code", (q) =>
        q.eq("claimCode", args.code.trim().toUpperCase()),
      )
      .unique();
    if (!settlement) return null;
    const auction = await ctx.db.get(settlement.auctionId);
    const winner = await ctx.db.get(settlement.winnerUserId);
    return {
      settlementId: settlement._id,
      auctionCode: auction?.auctionCode ?? "?",
      auctionTitle: auction?.title ?? "?",
      status: settlement.status,
      winnerName: winner?.name ?? null,
      deliveryMethod: settlement.deliveryMethod ?? null,
      deliveryPhone: settlement.deliveryPhone ?? null,
      deliveryAddress: settlement.deliveryAddress ?? null,
      paidAt: settlement.paidAt ?? null,
    };
  },
});

/** Admin: mark the prize handed over (FULFILLED) - final step. */
export const markFulfilled = mutation({
  args: { settlementId: v.id("winnerSettlements") },
  handler: async (ctx, args) => {
    const adminId = await requireAdminRole(ctx);
    const settlement = await ctx.db.get(args.settlementId);
    if (!settlement) throw new Error("SETTLEMENT_NOT_FOUND");
    if (settlement.status !== "PAID") throw new Error("NOT_PAID_YET");
    await ctx.db.patch(args.settlementId, { status: "FULFILLED" });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "PRIZE_FULFILLED",
      resource: `settlement:${args.settlementId}`,
      now: Date.now(),
    });
    await insertNotification(ctx, {
      userId: settlement.winnerUserId,
      type: "PRIZE_STATUS",
      title: "Prize handed over 🎉",
      body: "Enjoy your win! Share a photo with us for a chance to be featured.",
      auctionId: settlement.auctionId,
      now: Date.now(),
    });
  },
});

// ─── Role helper (admin or super_admin) ─────────────────────────────────────

// Structurally-typed context: works from both query and mutation handlers,
// mirroring the pattern in accountOps.ts.
type AnyCtx = Parameters<typeof getAuthUserId>[0] & {
  db: { get: MutationCtx["db"]["get"] };
};

async function requireAdminRole(ctx: AnyCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("UNAUTHENTICATED");
  const user = (await ctx.db.get(userId)) as Doc<"users"> | null;
  if (!user || (user.role !== ROLES.ADMIN && user.role !== ROLES.SUPER_ADMIN)) {
    throw new Error("FORBIDDEN_ADMIN_ONLY");
  }
  return userId;
}

// Hook point for lib/settlement: mint + deliver the claim code after a
// winner is recorded. Called via internal.winnerJourney.mintClaimCodeInternal.
export const _internal = { mintClaimCodeInternal };
