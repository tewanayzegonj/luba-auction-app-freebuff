import { api, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  chapaAmountToSantims,
  getChapaSecretKey,
  hmacSha256Hex,
  timingSafeEqualHex,
} from "./chapa";
import { PROVIDER_CHAPA } from "./payments";

/**
 * Chapa webhook receiver (spec §22–24).
 *
 * Security model:
 *  1. HMAC-SHA256 of the RAW request body is computed with
 *     CHAPA_WEBHOOK_SECRET and compared (timing-safe) against the
 *     x-chapa-signature / chapa-signature header — per Chapa's docs.
 *  2. Amount from the webhook is passed as expectedAmountSantims so a
 *     mismatch against the initiated payment is rejected before crediting.
 *  3. Idempotency: providerEventId dedupes replays; the payment state guard
 *     prevents double-crediting (Invariant 5).
 *
 * Configure in the Chapa dashboard (Profile → Webhooks):
 *   URL:    https://<deployment>.convex.site/webhooks/chapa
 *   Secret: the value stored as CHAPA_WEBHOOK_SECRET
 */

type ChapaEvent = {
  event?: string;
  status?: string;
  amount?: string;
  currency?: string;
  tx_ref?: string;
  reference?: string;
  failure_reason?: string;
  created_at?: string;
  updated_at?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const chapaWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.CHAPA_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Webhook not configured", { status: 500 });
  }

  const rawBody = await request.text();
  const provided =
    request.headers.get("x-chapa-signature") ??
    request.headers.get("chapa-signature");
  if (!provided) {
    return new Response("Missing signature", { status: 401 });
  }

  const expected = await hmacSha256Hex(secret, rawBody);
  if (!timingSafeEqualHex(expected, provided.trim().toLowerCase())) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event: ChapaEvent;
  try {
    event = JSON.parse(rawBody) as ChapaEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Payout/refund events and anything without a tx_ref is acknowledged
  // without processing (only wallet top-up charges matter here).
  const txRef = event.tx_ref;
  if (!txRef) return jsonResponse({ received: true });

  const succeeded =
    event.event === "charge.success" || event.status === "success";
  const failed =
    (event.event?.startsWith("charge.failed") ?? false) ||
    event.event === "charge.cancelled";
  if (!succeeded && !failed) return jsonResponse({ received: true });

  const providerEventId = `chapa:${event.event ?? "charge"}:${txRef}:${
    event.updated_at ?? event.created_at ?? ""
  }`;

  try {
    await ctx.runMutation(internal.payments.confirmProviderPaymentInternal, {
      providerEventId,
      merchantReference: txRef,
      providerReference: event.reference ?? undefined,
      succeeded,
      failureReason: event.failure_reason,
      expectedAmountSantims: event.amount
        ? (chapaAmountToSantims(event.amount) ?? undefined)
        : undefined,
    });
  } catch (err) {
    // PAYMENT_NOT_FOUND / AMOUNT_MISMATCH: acknowledge but do not retry —
    // a webhook that keeps failing would hammer the same condition.
    console.warn("[chapa-webhook] rejected event", txRef, err);
    return jsonResponse({ received: true, processed: false });
  }

  return jsonResponse({ received: true, processed: true });
});

/**
 * Client-return flow: the browser calls this right after coming back from the
 * Chapa checkout (return_url). Webhooks can be delayed or missed entirely, so
 * Chapa's own guidance is to re-verify the transaction server-side on return.
 *
 * Runs as a public httpAction (browser has no Convex auth header on plain
 * fetch calls) and authenticates via a per-payment capability token created
 * at initiation — only the initiator of a payment can verify it.
 */
export const verifyChapaReturn = httpAction(async (ctx, request) => {
  let body: { merchantReference?: string; token?: string };
  try {
    body = (await request.json()) as {
      merchantReference?: string;
      token?: string;
    };
  } catch {
    return jsonResponse({ ok: false, error: "INVALID_REQUEST" }, 400);
  }
  const { merchantReference, token } = body;
  if (!merchantReference || !token) {
    return jsonResponse({ ok: false, error: "INVALID_REQUEST" }, 400);
  }

  const secret = getChapaSecretKey();
  if (!secret) return jsonResponse({ ok: false, error: "CHAPA_NOT_CONFIGURED" }, 500);

  // Capability check: the token is an HMAC of the reference with the Chapa
  // secret — only someone who saw it at initiation (the initiating browser)
  // can produce it.
  const expectedToken = await hmacSha256Hex(secret, merchantReference);
  if (!timingSafeEqualHex(expectedToken, token.trim().toLowerCase())) {
    return jsonResponse({ ok: false, error: "INVALID_TOKEN" }, 401);
  }

  // Check state first to avoid re-running the network verification
  // unnecessarily (the webhook may have already completed it).
  const payment = await ctx.runQuery(
    internal.payments.getPaymentByReferenceInternal,
    { merchantReference },
  );
  if (!payment) {
    return jsonResponse({ ok: false, error: "PAYMENT_NOT_FOUND" }, 404);
  }
  if (payment.status === "COMPLETED") {
    return jsonResponse({ ok: true, status: "COMPLETED" });
  }
  if (payment.provider !== PROVIDER_CHAPA) {
    return jsonResponse({ ok: false, error: "NOT_A_CHAPA_PAYMENT" }, 400);
  }

  const verified = await ctx.runAction(api.chapa.verifyTransaction, {
    merchantReference,
  });
  if (!verified.ok) {
    return jsonResponse({ ok: false, error: verified.error }, 502);
  }

  if (verified.succeeded) {
    await ctx.runMutation(internal.payments.confirmProviderPaymentInternal, {
      providerEventId: `chapa:return:${merchantReference}`,
      merchantReference,
      providerReference: verified.providerReference ?? undefined,
      succeeded: true,
      expectedAmountSantims: verified.amountSantims ?? undefined,
    });
    return jsonResponse({ ok: true, status: "COMPLETED" });
  }

  return jsonResponse({ ok: true, status: "PENDING" });
});
