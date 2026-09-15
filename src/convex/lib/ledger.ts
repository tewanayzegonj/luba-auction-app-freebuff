import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Double-entry ledger engine — spec §19–21.
 *
 * Sign conventions (debit-normal vs credit-normal accounts):
 *  - ASSET / EXPENSE  → debit-normal:  debits increase the balance
 *  - LIABILITY / REVENUE / EQUITY → credit-normal: credits increase the balance
 * The stored `balanceSantims` is the account's natural balance (a user wallet
 * holds a positive number when the user has funds).
 *
 * Invariants:
 *  1. Every transaction balances (Σ debits = Σ credits) — posting rejects
 *     unbalanced input.
 *  2. No user PAID/PROMO balance goes negative (checked before debiting).
 *  3. Transactions are idempotent via a unique idempotency key (Invariant 4).
 *  4. Entries are append-only: corrections are compensating entries.
 */

export type LedgerLine = {
  accountCode: string;
  accountName: string;
  accountType: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  direction: "DEBIT" | "CREDIT";
  amountSantims: number;
};

/** Chart of accounts — spec §21. Account codes embed the owner for user accounts. */
export const ACCOUNT_CODES = {
  userPaid: (userId: Id<"users">) => `USER_PAID:${userId}`,
  userPromo: (userId: Id<"users">) => `USER_PROMO:${userId}`,
  clearing: "PLATFORM_CLEARING",
  revenue: "PLATFORM_REVENUE",
  refundLiability: "PLATFORM_REFUND_LIABILITY",
  prizeExpense: "PLATFORM_PRIZE_EXPENSE",
  prizeLiability: "PLATFORM_PRIZE_LIABILITY",
  settlement: "PLATFORM_SETTLEMENT",
} as const;

function isUserAccount(code: string): boolean {
  return code.startsWith("USER_PAID:") || code.startsWith("USER_PROMO:");
}

function accountTypeFor(code: string): "LIABILITY" | "ASSET" {
  // Balances we owe users are liabilities from the platform's perspective.
  return isUserAccount(code) ? "LIABILITY" : "ASSET";
}

/** Credit-normal accounts grow when credited (liabilities, revenue, equity). */
function isCreditNormal(accountType: Doc<"ledgerAccounts">["type"]): boolean {
  return (
    accountType === "LIABILITY" ||
    accountType === "REVENUE" ||
    accountType === "EQUITY"
  );
}

/** Get or create a ledger account by chart code. */
export async function getOrCreateAccount(
  ctx: MutationCtx,
  code: string,
  name: string,
): Promise<Doc<"ledgerAccounts">> {
  const existing = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
  if (existing) return existing;

  const accountId = await ctx.db.insert("ledgerAccounts", {
    owner: isUserAccount(code) ? (code.split(":")[1] as Id<"users">) : undefined,
    code,
    name,
    type: accountTypeFor(code),
    balanceSantims: 0,
  });
  const account = await ctx.db.get(accountId);
  if (!account) throw new LedgerError("ACCOUNT_CREATE_FAILED");
  return account;
}

export class LedgerError extends Error {}

/**
 * Post a balanced, idempotent double-entry transaction.
 * Returns the transaction id, or the existing transaction id if this
 * idempotency key was already posted (original effect returned unchanged —
 * Invariant 4).
 */
export async function postTransaction(
  ctx: MutationCtx,
  args: {
    txType: string;
    description: string;
    reference: string;
    idempotencyKey: string;
    now: number;
    lines: LedgerLine[];
  },
): Promise<Id<"ledgerTransactions">> {
  const { txType, description, reference, idempotencyKey, now, lines } = args;

  if (lines.length < 2) {
    throw new LedgerError("A ledger transaction needs at least two entries");
  }

  // Invariant 1: must balance.
  let debits = 0;
  let credits = 0;
  for (const line of lines) {
    if (!Number.isInteger(line.amountSantims) || line.amountSantims <= 0) {
      throw new LedgerError("Ledger amounts must be positive integers (santims)");
    }
    if (line.direction === "DEBIT") debits += line.amountSantims;
    else credits += line.amountSantims;
  }
  if (debits !== credits) {
    throw new LedgerError(
      `Unbalanced transaction: debits=${debits} credits=${credits}`,
    );
  }

  // Invariant 3/4: idempotency — unique key per transaction.
  const existing = await ctx.db
    .query("ledgerTransactions")
    .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (existing) return existing._id;

  const txId = await ctx.db.insert("ledgerTransactions", {
    txType,
    reference,
    description,
    idempotencyKey,
    createdAt: now,
  });

  for (const line of lines) {
    const account = await getOrCreateAccount(
      ctx,
      line.accountCode,
      line.accountName,
    );

    // Apply the delta in the account's natural direction.
    const credited = line.direction === "CREDIT";
    const grows = isCreditNormal(account.type) ? credited : !credited;
    const delta = grows ? line.amountSantims : -line.amountSantims;

    // Invariant 2: user balances can never go negative.
    if (isUserAccount(account.code) && account.balanceSantims + delta < 0) {
      throw new LedgerError("INSUFFICIENT_FUNDS");
    }

    await ctx.db.insert("ledgerEntries", {
      transactionId: txId,
      accountId: account._id,
      direction: line.direction,
      amountSantims: line.amountSantims,
      userId: isUserAccount(account.code) ? (account.code.split(":")[1] as Id<"users">) : undefined,
      createdAt: now,
    });

    // Balance projection (rebuildable from entries — never the truth itself).
    // Phase 6: only PER-USER accounts are patched. Platform accounts
    // (revenue, clearing, settlement…) would be a single hot row contended
    // by every concurrent bidder; their totals are aggregated from entries
    // at read time (see admin.getFinanceDashboard). Entries are the truth.
    if (isUserAccount(account.code)) {
      ctx.db.patch(account._id, {
        balanceSantims: account.balanceSantims + delta,
      });
    }
  }

  return txId;
}
