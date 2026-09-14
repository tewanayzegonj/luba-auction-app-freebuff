import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { sendTelegramMessage } from "./senders";

/**
 * Telegram OTP provider.
 *
 * The `identifier` for this provider is the user's numeric Telegram chat ID
 * (e.g. "123456789"). Telegram's Bot API has no way to resolve a username or
 * phone number to a chat ID, so the user obtains their ID from the bot's
 * /start message (or any ID bot) and enters it on the sign-in screen.
 */
export const telegramOtp = Email({
  id: "telegram-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: chatId, token }) {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error(
        "TELEGRAM_BOT_TOKEN is not configured; Telegram sign-in is unavailable.",
      );
    }
    if (!/^\d{5,}$/.test(chatId)) {
      throw new Error(
        "Telegram sign-in requires your numeric Telegram ID (digits only). Open our bot and press Start to receive it.",
      );
    }
    try {
      await sendTelegramMessage(
        chatId,
        `Your Luba verification code is <code>${token}</code>\n\nIt expires in 15 minutes. If you didn't request it, you can ignore this message.`,
      );
    } catch (error) {
      throw new Error(JSON.stringify(error));
    }
  },
});
