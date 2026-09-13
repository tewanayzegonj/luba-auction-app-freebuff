import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { chargeBidFee } from "./lib/finance";
import { LedgerError } from "./lib/ledger";
import { insertNotification } from "./lib/notifications";
import { settleAuctionInternal } from "./lib/settlement";
import {
  isConsecutiveBidAllowed,
  resolveLowestUniqueBid,
} from "./lib/winner";

/**
 * Auction engine — spec §11–17, §27, §30–31.
 * All validation and time comes from the server. Clients never decide.
 */

// ─── Queries ────────────────────────────────────────────────────────────────

/** Public listing: OPEN/CLOSING auctions, soonest-closing first. */
export const listOpenAuctions = query({
  args: {},
  handler: async (ctx) => {
    const auctions = await ctx.db
      .query("auctions")
      .withIndex("by_status", (q) => q.eq("status", "OPEN"))
      .collect();
    const closing = await ctx.db
      .query("auctions")
      .withIndex("by_status", (q) => q.eq("status", "CLOSING"))
      .collect();

    const all = [...auctions, ...closing].sort((a, b) => a.closesAt - b.closesAt);

    return Promise.all(
      all.map(async (auction) => {
        const prize = await ctx.db.get(auction.prizeId);
        const prizeImageUrl =
          prize?.imageStorageId !== undefined
            ? await ctx.storage.getUrl(prize.imageStorageId)
            : prize?.imageUrl;
        return {
          _id: auction._id,
          auctionCode: auction.auctionCode,
          title: auction.title,
          status: auction.status,
          closesAt: auction.closesAt,
          bidServiceFeeSantims: auction.bidServiceFeeSantims,
          minBidSantims: auction.minBidSantims,
          maxBidSantims: auction.maxBidSantims,
          bidCount: auction.bidCount,
          uniqueBidCount: auction.uniqueBidCount,
          prize: prize
            ? {
                title: prize.title,
                emoji: prize.emoji ?? "🎁",
                imageUrl: prizeImageUrl,
                valueSantims: prize.valueSantims,
                category: prize.category,
              }
            : null,
        };
      }),
    );
  },
});

/** Public detail for an auction by code, joined with prize + recent bid stats. */
export const getAuctionByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const auction = await ctx.db
      .query("auctions")
      .withIndex("by_code", (q) => q.eq("auctionCode", args.code))
      .unique();
    if (!auction) return null;

    const prize = await ctx.db.get(auction.prizeId);
    const prizeImageUrl =
      prize?.imageStorageId !== undefined
        ? await ctx.storage.getUrl(prize.imageStorageId)
        : prize?.imageUrl;
    const result = await ctx.db
      .query("auctionResults")
      .withIndex("by_auction", (q) => q.eq("auctionId", auction._id))
      .unique();

    return {
      _id: auction._id,
      auctionCode: auction.auctionCode,
      title: auction.title,
      description: auction.description,
      status: auction.status,
      opensAt: auction.opensAt,
      closesAt: auction.closesAt,
      minBidSantims: auction.minBidSantims,
      maxBidSantims: auction.maxBidSantims,
      bidIncrementSantims: auction.bidIncrementSantims,
      bidServiceFeeSantims: auction.bidServiceFeeSantims,
      maximumBidsPerUser: auction.maximumBidsPerUser,
      consecutiveBidPolicy: auction.consecutiveBidPolicy,
      noWinnerPolicy: auction.noWinnerPolicy,
      bidCount: auction.bidCount,
      uniqueBidCount: auction.uniqueBidCount,
      prize: prize
        ? {
            title: prize.title,
            description: prize.description,
            emoji: prize.emoji ?? "🎁",
            imageUrl: prizeImageUrl,
            valueSantims: prize.valueSantims,
            category: prize.category,
          }
        : null,
      result: result
        ? {
            resolution: result.resolution,
            winningBidValueSantims: result.winningBidValueSantims,
            winnerUserId: result.winnerUserId,
          }
        : null,
    };
  },
});

/**
 * Uniqueness counts for SPECIFIC bid values only (spec §33: limited public
 * info). The client asks about the value it's about to bid plus its own
 * bids — never the full distribution, which would enable strategic
 * scraping. Presentation data only; never authoritative for settlement.
 */
export const getUniquenessForValues = query({
  args: { auctionId: v.id("auctions"), values: v.array(v.number()) },
  handler: async (ctx, args) => {
    if (args.values.length === 0) return [];
    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_value", (q) =>
        q.eq("auctionId", args.auctionId),
      )
      .collect();

    const wanted = new Set(args.values);
    const counts = new Map<number, number>();
    for (const b of bids) {
      if (b.status !== "ACCEPTED") continue;
      if (!wanted.has(b.bidValueSantims)) continue;
      counts.set(b.bidValueSantims, (counts.get(b.bidValueSantims) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([valueSantims, count]) => ({
      valueSantims,
      count,
    }));
  },
});

/** The signed-in user's bids for one auction. */
export const getMyBidsForAuction = query({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_user", (q) =>
        q.eq("auctionId", args.auctionId).eq("userId", userId),
      )
      .collect();
    return bids.sort((a, b) => b.acceptedAt - a.acceptedAt);
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Place a bid — the atomic core (spec §14–17).
 * Validates every rule, charges the fee, creates the bid, and writes the
 * outbox event in ONE transaction. Accepted exactly once, or not at all.
 */
export const placeBid = mutation({
  args: {
    auctionId: v.id("auctions"),
    bidValueSantims: v.number(),
    idempotencyKey: v.string(),
    acceptedTerms: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");

    const user = await ctx.db.get(userId);
    if (!user || (user.status && user.status !== "ACTIVE")) {
      throw new Error("USER_NOT_ELIGIBLE");
    }
    if (!args.acceptedTerms) throw new Error("TERMS_NOT_ACCEPTED");

    const now = Date.now(); // server time only (spec §30)

    // Idempotency replay: return the original outcome (spec §17).
    const idem = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", `place_bid:${userId}`).eq("key", args.idempotencyKey),
      )
      .unique();
    if (idem) {
      const existingBid = await ctx.db
        .query("auctionBids")
        .withIndex("by_auction_user_idem", (q) =>
          q
            .eq("auctionId", args.auctionId)
            .eq("userId", userId)
            .eq("idempotencyKey", args.idempotencyKey),
        )
        .first();
      if (existingBid) {
        return { bidId: existingBid._id, replayed: true };
      }
      return { bidId: null, replayed: true };
    }

    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");

    // Rule 3–4: auction OPEN and server time before close.
    if (auction.status !== "OPEN" && auction.status !== "CLOSING") {
      throw new Error("AUCTION_NOT_OPEN");
    }
    if (now >= auction.closesAt) throw new Error("AUCTION_CLOSED");

    // Rule 5: within allowed range.
    const { bidValueSantims } = args;
    if (
      bidValueSantims < auction.minBidSantims ||
      bidValueSantims > auction.maxBidSantims
    ) {
      throw new Error("BID_OUT_OF_RANGE");
    }

    // Rule 6: increment grid.
    if (auction.bidIncrementSantims > 0) {
      if (
        (bidValueSantims - auction.minBidSantims) % auction.bidIncrementSantims !==
        0
      ) {
        throw new Error("BID_NOT_ON_INCREMENT");
      }
    }

    // Rule 7: per-user bid cap (spec §12).
    const myBids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_user", (q) =>
        q.eq("auctionId", args.auctionId).eq("userId", userId),
      )
      .collect();
    const accepted = myBids.filter((b) => b.status === "ACCEPTED");
    if (accepted.length >= auction.maximumBidsPerUser) {
      throw new Error("BID_LIMIT_REACHED");
    }

    // Rule 9: consecutive-bid policy (spec §13).
    if (auction.consecutiveBidPolicy !== "NONE") {
      const allowed = isConsecutiveBidAllowed(
        auction.consecutiveBidPolicy,
        auction.bidIncrementSantims,
        bidValueSantims,
        accepted.map((b) => b.bidValueSantims),
      );
      if (!allowed) throw new Error("CONSECUTIVE_BID_BLOCKED");
    }

    // Create bid first so the ledger can reference it.
    const bidId = await ctx.db.insert("auctionBids", {
      auctionId: auction._id,
      userId,
      bidValueSantims,
      bidServiceFeeSantims: auction.bidServiceFeeSantims,
      idempotencyKey: args.idempotencyKey,
      acceptedAt: now,
      status: "ACCEPTED",
    });

    // Rule 8 + atomicity: fee and bid commit together (spec §15).
    try {
      await chargeBidFee(ctx, {
        userId,
        feeSantims: auction.bidServiceFeeSantims,
        bidId,
        now,
      });
    } catch (err) {
      if (err instanceof LedgerError && err.message === "INSUFFICIENT_FUNDS") {
        // Bid cannot exist without its fee — undo within this transaction.
        ctx.db.delete(bidId);
        throw new Error("INSUFFICIENT_BALANCE");
      }
      throw err;
    }

    // Denormalized counters for display.
    const allBids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_value", (q) => q.eq("auctionId", auction._id))
      .collect();
    const acceptedAll = allBids.filter((b) => b.status === "ACCEPTED");
    const valueCounts = new Map<number, number>();
    for (const b of acceptedAll) {
      valueCounts.set(b.bidValueSantims, (valueCounts.get(b.bidValueSantims) ?? 0) + 1);
    }
    let uniqueCount = 0;
    for (const c of valueCounts.values()) if (c === 1) uniqueCount++;

    ctx.db.patch(auction._id, {
      bidCount: acceptedAll.length,
      uniqueBidCount: uniqueCount,
      updatedAt: now,
    });

    // Outbox event (spec §18) — consumers must be idempotent.
    await ctx.db.insert("outboxEvents", {
      eventType: "BID_ACCEPTED",
      payload: {
        bidId,
        auctionId: auction._id,
        userId,
        bidValueSantims,
        feeSantims: auction.bidServiceFeeSantims,
      },
      processed: false,
      createdAt: now,
    });

    await insertNotification(ctx, {
      userId,
      type: "BID_ACCEPTED",
      title: "Bid confirmed",
      body: `Your bid of ${(bidValueSantims / 100).toFixed(2)} ETB in ${auction.auctionCode} was accepted.`,
      auctionId: auction._id,
      now,
    });

    // Record idempotency key LAST: replays return the original result.
    await ctx.db.insert("idempotencyKeys", {
      scope: `place_bid:${userId}`,
      userId,
      auctionId: auction._id,
      key: args.idempotencyKey,
      createdAt: now,
    });

    return { bidId, replayed: false };
  },
});

/** Public recent winners for the landing page (presentation only). */
export const recentWinners = query({
  args: {},
  handler: async (ctx) => {
    const results = await ctx.db
      .query("auctionResults")
      .order("desc")
      .take(12);

    const winners = [];
    for (const r of results) {
      if (r.resolution !== "WINNER" || !r.winnerUserId) continue;
      const auction = await ctx.db.get(r.auctionId);
      const winner = await ctx.db.get(r.winnerUserId);
      const prize = auction ? await ctx.db.get(auction.prizeId) : null;
      winners.push({
        resultId: r._id,
        auctionCode: auction?.auctionCode ?? "",
        prizeTitle: prize?.title ?? auction?.title ?? "Prize",
        winnerName: winner?.name ?? null,
        winningBidValueSantims: r.winningBidValueSantims ?? 0,
        bidCount: r.totalBids,
        resolvedAt: r.resolvedAt,
      });
      if (winners.length >= 6) break;
    }
    return winners;
  },
});

/**
 * Settle a CLOSED auction — deterministic winner resolution (spec §27–31).
 * Delegates to the shared settlement lib (unique-fence guarded).
 */
export const settleAuction = mutation({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    return settleAuctionInternal(ctx, args.auctionId);
  },
});
