import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import {
  isSmsEnabled,
  isValidEthiopianPhone,
  normalizePhone,
  sendSms,
} from "./senders";

/**
 * SMS OTP provider via AfroMessage (Ethiopian SMS gateway).
 *
 * The `identifier` is the recipient phone number in international format
 * without the leading "+" (e.g. "251911223344"). We normalize common local
 * formats (09xxxxxxxx / 9xxxxxxxx) to that shape before sending.
 */
export const afroMessageSms = Email({
  id: "sms-otp",
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
  async sendVerificationRequest({ identifier: rawPhone, token }) {
    if (!isSmsEnabled()) {
      throw new Error(
        "SMS sign-in is currently disabled. Please use email or Telegram instead.",
      );
    }

    const phone = normalizePhone(rawPhone);
    if (!isValidEthiopianPhone(phone)) {
      throw new Error(
        "Enter a valid phone number, e.g. 0911223344 or 251911223344.",
      );
    }

    try {
      await sendSms(
        phone,
        `Your Luba verification code is ${token}. It expires in 15 minutes.`,
      );
    } catch (error) {
      throw new Error(JSON.stringify(error));
    }
  },
});
