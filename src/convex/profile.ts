import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation } from "./_generated/server";
import { insertAuditLog } from "./lib/notifications";

/**
 * Display-name profile management (roadmap: user onboarding, spec §34).
 * Users may rename themselves at any time; admins see the same record.
 */
export const setMyName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");

    const name = args.name.trim().replace(/\s+/g, " ").slice(0, 60);
    if (name.length < 2) {
      throw new Error("Display name must be at least 2 characters.");
    }

    const before = await ctx.db.get(userId);
    await ctx.db.patch(userId, { name });
    await insertAuditLog(ctx, {
      actor: userId,
      action: "PROFILE_RENAME",
      resource: `users:${userId}`,
      details: `${before?.name ?? "—"} → ${name}`,
      now: Date.now(),
    });
    return { ok: true as const, name };
  },
});
