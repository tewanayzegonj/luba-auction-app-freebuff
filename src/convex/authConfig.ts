import { query } from "./_generated/server";

/**
 * Public, non-sensitive report of which sign-in methods are usable.
 * The auth screen uses this to hide buttons for unconfigured providers
 * instead of letting users hit runtime errors.
 */
export const getAuthMethods = query({
  args: {},
  handler: () => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    // The numeric part before the colon in the bot token is the bot's ID -
    // it appears in every oauth.telegram.org URL and is how users identify
    // bots in Telegram's UI, so it is public, not a secret. The client-side
    // Login widget REQUIRES this numeric id ("Bot id required" otherwise).
    const telegramBotId = Number.parseInt(botToken?.split(":")[0] ?? "", 10);
    return {
      emailOtp: true, // always available (Freebuff-managed sender)
      telegramWidget: Boolean(botToken),
      telegramOtp: Boolean(botToken),
      telegramBotId:
        Number.isFinite(telegramBotId) && telegramBotId > 0 ? telegramBotId : null,
      smsOtp:
        process.env.ENABLE_SMS_GATEWAY === "true" &&
        Boolean(process.env.AFROMESSAGE_API_KEY) &&
        Boolean(process.env.AFROMESSAGE_SENDER_ID),
    };
  },
});
