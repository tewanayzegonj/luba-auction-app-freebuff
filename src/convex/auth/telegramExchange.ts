"use node";

import axios from "axios";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Exchange a Telegram OIDC authorization code for the signed id_token.
 *
 * Telegram's NEW login system (after "switch to OpenID Connect") ends the
 * browser flow by redirecting back to us with ?code=... Per the OIDC spec
 * (https://core.telegram.org/bots/telegram-login → "Exchange Code for
 * Tokens") that code must be exchanged server-side at POST /token with
 * Basic auth (client_id:client_secret) and the PKCE verifier from the
 * original request. This runs as a Convex action so the client secret never
 * reaches the browser.
 *
 * Keys (Keys/API keys tab):
 *  - TELEGRAM_BOT_TOKEN (already configured; supplies the default client_id)
 *  - TELEGRAM_OIDC_CLIENT_SECRET — REQUIRED: the Client Secret shown by
 *    BotFather's Login Widget screen next to the Client ID.
 *  - TELEGRAM_OIDC_CLIENT_ID — only needed if it differs from the bot
 *    token's numeric prefix.
 */
export const exchangeTelegramCode = action({
  args: {
    code: v.string(),
    state: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    // CSRF + verifier lookup: consume the server-stored flow state keyed by
    // this exact state value. Unknown/expired/already-used states are
    // rejected before any network call.
    const codeVerifier = await ctx.runMutation(
      internal.auth.telegramFlow.consumeTelegramFlowState,
      { state: args.state },
    );
    if (!codeVerifier) {
      throw new Error(
        "This Telegram confirmation link is invalid or has expired. Please tap Continue with Telegram again.",
      );
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
    const tokenPrefix = botToken.split(":")[0] ?? "";
    const clientId =
      (process.env.TELEGRAM_OIDC_CLIENT_ID ?? "").trim() || tokenPrefix;
    if (!/^\d+$/.test(clientId)) {
      throw new Error("Telegram sign-in is not configured right now.");
    }
    const clientSecret = (
      process.env.TELEGRAM_OIDC_CLIENT_SECRET ?? ""
    ).trim();
    if (!clientSecret) {
      throw new Error(
        "The Telegram Client Secret is missing. Add TELEGRAM_OIDC_CLIENT_SECRET in the Keys/API keys tab (copy it from @BotFather → your bot → Login Widget) and try again.",
      );
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    let idToken: unknown;
    try {
      const res = await axios.post(
        "https://oauth.telegram.org/token",
        body.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basic}`,
          },
          timeout: 10_000,
        },
      );
      idToken = (res.data as { id_token?: unknown } | undefined)?.id_token;
    } catch (err) {
      const data = (
        err as {
          response?: { data?: { error_description?: string; error?: string } };
        }
      ).response?.data;
      const detail = data?.error_description ?? data?.error;
      throw new Error(
        detail
          ? `Telegram could not complete the sign-in: ${detail}`
          : "Could not reach Telegram to complete the sign-in. Check your connection and try again.",
      );
    }

    if (typeof idToken !== "string" || idToken.split(".").length !== 3) {
      throw new Error(
        "Telegram's reply was missing the signed confirmation. Please try again.",
      );
    }
    return { idToken };
  },
});
