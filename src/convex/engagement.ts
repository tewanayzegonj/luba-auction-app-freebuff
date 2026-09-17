import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { attemptBid } from "./lib/bidCore";
import { insertNotification } from "./lib/notifications";

/**
 * Engagement backend (spec §33, §38, §40, §58):
 *  - Watchlist with ending-soon alerts (Telegram/SMS via outbox).
 *  - Scheduled bids: queue now, execute via cron when due.
 *  - Per-user notification preferences (default: all on).
 *  - Payment-deadline chaser (cron).
 *  - Reconciliation worker (cron): ledger ↔ wallet ↔ payments invariants.
 *  - Responsible-play deposit cap enforcement (in initiateTopUp path).
 */

const ENDING_SOON_WINDOW_MS = 30 * 60 * 1000; // alert 30 min before close

// ─── Watchlist ──────────────────────────────────────────────────────────────

export const listWatchlist = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("watchlist")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const out = [];
    for (const row of rows) {
      const auction = await ctx.db.get(row.auctionId);
      if (!auction) continue;
      const prize = await ctx.db.get(auction.prizeId);
      out.push({
        watchId: row._id,
        auctionId: auction._id,
        auctionCode: auction.auctionCode,
        title: auction.title,
        prizeTitle: prize?.title ?? null,
        prizeImage: prize?.imageUrl ?? null,
        prizeEmoji: prize?.emoji ?? null,
        status: auction.status,
        closesAt: auction.closesAt,
        bidCount: auction.bidCount,
      });
    }
    return out.sort((a, b) => a.closesAt - b.closesAt);
  },
});

export const toggleWatchlist = mutation({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    const existing = await ctx.db
      .query("watchlist")
      .withIndex("by_auction", (q) => q.eq("auctionId", args.auctionId))
      .collect()
      .then((rows) => rows.find((r) => r.userId === userId));
    if (existing) {
      await ctx.db.delete(existing._id);
      return { watching: false };
    }
    await ctx.db.insert("watchlist", {
      userId,
      auctionId: args.auctionId,
      createdAt: Date.now(),
    });
    return { watching: true };
  },
});

export const isWatching = query({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return false;
    const rows = await ctx.db
      .query("watchlist")
      .withIndex("by_auction", (q) => q.eq("auctionId", args.auctionId))
      .collect();
    return rows.some((r) => r.userId === userId);
  },
});

/** Cron: alert watchers 30 min before close. Idempotent via prefs + window. */
export const processEndingSoon = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const open = await ctx.db
      .query("auctions")
      .withIndex("by_status", (q) => q.eq("status", "OPEN"))
      .collect();
    let alerted = 0;
    for (const auction of open) {
      const toClose = auction.closesAt - now;
      if (toClose > ENDING_SOON_WINDOW_MS || toClose <= 0) continue;
      const watchers = await ctx.db
        .query("watchlist")
        .withIndex("by_auction", (q) => q.eq("auctionId", auction._id))
        .collect();
      const prize = await ctx.db.get(auction.prizeId);
      for (const w of watchers) {
        // One alert per auction per user: dedupe on their notifications.
        const sent = await ctx.db
          .query("notifications")
          .withIndex("by_user", (q) => q.eq("userId", w.userId))
          .order("desc")
          .take(20);
        if (
          sent.some(
            (n) =>
              n.type === "AUCTION_ENDING" && n.auctionId === auction._id,
          )
        ) {
          continue;
        }
        await insertNotification(ctx, {
          userId: w.userId,
          type: "AUCTION_ENDING",
          title: "Ending soon ⏰",
          body: `${prize?.title ?? auction.title} closes at ${new Date(
            auction.closesAt,
          ).toLocaleTimeString()} - get your unique bid in.`,
          auctionId: auction._id,
          now,
        });
        alerted++;
      }
    }
    return { alerted };
  },
});

// ─── Scheduled bids ─────────────────────────────────────────────────────────

export const scheduleBid = mutation({
  args: {
    auctionId: v.id("auctions"),
    bidValueSantims: v.number(),
    executeAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    const user = await ctx.db.get(userId);
    if (!user || (user.status && user.status !== "ACTIVE")) {
      throw new Error("USER_NOT_ELIGIBLE");
    }
    if ((user.selfExcludedUntil ?? 0) > Date.now()) {
      throw new Error("SELF_EXCLUDED");
    }
    if (args.executeAt < Date.now() + 60_000) {
      throw new Error("Scheduled bids must be at least a minute ahead.");
    }
    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (
      args.bidValueSantims < auction.minBidSantims ||
      args.bidValueSantims > auction.maxBidSantims
    ) {
      throw new Error("BID_OUT_OF_RANGE");
    }
    const random: RandomReader = {
      read(bytes: Uint8Array<ArrayBuffer>) {
        crypto.getRandomValues(bytes);
      },
    };
    await ctx.db.insert("scheduledBids", {
      userId,
      auctionId: args.auctionId,
      bidValueSantims: args.bidValueSantims,
      idempotencyKey: `sched-${generateRandomString(random, "abcdefghijklmnopqrstuvwxyz0123456789", 16)}`,
      executeAt: args.executeAt,
      status: "QUEUED",
      createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});

export const listMyScheduledBids = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const all = await ctx.db
      .query("scheduledBids")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();
    const out = [];
    for (const s of all.sort((a, b) => a.executeAt - b.executeAt)) {
      const auction = await ctx.db.get(s.auctionId);
      out.push({
        _id: s._id,
        auctionCode: auction?.auctionCode ?? "?",
        bidValueSantims: s.bidValueSantims,
        executeAt: s.executeAt,
        status: s.status,
        failureReason: s.failureReason ?? null,
      });
    }
    return out;
  },
});

export const cancelScheduledBid = mutation({
  args: { id: v.id("scheduledBids") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== userId) throw new Error("NOT_FOUND");
    if (row.status !== "QUEUED") throw new Error("NOT_CANCELABLE");
    await ctx.db.patch(args.id, { status: "CANCELLED" });
    return { ok: true as const };
  },
});

/** Cron: execute due scheduled bids through the same engine as manual bids. */
export const processScheduledBids = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("scheduledBids")
      .withIndex("by_status_time", (q) => q.eq("status", "QUEUED"))
      .collect()
      .then((rows) => rows.filter((r) => r.executeAt <= now))
      .then((rows) => rows.slice(0, 25));
    let executed = 0;
    let failed = 0;
    for (const s of due) {
      const auction = await ctx.db.get(s.auctionId);
      try {
        if (!auction) throw new Error("AUCTION_NOT_FOUND");
        if (auction.status !== "OPEN" && auction.status !== "CLOSING") {
          throw new Error("AUCTION_NOT_OPEN");
        }
        if (now >= auction.closesAt) throw new Error("AUCTION_CLOSED");
        // Execute through the shared rules core (Phase 6): one code path for
        // every bid - same validation, same atomic fee, no auction-row writes.
        const attempt = await attemptBid(ctx, {
          auction,
          userId: s.userId,
          bidValueSantims: s.bidValueSantims,
          idempotencyKey: s.idempotencyKey,
          now,
        });
        if (!attempt.ok) {
          throw new Error(attempt.code);
        }
        const bidId = attempt.bidId;
        await ctx.scheduler.runAfter(
          5_000,
          internal.auctions.reconcileAuctionCounters,
          { auctionId: auction._id },
        );
        await ctx.db.patch(s._id, { status: "EXECUTED", bidId });
        await insertNotification(ctx, {
          userId: s.userId,
          type: "BID_ACCEPTED",
          title: "Scheduled bid placed",
          body: `Your scheduled bid of ${(s.bidValueSantims / 100).toFixed(2)} ETB was placed in ${auction.auctionCode}.`,
          auctionId: s.auctionId,
          now,
        });
        executed++;
      } catch (err) {
        await ctx.db.patch(s._id, {
          status: "FAILED",
          failureReason: err instanceof Error ? err.message : "UNKNOWN",
        });
        failed++;
      }
    }
    return { executed, failed };
  },
});

// ─── Notification preferences ───────────────────────────────────────────────

export const getMyNotificationPrefs = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const row = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // Default: everything on.
    return (
      row ?? {
        userId,
        BID_ACCEPTED: true,
        AUCTION_ENDING: true,
        WINNER_ANNOUNCED: true,
        PAYMENT_REMINDER: true,
        PAYMENT_SUCCESS: true,
        PRIZE_STATUS: true,
        WATCHLIST_ALERT: true,
        updatedAt: 0,
      }
    );
  },
});

export const setNotificationPref = mutation({
  args: { key: v.string(), value: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    const allowed = [
      "BID_ACCEPTED",
      "AUCTION_ENDING",
      "WINNER_ANNOUNCED",
      "PAYMENT_REMINDER",
      "PAYMENT_SUCCESS",
      "PRIZE_STATUS",
      "WATCHLIST_ALERT",
    ];
    if (!allowed.includes(args.key)) throw new Error("INVALID_KEY");
    const row = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, {
        [args.key]: args.value,
        updatedAt: Date.now(),
      } as never);
    } else {
      await ctx.db.insert("notificationPrefs", {
        userId,
        [args.key]: args.value,
        updatedAt: Date.now(),
      } as never);
    }
    return { ok: true as const };
  },
});

/**
 * Delivery gate used by the outbox worker: does this user want this
 * notification type on any channel?
 */
export const userWantsTypeInternal = internalQuery({
  args: { userId: v.id("users"), type: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!row) return true; // default on
    const value = (row as Record<string, unknown>)[args.type];
    return value === undefined ? true : value === true;
  },
});

// ─── Payment deadline chaser (cron) ─────────────────────────────────────────

export const chasePaymentDeadlines = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("winnerSettlements")
      .withIndex("by_status_deadline", (q) =>
        q.eq("status", "PENDING_PAYMENT"),
      )
      .collect();
    let reminders = 0;
    for (const s of pending) {
      const toDeadline = s.paymentDeadline - now;
      // Remind at T-24h and T-2h windows; dedupe via notification history.
      if (toDeadline < 24 * 3600_000 || toDeadline < 2 * 3600_000) {
        const prior = await ctx.db
          .query("notifications")
          .withIndex("by_user", (q) => q.eq("userId", s.winnerUserId))
          .order("desc")
          .take(20);
        const already = prior.filter(
          (n) => n.type === "PAYMENT_REMINDER",
        ).length;
        const tier = toDeadline < 2 * 3600_000 ? 2 : 1;
        if (already >= tier) continue;
        const auction = await ctx.db.get(s.auctionId);
        await insertNotification(ctx, {
          userId: s.winnerUserId,
          type: "PAYMENT_REMINDER",
          title:
            tier === 2
              ? "Final reminder: pay your winning bid"
              : "Reminder: pay your winning bid",
          body: `Your winning bid in ${auction?.auctionCode ?? "an auction"} must be paid by ${new Date(
            s.paymentDeadline,
          ).toLocaleString()} or the prize will be forfeited.`,
          auctionId: s.auctionId,
          now,
        });
        reminders++;
      }
    }
    return { reminders };
  },
});

// ─── Reconciliation worker (spec §58) ───────────────────────────────────────

export const reconcileInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const issues: string[] = [];

    // Invariant 2: no wallet balance negative.
    const wallets = await ctx.db.query("wallets").collect();
    for (const w of wallets) {
      if (w.paidBalanceSantims < 0 || w.promoBalanceSantims < 0) {
        issues.push(`WALLET_NEGATIVE:${w.userId}`);
      }
    }

    // Wallet projection vs ledger truth (per user paid account).
    for (const w of wallets) {
      const account = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_code", (q) =>
          q.eq("code", `USER_PAID:${w.userId}`),
        )
        .unique();
      if (account && account.balanceSantims !== w.paidBalanceSantims) {
        issues.push(
          `WALLET_LEDGER_MISMATCH:${w.userId}:wallet=${w.paidBalanceSantims}:ledger=${account.balanceSantims}`,
        );
      }
    }

    // Invariant 1: every ledger transaction balances.
    const recentTxs = await ctx.db
      .query("ledgerTransactions")
      .order("desc")
      .take(500);
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
      if (debits !== credits) {
        issues.push(`TX_UNBALANCED:${tx._id}`);
      }
    }

    // PENDING payments shouldn't linger > 24h.
    const dayAgo = Date.now() - 86_400_000;
    const stalePayments = await ctx.db
      .query("payments")
      .withIndex("by_status", (q) => q.eq("status", "PENDING"))
      .collect()
      .then((rows) => rows.filter((p) => p.createdAt < dayAgo));
    for (const p of stalePayments) {
      issues.push(`STALE_PENDING_PAYMENT:${p.merchantReference}`);
    }

    if (issues.length > 0) {
      await ctx.db.insert("outboxEvents", {
        eventType: "RECONCILIATION_ALERT",
        payload: { issues: issues.slice(0, 50), total: issues.length },
        processed: false,
        createdAt: Date.now(),
      });
    }
    return { checked: true, issues: issues.length, sample: issues.slice(0, 10) };
  },
});

// ─── Responsible-play: deposit cap check used by payments ───────────────────

export const assertDepositAllowedInternal = internalQuery({
  args: { userId: v.id("users"), amountSantims: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { allowed: false, reason: "USER_NOT_FOUND" };
    const now = Date.now();
    if ((user.selfExcludedUntil ?? 0) > now) {
      return { allowed: false, reason: "SELF_EXCLUDED" };
    }
    // A raised cap only takes effect after its 24h cooling period.
    const cap =
      user.selfDepositCapPendingSince !== undefined &&
      user.selfDepositCapPendingSince + 86_400_000 <= now
        ? user.selfDepositCapSantims
        : user.selfDepositCapSantims;
    if (cap === undefined) return { allowed: true };
    const dayStart = now - 86_400_000;
    const todays = await ctx.db
      .query("payments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()
      .then((rows) =>
        rows.filter(
          (p) =>
            p.kind === "DEPOSIT" &&
            p.status === "COMPLETED" &&
            p.createdAt >= dayStart,
        ),
      );
    const depositedToday = todays.reduce((sum, p) => sum + p.amountSantims, 0);
    if (depositedToday + args.amountSantims > cap) {
      return {
        allowed: false,
        reason: "DEPOSIT_CAP",
        capSantims: cap,
        depositedTodaySantims: depositedToday,
      };
    }
    return { allowed: true };
  },
});
