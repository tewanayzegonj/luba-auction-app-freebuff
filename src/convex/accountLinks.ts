import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  getBotToken,
  isSmsEnabled,
  isValidEthiopianPhone,
  normalizePhone,
  sendSms,
  sendTelegramMessage,
} from "./auth/senders";
import { insertAuditLog } from "./lib/notifications";

/**
 * True when the string looks like a numeric Telegram chat ID rather than an
 * email. Telegram sign-in flows through an Email-type provider, so the chat
 * ID gets stored in the user's `email` field — this helper distinguishes the
 * two so the UI labels identities correctly.
 */
function looksLikeTelegramChatId(value: string): boolean {
  return /^\d{5,}$/.test(value);
}

/**
 * Account linking — email ↔ Telegram ↔ phone (SMS), spec §8.
 *
 * Flow (Telegram / phone):
 *  1. `startLink` — signed-in user requests to link a channel; we generate a
 *     random token, store only its sha256, and hand the token to an internal
 *     sender action that delivers a deep link via Telegram/SMS.
 *  2. The user opens the link (`/auth?link=<token>`); the confirm mutation
 *     resolves the token server-side — the browser only ever holds a random
 *     capability token, never the account identity.
 *  3. `confirmLink` binds the verified destination to the user record:
 *     telegramChatId (Telegram) or phone + phoneVerificationTime (SMS).
 *
 * Uniqueness: a chat ID / phone number can be linked to at most one account —
 * conflicts are rejected instead of silently hijacking the other account.
 * Security: tokens are 20 chars of crypto-random (~95 bits), expire in 15
 * minutes, are single-use, and are hashed at rest (spec §54).
 */

const TOKEN_TTL_MS = 15 * 60 * 1000;

function randomToken(): string {
  const random: RandomReader = {
    read(bytes: Uint8Array<ArrayBuffer>) {
      crypto.getRandomValues(bytes);
    },
  };
  return generateRandomString(random, "abcdefghijklmnopqrstuvwxyz234567", 20);
}

async function hashToken(token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.CONVEX_CLOUD_URL ?? "luba-link"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const getLinkMethods = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (user === null) return null;
    return {
      email: user.email && !looksLikeTelegramChatId(user.email) ? user.email : null,
      signInEmail: user.email ?? null,
      signedInViaTelegram: looksLikeTelegramChatId(user.email ?? "") && !user.telegramChatId,
      telegramChatId: user.telegramChatId ?? null,
      phone: user.phone ?? null,
      phoneVerified: user.phoneVerificationTime !== undefined,
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      smsConfigured: isSmsEnabled(),
    };
  },
});

/** Kick off linking: stores a hashed token and schedules channel delivery. */
export const startLink = mutation({
  args: { method: v.union(v.literal("telegram"), v.literal("phone")), destination: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    const user = await ctx.db.get(userId);
    if (user === null) throw new Error("UNAUTHENTICATED");
    if (user.status === "SUSPENDED" || user.status === "LOCKED") {
      throw new Error("ACCOUNT_RESTRICTED");
    }

    const destination =
      args.method === "phone" ? normalizePhone(args.destination) : args.destination.trim();

    if (args.method === "telegram") {
      if (!/^\d{5,}$/.test(destination)) {
        throw new Error(
          "Enter your numeric Telegram ID — open our bot and press Start to receive it.",
        );
      }
      if (!process.env.TELEGRAM_BOT_TOKEN) {
        throw new Error("Telegram linking is not configured right now.");
      }
    } else {
      if (!isValidEthiopianPhone(destination)) {
        throw new Error("Enter a valid phone number, e.g. 0911223344.");
      }
      if (!isSmsEnabled()) {
        throw new Error("SMS linking is not configured right now.");
      }
    }

    // Conflict guard: the destination must not already belong to another user.
    if (args.method === "telegram") {
      const clash = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("telegramChatId"), destination))
        .first();
      if (clash && clash._id !== userId) {
        throw new Error("That Telegram account is already linked to another user.");
      }
      if (user.telegramChatId === destination) {
        throw new Error("That Telegram account is already linked to your account.");
      }
    } else {
      const clash = await ctx.db
        .query("users")
        .withIndex("phone", (q) => q.eq("phone", destination))
        .first();
      if (clash && clash._id !== userId) {
        throw new Error("That phone number is already linked to another user.");
      }
      if (user.phone === destination && user.phoneVerificationTime !== undefined) {
        throw new Error("That phone number is already linked to your account.");
      }
    }

    // Replace any pending link for the same method.
    for (const pending of await ctx.db
      .query("linkCodes")
      .withIndex("by_user_method", (q) => q.eq("userId", userId).eq("method", args.method))
      .collect()) {
      await ctx.db.delete(pending._id);
    }

    const token = randomToken();
    await ctx.db.insert("linkCodes", {
      tokenHash: await hashToken(token),
      userId,
      method: args.method,
      destination,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.accountLinks.deliverLink, {
      token,
      method: args.method,
      destination,
    });

    return { ok: true as const, destination };
  },
});

/** Internal sender — runs outside the client's transaction. */
export const deliverLink = internalAction({
  args: { token: v.string(), method: v.union(v.literal("telegram"), v.literal("phone")), destination: v.string() },
  handler: async (_ctx, args) => {
    const appUrl = (process.env.VLY_APP_URL ?? process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");
    const link = `${appUrl}/auth?link=${args.token}`;
    if (args.method === "telegram") {
      await sendTelegramMessage(
        args.destination,
        `🔗 ይህን ቴሌግራም መለያ ከሉባ መገለጫዎ ጋር ማጣመር ይፈልጋሉ? · Link this Telegram account to your Luba profile?\n\nከታች ይንኩ ላይ ለማረጋገጥ — አገናኙ ለ 15 ደቂቃ ብቻ ይሰራል፦\n${link}\n\nይህን ጥያቄ ካላደረጉ እርስ ይበሉ · If you didn't request this, ignore this message.`,
      );
    } else {
      await sendSms(
        args.destination,
        `Luba: ይህን ስልክ ቁጥር ከመገለጫዎ ጋር ማጣመር ይፈልጋሉ? Link your phone? ${link} (15 min)`,
      );
    }
  },
});

/**
 * Confirm a link from a browser that only holds the capability token.
 * Rate limiting comes free: tokens are unguessable and single-use.
 */
export const confirmLink = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const link = await ctx.db
      .query("linkCodes")
      .withIndex("by_token", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (link === null || link.consumedAt !== undefined) {
      throw new Error("This link is invalid or was already used.");
    }
    if (link.expiresAt < Date.now()) {
      throw new Error("This link has expired. Start the linking process again.");
    }

    const user = await ctx.db.get(link.userId);
    if (user === null) throw new Error("Account no longer exists.");

    // Re-check conflicts at confirm time (state may have changed meanwhile).
    if (link.method === "telegram") {
      const clash = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("telegramChatId"), link.destination))
        .first();
      if (clash && clash._id !== link.userId) {
        throw new Error("That Telegram account is already linked to another user.");
      }
      await ctx.db.patch(link.userId, { telegramChatId: link.destination });
      try {
        await sendTelegramMessage(
          link.destination,
          `✅ ተጣምሯል! ይህ ቴሌግራም መለያ ከሉባ መገለጫዎ ጋር ተያይዟል (<b>${user.email ?? user._id}</b>)።\n\nLinked! Winner alerts will arrive here · የድሎች ማሳወቂያዎች እዚህ ይደርሳሉ።`,
        );
      } catch {
        // The link is already bound; delivery of the confirmation is best-effort.
      }
    } else {
      const clash = await ctx.db
        .query("users")
        .withIndex("phone", (q) => q.eq("phone", link.destination))
        .first();
      if (clash && clash._id !== link.userId) {
        throw new Error("That phone number is already linked to another user.");
      }
      await ctx.db.patch(link.userId, {
        phone: link.destination,
        phoneVerificationTime: Date.now(),
      });
    }

    await ctx.db.patch(link._id, { consumedAt: Date.now() });
    await insertAuditLog(ctx, {
      actor: link.userId,
      action: link.method === "telegram" ? "ACCOUNT_LINK_TELEGRAM" : "ACCOUNT_LINK_PHONE",
      resource: `users:${link.userId}`,
      details: link.destination,
      now: Date.now(),
    });
    return { ok: true as const, method: link.method };
  },
});

export const unlink = mutation({
  args: { method: v.union(v.literal("telegram"), v.literal("phone")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    const user = await ctx.db.get(userId);
    if (user === null) throw new Error("UNAUTHENTICATED");

    if (args.method === "telegram") {
      if (!user.telegramChatId) throw new Error("NOT_LINKED");
      await ctx.db.patch(userId, { telegramChatId: undefined });
    } else {
      if (user.phoneVerificationTime === undefined) throw new Error("NOT_LINKED");
      await ctx.db.patch(userId, { phone: undefined, phoneVerificationTime: undefined });
    }

    for (const pending of await ctx.db
      .query("linkCodes")
      .withIndex("by_user_method", (q) => q.eq("userId", userId).eq("method", args.method))
      .collect()) {
      await ctx.db.delete(pending._id);
    }

    await insertAuditLog(ctx, {
      actor: userId,
      action: args.method === "telegram" ? "ACCOUNT_UNLINK_TELEGRAM" : "ACCOUNT_UNLINK_PHONE",
      resource: `users:${userId}`,
      now: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Channel lookup for the outbox delivery worker. */
export const getUserChannelsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) return null;
    return {
      telegramChatId: user.telegramChatId ?? null,
      phone: user.phone ?? null,
      phoneVerificationTime: user.phoneVerificationTime ?? null,
    };
  },
});
