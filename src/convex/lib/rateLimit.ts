import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Lightweight, DB-backed rate limiter (spec §40).
 *
 * In production this would live in Redis; here a per-window counter row in
 * `rateLimits` gives the same fail-closed behavior without new infrastructure.
 * All window state is in a single row per (scope, key) so writes stay O(1),
 * and stale windows are simply overwritten (no unbounded growth).
 */

export interface RateLimitResult {
  allowed: boolean;
  /** ms until the window resets (only meaningful when allowed=false) */
  retryAfterMs: number;
}

const WINDOW_MS: Record<string, number> = {
  BID: 10_000, // 10 seconds
  BID_MIN_INTERVAL: 1_500, // anti-bot floor (Phase 6): ≥1.5s between bids
  TOPUP: 60_000, // 1 minute
  OTP: 60_000, // 1 minute (framework has its own limits too)
};

const LIMITS: Record<string, number> = {
  BID: 20, // 20 bids / 10s per user per auction is generous for humans
  BID_MIN_INTERVAL: 1, // 1 bid per 1.5s window = max-firewall for scripts
  TOPUP: 5, // 5 top-up attempts / minute
  OTP: 3, // 3 OTP requests / minute
};

export async function checkRateLimit(
  ctx: MutationCtx,
  args: {
    scope: keyof typeof WINDOW_MS;
    key: string; // userId, or `${userId}:${auctionId}` for BID
  },
): Promise<RateLimitResult> {
  const windowMs = WINDOW_MS[args.scope] ?? 60_000;
  const limit = LIMITS[args.scope] ?? 10;
  const now = Date.now();

  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_scope_key", (q) => q.eq("scope", args.scope).eq("key", args.key))
    .unique();

  if (existing === null || now - existing.windowStart >= windowMs) {
    // New window: create or reset.
    if (existing !== null) {
      await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
    } else {
      await ctx.db.insert("rateLimits", { scope: args.scope, key: args.key, windowStart: now, count: 1 });
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterMs: existing.windowStart + windowMs - now };
  }

  await ctx.db.patch(existing._id, { count: existing.count + 1 });
  return { allowed: true, retryAfterMs: 0 };
}

/** Throwing variant for use at the top of hot mutations. */
export async function assertRateLimit(
  ctx: MutationCtx,
  args: { scope: keyof typeof WINDOW_MS; key: string },
): Promise<void> {
  const result = await checkRateLimit(ctx, args);
  if (!result.allowed) {
    const secs = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    throw new Error(`RATE_LIMITED: Too many attempts. Try again in ${secs}s.`);
  }
}

/**
 * Phase 6 anti-bot floor: at most one bid per user per 1.5 seconds. Runs in
 * the same transaction family as the burst limiter and fails closed.
 * human clicks are spaced well beyond this; rapid-fire scripts are not.
 */
export async function assertBidMinInterval(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  await assertRateLimit(ctx, { scope: "BID_MIN_INTERVAL", key: userId });
}

/** Best-effort cleanup cron helper — removes windows older than 1 hour. */
export async function purgeStaleWindows(ctx: MutationCtx, now: number): Promise<number> {
  const cutoff = now - 60 * 60 * 1000;
  let purged = 0;
  for (const scope of ["BID", "BID_MIN_INTERVAL", "TOPUP", "OTP"] as const) {
    const rows = await ctx.db
      .query("rateLimits")
      .withIndex("by_scope_key", (q) => q.eq("scope", scope))
      .take(200);
    for (const row of rows) {
      if (row.windowStart < cutoff) {
        await ctx.db.delete(row._id);
        purged++;
      }
    }
  }
  return purged;
}
