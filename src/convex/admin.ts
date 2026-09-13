import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { ROLES, roleValidator } from "./schema";
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
