import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { insertAuditLog, insertNotification } from "./lib/notifications";
import { requireAdmin } from "./admin";

/**
 * KYC documents (spec §32, §41) - winner identity verification.
 *
 * Flow: user uploads a photo ID (image or PDF, ≤5MB) → status PENDING →
 * admin approves/rejects → user.kycStatus updated + notified. The document
 * lives in Convex file storage; only its metadata row is in the table.
 * Admins read documents through a short-lived serving URL at review time.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Step 1: user requests an upload URL. */
export const generateKycUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    if (user.status === "SUSPENDED" || user.status === "CLOSED") {
      throw new Error("ACCOUNT_NOT_ELIGIBLE");
    }

    // One pending document at a time.
    const pending = await ctx.db
      .query("kycDocuments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "PENDING"))
      .first();
    if (pending) throw new Error("KYC_ALREADY_PENDING");

    return await ctx.storage.generateUploadUrl();
  },
});

/** Step 2: attach the uploaded file and create the review row. */
export const submitKycDocument = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");

    const file = await ctx.db.system.get(args.storageId);
    if (!file) throw new Error("FILE_NOT_FOUND");
    const contentType = file.contentType ?? "";
    if (!ALLOWED_TYPES.includes(contentType)) {
      throw new Error("FILE_TYPE_NOT_ALLOWED (JPEG, PNG, WebP, or PDF)");
    }
    if (file.size > MAX_BYTES) {
      throw new Error("FILE_TOO_LARGE_5MB");
    }

    const pending = await ctx.db
      .query("kycDocuments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "PENDING"))
      .first();
    if (pending) throw new Error("KYC_ALREADY_PENDING");

    const docId = await ctx.db.insert("kycDocuments", {
      userId,
      storageId: args.storageId,
      fileName: args.fileName.slice(0, 120),
      contentType,
      sizeBytes: file.size,
      status: "PENDING",
      uploadedAt: Date.now(),
    });

    await ctx.db.patch(userId, { kycStatus: "PENDING" });

    await insertNotification(ctx, {
      userId,
      type: "PRIZE_STATUS",
      title: "Verification document received",
      body: "We received your identity document. Our team will review it shortly.",
      now: Date.now(),
    });

    await insertAuditLog(ctx, {
      actor: userId,
      action: "KYC_DOCUMENT_SUBMITTED",
      resource: `kycDocument:${docId}`,
      details: `fileName=${args.fileName} size=${file.size}`,
      now: Date.now(),
    });

    return { ok: true, documentId: docId };
  },
});

/** User's own KYC documents + status. */
export const getMyKyc = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    const docs = await ctx.db
      .query("kycDocuments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(10);

    return {
      kycStatus: user?.kycStatus ?? "UNVERIFIED",
      kycNote: user?.kycNote ?? null,
      documents: docs.map((d) => ({
        _id: d._id,
        fileName: d.fileName,
        status: d.status,
        reviewNote: d.reviewNote ?? null,
        uploadedAt: d.uploadedAt,
      })),
    };
  },
});

// ─── Admin ──────────────────────────────────────────────────────────────────

/** Admin: pending review queue. */
export const listPendingKyc = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const docs = await ctx.db
      .query("kycDocuments")
      .withIndex("by_status", (q) => q.eq("status", "PENDING"))
      .order("asc")
      .take(50);

    return Promise.all(
      docs.map(async (d) => {
        const user = await ctx.db.get(d.userId);
        const url = await ctx.storage.getUrl(d.storageId);
        return {
          _id: d._id,
          userId: d.userId,
          userEmail: user?.email ?? null,
          userName: user?.name ?? null,
          fileName: d.fileName,
          contentType: d.contentType,
          sizeBytes: d.sizeBytes,
          uploadedAt: d.uploadedAt,
          documentUrl: url,
        };
      }),
    );
  },
});

/** Admin: approve or reject a document. */
export const reviewKycDocument = mutation({
  args: {
    documentId: v.id("kycDocuments"),
    decision: v.union(v.literal("APPROVED"), v.literal("REJECTED")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);

    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
    if (doc.status !== "PENDING") throw new Error("ALREADY_REVIEWED");

    const userStatus = args.decision === "APPROVED" ? "VERIFIED" : "REJECTED";

    await ctx.db.patch(args.documentId, {
      status: args.decision,
      reviewedBy: adminId,
      reviewedAt: Date.now(),
      reviewNote: args.note?.slice(0, 300),
    });

    await ctx.db.patch(doc.userId, {
      kycStatus: userStatus,
      kycNote: args.note?.slice(0, 300),
    });

    await insertNotification(ctx, {
      userId: doc.userId,
      type: "PRIZE_STATUS",
      title: args.decision === "APPROVED" ? "Identity verified" : "Verification declined",
      body:
        args.decision === "APPROVED"
          ? "Your identity has been verified. You're all set."
          : `We could not verify your identity.${args.note ? ` Note: ${args.note}` : ""} You may resubmit a clearer document.`,
      now: Date.now(),
    });

    await insertAuditLog(ctx, {
      actor: adminId,
      action: `KYC_${args.decision}`,
      resource: `kycDocument:${args.documentId}`,
      details: `userId=${doc.userId} note=${args.note ?? "-"}`,
      now: Date.now(),
    });

    return { ok: true };
  },
});

// ─── Internal (system) ──────────────────────────────────────────────────────

/** Internal: admin console may mark KYC directly (existing flow keeps working). */
export const syncUserKycStatusInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query("kycDocuments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();
    if (latest && latest.status !== "PENDING") {
      await ctx.db.patch(args.userId, {
        kycStatus: latest.status === "APPROVED" ? "VERIFIED" : latest.status,
      });
    }
    return { ok: true };
  },
});
