import { internalQuery } from "./_generated/server";

/**
 * TEMPORARY read-only diagnostics (internal = CLI/admin only, not callable
 * from the browser). Inspects the deposit chain artifacts to see exactly
 * where a top-up failed. Delete this file after diagnosis.
 */
export const inspect = internalQuery({
  args: {},
  handler: async (ctx) => {
    const payments = await ctx.db.query("payments").collect();
    const events = await ctx.db.query("paymentEvents").collect();
    const accounts = await ctx.db.query("ledgerAccounts").collect();
    const txs = await ctx.db.query("ledgerTransactions").collect();
    const wallets = await ctx.db.query("wallets").collect();

    const paymentsSorted = [...payments].sort((a, b) => b.createdAt - a.createdAt);
    const platformAccounts = accounts.filter((a) => !a.owner);
    const userAccounts = accounts.filter((a) => a.owner);

    // Duplicate chart codes would make .unique() queries throw.
    const codeCounts = new Map<string, number>();
    for (const a of accounts) {
      codeCounts.set(a.code, (codeCounts.get(a.code) ?? 0) + 1);
    }
    const duplicateCodes = [...codeCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([code, n]) => ({ code, count: n }));

    // Duplicate merchant references would also break .unique().
    const refCounts = new Map<string, number>();
    for (const p of payments) {
      refCounts.set(p.merchantReference, (refCounts.get(p.merchantReference) ?? 0) + 1);
    }
    const duplicateRefs = [...refCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([ref, n]) => ({ ref, count: n }));

    // Duplicate event ids break webhook idempotency lookup.
    const evtCounts = new Map<string, number>();
    for (const e of events) {
      evtCounts.set(e.providerEventId, (evtCounts.get(e.providerEventId) ?? 0) + 1);
    }
    const duplicateEvents = [...evtCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([id, n]) => ({ id, count: n }));

    const depositTxs = txs
      .filter((t) => t.txType === "DEPOSIT")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10)
      .map((t) => ({ id: t._id, key: t.idempotencyKey, at: t.createdAt }));

    const users = await ctx.db.query("users").collect();

    return {
      userCount: users.length,
      users: users.slice(0, 10).map((u) => ({
        id: u._id,
        email: u.email ?? null,
        name: u.name ?? null,
        createdAt: (u as unknown as { _creationTime?: number })._creationTime ?? null,
      })),
      paymentsRecent: paymentsSorted.slice(0, 10).map((p) => ({
        id: p._id,
        user: p.userId,
        amount: p.amountSantims,
        status: p.status,
        provider: p.provider,
        ref: p.merchantReference,
        createdAt: p.createdAt,
        completedAt: p.completedAt ?? null,
      })),
      eventsRecent: events
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 10)
        .map((e) => ({ id: e._id, payment: e.paymentId, type: e.eventType, at: e.createdAt })),
      platformAccounts: platformAccounts.map((a) => ({
        code: a.code,
        balance: a.balanceSantims,
      })),
      userAccountCount: userAccounts.length,
      duplicateCodes,
      duplicateRefs,
      duplicateEvents,
      depositTxs,
      walletCount: wallets.length,
      txCount: txs.length,
    };
  },
});
