import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

/**
 * Telegram Login Widget provider - the one-tap popup sign-in.
 *
 * The official Telegram widget collects the user's confirmation in a popup
 * (or a native sheet on mobile) and hands the page a payload of the form
 * {id, first_name, ..., auth_date, hash}. `hash` is an HMAC-SHA256 over the
 * alphabetically sorted payload fields, keyed with SHA256(bot_token), so
 * verifying it server-side proves Telegram issued this payload for THIS bot.
 * The payload's numeric `id` is the user's chat ID - the exact same key the
 * notification bridge (outbox → sendTelegramMessage) already uses, so a
 * widget sign-in automatically enables outbid/winner Telegram alerts.
 *
 * Replay hardening: the hash is bearer-capable until auth_date goes stale,
 * so we enforce BOTH:
 *  - auth_date within MAX_AGE_S of server time, and
 *  - each payload hash is recorded and accepted exactly once
 *    (idempotencyKeys, scope telegram-widget-login).
 */

const MAX_AGE_S = 600; // 10 minutes from Telegram confirmation to completed sign-in
const REPLAY_SCOPE = "telegram-widget-login";

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Constant-time comparison - never leak how much of the hash matched. */
function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const telegramWidget = ConvexCredentials({
  id: "telegram-widget",
  authorize: async (
    params,
    ctx,
  ): Promise<{ userId: Id<"users">; sessionId?: Id<"authSessions"> } | null> => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error("Telegram sign-in is not configured right now.");
    }

    const id = typeof params.id === "string" ? params.id : undefined;
    const firstName =
      typeof params.first_name === "string" ? params.first_name : undefined;
    const authDate =
      typeof params.auth_date === "string" ? params.auth_date : undefined;
    const hash = typeof params.hash === "string" ? params.hash : undefined;
    if (
      id === undefined ||
      firstName === undefined ||
      authDate === undefined ||
      hash === undefined
    ) {
      throw new Error(
        "The Telegram confirmation was incomplete. Please try again.",
      );
    }

    // Freshness: auth_date is stamped when the user confirms in Telegram.
    const ageS = Math.floor(Date.now() / 1000) - Number(authDate);
    if (!Number.isFinite(ageS) || Math.abs(ageS) > MAX_AGE_S) {
      throw new Error(
        "This Telegram confirmation expired. Close the window and try again.",
      );
    }

    // Telegram spec: data_check_string = every received field except `hash`,
    // sorted by key, joined as `key=value` lines. We sign exactly the fields
    // present (unknown-but-signed fields are part of the payload per spec),
    // so any client tampering breaks the HMAC - which is the whole check.
    const entries: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(params)) {
      if (key === "hash") continue;
      if (typeof value !== "string") continue;
      entries.push([key, value]);
    }
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    const secretKey = await crypto.subtle.importKey(
      "raw",
      hexToBytes(await sha256Hex(new TextEncoder().encode(botToken))),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      secretKey,
      new TextEncoder().encode(dataCheckString),
    );
    const expected = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (!timingSafeHexEqual(expected, hash)) {
      throw new Error(
        "We could not verify this Telegram confirmation. Please try again.",
      );
    }

    const userId = await ctx.runMutation(
      internal.auth.telegramWidget.resolveTelegramWidgetUser,
      {
        replayKey: hash,
        telegramId: id,
        firstName,
        lastName: typeof params.last_name === "string" ? params.last_name : undefined,
        username: typeof params.username === "string" ? params.username : undefined,
        photoUrl: typeof params.photo_url === "string" ? params.photo_url : undefined,
      },
    );
    return { userId };
  },
});

/**
 * Resolve a verified Telegram identity to a user account.
 *
 * Resolution order (mirrors auth/userResolution.ts so both Telegram entry
 * points land on ONE account):
 *  1. users.telegramChatId (widget-native accounts, and accounts the widget
 *     has already normalized),
 *  2. the legacy telegram-otp convention, where the chat ID lives in
 *     `email` - adopted and normalized to telegramChatId on first widget
 *     sign-in,
 *  3. otherwise a new account. `email` stays UNSET on purpose: that field is
 *     the email sign-in identity and must never collide with a chat ID.
 *
 * Soft-deleted accounts (deletedAt set) are never revived - the schema
 * promises re-registration is possible, so a fresh account is created.
 */
export const resolveTelegramWidgetUser = internalMutation({
  args: {
    replayKey: v.string(),
    telegramId: v.string(),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    username: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Single-use payload: a captured hash must never mint a second session.
    const seen = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", REPLAY_SCOPE).eq("key", args.replayKey),
      )
      .unique();
    if (seen !== null) {
      throw new Error(
        "This Telegram confirmation was already used. Please sign in again.",
      );
    }
    await ctx.db.insert("idempotencyKeys", {
      scope: REPLAY_SCOPE,
      key: args.replayKey,
      createdAt: Date.now(),
    });

    const displayName = [args.firstName, args.lastName]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join(" ")
      .trim();

    const refreshDisplayInfo = (existing: {
      name?: string;
      image?: string;
    }): { name?: string; image?: string } | null => {
      const patch: { name?: string; image?: string } = {};
      if (!existing.name && displayName) patch.name = displayName;
      if (!existing.image && args.photoUrl) patch.image = args.photoUrl;
      return Object.keys(patch).length > 0 ? patch : null;
    };

    // 1. Widget-native account (or a previously normalized legacy account).
    const byChatId = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("telegramChatId"), args.telegramId))
      .first();
    if (byChatId !== null && byChatId.deletedAt === undefined) {
      const patch = refreshDisplayInfo(byChatId);
      if (patch !== null) await ctx.db.patch(byChatId._id, patch);
      return byChatId._id;
    }

    // 2. Legacy telegram-otp account (chat ID stored as `email`).
    const byLegacyEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.telegramId))
      .first();
    if (byLegacyEmail !== null && byLegacyEmail.deletedAt === undefined) {
      const patch = refreshDisplayInfo(byLegacyEmail);
      if (patch !== null) await ctx.db.patch(byLegacyEmail._id, patch);
      // Normalize: from now on the chat ID lives in its proper field, so the
      // notification bridge and future widget sign-ins find it directly.
      await ctx.db.patch(byLegacyEmail._id, { telegramChatId: args.telegramId });
      return byLegacyEmail._id;
    }

    // 3. New account.
    return await ctx.db.insert("users", {
      ...(displayName ? { name: displayName } : {}),
      ...(args.photoUrl ? { image: args.photoUrl } : {}),
      telegramChatId: args.telegramId,
      isActive: true,
    });
  },
});
