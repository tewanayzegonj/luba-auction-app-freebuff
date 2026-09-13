import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { getChapaSecretKey, hmacSha256Hex } from "./chapa";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { chargeWinnerPayment, deposit, ensureWallet } from "./lib/finance";
import { insertNotification } from "./lib/notifications";

/**
 * Payments — spec §22–25.
 *
 * Provider seam (spec §22): every deposit flows through
 *   initiateTopUp  →  confirmProviderPaymentInternal  →  deposit (ledger)
 * regardless of provider. Chapa is the production adapter; "manual" is a
 * sandbox/dev adapter so the product is testable before PSP credentials exist.
 *
 * Chapa specifics (developer.chapa.co):
 *  - initialize: POST /v1/transaction/initialize, Bearer secret key,
 *    our merchantReference rides in `tx_ref`.
 *  - webhook: POST with JSON body; verify HMAC-SHA256 of the raw body against
 *    CHAPA_WEBHOOK_SECRET, matched in header x-chapa-signature (or
 *    chapa-signature). Event charge.success carries `tx_ref` and `amount`.
 *  - verify: GET /v1/transaction/verify/{tx_ref} — webhook best practice is to
 *    re-verify server-side before granting value.
 *
 * Idempotency (spec §24, Invariant 5): paymentEvents.providerEventId is the
 * UNIQUE webhook dedupe boundary; payment state transitions are guarded so a
 * COMPLETED payment can never be credited twice.
 */

export const PROVIDER_MANUAL = "manual";
export const PROVIDER_CHAPA = "chapa";

// ─── Queries ────────────────────────────────────────────────────────────────

export const getMyWallet = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    // Read-only: the wallet row is created by the deposit flow.
    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (wallet) return wallet;
    return {
      userId,
      paidBalanceSantims: 0,
      promoBalanceSantims: 0,
      totalDepositedSantims: 0,
      totalSpentSantims: 0,
      updatedAt: 0,
    };
  },
});

export const getMyPayments = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("payments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** The signed-in user's winner settlements (wins to pay / history). */
export const getMySettlements = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("winnerSettlements")
      .withIndex("by_winner", (q) => q.eq("winnerUserId", userId))
      .collect();
    return rows.sort((a, b) => b.paymentDeadline - a.paymentDeadline);
  },
});

// ─── Shared internal core ───────────────────────────────────────────────────

const initiateArgs = v.object({
  amountSantims: v.number(),
  provider: v.union(v.literal(PROVIDER_MANUAL), v.literal(PROVIDER_CHAPA)),
});

type InitiateArgs = { amountSantims: number; provider: "manual" | "chapa" };

async function initiateTopUpCore(ctx: MutationCtx, args: InitiateArgs) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("UNAUTHENTICATED");
  if (!Number.isInteger(args.amountSantims) || args.amountSantims <= 0) {
    throw new Error("INVALID_AMOUNT");
  }

  const now = Date.now();
  const merchantReference = `LUBA-${now}-${Math.floor(Math.random() * 1_000_000)}`;

  await ctx.db.insert("payments", {
    userId,
    amountSantims: args.amountSantims,
    currency: "ETB",
    kind: "DEPOSIT",
    provider: args.provider,
    merchantReference,
    status: "PENDING",
    createdAt: now,
  });

  // Capability token for the client-return verify flow (Chapa only): an HMAC
  // of the reference with the provider secret. Only the initiating browser,
  // which receives it from this call, can present it.
  let verifyToken: string | undefined;
  if (args.provider === PROVIDER_CHAPA) {
    const secret = getChapaSecretKey();
    verifyToken = secret
      ? await hmacSha256Hex(secret, merchantReference)
      : undefined;
  }

  return { merchantReference, verifyToken };
}

async function confirmCore(
  ctx: MutationCtx,
  args: {
    providerEventId: string;
    merchantReference: string;
    providerReference?: string;
    succeeded: boolean;
    failureReason?: string;
    expectedAmountSantims?: number;
  },
) {
  const now = Date.now();

  // §24: provider_event_id UNIQUE — replayed webhook is a no-op.
  const seenEvent = await ctx.db
    .query("paymentEvents")
    .withIndex("by_event_id", (q) =>
      q.eq("providerEventId", args.providerEventId),
    )
    .unique();
  if (seenEvent) {
    return { duplicated: true, credited: false };
  }

  const payment = await ctx.db
    .query("payments")
    .withIndex("by_merchant_ref", (q) =>
      q.eq("merchantReference", args.merchantReference),
    )
    .unique();
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");

  // Never grant value on an amount mismatch (webhook tamper / drift guard).
  if (
    args.succeeded &&
    args.expectedAmountSantims !== undefined &&
    args.expectedAmountSantims !== payment.amountSantims
  ) {
    await ctx.db.insert("paymentEvents", {
      paymentId: payment._id,
      providerEventId: args.providerEventId,
      eventType: "payment.amount_mismatch",
      payload: JSON.stringify({
        expected: payment.amountSantims,
        received: args.expectedAmountSantims,
      }),
      createdAt: now,
    });
    throw new Error("AMOUNT_MISMATCH");
  }

  await ctx.db.insert("paymentEvents", {
    paymentId: payment._id,
    providerEventId: args.providerEventId,
    eventType: args.succeeded ? "payment.succeeded" : "payment.failed",
    payload: args.failureReason
      ? JSON.stringify({ reason: args.failureReason })
      : undefined,
    createdAt: now,
  });

  if (!args.succeeded) {
    ctx.db.patch(payment._id, { status: "FAILED" });
    return { duplicated: false, credited: false };
  }

  // State guard (Invariant 5): only PENDING/FAILED payments can complete.
  // FAILED → COMPLETED is a legitimate transition (Chapa lets customers retry
  // a failed payment); a COMPLETED payment is terminal and can never be
  // credited again.
  if (payment.status !== "PENDING" && payment.status !== "FAILED") {
    return { duplicated: false, credited: false };
  }

  ctx.db.patch(payment._id, {
    status: "COMPLETED",
    providerReference: args.providerReference ?? args.merchantReference,
    completedAt: now,
  });

  // Credit the wallet — same transaction as the payment state change.
  await deposit(ctx, {
    userId: payment.userId,
    amountSantims: payment.amountSantims,
    referenceId: payment._id,
    now,
  });

  await insertNotification(ctx, {
    userId: payment.userId,
    type: "PAYMENT_SUCCESS",
    title: "Deposit received",
    body: `Your deposit of ${formatSantims(payment.amountSantims)} ETB was credited to your wallet.`,
    now,
  });

  await ctx.db.insert("outboxEvents", {
    eventType: "PAYMENT_COMPLETED",
    payload: { paymentId: payment._id, userId: payment.userId },
    processed: false,
    createdAt: now,
  });

  return { duplicated: false, credited: true };
}

function formatSantims(santims: number): string {
  const abs = Math.abs(Math.trunc(santims));
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Initiate a wallet top-up: creates the PENDING payment row with a unique
 * merchant reference. The provider adapter completes it — Chapa via webhook
 * (chapaWebhook), manual/sandbox via confirmManualTopUp.
 */
export const initiateTopUp = mutation({
  args: initiateArgs,
  handler: async (ctx, args) => initiateTopUpCore(ctx, args),
});

/**
 * Sandbox/manual adapter completion — used before PSP credentials exist and by
 * admin-assisted deposits. Never callable for a Chapa payment.
 */
export const confirmManualTopUp = mutation({
  args: {
    merchantReference: v.string(),
    succeeded: v.boolean(),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");

    const payment = await ctx.db
      .query("payments")
      .withIndex("by_merchant_ref", (q) =>
        q.eq("merchantReference", args.merchantReference),
      )
      .unique();
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (payment.userId !== userId) throw new Error("PAYMENT_NOT_YOURS");
    if (payment.provider !== PROVIDER_MANUAL) {
      throw new Error("NOT_A_MANUAL_PAYMENT");
    }

    return confirmCore(ctx, {
      providerEventId: `manual_${args.merchantReference}`,
      merchantReference: args.merchantReference,
      providerReference: `manual_${args.merchantReference}`,
      succeeded: args.succeeded,
      failureReason: args.failureReason,
    });
  },
});

/**
 * Abandon the caller's own PENDING top-up (e.g. the provider could not start
 * checkout). Only ever marks a payment FAILED — it can never credit
 * anything, so it's safe to expose to the owner.
 */
export const cancelMyTopUp = mutation({
  args: { merchantReference: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");

    const payment = await ctx.db
      .query("payments")
      .withIndex("by_merchant_ref", (q) =>
        q.eq("merchantReference", args.merchantReference),
      )
      .unique();
    if (!payment || payment.userId !== userId) {
      throw new Error("PAYMENT_NOT_FOUND");
    }
    if (payment.status !== "PENDING") return { cancelled: false };

    ctx.db.patch(payment._id, { status: "FAILED" });
    return { cancelled: true };
  },
});

/**
 * Winner completes payment of the winning bid amount from wallet balance
 * (spec §32). Atomic: debit + settlement PAID in one transaction.
 */
export const payWinningBid = mutation({
  args: { settlementId: v.id("winnerSettlements") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");

    const settlement = await ctx.db.get(args.settlementId);
    if (!settlement) throw new Error("SETTLEMENT_NOT_FOUND");
    if (settlement.winnerUserId !== userId) throw new Error("NOT_THE_WINNER");
    if (settlement.status !== "PENDING_PAYMENT") {
      throw new Error("SETTLEMENT_ALREADY_SETTLED");
    }

    const now = Date.now();
    await chargeWinnerPayment(ctx, {
      userId,
      amountSantims: settlement.winningBidValueSantims,
      settlementId: settlement._id,
      now,
    });

    ctx.db.patch(settlement._id, { status: "PAID", paidAt: now });

    await insertNotification(ctx, {
      userId,
      type: "PRIZE_STATUS",
      title: "Payment received",
      body: "Winning bid payment confirmed. Your prize will be fulfilled shortly.",
      auctionId: settlement.auctionId,
      now,
    });

    return { paid: true };
  },
});

// ─── Internal functions (webhook / system adapters only) ────────────────────

/** Minimal payment facts for the adapter's verify-and-settle flow. */
export const getPaymentByReferenceInternal = internalQuery({
  args: { merchantReference: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_merchant_ref", (q) =>
        q.eq("merchantReference", args.merchantReference),
      )
      .unique();
    if (!payment) return null;
    return {
      userId: payment.userId,
      provider: payment.provider,
      status: payment.status,
      amountSantims: payment.amountSantims,
    };
  },
});

/**
 * The exact hook every PSP adapter calls after authenticating + verifying a
 * webhook. Internal visibility: no public mutation can credit a wallet.
 */
export const confirmProviderPaymentInternal = internalMutation({
  args: {
    providerEventId: v.string(),
    merchantReference: v.string(),
    providerReference: v.optional(v.string()),
    succeeded: v.boolean(),
    failureReason: v.optional(v.string()),
    expectedAmountSantims: v.optional(v.number()),
  },
  handler: async (ctx, args) => confirmCore(ctx, args),
});

/**
 * Mark stale PENDING manual payments as FAILED so payment history stays
 * truthful (used by the return-flow verify when the user abandoned checkout).
 */
export const failPendingManualPaymentInternal = internalMutation({
  args: { merchantReference: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_merchant_ref", (q) =>
        q.eq("merchantReference", args.merchantReference),
      )
      .unique();
    if (!payment || payment.status !== "PENDING") return { marked: false };
    if (payment.provider !== PROVIDER_MANUAL) return { marked: false };
    ctx.db.patch(payment._id, { status: "FAILED" });
    return { marked: true };
  },
});
