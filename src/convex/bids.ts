import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Dashboard data — spec §34. */

export const getMyBids = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return bids.sort((a, b) => b.acceptedAt - a.acceptedAt);
  },
});

export const getMyNotifications = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  },
});

export const markNotificationsRead = mutation({
  args: { ids: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");
    for (const id of args.ids) {
      const n = await ctx.db.get(id);
      if (n && n.userId === userId) ctx.db.patch(id, { read: true });
    }
    return { ok: true };
  },
});
