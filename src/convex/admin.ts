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
import { deposit, refundUser } from "./lib/finance";
import { insertAuditLog, insertNotification } from "./lib/notifications";
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

    return prizes
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((p) => {
        const used = auctions.filter(
          (a) => a.prizeId === p._id && a.status !== "CANCELLED",
        ).length;
        return { ...p, usedInAuctions: used };
      });
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

    return auctions
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((a) => {
        const prize = prizeById.get(a.prizeId);
        return {
          id: a._id,
          auctionCode: a.auctionCode,
          title: a.title,
          prizeTitle: prize?.title ?? "—",
          prizeEmoji: prize?.emoji ?? "🎁",
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
      });
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
