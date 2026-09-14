import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

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
    const apiKey = process.env.AFROMESSAGE_API_KEY;
    const senderId = process.env.AFROMESSAGE_SENDER_ID;

    if (process.env.ENABLE_SMS_GATEWAY !== "true") {
      throw new Error(
        "SMS sign-in is currently disabled. Please use email or Telegram instead.",
      );
    }
    if (!apiKey || !senderId) {
      throw new Error(
        "AFROMESSAGE_API_KEY / AFROMESSAGE_SENDER_ID are not configured; SMS sign-in is unavailable.",
      );
    }

    // Normalize: strip spaces/dashes and any leading +, then coerce local
    // Ethiopian formats (09xx…, 9xx…) to 2519xx…
    let phone = rawPhone.replace(/[\s-]/g, "").replace(/^\+/, "");
    if (/^0\d{9}$/.test(phone)) phone = `251${phone.slice(1)}`;
    else if (/^9\d{8}$/.test(phone)) phone = `251${phone}`;
    if (!/^\d{12}$/.test(phone)) {
      throw new Error(
        "Enter a valid phone number, e.g. 0911223344 or 251911223344.",
      );
    }

    try {
      const res = await axios.post(
        "https://api.afromessage.com/api/send",
        {
          to: phone,
          from: senderId,
          message: `Your Luba verification code is ${token}. It expires in 15 minutes.`,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10_000,
        },
      );
      if (res.data?.acknowledge !== "success") {
        throw new Error(
          res.data?.response_message ?? "AfroMessage rejected the message",
        );
      }
    } catch (error) {
      throw new Error(JSON.stringify(error));
    }
  },
});
