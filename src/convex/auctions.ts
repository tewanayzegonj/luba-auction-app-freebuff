import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  query,
} from "./_generated/server";
import { attemptBid } from "./lib/bidCore";
import { insertNotification } from "./lib/notifications";
import { assertBidMinInterval, assertRateLimit } from "./lib/rateLimit";
import { settleAuctionInternal } from "./lib/settlement";
import { resolveLowestUniqueBid } from "./lib/winner";

/**
 * Auction engine - spec §11-17, §27, §30-31.
 * All validation and time comes from the server. Clients never decide.
 */

// ─── Queries ────────────────────────────────────────────────────────────────

/** Public listing: OPEN/CLOSING auctions, soonest-closing first. */
export const listOpenAuctions = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const auctions = await ctx.db
      .query("auctions")
      .withIndex("by_status", (q) => q.eq("status", "OPEN"))
      .collect();
    const closing = await ctx.db
      .query("auctions")
      .withIndex("by_status", (q) => q.eq("status", "CLOSING"))
      .collect();

    // Defensive: never render a dead auction, even between lifecycle ticks -
    // a close time in the past means it must not be listed as open.
    // Sandbox marker: [SIM] concurrency-test auctions are never public,
    // even if sim rows linger in the database (they're purged separately).
    const all = [...auctions, ...closing]
      .filter((a) => a.closesAt > now && !a.auctionCode.startsWith("SIM-"))
      .sort((a, b) => a.closesAt - b.closesAt);

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
          participantCount: auction.participantCount ?? 0,
          viewCount: auction.viewCount ?? 0,
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

/**
 * Compact summaries for specific auctions by ID - lets the Dashboard render
 * correct titles for bids on CLOSED auctions (listOpenAuctions only covers
 * live ones). Public-safe: title, code, status, close time only.
 */
export const getAuctionSummaries = query({
  args: { ids: v.array(v.id("auctions")) },
  handler: async (ctx, args) => {
    const unique = [...new Set(args.ids)].slice(0, 100);
    return Promise.all(
      unique.map(async (id) => {
        const a = await ctx.db.get(id);
        if (!a) return null;
        const prize = await ctx.db.get(a.prizeId);
        return {
          _id: a._id,
          auctionCode: a.auctionCode,
          title: a.title,
          prizeTitle: prize?.title ?? null,
          status: a.status,
          closesAt: a.closesAt,
        };
      }),
    );
  },
});

/** Public detail for an auction by code, joined with prize + recent bid stats. */
/**
 * Record a detail-page view (P3.8). Throttled per user+auction via
 * sessionStorage on the client - the server just increments. Best-effort:
 * view stats are presentation metrics, not financial truth.
 */
export const recordAuctionView = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const auction = await ctx.db
      .query("auctions")
      .withIndex("by_code", (q) => q.eq("auctionCode", args.code))
      .unique();
    if (!auction) return { ok: false as const };
    await ctx.db.patch(auction._id, {
      viewCount: (auction.viewCount ?? 0) + 1,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

export const getAuctionByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const auction = await ctx.db
      .query("auctions")
      .withIndex("by_code", (q) => q.eq("auctionCode", args.code))
      .unique();
    // Sandbox marker: sim auctions are not addressable by the public detail
    // route - a lingering sim row can't render as a real auction page.
    if (!auction || auction.auctionCode.startsWith("SIM-")) return null;

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
      participantCount: auction.participantCount ?? 0,
      viewCount: auction.viewCount ?? 0,
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
 * bids - never the full distribution, which would enable strategic
 * scraping. Presentation data only; never authoritative for settlement.
 */
export const getUniquenessForValues = query({
  args: { auctionId: v.id("auctions"), values: v.array(v.number()) },
  handler: async (ctx, args) => {
    if (args.values.length === 0) return [];

    // Phase 6: one bounded indexed read per requested value (take(2) is all
    // uniqueness display needs - 1 = unique, ≥2 = taken) instead of scanning
    // the whole auction's bid set on every keystroke.
    const counts: { valueSantims: number; count: number }[] = [];
    for (const value of args.values) {
      const rows = await ctx.db
        .query("auctionBids")
        .withIndex("by_auction_value", (q) =>
          q.eq("auctionId", args.auctionId).eq("bidValueSantims", value),
        )
        .take(2);
      let count = 0;
      for (const b of rows) {
        if (b.status === "ACCEPTED") count++;
      }
      if (count > 0 || rows.length === 0) counts.push({ valueSantims: value, count });
    }
    return counts;
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
 * Place a bid - the atomic core (spec §14-17).
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

    // Rate limits (spec §40, Phase 6): 1 bid / 1.5s per user (anti-bot
    // floor) + 20 bids / 10s per user per auction (burst ceiling).
    await assertBidMinInterval(ctx, userId);
    await assertRateLimit(ctx, { scope: "BID", key: `${userId}:${args.auctionId}` });

    // Responsible play: self-exclusion is absolute (spec-aligned safety).
    if ((user.selfExcludedUntil ?? 0) > Date.now()) {
      throw new Error("SELF_EXCLUDED");
    }

    // Fraud velocity guard (spec §39): >15 accepted bids in 10 min signals.
    const tenMinAgo = Date.now() - 600_000;
    const recentAccepted = await ctx.db
      .query("auctionBids")
      .withIndex("by_user", (q) => q.eq("userId", userId).gt("acceptedAt", tenMinAgo))
      .take(20);
    if (recentAccepted.length >= 15) {
      await ctx.scheduler.runAfter(0, internal.growth.recordFraudSignalInternal, {
        userId,
        signal: "BID_VELOCITY",
        severity: "MEDIUM",
        details: `${recentAccepted.length} accepted bids in 10 minutes`,
      });
    }

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

    // Rule 3-4: auction OPEN and server time before close.
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

    // Rules 7-9 + fee charge (spec §12, §13, §15) via the shared core:
    // index-driven, no auction-row writes, no full-auction scans (Phase 6).
    const attempt = await attemptBid(ctx, {
      auction,
      userId,
      bidValueSantims,
      idempotencyKey: args.idempotencyKey,
      now,
    });
    if (!attempt.ok) {
      if (attempt.code === "INSUFFICIENT_BALANCE") {
        throw new Error("INSUFFICIENT_BALANCE");
      }
      throw new Error(attempt.code);
    }
    const bidId = attempt.bidId;

    // Anti-snipe soft-close (popcorn bidding): a bid inside the final window
    // pushes the close time out so human bidders on slow mobile connections
    // retain a real chance to react. One OCC-serialized patch per auction
    // row - contention is bounded to the final-minute frenzy by design.
    const ANTI_SNIPE_WINDOW_MS = 60_000;
    const ANTI_SNIPE_EXTENSION_MS = 120_000;
    if (
      auction.closesAt - now < ANTI_SNIPE_WINDOW_MS &&
      !auction.antiSnipeDisabled
    ) {
      await ctx.db.patch(auction._id, {
        closesAt: now + ANTI_SNIPE_EXTENSION_MS,
        updatedAt: now,
      });
      await insertNotification(ctx, {
        userId,
        type: "AUCTION_EXTENDED",
        title: "Auction extended",
        body: `${auction.auctionCode} was extended - a bid landed in the final minute. New close time applies.`,
        auctionId: auction._id,
        now,
      });
    }

    // Phase 6: display counters are refreshed by a throttled background
    // reconciler, never inside the bid transaction - per-bid patches on the
    // auction document would serialize every concurrent bidder through OCC
    // retries.
    await ctx.scheduler.runAfter(
      5_000,
      internal.auctions.reconcileAuctionCounters,
      { auctionId: auction._id },
    );

    // Outbox event (spec §18) - consumers must be idempotent.
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

    // Referral reward: a referee's first successful bid-fee triggers the
    // promo grants (idempotent - PENDING → REWARDED fence inside).
    if (user.referredBy) {
      await ctx.scheduler.runAfter(0, internal.growth.rewardReferralInternal, {
        refereeId: userId,
        bidId,
      });
    }

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

/**
 * Recompute denormalized display counters from accepted bids and store with
 * a staleness timestamp. Presentation-only - winner resolution recomputes
 * from bid rows and never reads these (Invariant 7).
 */
async function refreshAuctionCounters(
  ctx: MutationCtx,
  auctionId: Id<"auctions">,
): Promise<number> {
  const now = Date.now();
  const bids = await ctx.db
    .query("auctionBids")
    .withIndex("by_auction_value", (q) => q.eq("auctionId", auctionId))
    .collect();
  const accepted = bids.filter((b) => b.status === "ACCEPTED");
  const valueCounts = new Map<number, number>();
  for (const b of accepted) {
    valueCounts.set(b.bidValueSantims, (valueCounts.get(b.bidValueSantims) ?? 0) + 1);
  }
  let uniqueCount = 0;
  for (const c of valueCounts.values()) if (c === 1) uniqueCount++;
  const participants = new Set<string>();
  for (const b of accepted) participants.add(b.userId);

  ctx.db.patch(auctionId, {
    bidCount: accepted.length,
    uniqueBidCount: uniqueCount,
    participantCount: participants.size,
    countersUpdatedAt: now,
    updatedAt: now,
  });
  return accepted.length;
}

/** Scheduled a few seconds after each accepted bid (Phase 6). */
export const reconcileAuctionCounters = internalMutation({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    const bidCount = await refreshAuctionCounters(ctx, args.auctionId);
    return { bidCount };
  },
});

/**
 * Cron sweep (Phase 6): refresh counters for live auctions whose numbers
 * are older than 30s. Bounded to OPEN/CLOSING auctions via the status index.
 */
export const sweepStaleCounters = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30_000;
    let refreshed = 0;
    for (const status of ["OPEN", "CLOSING"] as const) {
      const auctions = await ctx.db
        .query("auctions")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const auction of auctions) {
        if ((auction.countersUpdatedAt ?? 0) >= cutoff) continue;
        await refreshAuctionCounters(ctx, auction._id);
        refreshed++;
      }
    }
    return { refreshed };
  },
});

/** Public recent winners for the landing page (presentation only). */
export const recentWinners = query({
  args: {},
  handler: async (ctx) => {
    const results = await ctx.db
      .query("auctionResults")
      .order("desc")
      .take(30);

    const winners = [];
    for (const r of results) {
      if (r.resolution !== "WINNER" || !r.winnerUserId) continue;
      const auction = await ctx.db.get(r.auctionId);
      // Sandbox marker: sim settlements never appear on the public ledger.
      if (!auction || auction.auctionCode.startsWith("SIM-")) continue;
      const winner = await ctx.db.get(r.winnerUserId);
      const prize = auction ? await ctx.db.get(auction.prizeId) : null;
      const prizeImageUrl =
        prize?.imageStorageId !== undefined
          ? await ctx.storage.getUrl(prize.imageStorageId)
          : prize?.imageUrl;
      winners.push({
        resultId: r._id,
        auctionCode: auction?.auctionCode ?? "",
        prizeTitle: prize?.title ?? auction?.title ?? "Prize",
        prizeImageUrl,
        prizeEmoji: prize?.emoji ?? null,
        winnerName: winner?.name ?? null,
        winningBidValueSantims: r.winningBidValueSantims ?? 0,
        bidCount: r.totalBids,
        resolvedAt: r.resolvedAt,
      });
      if (winners.length >= 12) break;
    }
    return winners;
  },
});

/**
 * Settle a CLOSED auction - deterministic winner resolution (spec §27-31).
 * Delegates to the shared settlement lib (unique-fence guarded).
 */
export const settleAuction = mutation({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    return settleAuctionInternal(ctx, args.auctionId);
  },
});
