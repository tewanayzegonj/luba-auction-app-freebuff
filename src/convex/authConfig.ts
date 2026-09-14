import { query } from "./_generated/server";

/**
 * Public, non-sensitive report of which sign-in methods are usable.
 * The auth screen uses this to hide buttons for unconfigured providers
 * instead of letting users hit runtime errors.
 */
export const getAuthMethods = query({
  args: {},
  handler: () => {
    return {
      emailOtp: true, // always available (Freebuff-managed sender)
      telegramOtp: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      smsOtp:
        process.env.ENABLE_SMS_GATEWAY === "true" &&
        Boolean(process.env.AFROMESSAGE_API_KEY) &&
        Boolean(process.env.AFROMESSAGE_SENDER_ID),
    };
  },
});
