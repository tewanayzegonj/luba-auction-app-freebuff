import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";

/**
 * Server-side state for the Telegram OIDC Authorization Code flow.
 *
 * Why server-side: the flow navigates away from the app to Telegram's login
 * and back — possibly in a DIFFERENT tab or frame context than where it
 * started (the preview pane runs the app inside an iframe; Telegram refuses
 * to be framed, so the login opens in its own tab). Browser sessionStorage
 * cannot bridge that journey; the database can. The `state` random value in
 * the login URL is the lookup key, which also gives us the standard CSRF
 * check for free: a forged return can't name a state we actually issued.
 *
 * Storage reuses the idempotencyKeys table (scope + key + result) — no
 * schema change. Consume-on-read makes a code exchange single-use even if
 * the browser retries.
 */

const FLOW_SCOPE = "telegram-oidc-flow";
const MAX_AGE_MS = 10 * 60 * 1000; // codes live ~10 minutes; match Telegram's

/** Called by the login button right before navigating to Telegram's login. */
export const startTelegramFlow = mutation({
  args: {
    state: v.string(),
    verifier: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.state.length < 16 || args.verifier.length < 32) {
      throw new Error("Couldn't start Telegram sign-in. Please try again.");
    }
    await ctx.db.insert("idempotencyKeys", {
      scope: FLOW_SCOPE,
      key: args.state,
      result: { verifier: args.verifier },
      createdAt: Date.now(),
    });
  },
});

/** Called by the exchange action. Single-use: the record is deleted. */
export const consumeTelegramFlowState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", FLOW_SCOPE).eq("key", args.state),
      )
      .unique();
    if (record === null) return null;
    await ctx.db.delete(record._id);
    // Expired flows are treated as unknown states.
    if (Date.now() - record.createdAt > MAX_AGE_MS) return null;
    const verifier =
      typeof (record.result as { verifier?: unknown } | null)?.verifier ===
      "string"
        ? ((record.result as { verifier: string }).verifier as string)
        : null;
    return verifier;
  },
});
