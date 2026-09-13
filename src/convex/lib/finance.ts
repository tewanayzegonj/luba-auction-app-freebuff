import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ACCOUNT_CODES, postTransaction } from "./ledger";

/**
 * Financial service — wallet operations as double-entry ledger postings.
 * Every function is idempotent and must be called inside the same
 * transaction as the business event it funds (spec §15).
 */

/** Get or create the wallet projection row for a user. */
export async function ensureWallet(ctx: MutationCtx, userId: Id<"users">) {
  const existing = await ctx.db
    .query("wallets")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (existing) return existing;

  const walletId = await ctx.db.insert("wallets", {
    userId,
    paidBalanceSantims: 0,
    promoBalanceSantims: 0,
    totalDepositedSantims: 0,
    totalSpentSantims: 0,
    updatedAt: Date.now(),
  });
  const wallet = await ctx.db.get(walletId);
  if (!wallet) throw new Error("WALLET_CREATE_FAILED");
  return wallet;
}

/**
 * Deposit: money arrived from a completed payment (or an admin adjustment).
 *   DEBIT  PLATFORM_CLEARING (payment received, in transit)
 *   CREDIT USER_PAID:userId  (credit user's paid balance)
 * Pass idempotencyKey explicitly for non-payment adjustments (admin credits),
 * otherwise it derives from the payment id.
 */
export async function deposit(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    amountSantims: number;
    referenceId: string;
    idempotencyKey?: string;
    description?: string;
    now: number;
  },
): Promise<void> {
  const { userId, amountSantims, referenceId, now } = args;
  if (!Number.isInteger(amountSantims) || amountSantims <= 0) {
    throw new Error("DEPOSIT_AMOUNT_MUST_BE_POSITIVE");
  }

  await postTransaction(ctx, {
    txType: args.idempotencyKey ? "ADMIN_ADJUSTMENT" : "DEPOSIT",
    description: args.description ?? `Wallet deposit (${referenceId})`,
    reference: referenceId,
    idempotencyKey: args.idempotencyKey ?? `DEPOSIT:${referenceId}`,
    now,
    lines: [
      {
        accountCode: ACCOUNT_CODES.clearing,
        accountName: "Platform clearing",
        accountType: "ASSET",
        direction: "DEBIT",
        amountSantims,
      },
      {
        accountCode: ACCOUNT_CODES.userPaid(userId),
        accountName: "User paid balance",
        accountType: "LIABILITY",
        direction: "CREDIT",
        amountSantims,
      },
    ],
  });

  const wallet = await ensureWallet(ctx, userId);
  ctx.db.patch(wallet._id, {
    paidBalanceSantims: wallet.paidBalanceSantims + amountSantims,
    totalDepositedSantims: wallet.totalDepositedSantims + amountSantims,
    updatedAt: now,
  });
}

/**
 * Charge the bid service fee: DEBIT user paid balance → CREDIT platform revenue.
 * Called transactionally with bid creation (spec §15).
 * Throws LedgerError("INSUFFICIENT_FUNDS") when the balance is too low.
 */
export async function chargeBidFee(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    feeSantims: number;
    bidId: Id<"auctionBids">;
    now: number;
  },
): Promise<void> {
  const { userId, feeSantims, bidId, now } = args;
  if (!Number.isInteger(feeSantims) || feeSantims <= 0) {
    throw new Error("FEE_MUST_BE_POSITIVE");
  }

  await postTransaction(ctx, {
    txType: "BID_FEE",
    description: `Bid service fee (bid ${bidId})`,
    reference: bidId,
    idempotencyKey: `BID_FEE:${bidId}`,
    now,
    lines: [
      {
        accountCode: ACCOUNT_CODES.userPaid(userId),
        accountName: "User paid balance",
        accountType: "LIABILITY",
        direction: "DEBIT",
        amountSantims: feeSantims,
      },
      {
        accountCode: ACCOUNT_CODES.revenue,
        accountName: "Platform revenue",
        accountType: "REVENUE",
        direction: "CREDIT",
        amountSantims: feeSantims,
      },
    ],
  });

  const wallet = await ensureWallet(ctx, userId);
  ctx.db.patch(wallet._id, {
    paidBalanceSantims: wallet.paidBalanceSantims - feeSantims,
    totalSpentSantims: wallet.totalSpentSantims + feeSantims,
    updatedAt: now,
  });
}

/**
 * Winner pays the winning bid amount: DEBIT user → CREDIT platform settlement.
 * Called transactionally with the settlement being marked PAID (spec §32).
 */
export async function chargeWinnerPayment(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    amountSantims: number;
    settlementId: Id<"winnerSettlements">;
    now: number;
  },
): Promise<void> {
  const { userId, amountSantims, settlementId, now } = args;

  await postTransaction(ctx, {
    txType: "WINNER_PAYMENT",
    description: `Winning bid payment (settlement ${settlementId})`,
    reference: settlementId,
    idempotencyKey: `WINNER_PAYMENT:${settlementId}`,
    now,
    lines: [
      {
        accountCode: ACCOUNT_CODES.userPaid(userId),
        accountName: "User paid balance",
        accountType: "LIABILITY",
        direction: "DEBIT",
        amountSantims,
      },
      {
        accountCode: ACCOUNT_CODES.settlement,
        accountName: "Platform settlement",
        accountType: "LIABILITY",
        direction: "CREDIT",
        amountSantims,
      },
    ],
  });

  const wallet = await ensureWallet(ctx, userId);
  ctx.db.patch(wallet._id, {
    paidBalanceSantims: wallet.paidBalanceSantims - amountSantims,
    totalSpentSantims: wallet.totalSpentSantims + amountSantims,
    updatedAt: now,
  });
}

/**
 * Refund a user's paid balance (e.g. bid fee refunds under the no-winner
 * policy). Reverses platform revenue:
 *   DEBIT  PLATFORM_REVENUE
 *   CREDIT USER_PAID:userId
 */
export async function refundUser(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    amountSantims: number;
    reason: string;
    reference: string;
    idempotencyKey: string;
    now: number;
  },
): Promise<void> {
  const { userId, amountSantims, reason, reference, idempotencyKey, now } = args;
  if (!Number.isInteger(amountSantims) || amountSantims <= 0) {
    throw new Error("REFUND_AMOUNT_MUST_BE_POSITIVE");
  }

  await postTransaction(ctx, {
    txType: "REFUND",
    description: `Refund: ${reason}`,
    reference,
    idempotencyKey,
    now,
    lines: [
      {
        accountCode: ACCOUNT_CODES.revenue,
        accountName: "Platform revenue",
        accountType: "REVENUE",
        direction: "DEBIT",
        amountSantims,
      },
      {
        accountCode: ACCOUNT_CODES.userPaid(userId),
        accountName: "User paid balance",
        accountType: "LIABILITY",
        direction: "CREDIT",
        amountSantims,
      },
    ],
  });

  const wallet = await ensureWallet(ctx, userId);
  ctx.db.patch(wallet._id, {
    paidBalanceSantims: wallet.paidBalanceSantims + amountSantims,
    updatedAt: now,
  });
}
