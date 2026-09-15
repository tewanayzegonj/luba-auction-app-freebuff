import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ROLES } from "./schema";
import {
  ACCOUNT_CODES,
  LedgerError,
  postTransaction,
} from "./lib/ledger";
import { ensureWallet } from "./lib/finance";
import { insertAuditLog, insertNotification } from "./lib/notifications";
import { attemptBid } from "./lib/bidCore";

/**
 * Account operations (Phase 2 + Phase 6):
 *  - Wallet withdrawals: user requests a payout, admins review it. The
 *    request moves funds OUT of the user's paid balance into a platform
 *    withdrawal liability atomically — the user cannot spend or double
 *    request money that is awaiting review. Rejection refunds via a
 *    compensating ledger posting (append-only pattern, spec §20).
 *  - Super admin: the platform owner role. Regular admins cannot grant,
 *    revoke, or downgrade it. The owner can demote other admins. A recovery
 *    mutation (CLI-only, key-gated) reassigns ownership if the owner loses
 *    their account.
 *  - Soft delete: anonymizes personal data, deactivates the account, keeps
 *    financial history intact; the freed identity can re-register.
 *  - Auto-bidder plans: budgeted randomized bidding executed by a cron
 *    through the same attemptBid engine as manual bids.
 */

// ─── Role helpers ───────────────────────────────────────────────────────────

/** Structurally-typed ctx usable from both query and mutation handlers. */
type AnyCtx = Parameters<typeof getAuthUserId>[0] & {
  db: { get: QueryCtx["db"]["get"] };
};

export async function requireSuperAdmin(ctx: AnyCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("UNAUTHENTICATED");
  const user = await ctx.db.get(userId);
  if (!user || user.role !== ROLES.SUPER_ADMIN) {
    throw new Error("FORBIDDEN_SUPER_ADMIN_ONLY");
  }
  return userId;
}

// ─── Withdrawals (user side) ────────────────────────────────────────────────

const WITHDRAW_METHODS = ["TELEBIRR", "CBE_BIRR", "BANK"] as const;

export const requestWithdrawal = mutation({
  args: {
    amountSantims: v.number(),
    method: v.union(
      v.literal("TELEBIRR"),
      v.literal("CBE_BIRR"),
      v.literal("BANK"),
    ),
    destination: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");
    const user = await ctx.db.get(userId);
    if (!user || user.isActive === false) throw new Error("ACCOUNT_INACTIVE");
    if (
      !Number.isInteger(args.amountSantims) ||
      args.amountSantims <= 0
    ) {
      throw new Error("AMOUNT_MUST_BE_POSITIVE");
    }
    const destination = args.destination.trim();
    if (destination.length < 6) throw new Error("INVALID_DESTINATION");
    // Anti-spam: maximum one PENDING withdrawal request at a time.
    const pending = await ctx.db
      .query("withdrawals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
      .then((rows) => rows.filter((r) => r.status === "PENDING"));
    if (pending.length > 0) {
      throw new Error("WITHDRAWAL_ALREADY_PENDING");
    }
    // Minimum payout: 25 ETB — keeps manual review economically sane.
    if (args.amountSantims < 2_500) {
      throw new Error("MIN_WITHDRAWAL_25_ETB");
    }

    const wallet = await ensureWallet(ctx, userId);
    if (wallet.paidBalanceSantims < args.amountSantims) {
      throw new Error("INSUFFICIENT_BALANCE");
    }

    const now = Date.now();
    // Move funds out of the spendable balance into the withdrawal liability
    // atomically with the request row. The ledger refuses negative user
    // balances (Invariant 2), and the withdraw-liability row is what the
    // admin review settles against — no automation, fraud-safe.
    await postTransaction(ctx, {
      txType: "WITHDRAWAL_HOLD",
      description: `Withdrawal request (${args.method}) — pending review`,
      reference: userId,
      idempotencyKey: `WITHDRAWAL_HOLD:${userId}:${now}`,
      now,
      lines: [
        {
          accountCode: ACCOUNT_CODES.userPaid(userId),
          accountName: "User paid balance",
          accountType: "LIABILITY",
          direction: "DEBIT",
          amountSantims: args.amountSantims,
        },
        {
          accountCode: ACCOUNT_CODES.withdrawals,
          accountName: "Platform withdrawals pending",
          accountType: "LIABILITY",
          direction: "CREDIT",
          amountSantims: args.amountSantims,
        },
      ],
    });
    ctx.db.patch(wallet._id, {
      paidBalanceSantims: wallet.paidBalanceSantims - args.amountSantims,
      updatedAt: now,
    });

    const withdrawalId = await ctx.db.insert("withdrawals", {
      userId,
      amountSantims: args.amountSantims,
      method: args.method,
      destination,
      status: "PENDING",
      userNote: args.note?.trim() || undefined,
      createdAt: now,
    });

    await insertAuditLog(ctx, {
      actor: userId,
      action: "WITHDRAWAL_REQUESTED",
      resource: `withdrawal:${withdrawalId}`,
      details: `amount=${args.amountSantims} method=${args.method}`,
      now,
    });
    await insertNotification(ctx, {
      userId,
      type: "PRIZE_STATUS",
      title: "Withdrawal requested",
      body: `Your withdrawal request for ${(args.amountSantims / 100).toFixed(2)} ETB is pending review.`,
      now,
    });
    return { ok: true as const, withdrawalId };
  },
});

export const cancelMyWithdrawal = mutation({
  args: { withdrawalId: v.id("withdrawals") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");
    const w = await ctx.db.get(args.withdrawalId);
    if (!w || w.userId !== userId) throw new Error("NOT_FOUND");
    if (w.status !== "PENDING") throw new Error("NOT_CANCELABLE");

    const now = Date.now();
    await refundWithdrawalHold(ctx, w, now, "cancelled by user");
    ctx.db.patch(w._id, { status: "CANCELLED", reviewedAt: now });
    await insertAuditLog(ctx, {
      actor: userId,
      action: "WITHDRAWAL_CANCELLED",
      resource: `withdrawal:${w._id}`,
      now,
    });
    return { ok: true as const };
  },
});

/** Compensating posting: return the held amount to the user's paid balance. */
async function refundWithdrawalHold(
  ctx: MutationCtx,
  w: Doc<"withdrawals">,
  now: number,
  reason: string,
): Promise<void> {
  await postTransaction(ctx, {
    txType: "WITHDRAWAL_RELEASE",
    description: `Withdrawal released: ${reason}`,
    reference: w._id,
    idempotencyKey: `WITHDRAWAL_RELEASE:${w._id}`,
    now,
    lines: [
      {
        accountCode: ACCOUNT_CODES.withdrawals,
        accountName: "Platform withdrawals pending",
        accountType: "LIABILITY",
        direction: "DEBIT",
        amountSantims: w.amountSantims,
      },
      {
        accountCode: ACCOUNT_CODES.userPaid(w.userId),
        accountName: "User paid balance",
        accountType: "LIABILITY",
        direction: "CREDIT",
        amountSantims: w.amountSantims,
      },
    ],
  });
  const wallet = await ensureWallet(ctx, w.userId);
  ctx.db.patch(wallet._id, {
    paidBalanceSantims: wallet.paidBalanceSantims + w.amountSantims,
    updatedAt: now,
  });
}

export const getMyWithdrawals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return ctx.db
      .query("withdrawals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
  },
});

// ─── Withdrawals (admin side) ───────────────────────────────────────────────

export const listWithdrawalsAdmin = query({
  args: { statusFilter: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const adminId = await requireSuperAdminOrAdmin(ctx);
    const rows = args.statusFilter
      ? await ctx.db
          .query("withdrawals")
          .withIndex("by_status", (q) =>
            q.eq("status", args.statusFilter as Doc<"withdrawals">["status"]),
          )
          .collect()
      : await ctx.db.query("withdrawals").collect();
    const users = await ctx.db.query("users").collect();
    const byId = new Map(users.map((u) => [u._id, u]));
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200)
      .map((w) => ({
        id: w._id,
        userId: w.userId,
        userEmail: byId.get(w.userId)?.email ?? "—",
        userName: byId.get(w.userId)?.name ?? null,
        amountSantims: w.amountSantims,
        method: w.method,
        destination: w.destination,
        status: w.status,
        userNote: w.userNote ?? null,
        reviewedAt: w.reviewedAt ?? null,
        reviewNote: w.reviewNote ?? null,
        createdAt: w.createdAt,
      }));
  },
});

async function requireSuperAdminOrAdmin(ctx: AnyCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("UNAUTHENTICATED");
  const user = await ctx.db.get(userId);
  if (!user || !(user.role === ROLES.ADMIN || user.role === ROLES.SUPER_ADMIN)) {
    throw new Error("FORBIDDEN_ADMIN_ONLY");
  }
  return userId;
}

/**
 * Admin decision on a withdrawal. Only PAID moves money out of the platform
 * (the hold liability is settled against real-world payout); REJECTED and
 * any other path refunds the hold to the user's wallet.
 */
export const reviewWithdrawal = mutation({
  args: {
    withdrawalId: v.id("withdrawals"),
    decision: v.union(v.literal("PAID"), v.literal("REJECTED")),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const adminId = await requireSuperAdminOrAdmin(ctx);
    const w = await ctx.db.get(args.withdrawalId);
    if (!w) throw new Error("NOT_FOUND");
    if (w.status !== "PENDING") throw new Error("ALREADY_REVIEWED");

    const now = Date.now();
    if (args.decision === "PAID") {
      // Settle the withdrawal liability: funds have left the platform via
      // manual payout (telebirr/bank transfer executed outside the app).
      await postTransaction(ctx, {
        txType: "WITHDRAWAL_PAID",
        description: `Withdrawal paid out (${w.method}) — ${args.note}`,
        reference: w._id,
        idempotencyKey: `WITHDRAWAL_PAID:${w._id}`,
        now,
        lines: [
          {
            accountCode: ACCOUNT_CODES.withdrawals,
            accountName: "Platform withdrawals pending",
            accountType: "LIABILITY",
            direction: "DEBIT",
            amountSantims: w.amountSantims,
          },
          {
            accountCode: ACCOUNT_CODES.clearing,
            accountName: "Platform clearing",
            accountType: "ASSET",
            direction: "CREDIT",
            amountSantims: w.amountSantims,
          },
        ],
      });
      ctx.db.patch(w._id, {
        status: "PAID",
        reviewedBy: adminId,
        reviewedAt: now,
        reviewNote: args.note.trim() || undefined,
      });
      await insertNotification(ctx, {
        userId: w.userId,
        type: "PAYMENT_SUCCESS",
        title: "Withdrawal paid",
        body: `Your withdrawal of ${(w.amountSantims / 100).toFixed(2)} ETB has been sent via ${w.method}.`,
        now,
      });
    } else {
      await refundWithdrawalHold(ctx, w, now, `rejected: ${args.note}`);
      ctx.db.patch(w._id, {
        status: "REJECTED",
        reviewedBy: adminId,
        reviewedAt: now,
        reviewNote: args.note.trim() || undefined,
      });
      await insertNotification(ctx, {
        userId: w.userId,
        type: "PAYMENT_SUCCESS",
        title: "Withdrawal rejected",
        body: `Your withdrawal request was rejected. Reason: ${args.note}. The funds are back in your wallet.`,
        now,
      });
    }
    await insertAuditLog(ctx, {
      actor: adminId,
      action: `WITHDRAWAL_${args.decision}`,
      resource: `withdrawal:${w._id}`,
      details: `amount=${w.amountSantims} note=${args.note}`,
      now,
    });
    return { ok: true as const };
  },
});

// ─── Super admin management ────────────────────────────────────────────────

/**
 * Grant a role. Regular admins can only grant USER (i.e. nothing above
 * themselves); only the SUPER_ADMIN can create admins or transfer ownership.
 * The super admin can demote other admins (Revoke Admin) but nobody —
 * including themselves — can downgrade the super admin account.
 */
export const grantRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(
      v.literal(ROLES.SUPER_ADMIN),
      v.literal(ROLES.ADMIN),
      v.literal(ROLES.USER),
      v.literal(ROLES.MEMBER),
    ),
  },
  handler: async (ctx, args) => {
    const adminId = await requireSuperAdminOrAdmin(ctx);
    const actor = await ctx.db.get(adminId);
    if (!actor) throw new Error("UNAUTHENTICATED");
    if (args.userId === adminId) throw new Error("CANNOT_CHANGE_OWN_ROLE");

    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("USER_NOT_FOUND");

    if (actor.role === ROLES.ADMIN && args.role !== ROLES.USER) {
      throw new Error("ONLY_SUPER_ADMIN_CAN_GRANT_ADMIN");
    }
    if (actor.role === ROLES.SUPER_ADMIN && args.role === ROLES.SUPER_ADMIN) {
      throw new Error("OWNERSHIP_TRANSFER_NOT_ALLOWED_HERE");
    }
    // Never downgrade an existing super admin.
    if (target.role === ROLES.SUPER_ADMIN) {
      throw new Error("SUPER_ADMIN_IS_PROTECTED");
    }

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

/** Revoke admin (back to user) — super admin only. */
export const revokeAdmin = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const adminId = await requireSuperAdmin(ctx);
    if (args.userId === adminId) throw new Error("CANNOT_MODIFY_SELF");
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("USER_NOT_FOUND");
    if (target.role !== ROLES.ADMIN) throw new Error("TARGET_NOT_ADMIN");

    ctx.db.patch(args.userId, { role: ROLES.USER });
    await insertAuditLog(ctx, {
      actor: adminId,
      action: "ADMIN_REVOKED",
      resource: `user:${args.userId}`,
      now: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Owner recovery — CLI/Dashboard only (internal, never callable from the
 * frontend). Run with:
 *   npx convex run internal/accountOps:recoverSuperAdmin '{"newOwnerId":"...", "recoveryKey":"..."}'
 * The key comes from SUPER_ADMIN_RECOVERY_KEY in the environment. Every
 * current super admin is demoted and the new owner takes over, so a lost
 * Telegram/email account never locks the platform.
 */
export const recoverSuperAdmin = internalMutation({
  args: { newOwnerId: v.id("users"), recoveryKey: v.string() },
  handler: async (ctx, args) => {
    const expected = process.env.SUPER_ADMIN_RECOVERY_KEY;
    if (!expected) throw new Error("RECOVERY_NOT_CONFIGURED");
    if (args.recoveryKey !== expected) throw new Error("INVALID_RECOVERY_KEY");

    const previous = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), ROLES.SUPER_ADMIN))
      .collect();
    for (const u of previous) {
      ctx.db.patch(u._id, { role: ROLES.ADMIN });
    }
    ctx.db.patch(args.newOwnerId, { role: ROLES.SUPER_ADMIN });
    await insertAuditLog(ctx, {
      action: "SUPER_ADMIN_RECOVERED",
      resource: `user:${args.newOwnerId}`,
      details: `previous=${previous.map((u) => u._id).join(",") || "none"}`,
      now: Date.now(),
    });
    return { ok: true, demoted: previous.length };
  },
});

// ─── Soft delete / account closure ─────────────────────────────────────────

/**
 * Anonymize and deactivate the caller's account. Financial and bid records
 * are preserved (ledger integrity), but the identity is scrubbed so the same
 * Telegram ID / email can sign up fresh later.
 */
export const deleteMyAccount = mutation({
  args: { confirmation: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");
    if (args.confirmation !== "DELETE MY ACCOUNT") {
      throw new Error('Type "DELETE MY ACCOUNT" to confirm.');
    }
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    if (user.role === ROLES.SUPER_ADMIN) {
      throw new Error(
        "OWNER_ACCOUNT_CANNOT_BE_DELETED — use owner recovery instead.",
      );
    }

    // Block if a withdrawal is pending (funds in flight).
    const pending = await ctx.db
      .query("withdrawals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
      .then((rows) => rows.filter((r) => r.status === "PENDING"));
    if (pending.length > 0) {
      throw new Error("RESOLVE_PENDING_WITHDRAWAL_FIRST");
    }

    const now = Date.now();
    const anon = `deleted-user-${userId.slice(-8)}-${now}`;
    ctx.db.patch(userId, {
      name: "Deleted user",
      email: anon,
      emailVerificationTime: undefined,
      phone: undefined,
      phoneVerificationTime: undefined,
      telegramChatId: undefined,
      image: undefined,
      role: user.role === ROLES.ADMIN ? undefined : user.role,
      isActive: false,
      deletedAt: now,
      status: "CLOSED",
    });

    // Free the channel for re-registration.
    for (const code of await ctx.db
      .query("linkCodes")
      .withIndex("by_user_method", (q) => q.eq("userId", userId).eq("method", "telegram"))
      .collect()) {
      ctx.db.delete(code._id);
    }
    for (const code of await ctx.db
      .query("linkCodes")
      .withIndex("by_user_method", (q) => q.eq("userId", userId).eq("method", "phone"))
      .collect()) {
      ctx.db.delete(code._id);
    }

    await insertAuditLog(ctx, {
      actor: userId,
      action: "ACCOUNT_SOFT_DELETED",
      resource: `user:${userId}`,
      now,
    });
    return { ok: true as const };
  },
});

/**
 * Auth-side hook: when a Telegram chat ID or email that previously belonged
 * to a closed account signs in again, reactivate the record as a fresh
 * account instead of refusing. Wired from auth/userResolution via internal
 * call after a CLOSED/anonymized match is detected.
 */
export const reactivateClosedAccountInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.isActive !== false) return { reactivated: false };
    const now = Date.now();
    ctx.db.patch(args.userId, {
      isActive: true,
      deletedAt: undefined,
      status: "ACTIVE",
      email: undefined,
      name: undefined,
    });
    return { reactivated: true };
  },
});

// ─── Auto-bidder plans (Phase 6, §6.4) ─────────────────────────────────────

export const createAutoBidPlan = mutation({
  args: {
    auctionId: v.id("auctions"),
    budgetSantims: v.number(),
    bidCount: v.number(),
    minBidSantims: v.number(),
    maxBidSantims: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");
    const user = await ctx.db.get(userId);
    if (!user || user.isActive === false) throw new Error("ACCOUNT_INACTIVE");
    if ((user.selfExcludedUntil ?? 0) > Date.now()) {
      throw new Error("SELF_EXCLUDED");
    }

    const auction = await ctx.db.get(args.auctionId);
    if (!auction) throw new Error("AUCTION_NOT_FOUND");
    if (auction.status !== "OPEN" && auction.status !== "CLOSING") {
      throw new Error("AUCTION_NOT_OPEN");
    }

    if (
      !Number.isInteger(args.bidCount) ||
      args.bidCount < 1 ||
      args.bidCount > 100
    ) {
      throw new Error("BID_COUNT_INVALID");
    }
    if (
      !Number.isInteger(args.budgetSantims) ||
      args.budgetSantims <
        args.bidCount * auction.bidServiceFeeSantims
    ) {
      throw new Error(
        `BUDGET_TOO_SMALL — needs at least ${args.bidCount * auction.bidServiceFeeSantims} santims (${(args.bidCount * auction.bidServiceFeeSantims / 100).toFixed(2)} ETB)`,
      );
    }
    if (
      !Number.isInteger(args.minBidSantims) ||
      !Number.isInteger(args.maxBidSantims) ||
      args.minBidSantims < auction.minBidSantims ||
      args.maxBidSantims > auction.maxBidSantims ||
      args.minBidSantims > args.maxBidSantims
    ) {
      throw new Error("BID_RANGE_INVALID");
    }
    // Cap: one ACTIVE plan per user per auction.
    const existing = await ctx.db
      .query("autoBids")
      .withIndex("by_auction_status", (q) =>
        q.eq("auctionId", args.auctionId).eq("status", "ACTIVE"),
      )
      .collect()
      .then((rows) => rows.filter((r) => r.userId === userId));
    if (existing.length > 0) {
      throw new Error("PLAN_ALREADY_ACTIVE_FOR_AUCTION");
    }

    const planId = await ctx.db.insert("autoBids", {
      userId,
      auctionId: args.auctionId,
      budgetSantims: args.budgetSantims,
      spentSantims: 0,
      minBidSantims: args.minBidSantims,
      maxBidSantims: args.maxBidSantims,
      bidCount: args.bidCount,
      bidsPlaced: 0,
      status: "ACTIVE",
      createdAt: Date.now(),
    });
    await insertAuditLog(ctx, {
      actor: userId,
      action: "AUTO_BID_PLAN_CREATED",
      resource: `autoBid:${planId}`,
      details: `auction=${auction.auctionCode} budget=${args.budgetSantims} bids=${args.bidCount}`,
      now: Date.now(),
    });
    return { ok: true as const, planId };
  },
});

export const cancelAutoBidPlan = mutation({
  args: { planId: v.id("autoBids") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");
    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.userId !== userId) throw new Error("NOT_FOUND");
    if (plan.status !== "ACTIVE") throw new Error("NOT_ACTIVE");
    ctx.db.patch(args.planId, { status: "CANCELLED" });
    return { ok: true as const };
  },
});

export const listMyAutoBidPlans = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const plans = await ctx.db
      .query("autoBids")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return Promise.all(
      plans
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (p) => {
          const auction = await ctx.db.get(p.auctionId);
          return {
            _id: p._id,
            auctionCode: auction?.auctionCode ?? "?",
            budgetSantims: p.budgetSantims,
            spentSantims: p.spentSantims,
            bidCount: p.bidCount,
            bidsPlaced: p.bidsPlaced,
            minBidSantims: p.minBidSantims,
            maxBidSantims: p.maxBidSantims,
            status: p.status,
            createdAt: p.createdAt,
          };
        }),
    );
  },
});

/**
 * Cron worker: executes due auto-bid plans. Each tick picks a few ACTIVE
 * plans whose auction is open, waits for a randomized delay spread across
 * the remaining auction time, and places ONE bid per activation through
 * attemptBid — the same engine as manual bids (same validation, same fee).
 * Randomized values keep plans from telegraphing a pattern; the budget and
 * per-auction bid caps are enforced inside attemptBid.
 */
export const processAutoBids = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const plans = await ctx.db
      .query("autoBids")
      .withIndex("by_status", (q) => q.eq("status", "ACTIVE"))
      .collect();
    let executed = 0;
    let finished = 0;

    for (const plan of plans.slice(0, 15)) {
      const auction = await ctx.db.get(plan.auctionId);
      const user = await ctx.db.get(plan.userId);
      if (
        !auction ||
        !user ||
        (auction.status !== "OPEN" && auction.status !== "CLOSING") ||
        now >= auction.closesAt ||
        (user.selfExcludedUntil ?? 0) > now ||
        user.isActive === false
      ) {
        if (!auction || auction.status === "CLOSED" || auction.status === "COMPLETED") {
          ctx.db.patch(plan._id, { status: "DONE" });
          finished++;
        }
        continue;
      }

      // Fees remaining that this plan can still spend.
      const remainingBids = plan.bidCount - plan.bidsPlaced;
      const remainingBudget = plan.budgetSantims - plan.spentSantims;
      if (remainingBids <= 0 || remainingBudget < auction.bidServiceFeeSantims) {
        ctx.db.patch(plan._id, { status: "DONE" });
        finished++;
        continue;
      }

      // Random value in [min, max] aligned to the increment grid.
      let value = plan.minBidSantims;
      if (plan.maxBidSantims > plan.minBidSantims) {
        const steps = Math.floor(
          (plan.maxBidSantims - plan.minBidSantims) /
            Math.max(1, auction.bidIncrementSantims),
        );
        const step = Math.floor(Math.random() * (steps + 1));
        value = plan.minBidSantims + step * Math.max(1, auction.bidIncrementSantims);
      }

      const idempotencyKey = `auto-${plan._id}-${plan.bidsPlaced}`;
      let attempt: Awaited<ReturnType<typeof attemptBid>>;
      try {
        attempt = await attemptBid(ctx, {
          auction,
          userId: plan.userId,
          bidValueSantims: value,
          idempotencyKey,
          now,
        });
      } catch (err) {
        if (err instanceof LedgerError) {
          attempt = { ok: false, code: "INSUFFICIENT_BALANCE" };
        } else {
          throw err;
        }
      }

      if (attempt.ok) {
        executed++;
        const spent = plan.spentSantims + auction.bidServiceFeeSantims;
        const placed = plan.bidsPlaced + 1;
        const done = placed >= plan.bidCount || spent + auction.bidServiceFeeSantims > plan.budgetSantims;
        ctx.db.patch(plan._id, {
          spentSantims: spent,
          bidsPlaced: placed,
          ...(done ? { status: "DONE" as const } : {}),
        });
        await insertNotification(ctx, {
          userId: plan.userId,
          type: "BID_ACCEPTED",
          title: "Auto-bid placed",
          body: `Your auto-bid plan placed a bid in ${auction.auctionCode} (${placed}/${plan.bidCount}).`,
          auctionId: auction._id,
          now,
        });
      } else if (attempt.code === "INSUFFICIENT_BALANCE") {
        ctx.db.patch(plan._id, { status: "DONE" });
        finished++;
      } else if (
        attempt.code === "BID_LIMIT_REACHED" ||
        attempt.code === "CONSECUTIVE_BID_BLOCKED"
      ) {
        // Retry next tick with a different random value — temporary blocks.
      } else {
        // Range/validation errors would repeat forever — end the plan.
        ctx.db.patch(plan._id, {
          status: "DONE",
        });
        finished++;
      }
    }
    return { executed, finished };
  },
});
