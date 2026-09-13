import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  noWinnerPolicyValidator,
  ROLES,
  roleValidator,
} from "./schema";
import { deposit, ensureWallet, refundUser } from "./lib/finance";
import { ACCOUNT_CODES, postTransaction } from "./lib/ledger";
import { insertAuditLog, insertNotification } from "./lib/notifications";
import { isChapaConfigured } from "./chapa";
import { settleAuctionInternal } from "./lib/settlement";

/**
 * Admin system — spec §41–43 (RBAC, audit logging).
 *
 * Roles live on the users table. The FIRST user on the platform can claim
 * ADMIN in one bootstrap call (checked against the total user count); after
 * that, only an existing admin can grant roles. Every sensitive admin action
 * writes an append-only auditLogs row (spec §43).
 */

/**
 * Guard: throws unless the caller is authenticated and has the admin role.
 * Structurally typed so both query and mutation contexts can call it.
 */
type AdminCheckCtx = Parameters<typeof getAuthUserId>[0] & {
  db: { get: MutationCtx["db"]["get"] };
};

export async function requireAdmin(ctx: AdminCheckCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("UNAUTHENTICATED");
  const user = await ctx.db.get(userId);
  if (!user || user.role !== ROLES.ADMIN) {
    throw new Error("FORBIDDEN_ADMIN_ONLY");
  }
  return userId;
}

// ─── Bootstrap & roles ──────────────────────────────────────────────────────

/**
 * One-time bootstrap: the FIRST registered user may claim the ADMIN role.
 * Afterwards only an existing admin can grant roles via grantRole.
 */
export const bootstrapAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    if (user.role === ROLES.ADMIN) return { granted: true, alreadyAdmin: true };

    const count = await ctx.db.query("users").collect();
    if (count.length !== 1) {
      throw new Error("BOOTSTRAP_CLOSED_ADMIN_EXISTS");
    }

    ctx.db.patch(userId, { role: ROLES.ADMIN });
    await insertAuditLog(ctx, {
      actor: userId,
      action: "ADMIN_BOOTSTRAP",
      resource: `user:${userId}`,
      details: "First user claimed the admin role",
      now: Date.now(),
    });
    return { granted: true, alreadyAdmin: false };
  },
});

/** Grant or change a user's role (admin only, audited). */
export const grantRole = mutation({
  args: { userId: v.id("users"), role: roleValidator },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    if (args.userId === adminId) throw new Error("CANNOT_CHANGE_OWN_ROLE");

    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("USER_NOT_FOUND");

    ctx.db.patch(args.userId, { role: args.role });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "ROLE_GRANTED",
      resource: `user:${args.userId}`,
      details: `role=${args.role}`,
      now: Date.now(),
    });
    return { ok: true };
  },
});

// ─── Platform queries ───────────────────────────────────────────────────────

export const getPlatformStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const [users, auctions, bids, payments, txs, unprocessedOutbox] =
      await Promise.all([
        ctx.db.query("users").collect(),
        ctx.db.query("auctions").collect(),
        ctx.db.query("auctionBids").collect(),
        ctx.db.query("payments").collect(),
        ctx.db.query("ledgerTransactions").collect(),
        ctx.db
          .query("outboxEvents")
          .withIndex("by_unprocessed", (q) => q.eq("processed", false))
          .collect(),
      ]);

    // Ledger invariant 1 check: Σ debits = Σ credits across every transaction.
    const accounts = await ctx.db.query("ledgerAccounts").collect();
    const entries = await ctx.db.query("ledgerEntries").collect();
    const accountById = new Map(accounts.map((a) => [a._id, a]));
    let totalDebits = 0;
    let totalCredits = 0;
    for (const e of entries) {
      const account = accountById.get(e.accountId);
      if (!account) continue;
      if (account.type === "ASSET" || account.type === "EXPENSE") {
        if (e.direction === "DEBIT") totalDebits += e.amountSantims;
        else totalCredits += e.amountSantims;
      } else {
        if (e.direction === "CREDIT") totalCredits += e.amountSantims;
        else totalDebits += e.amountSantims;
      }
    }

    const depositTotal = payments
      .filter((p) => p.status === "COMPLETED" && p.kind === "DEPOSIT")
      .reduce((sum, p) => sum + p.amountSantims, 0);
    const completedPayments = payments.filter(
      (p) => p.status === "COMPLETED",
    ).length;
    const failedPayments = payments.filter((p) => p.status === "FAILED").length;
    const pendingPayments = payments.filter((p) => p.status === "PENDING").length;

    return {
      userCount: users.length,
      activeAuctions: auctions.filter((a) => a.status === "OPEN").length,
      totalAuctions: auctions.length,
      totalBids: bids.filter((b) => b.status === "ACCEPTED").length,
      payments: {
        completed: completedPayments,
        pending: pendingPayments,
        failed: failedPayments,
        depositedSantims: depositTotal,
      },
      ledger: {
        transactionCount: txs.length,
        totalDebitsSantims: totalDebits,
        totalCreditsSantims: totalCredits,
        balanced: totalDebits === totalCredits,
      },
      outboxPending: unprocessedOutbox.length,
    };
  },
});

/** User management list with search + status filter. */
export const listUsers = query({
  args: {
    statusFilter: v.optional(
      v.union(
        v.literal("ACTIVE"),
        v.literal("SUSPENDED"),
        v.literal("RESTRICTED"),
        v.literal("LOCKED"),
        v.literal("CLOSED"),
      ),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    let users = await ctx.db.query("users").collect();
    if (args.statusFilter) {
      users = users.filter((u) => u.status === args.statusFilter);
    }
    if (args.search) {
      const q = args.search.toLowerCase();
      users = users.filter(
        (u) =>
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.name ?? "").toLowerCase().includes(q),
      );
    }

    const wallets = await ctx.db.query("wallets").collect();
    const walletByUser = new Map(wallets.map((w) => [w.userId, w]));

    return users
      .sort((a, b) => a._creationTime - b._creationTime)
      .slice(-100)
      .map((u) => ({
        id: u._id,
        email: u.email ?? null,
        name: u.name ?? null,
        role: u.role ?? null,
        status: u.status ?? "ACTIVE",
        kycStatus: u.kycStatus ?? "UNVERIFIED",
        walletSantims: walletByUser.get(u._id)?.paidBalanceSantims ?? 0,
      }));
  },
});

/** All payments platform-wide, newest first (reconciliation view). */
export const listPaymentsAdmin = query({
  args: { statusFilter: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("payments").collect();
    const filtered = args.statusFilter
      ? rows.filter((p) => p.status === args.statusFilter)
      : rows;
    const users = await ctx.db.query("users").collect();
    const emailById = new Map(users.map((u) => [u._id, u.email ?? "—"]));
    return filtered
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((p) => ({
        id: p._id,
        email: emailById.get(p.userId) ?? "—",
        amountSantims: p.amountSantims,
        kind: p.kind,
        provider: p.provider,
        status: p.status,
        merchantReference: p.merchantReference,
        createdAt: p.createdAt,
      }));
  },
});

/** Append-only audit trail (spec §43). */
export const listAuditLogs = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const logs = await ctx.db.query("auditLogs").collect();
    const users = await ctx.db.query("users").collect();
    const emailById = new Map(users.map((u) => [u._id, u.email ?? "system"]));
    return logs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((l) => ({
        id: l._id,
        actor: l.actor ? (emailById.get(l.actor) ?? "unknown") : "system",
        action: l.action,
        resource: l.resource,
        details: l.details ?? null,
        createdAt: l.createdAt,
      }));
  },
});

// ─── Sensitive actions (all audited) ────────────────────────────────────────

/** Suspend / restrict / reactivate a user (spec §41). */
export const setUserStatus = mutation({
  args: {
    userId: v.id("users"),
    status: v.union(
      v.literal("ACTIVE"),
      v.literal("SUSPENDED"),
      v.literal("RESTRICTED"),
      v.literal("LOCKED"),
      v.literal("CLOSED"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    if (args.userId === adminId) throw new Error("CANNOT_MODIFY_SELF");

    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("USER_NOT_FOUND");

    ctx.db.patch(args.userId, { status: args.status });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "USER_STATUS_CHANGED",
      resource: `user:${args.userId}`,
      details: `status=${args.status} reason=${args.reason}`,
      now: Date.now(),
    });
    await insertNotification(ctx, {
      userId: args.userId,
      type: "SYSTEM",
      title: "Account status updated",
      body: `Your account status is now ${args.status}. Reason: ${args.reason}`,
      now: Date.now(),
    });
    return { ok: true };
  },
});

/** Cancel an auction before/at any pre-completed state and refund all fees. */
export const adminCancelAuction = mutation({
  args: { auctionId: v.id("auctions"), reason: v.string() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (auction.status === "COMPLETED" || auction.status === "CANCELLED") {
      throw new Error("AUCTION_ALREADY_FINISHED");
    }

    const now = Date.now();

    // Refund every accepted bid's service fee (idempotent per bid).
    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_value", (q) => q.eq("auctionId", args.auctionId))
      .collect();
    for (const bid of bids) {
      if (bid.status !== "ACCEPTED") continue;
      await refundUser(ctx, {
        userId: bid.userId,
        amountSantims: bid.bidServiceFeeSantims,
        reason: `Auction cancelled by admin: ${args.reason}`,
        reference: bid._id,
        idempotencyKey: `REFUND:${bid._id}`,
        now,
      });
      ctx.db.patch(bid._id, { status: "REFUNDED" });
    }

    ctx.db.patch(args.auctionId, { status: "CANCELLED", updatedAt: now });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "AUCTION_CANCELLED",
      resource: `auction:${args.auctionId}`,
      details: `reason=${args.reason} refundedBids=${bids.filter((b) => b.status === "REFUNDED").length}`,
      now,
    });
    return { ok: true, refundedBids: bids.length };
  },
});

/** Force settlement of a closed auction (recovery path — the result-row
 *  fence makes this idempotent, Invariant 6). */
export const adminSettleAuction = mutation({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (auction.status !== "CLOSED" && auction.status !== "SETTLING") {
      throw new Error(`AUCTION_NOT_CLOSED_${auction.status}`);
    }

    ctx.db.patch(args.auctionId, { status: "SETTLING", updatedAt: Date.now() });
    const { resultId, replayed } = await settleAuctionInternal(
      ctx,
      args.auctionId,
    );
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "AUCTION_SETTLED_MANUAL",
      resource: `auction:${args.auctionId}`,
      details: `resultId=${resultId} replayed=${replayed}`,
      now: Date.now(),
    });
    return { ok: true, resultId, replayed };
  },
});

/**
 * Manually credit a user's wallet (bank-transfer reconciliation, goodwill
 * credit, support adjustments). Goes through the same ledger posting as any
 * deposit — fully audited, never a raw balance edit.
 */
export const adminAdjustWallet = mutation({
  args: {
    userId: v.id("users"),
    amountSantims: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    if (!Number.isInteger(args.amountSantims) || args.amountSantims <= 0) {
      throw new Error("AMOUNT_MUST_BE_POSITIVE");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("USER_NOT_FOUND");

    const now = Date.now();
    await deposit(ctx, {
      userId: args.userId,
      amountSantims: args.amountSantims,
      referenceId: args.userId,
      idempotencyKey: `ADMIN_ADJUST:${crypto.randomUUID()}`,
      description: `Admin adjustment: ${args.reason}`,
      now,
    });

    await insertAuditLog(ctx, {
      actor: adminId,
      action: "WALLET_ADJUSTED",
      resource: `user:${args.userId}`,
      details: `amount=${args.amountSantims} reason=${args.reason}`,
      now,
    });
    await insertNotification(ctx, {
      userId: args.userId,
      type: "PAYMENT_SUCCESS",
      title: "Wallet credited",
      body: `An adjustment of ${Math.floor(args.amountSantims / 100)}.${String(args.amountSantims % 100).padStart(2, "0")} ETB was credited to your wallet. Reason: ${args.reason}`,
      now,
    });
    return { ok: true, adminId };
  },
});

/**
 * Admin deduction: remove funds from a user's paid balance (fraud recovery,
 * erroneous-credit correction). Ledger-guarded: cannot take the balance
 * negative. Fully audited and notified.
 */
export const adminDeductWallet = mutation({
  args: {
    userId: v.id("users"),
    amountSantims: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    if (!Number.isInteger(args.amountSantims) || args.amountSantims <= 0) {
      throw new Error("AMOUNT_MUST_BE_POSITIVE");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("USER_NOT_FOUND");

    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!wallet || wallet.paidBalanceSantims < args.amountSantims) {
      throw new Error("INSUFFICIENT_USER_BALANCE");
    }

    const now = Date.now();
    await deductUser(ctx, {
      userId: args.userId,
      amountSantims: args.amountSantims,
      reason: args.reason,
      reference: `admin:${adminId}`,
      idempotencyKey: `ADMIN_DEDUCT:${crypto.randomUUID()}`,
      now,
    });

    await insertAuditLog(ctx, {
      actor: adminId,
      action: "WALLET_DEDUCTED",
      resource: `user:${args.userId}`,
      details: `amount=${args.amountSantims} reason=${args.reason}`,
      now,
    });
    await insertNotification(ctx, {
      userId: args.userId,
      type: "SYSTEM",
      title: "Wallet adjusted",
      body: `${Math.floor(args.amountSantims / 100)}.${String(args.amountSantims % 100).padStart(2, "0")} ETB was deducted from your wallet. Reason: ${args.reason}`,
      now,
    });
    return { ok: true, adminId };

// ─── Campaign management (spec §10, §41) ────────────────────────────────────

function validateCampaignConfig(
  c: {
    opensAt: number;
    closesAt: number;
    minBidSantims: number;
    maxBidSantims: number;
    bidIncrementSantims: number;
    bidServiceFeeSantims: number;
    maximumBidsPerUser: number;
    winnerPaymentDeadline: number;
  },
): void {
  if (!Number.isInteger(c.minBidSantims) || c.minBidSantims < 1) {
    throw new Error("MIN_BID_INVALID");
  }
  if (!Number.isInteger(c.maxBidSantims) || c.maxBidSantims <= c.minBidSantims) {
    throw new Error("MAX_BID_MUST_EXCEED_MIN");
  }
  if (
    !Number.isInteger(c.bidIncrementSantims) ||
    c.bidIncrementSantims < 0
  ) {
    throw new Error("INCREMENT_INVALID");
  }
  if (!Number.isInteger(c.bidServiceFeeSantims) || c.bidServiceFeeSantims <= 0) {
    throw new Error("FEE_MUST_BE_POSITIVE");
  }
  if (
    !Number.isInteger(c.maximumBidsPerUser) ||
    c.maximumBidsPerUser < 1 ||
    c.maximumBidsPerUser > 1000
  ) {
    throw new Error("BID_CAP_INVALID");
  }
  if (
    !Number.isInteger(c.winnerPaymentDeadline) ||
    c.winnerPaymentDeadline <= 0
  ) {
    throw new Error("PAYMENT_DEADLINE_INVALID");
  }
  if (c.closesAt <= c.opensAt) {
    throw new Error("CLOSE_MUST_BE_AFTER_OPEN");
  }
}

/** Create a prize for campaigns (spec §41 products/prizes). */
export const createPrize = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    valueSantims: v.number(),
    emoji: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    stock: v.number(),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const title = args.title.trim();
    if (!title) throw new Error("TITLE_REQUIRED");
    if (!Number.isInteger(args.valueSantims) || args.valueSantims <= 0) {
      throw new Error("VALUE_MUST_BE_POSITIVE");
    }
    if (!Number.isInteger(args.stock) || args.stock < 1) {
      throw new Error("STOCK_MUST_BE_POSITIVE");
    }

    const now = Date.now();
    const prizeId = await ctx.db.insert("prizes", {
      title,
      description: args.description?.trim() || undefined,
      category: args.category?.trim() || undefined,
      valueSantims: args.valueSantims,
      emoji: args.emoji?.trim() || undefined,
      imageUrl: args.imageUrl?.trim() || undefined,
      stock: args.stock,
      createdAt: now,
    });

    await insertAuditLog(ctx, {
      actor: adminId,
      action: "PRIZE_CREATED",
      resource: `prize:${prizeId}`,
      details: `title="${title}" value=${args.valueSantims} stock=${args.stock}`,
      now,
    });
    return { prizeId };
  },
});

/** Prize inventory with active-campaign usage counts. */
export const listPrizes = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const prizes = await ctx.db.query("prizes").collect();
    const auctions = await ctx.db.query("auctions").collect();

    return Promise.all(
      prizes
        .sort((a, b) => b._creationTime - a._creationTime)
        .map(async (p) => {
          const used = auctions.filter(
            (a) => a.prizeId === p._id && a.status !== "CANCELLED",
          ).length;
          const imageUrl =
            p.imageStorageId !== undefined
              ? await ctx.storage.getUrl(p.imageStorageId)
              : (p.imageUrl ?? undefined);
          return { ...p, imageUrl, usedInAuctions: used };
        }),
    );
  },
});

/**
 * Create a campaign (auction) with the full configurable rule set (spec §10).
 * Every value the engine enforces comes from this row — no hard-coded rules.
 */
export const createAuction = mutation({
  args: {
    prizeId: v.id("prizes"),
    title: v.string(),
    description: v.optional(v.string()),
    opensAt: v.number(),
    closesAt: v.number(),
    minBidSantims: v.number(),
    maxBidSantims: v.number(),
    bidIncrementSantims: v.number(),
    bidServiceFeeSantims: v.number(),
    maximumBidsPerUser: v.number(),
    consecutiveBidPolicy: v.union(
      v.literal("NONE"),
      v.literal("THREE_THEN_BLOCK_TWO"),
      v.literal("CUSTOM"),
    ),
    noWinnerPolicy: noWinnerPolicyValidator,
    winnerPaymentDeadline: v.number(),
    visibilityPolicy: v.union(v.literal("PUBLIC"), v.literal("PRIVATE")),
    openImmediately: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);

    const prize = await ctx.db.get(args.prizeId);
    if (!prize) throw new Error("PRIZE_NOT_FOUND");
    if (prize.stock < 1) throw new Error("PRIZE_OUT_OF_STOCK");

    const title = args.title.trim();
    if (!title) throw new Error("TITLE_REQUIRED");

    validateCampaignConfig({
      opensAt: args.opensAt,
      closesAt: args.closesAt,
      minBidSantims: args.minBidSantims,
      maxBidSantims: args.maxBidSantims,
      bidIncrementSantims: args.bidIncrementSantims,
      bidServiceFeeSantims: args.bidServiceFeeSantims,
      maximumBidsPerUser: args.maximumBidsPerUser,
      winnerPaymentDeadline: args.winnerPaymentDeadline,
    });

    const now = Date.now();

    // Unique auction code: LUBA-<year>-<6 random digits>.
    let auctionCode = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = `LUBA-${new Date(now).getFullYear()}-${String(
        Math.floor(100000 + Math.random() * 900000),
      )}`;
      const clash = await ctx.db
        .query("auctions")
        .withIndex("by_code", (q) => q.eq("auctionCode", candidate))
        .unique();
      if (!clash) {
        auctionCode = candidate;
        break;
      }
    }
    if (!auctionCode) throw new Error("CODE_GENERATION_FAILED");

    const openNow = args.openImmediately === true;
    const auctionId = await ctx.db.insert("auctions", {
      auctionCode,
      title,
      description: args.description?.trim() || undefined,
      prizeId: args.prizeId,
      opensAt: openNow ? Math.min(args.opensAt, now) : args.opensAt,
      closesAt: args.closesAt,
      status: openNow ? "OPEN" : "SCHEDULED",
      minBidSantims: args.minBidSantims,
      maxBidSantims: args.maxBidSantims,
      bidIncrementSantims: args.bidIncrementSantims,
      bidServiceFeeSantims: args.bidServiceFeeSantims,
      maximumBidsPerUser: args.maximumBidsPerUser,
      consecutiveBidPolicy: args.consecutiveBidPolicy,
      noWinnerPolicy: args.noWinnerPolicy,
      winnerPaymentDeadline: args.winnerPaymentDeadline,
      visibilityPolicy: args.visibilityPolicy,
      bidCount: 0,
      uniqueBidCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    await insertAuditLog(ctx, {
      actor: adminId,
      action: "AUCTION_CREATED",
      resource: `auction:${auctionId}`,
      details: `code=${auctionCode} prize="${prize.title}" fee=${args.bidServiceFeeSantims} window=${args.opensAt}..${args.closesAt} status=${openNow ? "OPEN" : "SCHEDULED"}`,
      now,
    });
    return { auctionId, auctionCode };
  },
});

/** Every campaign for the console, newest first, with revenue estimate. */
export const listAllAuctions = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const auctions = await ctx.db.query("auctions").collect();
    const prizes = await ctx.db.query("prizes").collect();
    const prizeById = new Map(prizes.map((p) => [p._id, p]));

    return Promise.all(
      auctions
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (a) => {
          const prize = prizeById.get(a.prizeId);
          const prizeImageUrl =
            prize?.imageStorageId !== undefined
              ? await ctx.storage.getUrl(prize.imageStorageId)
              : (prize?.imageUrl ?? undefined);
          return {
            id: a._id,
            auctionCode: a.auctionCode,
            title: a.title,
            prizeTitle: prize?.title ?? "—",
            prizeEmoji: prize?.emoji ?? "🎁",
            prizeImageUrl,
            status: a.status,
            opensAt: a.opensAt,
            closesAt: a.closesAt,
            bidCount: a.bidCount,
            uniqueBidCount: a.uniqueBidCount,
            bidServiceFeeSantims: a.bidServiceFeeSantims,
            maxBidsPerUser: a.maximumBidsPerUser,
            noWinnerPolicy: a.noWinnerPolicy,
            grossFeeRevenueSantims: a.bidCount * a.bidServiceFeeSantims,
            createdAt: a.createdAt,
          };
        }),
    );
  },
});

/**
 * Edit the rule set of a campaign. Only SCHEDULED auctions are editable —
 * once open, rules are frozen so bidders face a moving target (spec §29:
 * policy is frozen when the auction becomes OPEN).
 */
export const updateAuctionRules = mutation({
  args: {
    auctionId: v.id("auctions"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    opensAt: v.optional(v.number()),
    closesAt: v.optional(v.number()),
    minBidSantims: v.optional(v.number()),
    maxBidSantims: v.optional(v.number()),
    bidIncrementSantims: v.optional(v.number()),
    bidServiceFeeSantims: v.optional(v.number()),
    maximumBidsPerUser: v.optional(v.number()),
    consecutiveBidPolicy: v.optional(
      v.union(
        v.literal("NONE"),
        v.literal("THREE_THEN_BLOCK_TWO"),
        v.literal("CUSTOM"),
      ),
    ),
    noWinnerPolicy: v.optional(noWinnerPolicyValidator),
    winnerPaymentDeadline: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (auction.status !== "SCHEDULED") {
      throw new Error("ONLY_SCHEDULED_AUCTIONS_ARE_EDITABLE");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const changes: string[] = [];

    const assign = (field: string, value: unknown) => {
      if (value !== undefined) {
        patch[field] = value;
        changes.push(`${field}=${String(value)}`);
      }
    };

    if (args.title !== undefined) {
      const t = args.title.trim();
      if (!t) throw new Error("TITLE_REQUIRED");
      assign("title", t);
    }
    assign("description", args.description?.trim() || undefined);
    assign("opensAt", args.opensAt);
    assign("closesAt", args.closesAt);
    assign("minBidSantims", args.minBidSantims);
    assign("maxBidSantims", args.maxBidSantims);
    assign("bidIncrementSantims", args.bidIncrementSantims);
    assign("bidServiceFeeSantims", args.bidServiceFeeSantims);
    assign("maximumBidsPerUser", args.maximumBidsPerUser);
    assign("consecutiveBidPolicy", args.consecutiveBidPolicy);
    assign("noWinnerPolicy", args.noWinnerPolicy);
    assign("winnerPaymentDeadline", args.winnerPaymentDeadline);

    // Validate the resulting combination.
    validateCampaignConfig({
      opensAt: (patch.opensAt as number) ?? auction.opensAt,
      closesAt: (patch.closesAt as number) ?? auction.closesAt,
      minBidSantims: (patch.minBidSantims as number) ?? auction.minBidSantims,
      maxBidSantims: (patch.maxBidSantims as number) ?? auction.maxBidSantims,
      bidIncrementSantims:
        (patch.bidIncrementSantims as number) ?? auction.bidIncrementSantims,
      bidServiceFeeSantims:
        (patch.bidServiceFeeSantims as number) ?? auction.bidServiceFeeSantims,
      maximumBidsPerUser:
        (patch.maximumBidsPerUser as number) ?? auction.maximumBidsPerUser,
      winnerPaymentDeadline:
        (patch.winnerPaymentDeadline as number) ?? auction.winnerPaymentDeadline,
    });

    ctx.db.patch(args.auctionId, patch);
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "AUCTION_RULES_UPDATED",
      resource: `auction:${args.auctionId}`,
      details: changes.join(" ") || "no changes",
      now: Date.now(),
    });
    return { ok: true, changed: changes.length };
  },
});

/** Open a scheduled campaign immediately (flips SCHEDULED → OPEN). */
export const openAuctionNow = mutation({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (auction.status !== "SCHEDULED") {
      throw new Error("AUCTION_NOT_SCHEDULED");
    }

    const now = Date.now();
    ctx.db.patch(args.auctionId, {
      status: "OPEN",
      opensAt: Math.min(auction.opensAt, now),
      updatedAt: now,
    });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "AUCTION_OPENED_EARLY",
      resource: `auction:${args.auctionId}`,
      details: `code=${auction.auctionCode}`,
      now,
    });
    return { ok: true };
  },
});

// ─── Auction lifecycle controls: pause / resume / extend (spec §41) ─────────

/**
 * Pause an OPEN or CLOSING auction for technical issues or disputes.
 * Bid acceptance stops immediately (placeBid only accepts OPEN/CLOSING),
 * and the lifecycle worker will not close a PAUSED auction.
 * Bidders already see it as paused — no money moves.
 */
export const pauseAuction = mutation({
  args: { auctionId: v.id("auctions"), reason: v.string() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (auction.status !== "OPEN" && auction.status !== "CLOSING") {
      throw new Error(`CANNOT_PAUSE_FROM_${auction.status}`);
    }
    ctx.db.patch(args.auctionId, { status: "PAUSED", updatedAt: Date.now() });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "AUCTION_PAUSED",
      resource: `auction:${args.auctionId}`,
      details: `code=${auction.auctionCode} reason=${args.reason}`,
      now: Date.now(),
    });
    await ctx.db.insert("outboxEvents", {
      eventType: "AUCTION_PAUSED",
      payload: { auctionId: args.auctionId, code: auction.auctionCode },
      processed: false,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Resume a PAUSED auction back to OPEN. Closing time is unchanged. */
export const resumeAuction = mutation({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (auction.status !== "PAUSED") throw new Error("AUCTION_NOT_PAUSED");

    const now = Date.now();
    // If the pause outlived the planned closing time, push the close out so
    // bidders get a fair window rather than an instantly-closing auction.
    const closesAt = auction.closesAt <= now ? now + 60 * 60 * 1000 : auction.closesAt;
    ctx.db.patch(args.auctionId, { status: "OPEN", closesAt, updatedAt: now });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "AUCTION_RESUMED",
      resource: `auction:${args.auctionId}`,
      details: `code=${auction.auctionCode} closesAt=${closesAt}`,
      now,
    });
    return { ok: true };
  },
});

/**
 * Extend a live auction's closing time. Allowed while OPEN / CLOSING / PAUSED.
 * Rules stay frozen — only the clock moves (spec §29).
 */
export const extendAuction = mutation({
  args: { auctionId: v.id("auctions"), additionalMs: v.number() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    if (!Number.isInteger(args.additionalMs) || args.additionalMs <= 0) {
      throw new Error("EXTENSION_MUST_BE_POSITIVE");
    }
    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (
      auction.status !== "OPEN" &&
      auction.status !== "CLOSING" &&
      auction.status !== "PAUSED"
    ) {
      throw new Error(`CANNOT_EXTEND_FROM_${auction.status}`);
    }
    const closesAt = Math.max(auction.closesAt, Date.now()) + args.additionalMs;
    const status = auction.status === "PAUSED" ? "PAUSED" : "OPEN";
    ctx.db.patch(args.auctionId, { closesAt, status, updatedAt: Date.now() });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "AUCTION_EXTENDED",
      resource: `auction:${args.auctionId}`,
      details: `code=${auction.auctionCode} newClosesAt=${closesAt}`,
      now: Date.now(),
    });
    await ctx.db.insert("outboxEvents", {
      eventType: "AUCTION_EXTENDED",
      payload: { auctionId: args.auctionId, code: auction.auctionCode, closesAt },
      processed: false,
      createdAt: Date.now(),
    });
    return { ok: true, closesAt };
  },
});

// ─── Winner claims & payout (spec §32, §41) ─────────────────────────────────

/** List settlements across all auctions with auction + winner context. */
export const listSettlementsAdmin = query({
  args: { statusFilter: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("winnerSettlements").collect();
    const filtered = args.statusFilter
      ? rows.filter((s) => s.status === args.statusFilter)
      : rows;
    const [auctions, users] = await Promise.all([
      ctx.db.query("auctions").collect(),
      ctx.db.query("users").collect(),
    ]);
    const auctionById = new Map(auctions.map((a) => [a._id, a]));
    const emailById = new Map(users.map((u) => [u._id, u.email ?? "—"]));
    return filtered
      .sort((a, b) => b.paymentDeadline - a.paymentDeadline)
      .slice(0, 100)
      .map((s) => {
        const a = auctionById.get(s.auctionId);
        const overdue =
          s.status === "PENDING_PAYMENT" && s.paymentDeadline < Date.now();
        return {
          id: s._id,
          auctionCode: a?.auctionCode ?? "—",
          auctionTitle: a?.title ?? "—",
          winnerEmail: emailById.get(s.winnerUserId) ?? "—",
          winningBidValueSantims: s.winningBidValueSantims,
          status: s.status,
          paidAt: s.paidAt ?? null,
          paymentDeadline: s.paymentDeadline,
          overdue,
        };
      });
  },
});

/**
 * Mark a winner's payment as received and verified, then the prize as
 * delivered (fulfilled). Two audited steps so fulfillment is explicit.
 */
export const markWinnerPaid = mutation({
  args: { settlementId: v.id("winnerSettlements"), note: v.string() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const s = await ctx.db.get(args.settlementId);
    if (!s) throw new Error("SETTLEMENT_NOT_FOUND");
    if (s.status !== "PENDING_PAYMENT") throw new Error(`CANNOT_CONFIRM_FROM_${s.status}`);

    ctx.db.patch(args.settlementId, { status: "PAID", paidAt: Date.now() });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "WINNER_PAYMENT_CONFIRMED",
      resource: `settlement:${args.settlementId}`,
      details: `note=${args.note}`,
      now: Date.now(),
    });
    await insertNotification(ctx, {
      userId: s.winnerUserId,
      type: "PAYMENT_SUCCESS",
      title: "Payment confirmed",
      body: "Your winning-bid payment was confirmed. Your prize is being prepared for delivery.",
      auctionId: s.auctionId,
      now: Date.now(),
    });
    return { ok: true };
  },
});

/** Mark a PAID settlement as fulfilled (prize delivered). */
export const markPrizeFulfilled = mutation({
  args: { settlementId: v.id("winnerSettlements"), note: v.string() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const s = await ctx.db.get(args.settlementId);
    if (!s) throw new Error("SETTLEMENT_NOT_FOUND");
    if (s.status !== "PAID") throw new Error(`CANNOT_FULFILL_FROM_${s.status}`);

    ctx.db.patch(args.settlementId, { status: "FULFILLED" });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "PRIZE_FULFILLED",
      resource: `settlement:${args.settlementId}`,
      details: `note=${args.note}`,
      now: Date.now(),
    });
    await insertNotification(ctx, {
      userId: s.winnerUserId,
      type: "PRIZE_STATUS",
      title: "Prize delivered",
      body: "Your prize has been fulfilled. Congratulations again!",
      auctionId: s.auctionId,
      now: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Forfeit an overdue claim: the winner did not pay by the deadline.
 * All of that winner's fees on the auction are refunded and the auction is
 * reopened (bids preserved, rules frozen, new 24h close) so bidders get a
 * fresh round. Forfeited settlements can never be paid afterwards.
 */
export const forfeitAndReopen = mutation({
  args: { settlementId: v.id("winnerSettlements"), reason: v.string() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const s = await ctx.db.get(args.settlementId);
    if (!s) throw new Error("SETTLEMENT_NOT_FOUND");
    if (s.status !== "PENDING_PAYMENT") throw new Error(`CANNOT_FORFEIT_FROM_${s.status}`);
    const auction = await ctx.db.get(s.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");

    const now = Date.now();
    ctx.db.patch(args.settlementId, { status: "FORFEITED" });

    // Refund every fee the forfeiting winner paid on this auction.
    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_user", (q) =>
        q.eq("auctionId", s.auctionId).eq("userId", s.winnerUserId),
      )
      .collect();
    for (const bid of bids) {
      if (bid.status !== "ACCEPTED") continue;
      await refundUser(ctx, {
        userId: bid.userId,
        amountSantims: bid.bidServiceFeeSantims,
        reason: `Winner forfeited (${auction.auctionCode}): ${args.reason}`,
        reference: bid._id,
        idempotencyKey: `FORFEIT_REFUND:${bid._id}`,
        now,
      });
      ctx.db.patch(bid._id, { status: "REFUNDED" });
    }

    // Reopen the auction: fresh 24h window, all remaining accepted bids count.
    const closesAt = now + 24 * 60 * 60 * 1000;
    ctx.db.patch(s.auctionId, { status: "OPEN", closesAt, updatedAt: now });

    // Clear the round-1 result row: it is the uniqueness fence that guards
    // settlement, and it must not block resolving round 2. Round-1 history is
    // preserved by the FORFEITED settlement row above and the audit log —
    // bids, ledger entries, and payments are never touched (append-only).
    const oldResult = await ctx.db
      .query("auctionResults")
      .withIndex("by_auction", (q) => q.eq("auctionId", s.auctionId))
      .unique();
    if (oldResult) ctx.db.delete(oldResult._id);

    await insertNotification(ctx, {
      userId: s.winnerUserId,
      type: "SYSTEM",
      title: "Prize claim forfeited",
      body: `The payment deadline for ${auction.auctionCode} passed. Your bid fees were refunded and the auction has reopened.`,
      auctionId: s.auctionId,
      now,
    });
    await ctx.db.insert("outboxEvents", {
      eventType: "AUCTION_REOPENED",
      payload: { auctionId: s.auctionId, code: auction.auctionCode },
      processed: false,
      createdAt: now,
    });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "WINNER_FORFEITED_REOPENED",
      resource: `settlement:${args.settlementId}`,
      details: `reason=${args.reason} auction=${auction.auctionCode}`,
      now,
    });
    return { ok: true };
  },
});

// ─── Financial dashboard (spec §41, §52–53) ─────────────────────────────────

/**
 * Revenue & finance overview computed from the ledger (the financial truth):
 * fee revenue, refunds, winner payments, deposit float, and pending items.
 */
export const getFinanceDashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const txs = await ctx.db.query("ledgerTransactions").collect();
    const entries = await ctx.db.query("ledgerEntries").collect();
    const accounts = await ctx.db.query("ledgerAccounts").collect();
    const txById = new Map(txs.map((t) => [t._id, t]));
    const accountById = new Map(accounts.map((a) => [a._id, a]));

    let feeRevenue = 0;
    let winnerPayments = 0;
    let refunds = 0;
    let promoIssued = 0;
    for (const e of entries) {
      const tx = txById.get(e.transactionId);
      if (!tx) continue;
      const acct = accountById.get(e.accountId);
      // Revenue account, credit-normal: revenue grows on CREDIT, shrinks on DEBIT.
      if (acct?.type === "REVENUE") {
        if (e.direction === "CREDIT") feeRevenue += e.amountSantims;
        else feeRevenue -= e.amountSantims;
      }
      if (tx.txType === "WINNER_PAYMENT" && e.direction === "CREDIT") {
        winnerPayments += e.amountSantims;
      }
      if (tx.txType === "REFUND" && e.direction === "CREDIT") refunds += e.amountSantims;
      if (tx.txType === "PROMO_CREDIT" && e.direction === "CREDIT") promoIssued += e.amountSantims;
    }

    const payments = await ctx.db.query("payments").collect();
    const pendingDeposits = payments
      .filter((p) => p.kind === "DEPOSIT" && p.status === "PENDING")
      .reduce((sum, p) => sum + p.amountSantims, 0);

    const settlements = await ctx.db.query("winnerSettlements").collect();
    const pendingSettlements = settlements.filter(
      (s) => s.status === "PENDING_PAYMENT",
    ).length;

    const now = Date.now();
    const overdueSettlements = settlements.filter(
      (s) => s.status === "PENDING_PAYMENT" && s.paymentDeadline < now,
    ).length;

    return {
      feeRevenueSantims: feeRevenue,
      winnerPaymentsSantims: winnerPayments,
      refundsSantims: refunds,
      promoIssuedSantims: promoIssued,
      pendingDepositsSantims: pendingDeposits,
      pendingSettlements,
      overdueSettlements,
      txCount: txs.length,
    };
  },
});

/**
 * Admin refund: issue an arbitrary refund/credit adjustment to a user with a
 * reason (disputed fee, operational credit, fault correction). Audited; the
 * ledger entry is the financial truth.
 */
export const adminRefund = mutation({
  args: {
    userId: v.id("users"),
    amountSantims: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    if (!Number.isInteger(args.amountSantims) || args.amountSantims <= 0) {
      throw new Error("REFUND_AMOUNT_MUST_BE_POSITIVE");
    }
    await refundUser(ctx, {
      userId: args.userId,
      amountSantims: args.amountSantims,
      reason: args.reason,
      reference: `admin:${adminId}`,
      idempotencyKey: `ADMIN_REFUND:${crypto.randomUUID()}`,
      now: Date.now(),
    });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "ADMIN_REFUND_ISSUED",
      resource: `user:${args.userId}`,
      details: `amount=${args.amountSantims} reason=${args.reason}`,
      now: Date.now(),
    });
    await insertNotification(ctx, {
      userId: args.userId,
      type: "PAYMENT_SUCCESS",
      title: "Wallet credited",
      body: `A refund of ${args.amountSantims} santims was credited to your wallet. Reason: ${args.reason}`,
      now: Date.now(),
    });
    return { ok: true };
  },
});

// ─── KYC verification (spec §41) ────────────────────────────────────────────

/** Set a user's KYC verification status (admin only, audited). */
export const setKycStatus = mutation({
  args: {
    userId: v.id("users"),
    kycStatus: v.union(
      v.literal("UNVERIFIED"),
      v.literal("PENDING"),
      v.literal("VERIFIED"),
      v.literal("REJECTED"),
    ),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("USER_NOT_FOUND");

    ctx.db.patch(args.userId, { kycStatus: args.kycStatus, kycNote: args.note });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "KYC_STATUS_CHANGED",
      resource: `user:${args.userId}`,
      details: `kyc=${args.kycStatus} note=${args.note}`,
      now: Date.now(),
    });
    await insertNotification(ctx, {
      userId: args.userId,
      type: "SYSTEM",
      title: "Identity verification updated",
      body: `Your verification status is now ${args.kycStatus}.${args.note ? ` Note: ${args.note}` : ""}`,
      now: Date.now(),
    });
    return { ok: true };
  },
});

// ─── Bid moderation (spec §41) ──────────────────────────────────────────────

/**
 * Remove a rule-breaking or spam bid during an active round.
 * The bid keeps its row (append-only audit trail) but is marked REMOVED so
 * the winner resolver ignores it (it only counts ACCEPTED bids). The bidder
 * receives a notification; the fee is NOT auto-refunded — use adminRefund if
 * policy says the fee should come back.
 */
export const removeBid = mutation({
  args: { bidId: v.id("auctionBids"), reason: v.string() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const bid = await ctx.db.get(args.bidId);
    if (!bid) throw new Error("BID_NOT_FOUND");
    if (bid.status !== "ACCEPTED") throw new Error(`CANNOT_REMOVE_FROM_${bid.status}`);

    const auction = await ctx.db.get(bid.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (auction.status === "CLOSED" || auction.status === "SETTLING" || auction.status === "COMPLETED") {
      throw new Error("AUCTION_ALREADY_SETTLED_OR_CLOSED");
    }

    ctx.db.patch(args.bidId, { status: "REMOVED" });

    // Keep the denormalized counters truthful.
    const remaining = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_value", (q) => q.eq("auctionId", bid.auctionId))
      .collect();
    const acceptedValues = remaining.filter((b) => b.status === "ACCEPTED").map((b) => b.bidValueSantims);
    const uniqueCount = new Set(acceptedValues).size;
    ctx.db.patch(bid.auctionId, {
      bidCount: acceptedValues.length,
      uniqueBidCount: uniqueCount,
      updatedAt: Date.now(),
    });

    await insertNotification(ctx, {
      userId: bid.userId,
      type: "SYSTEM",
      title: "Bid removed",
      body: `Your bid of ${bid.bidValueSantims} santims in ${auction.auctionCode} was removed by moderation. Reason: ${args.reason}`,
      auctionId: bid.auctionId,
      now: Date.now(),
    });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "BID_REMOVED",
      resource: `bid:${args.bidId}`,
      details: `auction=${auction.auctionCode} value=${bid.bidValueSantims} reason=${args.reason}`,
      now: Date.now(),
    });
    return { ok: true };
  },
});

// ─── Notification settings & announcements (spec §38, §41) ──────────────────

const NOTIFICATION_KEYS = [
  "NOTIFY_BID_ACCEPTED",
  "NOTIFY_AUCTION_ENDING",
  "NOTIFY_WINNER",
  "NOTIFY_PAYMENT_REMINDER",
  "NOTIFY_PRIZE_STATUS",
] as const;

/** Current notification feature-flag values (admin view). */
export const getNotificationSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("platformSettings").collect();
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return NOTIFICATION_KEYS.map((key) => ({
      key,
      enabled: byKey.get(key) ?? true, // default: on
    }));
  },
});

/** Toggle one notification category (admin only). */
export const setNotificationSetting = mutation({
  args: { key: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    if (!NOTIFICATION_KEYS.includes(args.key as (typeof NOTIFICATION_KEYS)[number])) {
      throw new Error("UNKNOWN_SETTING_KEY");
    }
    const existing = await ctx.db
      .query("platformSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      ctx.db.patch(existing._id, { value: args.enabled, updatedAt: Date.now() });
    } else {
      ctx.db.insert("platformSettings", {
        key: args.key,
        value: args.enabled,
        updatedAt: Date.now(),
      });
    }
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "NOTIFICATION_SETTING_CHANGED",
      resource: `setting:${args.key}`,
      details: `enabled=${args.enabled}`,
      now: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Broadcast an in-app announcement to every active user (e.g. "auction
 * starting soon"). One notification row per user; audited once.
 */
export const broadcastAnnouncement = mutation({
  args: { title: v.string(), body: v.string(), auctionId: v.optional(v.id("auctions")) },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    if (!args.title.trim() || !args.body.trim()) {
      throw new Error("TITLE_AND_BODY_REQUIRED");
    }
    const users = await ctx.db.query("users").collect();
    const now = Date.now();
    let sent = 0;
    for (const u of users) {
      if (u.status && u.status !== "ACTIVE") continue;
      await insertNotification(ctx, {
        userId: u._id,
        type: "SYSTEM",
        title: args.title,
        body: args.body,
        auctionId: args.auctionId,
        now,
      });
      sent++;
    }
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "ANNOUNCEMENT_BROADCAST",
      resource: args.auctionId ? `auction:${args.auctionId}` : "platform",
      details: `title=${args.title} recipients=${sent}`,
      now,
    });
    return { ok: true, sent };
  },
});

// ─── Bid audit: complete frequency map (spec §27, §33, §41) ─────────────────

/**
 * Full bid-frequency map for one auction: every value, how many accepted
 * bids hold it, and who holds them. This is the audit tool for verifying a
 * winning bid was genuinely unique and lowest — and for the post-closure
 * transparency publication decision (spec §33).
 */
export const getBidFrequencyMap = query({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_value", (q) => q.eq("auctionId", args.auctionId))
      .collect();
    const users = await ctx.db.query("users").collect();
    const emailById = new Map(users.map((u) => [u._id, u.email ?? "—"]));

    const byValue = new Map<number, { count: number; holders: string[]; bidIds: Id<"auctionBids">[] }>();
    for (const b of bids) {
      if (b.status !== "ACCEPTED") continue;
      const entry = byValue.get(b.bidValueSantims) ?? {
        count: 0,
        holders: [],
        bidIds: [],
      };
      entry.count++;
      entry.holders.push(emailById.get(b.userId) ?? b.userId);
      entry.bidIds.push(b._id);
      byValue.set(b.bidValueSantims, entry);
    }

    return Array.from(byValue.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([valueSantims, info]) => ({
        valueSantims,
        count: info.count,
        unique: info.count === 1,
        holders: info.holders,
        bidIds: info.bidIds,
      }));
  },
});

/**
 * List all bids for one auction with moderation controls available
 * (admin view — includes removed/refunded bids for the full audit trail).
 */
export const listBidsAdmin = query({
  args: { auctionId: v.id("auctions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_accepted", (q) => q.eq("auctionId", args.auctionId))
      .collect();
    const users = await ctx.db.query("users").collect();
    const emailById = new Map(users.map((u) => [u._id, u.email ?? "—"]));
    return bids
      .sort((a, b) => b.acceptedAt - a.acceptedAt)
      .slice(0, 300)
      .map((b) => ({
        id: b._id,
        email: emailById.get(b.userId) ?? "—",
        bidValueSantims: b.bidValueSantims,
        feeSantims: b.bidServiceFeeSantims,
        status: b.status,
        acceptedAt: b.acceptedAt,
        idempotencyKey: b.idempotencyKey,
      }));
  },
});

// ─── Image uploads for prizes (spec §41 products/prizes) ────────────────────

/**
 * Update prize details after creation (title, category, image). Images are
 * uploaded through files.ts (generateUploadUrl → attachImageToPrize); this
 * mutation handles text edits in one step.
 */
export const updatePrize = mutation({
  args: {
    prizeId: v.id("prizes"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    emoji: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const prize = await ctx.db.get(args.prizeId);
    if (!prize) throw new Error("PRIZE_NOT_FOUND");

    const patch: Record<string, string | undefined> = {};
    if (args.title !== undefined) patch.title = args.title;
    if (args.description !== undefined) patch.description = args.description;
    if (args.category !== undefined) patch.category = args.category;
    if (args.emoji !== undefined) patch.emoji = args.emoji;
    ctx.db.patch(args.prizeId, patch);

    await insertAuditLog(ctx, {
      actor: adminId,
      action: "PRIZE_UPDATED",
      resource: `prize:${args.prizeId}`,
      details: JSON.stringify(patch),
      now: Date.now(),
    });
    return { ok: true };
  },
});

// ─── User oversight: full profile drill-down (spec §41) ─────────────────────

/**
 * Complete profile for one user: identity, KYC, wallet projection, full bid
 * history (all statuses), wins/settlements, and payment history. Everything
 * an investigator or support agent needs in one read, all audited server-side.
 */
export const getUserProfileAdmin = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("USER_NOT_FOUND");

    const [bids, settlements, payments, wallets] = await Promise.all([
      ctx.db
        .query("auctionBids")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect(),
      ctx.db
        .query("winnerSettlements")
        .withIndex("by_winner", (q) => q.eq("winnerUserId", args.userId))
        .collect(),
      ctx.db
        .query("payments")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect(),
      ctx.db
        .query("wallets")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect(),
    ]);

    const auctionIds = [...new Set(bids.map((b) => b.auctionId))];
    const auctions = await Promise.all(auctionIds.map((id) => ctx.db.get(id)));
    const auctionById = new Map(
      auctions.filter((a) => a !== null).map((a) => [a._id, a]),
    );

    const accepted = bids.filter((b) => b.status === "ACCEPTED");
    const now = Date.now();

    return {
      user: {
        id: user._id,
        email: user.email ?? null,
        name: user.name ?? null,
        role: user.role ?? null,
        status: user.status ?? "ACTIVE",
        kycStatus: user.kycStatus ?? "UNVERIFIED",
        kycNote: user.kycNote ?? null,
        createdAt: user._creationTime,
      },
      wallet: wallets[0]
        ? {
            paidSantims: wallets[0].paidBalanceSantims,
            promoSantims: wallets[0].promoBalanceSantims,
            totalDepositedSantims: wallets[0].totalDepositedSantims,
            totalSpentSantims: wallets[0].totalSpentSantims,
          }
        : null,
      bidStats: {
        total: bids.length,
        accepted: accepted.length,
        removed: bids.filter((b) => b.status === "REMOVED").length,
        refunded: bids.filter((b) => b.status === "REFUNDED").length,
        auctionsEntered: auctionIds.length,
        feesPaidSantims: bids
          .filter((b) => b.status !== "REMOVED")
          .reduce((s, b) => s + b.bidServiceFeeSantims, 0),
      },
      bids: bids
        .sort((a, b) => b.acceptedAt - a.acceptedAt)
        .slice(0, 100)
        .map((b) => {
          const a = auctionById.get(b.auctionId);
          return {
            id: b._id,
            auctionCode: a?.auctionCode ?? "—",
            auctionTitle: a?.title ?? "—",
            bidValueSantims: b.bidValueSantims,
            feeSantims: b.bidServiceFeeSantims,
            status: b.status,
            acceptedAt: b.acceptedAt,
          };
        }),
      wins: settlements.map((s) => {
        const a = auctionById.get(s.auctionId);
        return {
          settlementId: s._id,
          auctionCode: a?.auctionCode ?? "—",
          winningBidValueSantims: s.winningBidValueSantims,
          status: s.status,
          overdue: s.status === "PENDING_PAYMENT" && s.paymentDeadline < now,
          paymentDeadline: s.paymentDeadline,
        };
      }),
      payments: payments
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map((p) => ({
          id: p._id,
          amountSantims: p.amountSantims,
          kind: p.kind,
          provider: p.provider,
          status: p.status,
          createdAt: p.createdAt,
        })),
    };
  },
});

/**
 * Deduct from a user's paid balance (support corrections, chargebacks,
 * error fixes). Uses a compensating DEBIT posting against the wallet —
 * the ledger correction pattern (spec §20) — and refuses to drive a
 * balance negative (Invariant 2).
 */
export const adminDeductWallet = mutation({
  args: {
    userId: v.id("users"),
    amountSantims: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    if (!Number.isInteger(args.amountSantims) || args.amountSantims <= 0) {
      throw new Error("DEDUCT_AMOUNT_MUST_BE_POSITIVE");
    }
    if (!args.reason.trim()) throw new Error("REASON_REQUIRED");

    // Refuse if the balance cannot absorb the deduction.
    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    const balance = wallet?.paidBalanceSantims ?? 0;
    if (balance < args.amountSantims) {
      throw new Error(
        `INSUFFICIENT_BALANCE_${balance}_AVAILABLE_${args.amountSantims}_REQUESTED`,
 );
 }

    await postTransaction(ctx, {
      txType: "ADMIN_ADJUSTMENT",
      description: `Admin deduction: ${args.reason}`,
      reference: args.userId,
      idempotencyKey: `ADMIN_DEDUCT:${crypto.randomUUID()}`,
      now: Date.now(),
      lines: [
        {
          accountCode: ACCOUNT_CODES.userPaid(args.userId),
          accountName: "User paid balance",
          accountType: "LIABILITY",
          direction: "DEBIT",
          amountSantims: args.amountSantims,
        },
        {
          accountCode: ACCOUNT_CODES.revenue,
          accountName: "Platform revenue",
          accountType: "REVENUE",
          direction: "CREDIT",
          amountSantims: args.amountSantims,
        },
      ],
    });

    const w = await ensureWallet(ctx, args.userId);
    ctx.db.patch(w._id, {
      paidBalanceSantims: w.paidBalanceSantims - args.amountSantims,
      updatedAt: Date.now(),
    });

    await insertAuditLog(ctx, {
      actor: adminId,
      action: "WALLET_DEDUCTED",
      resource: `user:${args.userId}`,
      details: `amount=${args.amountSantims} reason=${args.reason}`,
      now: Date.now(),
    });
    await insertNotification(ctx, {
      userId: args.userId,
      type: "SYSTEM",
      title: "Wallet adjusted",
      body: `An adjustment reduced your wallet balance. Reason: ${args.reason}`,
      now: Date.now(),
    });
    return { ok: true };
  },
});

// ─── Gateway controls (spec §22 provider seam, admin-operated) ──────────────

const PAYMENT_GATEWAYS = ["chapa", "manual"] as const;

type GatewayState = {
  enabled: boolean;
  configured: boolean;
};

/** Current gateway switches (admin view; booleans only, no secrets). */
export const getGatewaySettings = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("platformSettings").collect();
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return PAYMENT_GATEWAYS.map((gateway) => ({
      gateway,
      enabled: byKey.get(`GATEWAY_${gateway.toUpperCase()}_ENABLED`) ?? true,
      configured: gateway === "chapa" ? isChapaConfigured() : true,
    }));
  },
});

/** Toggle a payment gateway on/off (admin only, audited). */
export const setGatewayEnabled = mutation({
  args: { gateway: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    if (!PAYMENT_GATEWAYS.includes(args.gateway as (typeof PAYMENT_GATEWAYS)[number])) {
      throw new Error("UNKNOWN_GATEWAY");
    }
    const key = `GATEWAY_${args.gateway.toUpperCase()}_ENABLED`;
    const existing = await ctx.db
      .query("platformSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) {
      ctx.db.patch(existing._id, { value: args.enabled, updatedAt: Date.now() });
    } else {
      ctx.db.insert("platformSettings", {
        key,
        value: args.enabled,
        updatedAt: Date.now(),
      });
    }
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "GATEWAY_TOGGLED",
      resource: `gateway:${args.gateway}`,
      details: `enabled=${args.enabled}`,
      now: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Force-close an OPEN/CLOSING/PAUSED auction immediately (emergency stop).
 * Bids stop, the auction goes to CLOSED, and normal settlement follows —
 * the result is still resolved deterministically from accepted bids.
 */
export const forceCloseAuction = mutation({
  args: { auctionId: v.id("auctions"), reason: v.string() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (
      auction.status !== "OPEN" &&
      auction.status !== "CLOSING" &&
      auction.status !== "PAUSED"
    ) {
      throw new Error(`CANNOT_CLOSE_FROM_${auction.status}`);
    }

    const now = Date.now();
    ctx.db.patch(args.auctionId, {
      status: "CLOSED",
      closesAt: now,
      updatedAt: now,
    });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "AUCTION_FORCE_CLOSED",
      resource: `auction:${args.auctionId}`,
      details: `code=${auction.auctionCode} reason=${args.reason}`,
      now,
    });
    await ctx.db.insert("outboxEvents", {
      eventType: "AUCTION_FORCE_CLOSED",
      payload: { auctionId: args.auctionId, code: auction.auctionCode },
      processed: false,
      createdAt: now,
    });
    return { ok: true };
  },
});

// ─── Transaction ledger browser (spec §41 payments/reconciliation) ──────────

/**
 * Every monetary transaction on the platform with its balanced entries —
 * the historical ledger view for spotting internal errors.
 */
export const listLedgerTransactions = query({
  args: { txType: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const txs = await ctx.db.query("ledgerTransactions").collect();
    const filtered = args.txType
      ? txs.filter((t) => t.txType === args.txType)
      : txs;
    const slice = filtered
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, args.limit ?? 100);

    const entries = await ctx.db.query("ledgerEntries").collect();
    const accounts = await ctx.db.query("ledgerAccounts").collect();
    const accountById = new Map(accounts.map((a) => [a._id, a]));
    const entriesByTx = new Map<Id<"ledgerTransactions">, typeof entries>();
    for (const e of entries) {
      const list = entriesByTx.get(e.transactionId) ?? [];
      list.push(e);
      entriesByTx.set(e.transactionId, list);
    }

    return slice.map((t) => {
      const txEntries = entriesByTx.get(t._id) ?? [];
      const debits = txEntries
        .filter((e) => e.direction === "DEBIT")
        .reduce((s, e) => s + e.amountSantims, 0);
      const credits = txEntries
        .filter((e) => e.direction === "CREDIT")
        .reduce((s, e) => s + e.amountSantims, 0);
      return {
        id: t._id,
        txType: t.txType,
        description: t.description,
        reference: t.reference,
        createdAt: t.createdAt,
        balanced: debits === credits,
        debitsSantims: debits,
        creditsSantims: credits,
        lines: txEntries.map((e) => ({
          account: accountById.get(e.accountId)?.code ?? "?",
          direction: e.direction,
          amountSantims: e.amountSantims,
        })),
      };    });
  },
});
