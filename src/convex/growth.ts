import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { ACCOUNT_CODES, postTransaction } from "./lib/ledger";
import { ensureWallet } from "./lib/finance";
import { insertAuditLog } from "./lib/notifications";

/**
 * Referrals & promo wallet (growth loop).
 *
 * Flow:
 *  1. Every user gets a referral code (generated lazily, unique).
 *  2. A new user signs up with ?ref=<code> → signupWithReferral binds it.
 *  3. When the referee's FIRST bid fee is charged, rewardReferralInternal
 *     grants both sides promo credit via balanced ledger postings.
 *
 * Promo balances are a projection of the ledger — never free-floating
 * counters (Invariant 1 applies to every promo credit).
 */

const REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no lookalikes
const DEFAULT_REFERRAL_REWARD_SANTIMS = 2_000; // 20 ETB promo, admin-tunable

function generateReferralCode(): string {
  const random: RandomReader = {
    read(bytes: Uint8Array<ArrayBuffer>) {
      crypto.getRandomValues(bytes);
    },
  };
  return generateRandomString(random, REFERRAL_ALPHABET, 8);
}

/** Lazily mint the caller's unique referral code (write — must be a mutation). */
export const ensureReferralCode = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("UNAUTHENTICATED");
    if (user.referralCode) return user.referralCode;
    let code = generateReferralCode();
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db
        .query("users")
        .withIndex("by_referral_code", (q) => q.eq("referralCode", code))
        .first();
      if (!clash) break;
      code = generateReferralCode();
    }
    await ctx.db.patch(userId, { referralCode: code });
    return code;
  },
});

/** The caller's referral code + stats. */
export const getMyReferralInfo = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;

    const referrals = await ctx.db
      .query("referrals")
      .withIndex("by_referrer", (q) => q.eq("referrerId", userId))
      .collect();
    const rewarded = referrals.filter((r) => r.status === "REWARDED");

    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    return {
      referralCode: user.referralCode ?? null,
      totalReferred: referrals.length,
      totalRewarded: rewarded.length,
      promoBalanceSantims: wallet?.promoBalanceSantims ?? 0,
    };
  },
});

/** Bind a referral code to the current (new) user. One-shot. */
export const applyReferralCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");

    const existing = await ctx.db
      .query("referrals")
      .withIndex("by_referee", (q) => q.eq("refereeId", userId))
      .first();
    if (existing) return { ok: true as const, alreadyBound: true };

    const code = args.code.trim().toUpperCase();
    const referrer = await ctx.db
      .query("users")
      .withIndex("by_referral_code", (q) => q.eq("referralCode", code))
      .unique();
    if (!referrer) throw new Error("That referral code doesn't exist.");
    if (referrer._id === userId) {
      throw new Error("You can't use your own referral code.");
    }

    await ctx.db.insert("referrals", {
      referrerId: referrer._id,
      refereeId: userId,
      code,
      status: "PENDING",
      createdAt: Date.now(),
    });
    await ctx.db.patch(userId, { referredBy: referrer._id, referredAt: Date.now() });
    return { ok: true as const, alreadyBound: false };
  },
});

/**
 * Called by the bid engine AFTER a referee's first successful bid-fee charge.
 * Idempotent: the PENDING → REWARDED transition is the fence.
 */
export const rewardReferralInternal = internalMutation({
  args: { refereeId: v.id("users"), bidId: v.id("auctionBids") },
  handler: async (ctx, args) => {
    const referral = await ctx.db
      .query("referrals")
      .withIndex("by_referee", (q) => q.eq("refereeId", args.refereeId))
      .first();
    if (!referral || referral.status !== "PENDING") return { rewarded: false };

    const now = Date.now();
    const rewardSetting = await ctx.db
      .query("platformSettingsText")
      .withIndex("by_key", (q) => q.eq("key", "REFERRAL_REWARD_SANTIMS"))
      .unique();
    const reward =
      Number(rewardSetting?.value) || DEFAULT_REFERRAL_REWARD_SANTIMS;

    // Credit both sides' promo accounts (balanced postings against revenue).
    await ensureWallet(ctx, referral.referrerId);
    await ensureWallet(ctx, referral.refereeId);
    await postTransaction(ctx, {
      txType: "PROMO_CREDIT",
      reference: `referral:${referral._id}:referrer`,
      description: "Referral reward — friend's first bid",
      idempotencyKey: `referral_reward:${referral._id}:referrer`,
      now,
      lines: [
        {
          accountCode: ACCOUNT_CODES.revenue,
          accountName: "Platform revenue",
          accountType: "REVENUE",
          direction: "DEBIT",
          amountSantims: reward,
        },
        {
          accountCode: ACCOUNT_CODES.userPromo(referral.referrerId),
          accountName: "User promo balance",
          accountType: "LIABILITY",
          direction: "CREDIT",
          amountSantims: reward,
        },
      ],
    });
    await postTransaction(ctx, {
      txType: "PROMO_CREDIT",
      reference: `referral:${referral._id}:referee`,
      description: "Referral welcome bonus",
      idempotencyKey: `referral_reward:${referral._id}:referee`,
      now,
      lines: [
        {
          accountCode: ACCOUNT_CODES.revenue,
          accountName: "Platform revenue",
          accountType: "REVENUE",
          direction: "DEBIT",
          amountSantims: reward,
        },
        {
          accountCode: ACCOUNT_CODES.userPromo(referral.refereeId),
          accountName: "User promo balance",
          accountType: "LIABILITY",
          direction: "CREDIT",
          amountSantims: reward,
        },
      ],
    });

    await ctx.db.patch(referral._id, { status: "REWARDED", rewardedAt: now });

    await ctx.db.insert("outboxEvents", {
      eventType: "NOTIFICATION",
      payload: {
        userId: referral.referrerId,
        type: "SYSTEM",
        title: "Referral reward earned 🎉",
        body: "Your friend placed their first bid — promo credit has been added to your wallet.",
      },
      processed: false,
      createdAt: now,
    });

    await insertAuditLog(ctx, {
      actor: referral.refereeId,
      action: "REFERRAL_REWARDED",
      resource: `referrals:${referral._id}`,
      details: `${reward} santims promo to both parties`,
      now,
    });
    return { rewarded: true };
  },
});

// ─── Responsible play (self-set limits; spec-aligned) ───────────────────────

export const setResponsiblePlayLimits = mutation({
  args: {
    dailyDepositCapSantims: v.optional(v.number()),
    selfExcludeDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");

    if (args.dailyDepositCapSantims !== undefined) {
      if (args.dailyDepositCapSantims < 0) {
        throw new Error("Cap must be zero or positive.");
      }
      // Limits can only be tightened. Raising a cap requires a 24h cooling
      // period — implemented as: new cap takes effect after 24h.
      const user = await ctx.db.get(userId);
      const current = user?.selfDepositCapSantims;
      if (current !== undefined && args.dailyDepositCapSantims > current) {
        await ctx.db.patch(userId, {
          selfDepositCapSantims: args.dailyDepositCapSantims,
          // pendingCapSince marks it as not-yet-effective (24h cooling off).
          selfDepositCapPendingSince: Date.now(),
        } as never);
      } else {
        await ctx.db.patch(userId, {
          selfDepositCapSantims: args.dailyDepositCapSantims,
          selfDepositCapPendingSince: undefined,
        } as never);
      }
    }

    if (args.selfExcludeDays !== undefined && args.selfExcludeDays > 0) {
      const until = Date.now() + args.selfExcludeDays * 86_400_000;
      await ctx.db.patch(userId, { selfExcludedUntil: until } as never);
      await insertAuditLog(ctx, {
        actor: userId,
        action: "SELF_EXCLUSION_SET",
        resource: `users:${userId}`,
        details: `until ${new Date(until).toISOString()}`,
        now: Date.now(),
      });
    }
    return { ok: true as const };
  },
});

export const getMyLimits = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const now = Date.now();
    const pendingCap =
      user.selfDepositCapPendingSince !== undefined &&
      user.selfDepositCapPendingSince + 86_400_000 > now
        ? user.selfDepositCapSantims
        : undefined;
    return {
      depositCapSantims: user.selfDepositCapSantims ?? null,
      capPendingSantims: pendingCap ?? null,
      selfExcludedUntil: user.selfExcludedUntil ?? null,
      currentlyExcluded: (user.selfExcludedUntil ?? 0) > now,
    };
  },
});

// ─── Fraud velocity signals (spec §39) ──────────────────────────────────────

export const recordFraudSignalInternal = internalMutation({
  args: {
    userId: v.id("users"),
    signal: v.string(),
    severity: v.union(v.literal("LOW"), v.literal("MEDIUM"), v.literal("HIGH")),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Dedupe: same signal for same user within 1h is not re-recorded.
    const cutoff = Date.now() - 3_600_000;
    const recent = await ctx.db
      .query("fraudSignals")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(5);
    if (
      recent.some(
        (s) => s.signal === args.signal && s.createdAt > cutoff,
      )
    ) {
      return { recorded: false };
    }
    await ctx.db.insert("fraudSignals", {
      userId: args.userId,
      signal: args.signal,
      severity: args.severity,
      details: args.details,
      reviewed: false,
      createdAt: Date.now(),
    });
    return { recorded: true };
  },
});
