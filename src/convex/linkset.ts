import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * links.et receipt verification - bank-confirmed wallet top-ups.
 *
 * Flow: user transfers money to LUBA's telebirr/CBE/bank account on their
 * own, then pastes the receipt URL (or telebirr reference). A server action
 * asks links.et to fetch the receipt FROM THE BANK (Ethiopia egress), parses
 * the provider-specific shape, and stores the outcome on the payment row.
 * A mutation then applies the credit through the same confirmCore path as a
 * PSP webhook.
 *
 * Architecture note: Convex mutations cannot return scheduled-action
 * results, so the flow is async by design:
 *   submitReceipt (mutation, ownership check) → schedules verifyReceiptTopUp
 *   verifyReceiptTopUp (action, "use node") → calls links.et → writes
 *     linksetStatus/linksetReceiptRef onto the payment row
 *   settleVerifiedReceipt (mutation) → idempotent credit via confirmCore
 *   myLinksetPayments (query) → UI reactivity picks up the settled state.
 *
 * Docs: https://links.et/agents.md - key rules honored:
 * - Switch on `receipt.source`, never on host/providerKey.
 * - Amounts: numbers on some providers, strings ("100 Birr"/"100 ETB") on
 *   others - parsed per source, never raw arithmetic.
 * - Never retry a Siinqee receipt (≈5 total views kills it).
 * - A receipt URL is a credential: never logged, never echoed to users.
 * - quota_exceeded (monthly cap) ≠ rate_limited (Retry-After seconds).
 */

const BASE = "https://links.et";

type LinksetError = { code?: string; message?: string };

const LINKSET_PROVIDER = "linkset";

// ─── Public entry ───────────────────────────────────────────────────────────

/**
 * The payment owner submits their receipt for verification. Ownership is
 * checked here (mutations have auth context; actions don't), the payment is
 * marked "verifying", and the verification action is scheduled.
 */
export const submitReceipt = mutation({
  args: {
    paymentId: v.id("payments"),
    receiptUrl: v.optional(v.string()),
    telebirrReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");

    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.userId !== userId) {
      throw new Error("PAYMENT_NOT_FOUND");
    }
    if (payment.provider !== LINKSET_PROVIDER) {
      throw new Error("NOT_A_RECEIPT_PAYMENT");
    }

    const url = args.receiptUrl?.trim();
    const ref = args.telebirrReference?.trim();
    if (!url && !ref) {
      throw new Error("PASTE_RECEIPT_FIRST");
    }
    if (url && !/^https:\/\//i.test(url)) {
      throw new Error("RECEIPT_URL_MUST_BE_HTTPS");
    }

    await ctx.db.patch(args.paymentId, {
      linksetStatus: "verifying",
      linksetError: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.linkset.verifyReceiptTopUp, {
      paymentId: args.paymentId,
      receiptUrl: url,
      telebirrReference: ref,
    });

    return { submitted: true };
  },
});

/** Reactive status for the wallet UI (called only with the owner's auth). */
export const getMyReceiptPayment = internalQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return null;
    return {
      status: payment.status,
      linksetStatus: payment.linksetStatus,
      linksetError: payment.linksetError,
      amountSantims: payment.amountSantims,
      merchantReference: payment.merchantReference,
    };
  },
});

// ─── Verification action ────────────────────────────────────────────────────

type PaymentRow = {
  _id: string;
  userId: string;
  amountSantims: number;
  provider: string;
  status: string;
};

export const verifyReceiptTopUp = internalAction({
  args: {
    paymentId: v.id("payments"),
    receiptUrl: v.optional(v.string()),
    telebirrReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.LINKS_ET_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.linkset.markLinksetFailed, {
        paymentId: args.paymentId,
        error:
          "Receipt verification is not configured yet - use Chapa or contact support.",
      });
      return;
    }

    const payment = (await ctx.runQuery(internal.payments.getPaymentInternal, {
      paymentId: args.paymentId,
    })) as PaymentRow | null;
    if (!payment || payment.provider !== LINKSET_PROVIDER) return;

    const body: Record<string, unknown> = { waitMs: 25_000 };
    if (args.telebirrReference) body.reference = args.telebirrReference.trim();
    else if (args.receiptUrl) body.url = args.receiptUrl.trim();

    // Idempotency-Key = payment id: re-submitting after a 202 or a dropped
    // connection replays the same verification instead of burning a second
    // bank fetch (cache hits are free at links.et).
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/verify`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
          "idempotency-key": args.paymentId,
        },
        body: JSON.stringify(body),
      });
    } catch {
      await ctx.runMutation(internal.linkset.markLinksetFailed, {
        paymentId: args.paymentId,
        error: "Network error reaching the verifier - tap Verify again.",
      });
      return;
    }

    // 202: bank still processing. Poll briefly; otherwise leave the row in
    // "verifying" - the user can re-submit and the idempotency key replays.
    if (res.status === 202) {
      const queued = (await res.json().catch(() => ({}))) as {
        statusUrl?: string;
      };
      if (queued.statusUrl) {
        for (let i = 0; i < 4; i++) {
          await new Promise((r) => setTimeout(r, 6_000));
          const poll = await fetch(`${BASE}${queued.statusUrl}`, {
            headers: { "x-api-key": apiKey },
          });
          if (poll.status === 200) {
            const done = (await poll.json()) as Record<string, unknown>;
            await interpret(ctx, args.paymentId, done);
            return;
          }
        }
      }
      await ctx.runMutation(internal.linkset.markLinksetFailed, {
        paymentId: args.paymentId,
        error:
          "The bank is still responding - tap Verify again in a minute. Your progress is saved.",
      });
      return;
    }

    const data = (await res.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!data) {
      await ctx.runMutation(internal.linkset.markLinksetFailed, {
        paymentId: args.paymentId,
        error: "The verifier returned an unreadable response - try again.",
      });
      return;
    }

    if (res.status === 429) {
      const err = data.error as LinksetError | undefined;
      await ctx.runMutation(internal.linkset.markLinksetFailed, {
        paymentId: args.paymentId,
        error:
          err?.code === "quota_exceeded" || err?.code === "image_cap_reached"
            ? "Verification quota is exhausted for this period - try again later or contact support."
            : "Too many verification attempts - wait a moment and retry.",
      });
      return;
    }

    if (res.status === 503) {
      const err = data.error as LinksetError | undefined;
      await ctx.runMutation(internal.linkset.markLinksetFailed, {
        paymentId: args.paymentId,
        error:
          err?.code === "provider_down"
            ? "Your bank's receipt service is down right now - try again in a few minutes."
            : "The verifier is temporarily unavailable - try again shortly.",
      });
      return;
    }

    if (!res.ok || data.ok !== true) {
      const err = data.error as LinksetError | string | undefined;
      const code = typeof err === "object" ? err?.code : undefined;
      const rawMsg = typeof err === "object" ? err?.message : err;
      // 400 with no code = upstream/busy-bank timeout per docs → retryable.
      await ctx.runMutation(internal.linkset.markLinksetFailed, {
        paymentId: args.paymentId,
        error: code
          ? friendlyError(code, rawMsg)
          : "The bank didn't respond in time - check the receipt link and try again.",
      });
      return;
    }

    await interpret(ctx, args.paymentId, data);
  },
});

/** Record a failed verification on the payment row (user-facing message). */
export const markLinksetFailed = internalMutation({
  args: { paymentId: v.id("payments"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, {
      linksetStatus: "failed",
      linksetError: args.error,
    });
  },
});

/**
 * Apply a bank-verified receipt: idempotent, single-redemption, exact-amount
 * credit through the payments core (same path as a PSP webhook).
 */
export const settleVerifiedReceipt = internalMutation({
  args: {
    paymentId: v.id("payments"),
    receiptSource: v.string(),
    receiptReference: v.string(),
    verifiedAmountSantims: v.number(),
    payerName: v.optional(v.string()),
    payerPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.provider !== LINKSET_PROVIDER) {
      await ctx.db.patch(args.paymentId, {
        linksetStatus: "failed",
        linksetError: "Payment request is no longer open - start a new top-up.",
      });
      return;
    }
    if (payment.status === "COMPLETED") {
      await ctx.db.patch(args.paymentId, {
        linksetStatus: "failed",
        linksetError: "This receipt has already been used for a top-up.",
      });
      return;
    }
    if (payment.status !== "PENDING") {
      await ctx.db.patch(args.paymentId, {
        linksetStatus: "failed",
        linksetError: "This payment request is no longer open - start a new top-up.",
      });
      return;
    }

    // Redemption ledger: has ANY linkset payment already been credited with
    // this exact receipt reference? One receipt = one redemption EVER - a
    // screenshot of the same receipt can never pay two accounts.
    const prior = await ctx.db
      .query("payments")
      .withIndex("by_provider_ref", (q) =>
        q
          .eq("provider", LINKSET_PROVIDER)
          .eq("providerReference", args.receiptReference),
      )
      .collect();
    if (prior.some((p) => p.status === "COMPLETED")) {
      await ctx.db.patch(args.paymentId, {
        linksetStatus: "failed",
        linksetError:
          "This receipt has already been used for a top-up. Each receipt can only be credited once.",
      });
      return;
    }

    if (args.verifiedAmountSantims !== payment.amountSantims) {
      await ctx.db.patch(args.paymentId, {
        linksetStatus: "failed",
        linksetError:
          "The verified amount doesn't match your top-up request. Start a new top-up for the exact amount you transferred.",
      });
      return;
    }

    // Attach the payer phone (fraud-correlation key) when the receipt has
    // one and the payment row doesn't yet.
    if (args.payerPhone && !payment.payerPhone) {
      ctx.db.patch(payment._id, { payerPhone: args.payerPhone });
    }

    const result = (await ctx.runMutation(
      internal.payments.confirmProviderPaymentInternal,
      {
        providerEventId: `linkset_${args.receiptReference}`,
        merchantReference: payment.merchantReference,
        providerReference: args.receiptReference,
        succeeded: true,
        expectedAmountSantims: args.verifiedAmountSantims,
      },
    )) as { duplicated?: boolean; credited?: boolean };

    if (result.duplicated) {
      await ctx.db.patch(args.paymentId, {
        linksetStatus: "failed",
        linksetError:
          "This receipt has already been used for a top-up. Each receipt can only be credited once.",
      });
      return;
    }

    await ctx.db.patch(args.paymentId, {
      linksetStatus: "verified",
      linksetError: undefined,
    });
  },
});

// ─── Parse + settle ─────────────────────────────────────────────────────────

type Runners = {
  runQuery(ref: unknown, args: unknown): Promise<unknown>;
  runMutation(ref: unknown, args: unknown): Promise<unknown>;
};

async function interpret(
  ctx: Runners,
  paymentId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const receipt = data.receipt as Record<string, unknown> | undefined;

  // 502 shape: parsed but failed validation - partial receipt attached.
  if (data.ok !== true || !receipt) {
    await ctx.runMutation(internal.linkset.markLinksetFailed, {
      paymentId,
      error:
        "The bank responded but the receipt couldn't be validated. Double-check the link, or contact support for a manual review.",
    });
    return;
  }

  const source = String(receipt.source ?? "");
  const parsed = parseReceipt(source, receipt);

  if (!parsed.reference || !parsed.amountSantims) {
    await ctx.runMutation(internal.linkset.markLinksetFailed, {
      paymentId,
      error:
        "We read the receipt but couldn't extract the amount or reference - contact support for a manual review.",
    });
    return;
  }

  // Providers whose receipts carry an explicit status must show completed;
  // a successful fetch+parse on status-less providers counts as completed.
  if (parsed.completed === false) {
    await ctx.runMutation(internal.linkset.markLinksetFailed, {
      paymentId,
      error: `The bank shows this transaction as "${parsed.statusRaw ?? "not completed"}" - funds were not transferred.`,
    });
    return;
  }

  await ctx.runMutation(internal.linkset.settleVerifiedReceipt, {
    paymentId,
    receiptSource: source,
    receiptReference: parsed.reference,
    verifiedAmountSantims: parsed.amountSantims,
    payerName: parsed.payerName,
    payerPhone: parsed.payerPhone,
  });
}

type Parsed = {
  reference?: string;
  amountSantims?: number;
  payerName?: string;
  payerPhone?: string;
  statusRaw?: string;
  completed?: boolean;
};

function toSantims(n: number): number {
  return Math.round(n * 100);
}

/** "100 Birr" / "1,024.50 ETB" / plain number → integer santims, or undefined. */
function parseAmountString(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return toSantims(raw);
  if (typeof raw !== "string") return undefined;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? toSantims(n) : undefined;
}

/**
 * Per-source extraction. Switch on receipt.source (docs rule #1), never the
 * host. Field names per https://links.et/docs/verify.md.
 */
function parseReceipt(source: string, r: Record<string, unknown>): Parsed {
  switch (source) {
    case "telebirr-html": {
      const status = str(r.transactionStatus);
      return {
        reference: str(r.receiptNo),
        amountSantims: parseAmountString(r.settledAmount),
        payerName: str(r.payerName),
        payerPhone: str(r.payerTelebirrNo),
        statusRaw: status ?? undefined,
        completed: status === "Completed",
      };
    }
    case "cbe-pdf":
      return {
        reference: str(r.reference),
        amountSantims: parseAmountString(r.transferredAmount),
        payerName: str(r.payerName),
      };
    case "mb-json":
      return {
        reference: str(r.reference),
        amountSantims: parseAmountString(r.transferredAmount),
        payerName: str(r.payerName),
      };
    case "boa-json": {
      const status = str(r.upstreamStatus);
      return {
        reference: str(r.transactionReference),
        amountSantims: parseAmountString(r.transferredAmount),
        statusRaw: status ?? undefined,
        completed: status === "Success",
      };
    }
    case "zemen-pdf": {
      const status = str(r.transactionStatus);
      return {
        reference: str(r.reference),
        amountSantims: parseAmountString(r.settledAmount),
        payerName: str(r.payerName),
        statusRaw: status ?? undefined,
        completed: status === "COMPLETED",
      };
    }
    case "awash-html": {
      const tx = r.transaction as Record<string, unknown> | undefined;
      const cust = r.customer as Record<string, unknown> | undefined;
      return {
        reference: str(tx?.transactionId) || undefined,
        amountSantims: parseAmountString(tx?.amount),
        payerName: str(cust?.customerName) || str(tx?.senderName) || undefined,
      };
    }
    default:
      // Providers without documented layouts (dashen, mpesa, ebirr, amhara,
      // abay, berhan, oromia, ahadu, siinqee, zamzam, hulubeje): best-effort
      // common-field scan; if it doesn't yield we ask for manual review
      // rather than guess.
      return {
        reference:
          str(r.reference) ||
          str(r.receiptNo) ||
          str(r.transactionReference) ||
          undefined,
        amountSantims:
          parseAmountString(r.settledAmount) ??
          parseAmountString(r.transferredAmount) ??
          parseAmountString(r.totalAmount) ??
          parseAmountString(r.amount),
        payerName: str(r.payerName) || undefined,
      };
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** User-safe error text - never echoes the receipt URL (docs rule #4). */
function friendlyError(code: string, raw?: string): string {
  switch (code) {
    case "invalid_request":
    case "invalid_json":
      return "That receipt link doesn't look right - paste the full link from your bank app or SMS.";
    case "missing_key":
    case "invalid_key":
    case "revoked_key":
      return "Receipt verification is misconfigured - contact support.";
    case "ocr_daily_cap_reached":
      return "The verification service is at capacity today - try again later.";
    case "ai_not_configured":
      return "Screenshot verification isn't available - paste a receipt link instead.";
    default:
      return raw
        ? "Verification failed - double-check the receipt and try again."
        : "Verification failed - double-check the receipt and try again.";
  }
}
