import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation } from "./_generated/server";
import { settleAuctionInternal } from "./lib/settlement";

/**
 * Auction lifecycle worker — spec §9, §30.
 * Server-authoritative transitions driven by server time:
 *   SCHEDULED → OPEN → CLOSING → CLOSED → SETTLING → COMPLETED
 * Closure stops bid acceptance (placeBid re-checks status atomically).
 */

/** Advance all auctions whose opensAt/closesAt have passed. Safe to run often. */
export const tickLifecycle = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // SCHEDULED → OPEN
    const scheduled = await ctx.db
      .query("auctions")
      .withIndex("by_status", (q) => q.eq("status", "SCHEDULED"))
      .collect();
    for (const a of scheduled) {
      if (a.opensAt <= now && a.closesAt > now) {
        ctx.db.patch(a._id, { status: "OPEN", updatedAt: now });
      } else if (a.closesAt <= now) {
        // Never opened long enough — close it directly.
        ctx.db.patch(a._id, { status: "CLOSED", updatedAt: now });
      }
    }

    // OPEN → CLOSING → CLOSED (server-time driven; §30)
    const open = await ctx.db
      .query("auctions")
      .withIndex("by_status", (q) => q.eq("status", "OPEN"))
      .collect();
    for (const a of open) {
      if (a.closesAt <= now) {
        ctx.db.patch(a._id, { status: "CLOSED", updatedAt: now });
      }
    }

    const closing = await ctx.db
      .query("auctions")
      .withIndex("by_status", (q) => q.eq("status", "CLOSING"))
      .collect();
    for (const a of closing) {
      if (a.closesAt <= now) {
        ctx.db.patch(a._id, { status: "CLOSED", updatedAt: now });
      }
    }

    // CLOSED → SETTLING → COMPLETED via deterministic settlement (§27).
    const closed = await ctx.db
      .query("auctions")
      .withIndex("by_status", (q) => q.eq("status", "CLOSED"))
      .collect();
    for (const a of closed) {
      ctx.db.patch(a._id, { status: "SETTLING", updatedAt: now });
      await settleAuctionInternal(ctx, a._id);
    }

    return { processedAt: now };
  },
});

/**
 * Process pending outbox events (spec §18). At-least-once delivery —
 * marking processed is the dedupe boundary for consumers.
 *
 * NOTIFICATION events are fanned out to the delivery worker (Telegram for
 * linked accounts, SMS where enabled); everything else is consumed here.
 */
export const processOutbox = internalMutation({
  args: { max: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("outboxEvents")
      .withIndex("by_unprocessed", (q) => q.eq("processed", false))
      .take(args.max ?? 50);

    const notificationPayloads: {
      eventId: Id<"outboxEvents">;
      userId: Id<"users">;
      type: string;
      title: string;
      body: string;
    }[] = [];

    for (const event of pending) {
      if (
        event.eventType === "NOTIFICATION" &&
        typeof event.payload?.userId === "string" &&
        typeof event.payload?.title === "string" &&
        typeof event.payload?.body === "string"
      ) {
        notificationPayloads.push({
          eventId: event._id,
          userId: event.payload.userId as Id<"users">,
          type: typeof event.payload.type === "string" ? event.payload.type : "SYSTEM",
          title: event.payload.title,
          body: event.payload.body,
        });
      }
      ctx.db.patch(event._id, { processed: true, processedAt: now });
    }

    if (notificationPayloads.length > 0) {
      await ctx.scheduler.runAfter(0, internal.outboxWorker.deliverNotifications, {
        events: notificationPayloads,
      });
    }

    return { processed: pending.length, notifications: notificationPayloads.length };
  },
});

/** Dev/utility: seed prizes and a set of auctions if none exist. */
export const seedIfEmpty = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("auctions").first();
    if (existing) return { seeded: false };

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const prizeSpecs = [
      {
        title: "iPhone 17 Pro Max",
        description: "Latest flagship, 512GB, official warranty.",
        category: "Electronics",
        valueSantims: 145_000_00,
        emoji: "📱",
        stock: 1,
      },
      {
        title: "Star Times 43\" Smart TV",
        description: "4K UHD smart television.",
        category: "Electronics",
        valueSantims: 32_000_00,
        emoji: "📺",
        stock: 1,
      },
      {
        title: "Samsung Galaxy A56",
        description: "Dual SIM, 256GB, sealed box.",
        category: "Electronics",
        valueSantims: 45_000_00,
        emoji: "📲",
        stock: 1,
      },
      {
        title: "50,000 ETB Shopping Voucher",
        description: "Redeemable at partner supermarkets.",
        category: "Vouchers",
        valueSantims: 50_000_00,
        emoji: "🛒",
        stock: 1,
      },
      {
        title: "Huawei MatePad 12",
        description: "Tablet with stylus support.",
        category: "Electronics",
        valueSantims: 38_000_00,
        emoji: "💻",
        stock: 1,
      },
      {
        title: "3,000 ETB Airtime Bundle",
        description: "Flexible airtime for any Ethiopian carrier.",
        category: "Vouchers",
        valueSantims: 3_000_00,
        emoji: "📞",
        stock: 1,
      },
    ];

    const prizeIds = [];
    for (const p of prizeSpecs) {
      prizeIds.push(
        await ctx.db.insert("prizes", { ...p, createdAt: now }),
      );
    }

    const auctionConfigs = [
      { opensOffset: -2 * DAY, closesOffset: 3 * DAY, fee: 10_00, status: "OPEN" },
      { opensOffset: -1 * DAY, closesOffset: 5 * DAY, fee: 10_00, status: "OPEN" },
      { opensOffset: -3 * DAY, closesOffset: 6 * DAY, fee: 15_00, status: "OPEN" },
      { opensOffset: 1 * DAY, closesOffset: 8 * DAY, fee: 10_00, status: "SCHEDULED" },
      { opensOffset: 2 * DAY, closesOffset: 10 * DAY, fee: 20_00, status: "SCHEDULED" },
      { opensOffset: -30 * DAY, closesOffset: -2 * DAY, fee: 10_00, status: "OPEN" }, // will be closed/settled by lifecycle
    ];

    let idx = 100;
    for (let i = 0; i < auctionConfigs.length; i++) {
      const cfg = auctionConfigs[i];
      const prizeId = prizeIds[i % prizeIds.length];
      const prize = prizeSpecs[i % prizeSpecs.length];
      idx += 7;
      await ctx.db.insert("auctions", {
        auctionCode: `LUBA-2026-${idx}`,
        title: prize.title,
        description: `Lowest unique bid takes home the ${prize.title}. Bid smart — the lowest amount nobody else picked wins.`,
        prizeId,
        opensAt: now + cfg.opensOffset,
        closesAt: now + cfg.closesOffset,
        status: cfg.status as "OPEN" | "SCHEDULED",
        minBidSantims: 100, // 1.00 ETB
        maxBidSantims: 10_000, // 100.00 ETB
        bidIncrementSantims: 1, // 0.01 ETB grid
        bidServiceFeeSantims: cfg.fee,
        maximumBidsPerUser: 100, // configurable default (spec §12)
        consecutiveBidPolicy: "THREE_THEN_BLOCK_TWO",
        noWinnerPolicy: "CANCEL_AND_REFUND",
        winnerPaymentDeadline: 7 * DAY,
        visibilityPolicy: "PUBLIC",      bidCount: 0,
      uniqueBidCount: 0,
      createdAt: now,
      updatedAt: now,
      });
    }

    await ctx.db.insert("auditLogs", {
      action: "SEED",
      resource: "system",
      details: "Seeded initial prizes and auctions",
      createdAt: now,
    });

    return { seeded: true };
  },
});
