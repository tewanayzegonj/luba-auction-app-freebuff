import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { ACCOUNT_CODES, postTransaction } from "./lib/ledger";
import { ensureWallet } from "./lib/finance";
import { insertNotification } from "./lib/notifications";

/**
 * Daily check-in bonus - a retention loop fully backed by the ledger.
 *
 * Rules:
 *  - One claim per Addis Ababa calendar day (Africa/Addis_Ababa, UTC+3, no DST),
 *    matching the lifecycle worker's day boundary.
 *  - Consecutive Addis days grow the streak; missing a day resets to day 1.
 *  - Reward is a promo-credit posting (DEBIT revenue / CREDIT user promo), the
 *    same instrument as referral rewards - it can only ever pay bid fees.
 *  - Idempotent: the claim key is derived from the calendar day, so a retry or
 *    race can never double-credit (ledger Invariant 4).
 */

// Fixed UTC+3 (no DST) - the Addis Ababa day window.
const ADDIS_OFFSET_MS = 3 * 3_600_000;

const BASE_REWARD_SANTIMS = 500; // 5 ETB on day 1
const STREAK_BONUS_STEP_SANTIMS = 250; // +2.5 ETB per consecutive day
const BONUS_CAP_SANTIMS = 3_000; // 30 ETB max from day 10 on

function addisDayString(now: number): string {
  return new Date(now + ADDIS_OFFSET_MS).toISOString().slice(0, 10);
}

function dayBefore(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The caller's daily-bonus state (drives the claim card). */
export const getDailyBonusStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;

    const today = addisDayString(Date.now());
    const last = user.lastDailyBonusDate ?? null;
    const claimedToday = last === today;
    const streak = user.dailyBonusStreak ?? 0;

    // If the last claim wasn't yesterday, an existing streak is stale - the
    // next claim restarts at day 1. Display the "live" streak accordingly.
    const streakAlive = last !== null && last === dayBefore(today);

    return {
      canClaim: !claimedToday,
      claimedToday,
      today,
      // Streak the user is currently on (already claimed days). If it's still
      // alive (claimed yesterday), claiming today extends it; otherwise the
      // next claim starts a fresh streak.
      streak: streakAlive ? streak : 0,
      nextRewardSantims: claimedToday
        ? 0
        : Math.min(
            BASE_REWARD_SANTIMS +
              STREAK_BONUS_STEP_SANTIMS * (streakAlive ? streak : 0),
            BONUS_CAP_SANTIMS,
          ),
      baseRewardSantims: BASE_REWARD_SANTIMS,
      capSantims: BONUS_CAP_SANTIMS,
    };
  },
});

/** Claim today's bonus. Idempotent per (user, Addis day). */
export const claimDailyBonus = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");

    // No extra rate limiting needed: the (user, Addis-day) idempotency key is
    // the gate - spamming this mutation returns ALREADY_CLAIMED_TODAY.

    const now = Date.now();
    const today = addisDayString(now);
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("UNAUTHENTICATED");

    if (user.lastDailyBonusDate === today) {
      return { claimed: false as const, reason: "ALREADY_CLAIMED_TODAY" as const };
    }

    // Streak: continuing (last claim was yesterday, Addis terms) → +1; reset → 1.
    const prev = user.lastDailyBonusDate ?? null;
    const continuing = prev !== null && prev === dayBefore(today);
    const streak = continuing ? (user.dailyBonusStreak ?? 0) + 1 : 1;

    const reward = Math.min(
      BASE_REWARD_SANTIMS + STREAK_BONUS_STEP_SANTIMS * (streak - 1),
      BONUS_CAP_SANTIMS,
    );

    await ensureWallet(ctx, userId);
    await postTransaction(ctx, {
      txType: "PROMO_CREDIT",
      reference: `daily_bonus:${userId}:${today}`,
      description: "Daily check-in bonus",
      idempotencyKey: `daily_bonus:${userId}:${today}`,
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
          accountCode: ACCOUNT_CODES.userPromo(userId),
          accountName: "User promo balance",
          accountType: "LIABILITY",
          direction: "CREDIT",
          amountSantims: reward,
        },
      ],
    });

    await ctx.db.patch(userId, {
      lastDailyBonusDate: today,
      dailyBonusStreak: streak,
    });
    await insertNotification(ctx, {
      userId,
      type: "SYSTEM",
      title: "Daily bonus claimed 🎁",
      body: `${(reward / 100).toFixed(2)} ETB promo credit added. Come back tomorrow to grow your streak!`,
      now,
    });

    return { claimed: true as const, rewardSantims: reward, streak };
  },
});
