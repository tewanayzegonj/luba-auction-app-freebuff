import { v } from "convex/values";
import { action } from "./_generated/server";
import { httpAction } from "./_generated/server";
import { hmacSha256Hex, timingSafeEqualHex } from "./chapa";

/**
 * Telegram bot webhook (spec §54 security, §38 notifications groundwork).
 *
 * Responsibilities (deliberately minimal for V1):
 *  - /start (and any private message) → reply with the sender's numeric chat
 *    ID, which is the identifier users need for Telegram OTP sign-in.
 *
 * Security: Telegram echoes the `secret_token` we registered with setWebhook
 * back in the `X-Telegram-Bot-Api-Secret-Token` header. Rather than asking
 * for a second env var, we derive the secret from the bot token itself
 * (HMAC-SHA256) - unguessable to outsiders, shared implicitly between the
 * registrar and the webhook since both read the same token. Requests without
 * a valid header are rejected 401 (fail closed).
 */

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }
  return token;
}

/** Secret derived from the bot token - see module doc. */
function webhookSecret(botToken: string): Promise<string> {
  return hmacSha256Hex(botToken, "luba-telegram-webhook-v1");
}

function siteUrl(): string {
  const site = process.env.CONVEX_SITE_URL;
  if (site) return site.replace(/\/$/, "");
  const cloud = process.env.CONVEX_CLOUD_URL ?? "";
  if (cloud.includes(".convex.cloud")) {
    return cloud.replace(".convex.cloud", ".convex.site");
  }
  throw new Error(
    "Cannot determine the deployment's public URL (CONVEX_SITE_URL missing).",
  );
}

/**
 * One-shot (idempotent) registrar: points the bot at this deployment's
 * webhook. Safe to call publicly - the only effect is re-registering our own
 * URL using our own token.
 */
export const registerWebhook = action({
  args: {},
  handler: async () => {
    const botToken = getBotToken();
    const url = `${siteUrl()}/webhooks/telegram`;
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          secret_token: await webhookSecret(botToken),
          allowed_updates: ["message"],
          drop_pending_updates: true,
        }),
      },
    );
    const data = (await res.json()) as {
      ok: boolean;
      description?: string;
    };
    if (!data.ok) {
      throw new Error(`Telegram setWebhook failed: ${data.description}`);
    }
    return { ok: true, webhookUrl: url };
  },
});

type TelegramUpdate = {
  message?: {
    chat?: { id?: number; type?: string };
    text?: string;
  };
};

export const handleTelegramUpdate = httpAction(async (ctx, request) => {
  let botToken: string;
  try {
    botToken = getBotToken();
  } catch {
    return new Response("Bot not configured", { status: 500 });
  }

  const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!provided) {
    return new Response("Missing secret", { status: 401 });
  }
  const expected = await webhookSecret(botToken);
  if (!timingSafeEqualHex(expected, provided.trim())) {
    return new Response("Invalid secret", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Only respond in private chats - never spam group conversations.
  const chatId = update.message?.chat?.id;
  const chatType = update.message?.chat?.type;
  if (typeof chatId === "number" && chatType === "private") {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          parse_mode: "HTML",
          text:
            `👋 እንኳን ወደ ሉባ (LUBA) በደህና መጡ!\n` +
            `Welcome to LUBA!\n\n` +
            `ዝቅተኛ እና ልዩ ዋጋ የሚያሸንፉበት የጨረታ መድረክ ነው።\n` +
            `The auction platform where the lowest unique price wins.\n\n` +
            `🆔 የእርስዎ ቴሌግራም መለያ (Telegram ID): <code>${chatId}</code>\n` +
            `ይህንን መለያ ድረ-ገጻችን ላይ በ«በቴሌግራም ይቀጥሉ» ማረጋገጫ ላይ በመጠቀም በቀላሉ ይግቡ።\n` +
            `Tap the button to copy your ID, then enter it on the Luba sign-in screen under “Continue with Telegram”.`,
          reply_markup: {
            inline_keyboard: [
              [{ text: "📋 Copy my ID · መለያዎን ይቅዱ", copy_text: { text: String(chatId) } }],
            ],
          },
        }),
      });
    } catch (err) {
      // Never return non-2xx: Telegram would retry and hammer us.
      console.warn("[telegram-webhook] reply failed", err);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
