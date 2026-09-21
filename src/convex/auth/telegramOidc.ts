import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

/**
 * Telegram Login (OIDC) provider - Telegram's CURRENT hosted login flow
 * (https://core.telegram.org/bots/telegram-login): the "Log in to <site>"
 * page with phone-number and QR options, hosted on oauth.telegram.org or
 * rendered natively inside Telegram's own app browser.
 *
 * The browser library hands us an OIDC **id_token** (JWT). Verification here
 * mirrors the doc's "Validating ID Tokens" section:
 *   1. Signature: RS256 (or ES256) against Telegram's published JWKS.
 *   2. Claims: iss = https://oauth.telegram.org, aud = our bot ID (the same
 *      public numeric prefix of TELEGRAM_BOT_TOKEN), exp/iat freshness.
 *   3. Anti-replay: each token hash is accepted exactly once, and a nonce -
 *      when the client supplied one - is single-use too.
 *
 * No extra secrets beyond the bot token: the popup flow delivers the signed
 * token directly (response_type=post_message), so the OIDC client secret is
 * never needed. The payload's `sub` is the user's chat ID - the same key the
 * notification bridge and the classic widget provider resolve on, so all
 * Telegram entry points land on ONE account.
 */

const OIDC_ISSUER = "https://oauth.telegram.org";
const JWKS_URL = `${OIDC_ISSUER}/.well-known/jwks.json`;
const MAX_AGE_S = 600; // token must be at most 10 minutes old (iat-based)
const CLOCK_SKEW_S = 60;
const REPLAY_SCOPE = "telegram-oidc-login";
const NONCE_SCOPE = "telegram-oidc-nonce";
const JWKS_CACHE_MS = 10 * 60 * 1000;

interface Jwk {
  kty: string;
  alg?: string;
  kid?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
  [key: string]: unknown;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function fetchTelegramJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("Could not reach Telegram's signing keys.");
  const data = (await res.json()) as { keys?: Jwk[] };
  const keys = data.keys ?? [];
  if (keys.length === 0) throw new Error("Telegram's signing keys are empty.");
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

function base64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function importVerificationKey(
  jwk: Jwk,
): Promise<CryptoKey> {
  if (jwk.alg === "RS256" || jwk.kty === "RSA") {
    return crypto.subtle.importKey(
      "jwk",
      jwk as unknown as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  }
  if (jwk.alg === "ES256" || (jwk.kty === "EC" && jwk.crv === "P-256")) {
    return crypto.subtle.importKey(
      "jwk",
      jwk as unknown as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  }
  throw new Error(
    "This Telegram confirmation uses a signing algorithm we don't support. Please try again.",
  );
}

async function verifyJwtSignature(
  signingInput: string,
  signatureB64url: string,
  header: { alg?: string; kid?: string },
): Promise<void> {
  const keys = await fetchTelegramJwks();
  let candidates = keys.filter((k) => k.kid === header.kid);
  if (candidates.length === 0) {
    // Unknown kid: refresh once in case Telegram rotated keys.
    jwksCache = null;
    candidates = (await fetchTelegramJwks()).filter((k) => k.kid === header.kid);
  }
  if (candidates.length === 0) {
    throw new Error(
      "This Telegram confirmation could not be matched to a trusted key. Please try again.",
    );
  }
  const signature = base64urlToBytes(signatureB64url);
  const data = new TextEncoder().encode(signingInput);
  for (const jwk of candidates) {
    try {
      const key = await importVerificationKey(jwk);
      const algorithm: AlgorithmIdentifier | EcdsaParams =
        jwk.alg === "ES256" || (jwk.kty === "EC" && jwk.crv === "P-256")
          ? { name: "ECDSA", hash: "SHA-256" }
          : "RSASSA-PKCS1-v1_5";
      const ok = await crypto.subtle.verify(algorithm, key, signature, data);
      if (ok) return;
    } catch {
      // Try the next candidate key.
    }
  }
  throw new Error(
    "We could not verify this Telegram confirmation. Please try again.",
  );
}

export const telegramOidc = ConvexCredentials({
  id: "telegram-oidc",
  authorize: async (
    params,
    ctx,
  ): Promise<{ userId: Id<"users"> } | null> => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error("Telegram sign-in is not configured right now.");
    }
    const botId = Number.parseInt(botToken.split(":")[0] ?? "", 10);
    if (!Number.isFinite(botId) || botId <= 0) {
      throw new Error("Telegram sign-in is misconfigured (bot ID).");
    }

    const idToken =
      typeof params.id_token === "string" ? params.id_token : undefined;
    if (idToken === undefined) {
      throw new Error(
        "The Telegram confirmation was incomplete. Please try again.",
      );
    }

    const parts = idToken.split(".");
    if (parts.length !== 3) {
      throw new Error(
        "The Telegram confirmation arrived in an unreadable form. Please try again.",
      );
    }
    let header: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(new TextDecoder().decode(base64urlToBytes(parts[0])));
      claims = JSON.parse(new TextDecoder().decode(base64urlToBytes(parts[1])));
    } catch {
      throw new Error(
        "The Telegram confirmation arrived in an unreadable form. Please try again.",
      );
    }

    const sub = typeof claims.sub === "string" ? claims.sub : undefined;
    const issuer = typeof claims.iss === "string" ? claims.iss : undefined;
    const aud = claims.aud;
    const exp = typeof claims.exp === "number" ? claims.exp : undefined;
    const iat = typeof claims.iat === "number" ? claims.iat : undefined;
    if (
      sub === undefined ||
      issuer !== OIDC_ISSUER ||
      aud !== String(botId) ||
      exp === undefined ||
      iat === undefined
    ) {
      throw new Error(
        "This Telegram confirmation was not issued for this site. Please try again.",
      );
    }

    // Freshness: reject stale or future-dated tokens, and enforce a tight
    // max age regardless of Telegram's longer exp window (1h default).
    const nowS = Math.floor(Date.now() / 1000);
    if (exp + CLOCK_SKEW_S < nowS || iat - CLOCK_SKEW_S > nowS) {
      throw new Error(
        "This Telegram confirmation expired. Close the window and try again.",
      );
    }
    if (nowS - iat > MAX_AGE_S) {
      throw new Error(
        "This Telegram confirmation expired. Close the window and try again.",
      );
    }

    await verifyJwtSignature(`${parts[0]}.${parts[1]}`, parts[2], header);

    const userId = await ctx.runMutation(
      internal.auth.telegramOidc.resolveTelegramOidcUser,
      {
        replayKey: await sha256Hex(idToken),
        nonce: typeof claims.nonce === "string" ? claims.nonce : undefined,
        telegramId: sub,
        name:
          typeof claims.name === "string" && claims.name.trim()
            ? claims.name.trim()
            : undefined,
        username:
          typeof claims.preferred_username === "string"
            ? claims.preferred_username
            : undefined,
        photoUrl:
          typeof claims.picture === "string" ? claims.picture : undefined,
        phoneNumber:
          typeof claims.phone_number === "string"
            ? claims.phone_number
            : undefined,
        verifiedAtS: iat,
      },
    );
    return { userId };
  },
});

/**
 * Resolve a verified OIDC identity to a user account.
 *
 * Resolution order (mirrors auth/telegramWidget.ts so every Telegram entry
 * point - widget, bot OTP, OIDC - lands on ONE account):
 *  1. users.telegramChatId,
 *  2. the legacy telegram-otp convention (chat ID stored in `email`),
 *     normalized to telegramChatId on first sign-in,
 *  3. otherwise a new account; `email` stays UNSET (it is the email sign-in
 *     identity and must never collide with a chat ID).
 *
 * The Telegram-verified phone number is stored on the account when the user
 * has none (explicit consent given in the Telegram UI); existing values are
 * never overwritten. Soft-deleted accounts are never revived.
 */
export const resolveTelegramOidcUser = internalMutation({
  args: {
    replayKey: v.string(),
    nonce: v.optional(v.string()),
    telegramId: v.string(),
    name: v.optional(v.string()),
    username: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    verifiedAtS: v.number(),
  },
  handler: async (ctx, args) => {
    // Single-use token: a captured JWT must never mint a second session.
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

    // Single-use nonce (when the client requested one at popup time).
    const nonce = args.nonce;
    if (nonce !== undefined) {
      const seenNonce = await ctx.db
        .query("idempotencyKeys")
        .withIndex("by_scope_key", (q) =>
          q.eq("scope", NONCE_SCOPE).eq("key", nonce),
        )
        .unique();
      if (seenNonce !== null) {
        throw new Error(
          "This Telegram confirmation was already used. Please sign in again.",
        );
      }
      await ctx.db.insert("idempotencyKeys", {
        scope: NONCE_SCOPE,
        key: nonce,
        createdAt: Date.now(),
      });
    }

    const verifiedPhoneMs = args.verifiedAtS * 1000;

    const refreshDisplayInfo = (existing: {
      name?: string;
      image?: string;
      phone?: string;
    }): { name?: string; image?: string; phone?: string; phoneVerificationTime?: number } | null => {
      const patch: Record<string, string | number> = {};
      if (!existing.name && args.name) patch.name = args.name;
      if (!existing.image && args.photoUrl) patch.image = args.photoUrl;
      if (!existing.phone && args.phoneNumber) {
        patch.phone = args.phoneNumber;
        patch.phoneVerificationTime = verifiedPhoneMs;
      }
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
      await ctx.db.patch(byLegacyEmail._id, {
        telegramChatId: args.telegramId,
      });
      return byLegacyEmail._id;
    }

    // 3. New account.
    return await ctx.db.insert("users", {
      ...(args.name ? { name: args.name } : {}),
      ...(args.photoUrl ? { image: args.photoUrl } : {}),
      telegramChatId: args.telegramId,
      ...(args.phoneNumber
        ? {
            phone: args.phoneNumber,
            phoneVerificationTime: verifiedPhoneMs,
          }
        : {}),
      isActive: true,
    });
  },
});
