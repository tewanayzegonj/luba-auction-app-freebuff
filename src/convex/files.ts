import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./admin";

/**
 * File storage for prize images (admin uploads) - Convex file storage.
 *
 * Upload flow (spec §41 products/prizes):
 *  1. Admin browser asks for an upload URL (generateUploadUrl).
 *  2. Browser POSTs the image file directly to that URL → returns storageId.
 *  3. Admin attaches the storageId to a prize (attachImageToPrize), which
 *     validates that the stored file really is an image.
 * Display: public queries resolve imageStorageId → a serving URL at read
 * time, so URLs never go stale in the database.
 */

/** Step 1: short-lived upload URL (admin only). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Step 3: attach an uploaded image to a prize (admin only, audited upstream). */
export const attachImageToPrize = mutation({
  args: {
    prizeId: v.id("prizes"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);

    const prize = await ctx.db.get(args.prizeId);
    if (!prize) throw new Error("PRIZE_NOT_FOUND");

    const file = await ctx.db.system.get(args.storageId);
    if (!file) throw new Error("FILE_NOT_FOUND");
    if (!(file.contentType ?? "").startsWith("image/")) {
      throw new Error("FILE_MUST_BE_IMAGE");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("FILE_TOO_LARGE_5MB");
    }

    ctx.db.patch(args.prizeId, { imageStorageId: args.storageId });
    return { ok: true, adminId };
  },
});

/** Detach the current image from a prize (admin only). */
export const removeImageFromPrize = mutation({
  args: { prizeId: v.id("prizes") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const prize = await ctx.db.get(args.prizeId);
    if (!prize) throw new Error("PRIZE_NOT_FOUND");
    ctx.db.patch(args.prizeId, { imageStorageId: undefined });
    return { ok: true };
  },
});

/** Admin: all prizes with their resolved image URLs. */
export const listPrizeImages = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const prizes = await ctx.db.query("prizes").collect();
    return Promise.all(
      prizes.map(async (p) => ({
        prizeId: p._id,
        title: p.title,
        emoji: p.emoji ?? null,
        valueSantims: p.valueSantims,
        imageUrl:
          p.imageStorageId !== undefined
            ? await ctx.storage.getUrl(p.imageStorageId)
            : (p.imageUrl ?? null),
      })),
    );
  },
});
