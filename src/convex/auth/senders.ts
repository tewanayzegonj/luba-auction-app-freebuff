/**
 * Shared OTP message senders for auth + account-linking flows.
 * Kept in one place so the Telegram and AfroMessage integrations have
 * a single home (auth providers and link flows call these).
 */
import axios from "axios";

export function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }
  return token;
}

export function isSmsEnabled(): boolean {
  return (
    process.env.ENABLE_SMS_GATEWAY === "true" &&
    Boolean(process.env.AFROMESSAGE_API_KEY) &&
    Boolean(process.env.AFROMESSAGE_SENDER_ID)
  );
}

/** Normalize an Ethiopian phone to international form (2519xxxxxxxx). */
export function normalizePhone(raw: string): string {
  let phone = raw.replace(/[\s-]/g, "").replace(/^\+/, "");
  if (/^0\d{9}$/.test(phone)) phone = `251${phone.slice(1)}`;
  else if (/^9\d{8}$/.test(phone)) phone = `251${phone}`;
  return phone;
}

export function isValidEthiopianPhone(phone: string): boolean {
  return /^2519\d{8}$/.test(phone) || /^2517\d{8}$/.test(phone);
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: unknown,
): Promise<void> {
  const res = await axios.post(
    `https://api.telegram.org/bot${getBotToken()}/sendMessage`,
    {
      chat_id: chatId,
      parse_mode: "HTML",
      text,
      ...(replyMarkup !== undefined ? { reply_markup: replyMarkup } : {}),
    },
    { timeout: 10_000 },
  );
  if (!res.data?.ok) {
    throw new Error(res.data?.description ?? "Telegram rejected the message");
  }
}

export async function sendSms(phone: string, text: string): Promise<void> {
  const apiKey = process.env.AFROMESSAGE_API_KEY;
  const senderId = process.env.AFROMESSAGE_SENDER_ID;
  if (!apiKey || !senderId) {
    throw new Error(
      "AFROMESSAGE_API_KEY / AFROMESSAGE_SENDER_ID are not configured.",
    );
  }
  const res = await axios.post(
    "https://api.afromessage.com/api/send",
    { to: phone, from: senderId, message: text },
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
}
