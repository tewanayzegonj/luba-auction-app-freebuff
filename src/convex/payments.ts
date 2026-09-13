import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { chargeWinnerPayment, deposit, ensureWallet } from "./lib/finance";
import { insertNotification } from "./lib/notifications";

/**
 * Payments — spec §22–25.
 * Provider abstraction per §22: V1 ships a wallet top-up model where the
 * provider is "wallet" (direct deposit). telebirr or other PSPs plug in as
 * additional adapters without re-architecting (Builder Rule 10).
 */

function formatSantims(santims: number): string {
  const abs = Math.abs(Math.trunc(santims));
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

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

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Initiate a wallet top-up. Creates a PENDING payment with a unique
 * merchant reference. The provider adapter (V1: wallet; later: telebirr)
 * confirms via confirmProviderPayment.
 */
export const initiateTopUp = mutation({
  args: { amountSantims: v.number() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");
    if (!Number.isInteger(args.amountSantims) || args.amountSantims <= 0) {
      throw new Error("INVALID_AMOUNT");
    }

    const now = Date.now();
    const merchantReference = `LUBA-${now}-${Math.floor(Math.random() * 1_000_000)}`;

    const paymentId = await ctx.db.insert("payments", {
      userId,
      amountSantims: args.amountSantims,
      currency: "ETB",
      kind: "DEPOSIT",
      provider: "wallet",
      merchantReference,
      status: "PENDING",
      createdAt: now,
    });

    return { paymentId, merchantReference };
  },
});

/**
 * Provider confirmation — the exact hook a real PSP adapter calls
 * (webhook handler in production). Idempotent by provider event id and by
 * payment state, so repeated webhooks never credit twice (spec §24,
 * Invariant 5).
 */
export const confirmProviderPayment = mutation({
  args: {
    providerEventId: v.string(),
    merchantReference: v.string(),
    providerReference: v.optional(v.string()),
    succeeded: v.boolean(),
  },
  handler: async (ctx, args) => {
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

    await ctx.db.insert("paymentEvents", {
      paymentId: payment._id,
      providerEventId: args.providerEventId,
      eventType: args.succeeded ? "payment.succeeded" : "payment.failed",
      createdAt: now,
    });

    if (!args.succeeded) {
      ctx.db.patch(payment._id, { status: "FAILED" });
      return { duplicated: false, credited: false };
    }

    // State guard: only a PENDING payment can be completed (Invariant 5).
    if (payment.status !== "PENDING") {
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
      paymentId: payment._id,
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
