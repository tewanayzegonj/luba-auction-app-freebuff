import { v } from "convex/values";
import { action, query } from "./_generated/server";

/**
 * Chapa payment adapter (spec §22 provider seam).
 *
 * Chapa aggregates the Ethiopian PSPs — telebirr, CBE Birr, M-Pesa, Amole,
 * cards — so one integration covers every requested method.
 *
 * API surface used (https://developer.chapa.co):
 *  - POST https://api.chapa.co/v1/transaction/initialize
 *      headers: Authorization: Bearer <CHAPA_SECRET_KEY>
 *      body:    amount, currency, tx_ref (= our merchant reference),
 *               return_url, customer fields, customization
 *      → data.checkout_url (hosted checkout page)
 *  - GET https://api.chapa.co/v1/transaction/verify/{tx_ref}
 *      → data.status === "success" (webhook best practice: re-verify
 *        server-side before granting value)
 *
 * Webhook verification happens in the HTTP route (chapaWebhook.ts) via
 * HMAC-SHA256 of the raw body against CHAPA_WEBHOOK_SECRET; this module
 * handles the outbound calls.
 *
 * Credentials are read from the environment at call time — never committed.
 * Missing keys throw CHAPA_NOT_CONFIGURED so the UI can fall back to the
 * sandbox adapter.
 */

const CHAPA_INITIALIZE_URL = "https://api.chapa.co/v1/transaction/initialize";
const CHAPA_VERIFY_URL = "https://api.chapa.co/v1/transaction/verify";

/** HMAC-SHA256 hex of a message with a secret (webhook + token signing). */
export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time hex string comparison. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function getChapaSecretKey(): string | undefined {
  return (
    process.env.CHAPA_SECRET_KEY ?? process.env.CHAPA_SECRET ?? undefined
  );
}

export function isChapaConfigured(): boolean {
  return Boolean(getChapaSecretKey());
}

/**
 * Setup status for the wallet UI. Reports only whether credentials exist —
 * never the values themselves.
 */
export const getChapaStatus = query({
  args: {},
  handler: async () => {
    const secretKey = getChapaSecretKey();
    const webhookSecret = Boolean(process.env.CHAPA_WEBHOOK_SECRET);
    return {
      configured: Boolean(secretKey),
      webhookSecretSet: webhookSecret,
    };
  },
});

/** Extract ETB santims from a Chapa decimal amount string like "400.00". */
export function chapaAmountToSantims(amount: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  const santims = whole * 100 + frac;
  return Number.isInteger(santims) ? santims : null;
}

type InitializeResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Initialize a Chapa transaction and return the hosted checkout URL.
 * Runs as an action because it performs a network call. The PENDING payment
 * row already exists (created by payments:initiateTopUp with the same
 * merchantReference, which is sent as tx_ref).
 */
export const initializeCheckout = action({
  args: {
    merchantReference: v.string(),
    amountSantims: v.number(),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phone: v.optional(v.string()),
    returnUrl: v.string(),
  },
  handler: async (ctx, args): Promise<InitializeResult> => {
    const secretKey = getChapaSecretKey();
    if (!secretKey) {
      return { ok: false, error: "CHAPA_NOT_CONFIGURED" };
    }
    if (!Number.isInteger(args.amountSantims) || args.amountSantims <= 0) {
      return { ok: false, error: "INVALID_AMOUNT" };
    }

    const etb = (args.amountSantims / 100).toFixed(2);

    const body: Record<string, unknown> = {
      amount: etb,
      currency: "ETB",
      tx_ref: args.merchantReference,
      return_url: args.returnUrl,
      customization: {
        title: "Luba wallet top-up",
        description: `Wallet deposit ${args.merchantReference}`,
      },
    };
    if (args.email) body.email = args.email;
    if (args.firstName) body.first_name = args.firstName;
    if (args.lastName) body.last_name = args.lastName;
    // Chapa requires 09xxxxxxxx / 07xxxxxxxx format for phone_number.
    if (args.phone && /^0[97]\d{8}$/.test(args.phone)) {
      body.phone_number = args.phone;
    }

    let response: Response;
    try {
      response = await fetch(CHAPA_INITIALIZE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, error: "CHAPA_NETWORK_ERROR" };
    }

    if (!response.ok) {
      return { ok: false, error: `CHAPA_HTTP_${response.status}` };
    }

    const payload = (await response.json()) as {
      status?: string;
      data?: { checkout_url?: string };
    };
    const checkoutUrl = payload.data?.checkout_url;
    if (payload.status !== "success" || !checkoutUrl) {
      return { ok: false, error: "CHAPA_INIT_FAILED" };
    }

    return { ok: true, checkoutUrl };
  },
});

type VerifyResult =
  | {
      ok: true;
      succeeded: boolean;
      amountSantims: number | null;
      providerReference: string | null;
      currency: string | null;
      failureReason: string | null;
    }
  | { ok: false; error: string };

/**
 * Verify a transaction server-side (Chapa's own recommended practice before
 * granting value). Returns the verified amount so the webhook/return flow can
 * cross-check it against the payment row before crediting.
 */
export const verifyTransaction = action({
  args: { merchantReference: v.string() },
  handler: async (ctx, args): Promise<VerifyResult> => {
    const secretKey = getChapaSecretKey();
    if (!secretKey) return { ok: false, error: "CHAPA_NOT_CONFIGURED" };

    let response: Response;
    try {
      response = await fetch(
        `${CHAPA_VERIFY_URL}/${encodeURIComponent(args.merchantReference)}`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      );
    } catch {
      return { ok: false, error: "CHAPA_NETWORK_ERROR" };
    }

    if (response.status === 404) {
      return {
        ok: true,
        succeeded: false,
        amountSantims: null,
        providerReference: null,
        currency: null,
        failureReason: "Transaction not found at provider",
      };
    }
    if (!response.ok) {
      return { ok: false, error: `CHAPA_HTTP_${response.status}` };
    }

    const payload = (await response.json()) as {
      status?: string;
      data?: {
        status?: string;
        amount?: string;
        currency?: string;
        reference?: string;
        failure_reason?: string;
      };
    };
    const data = payload.data;
    if (!data) return { ok: false, error: "CHAPA_VERIFY_MALFORMED" };

    const succeeded =
      payload.status === "success" && data.status === "success";

    return {
      ok: true,
      succeeded,
      amountSantims: data.amount ? chapaAmountToSantims(data.amount) : null,
      providerReference: data.reference ?? null,
      currency: data.currency ?? null,
      failureReason: data.failure_reason ?? null,
    };
  },
});
