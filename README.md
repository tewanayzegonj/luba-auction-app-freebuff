# LUBA Ethiopia — Lowest Unique Bid Auction Platform

**The lowest unique bid wins.** Not the lowest bid — the lowest amount submitted
exactly once.

This is the V1 implementation of the LUBA Master Blueprint (v1.0), scoped to the
first end-to-end production milestone: browse live auctions → sign up → top up
wallet → pay bid service fee → submit bid amount → auction closes →
deterministic winner resolution → winner pays winning bid → prize fulfillment
tracking.

## Stack

- **Frontend**: React 19 + TypeScript + Vite, Tailwind CSS v4, shadcn/ui,
  Framer Motion, React Router
- **Backend / Database**: Convex — ACID-transactional, schema-validated,
  reactive subscriptions (the platform's managed transactional store; plays the
  role the blueprint assigns to PostgreSQL: source of truth for auctions,
  bids, and the financial ledger)
- **Auth**: Convex Auth with email OTP (6-digit codes), protected routes via
  `RequireAuth`

## V1 scope (per product decision)

| In scope | Deferred |
| --- | --- |
| Landing page with live auction list | Admin console (Phase 8) |
| Auction detail + bid flow with confirmation & terms | SMS channel (outbox-ready) |
| Wallet top-up + bid service fee ledger | telebirr/PSP live adapter (abstraction ready) |
| Deterministic winner resolution & settlement | Monte Carlo simulator (spec §48–53) |
| No-winner refund policy | Multi-language, advanced fraud engine |
| Notifications (in-app), my bids, wins, profile | Full bid-history publication |

## Architecture highlights

### Money (spec §7)
All amounts are **integers in santims** (1 ETB = 100 santims). No floats.
`src/lib/money.ts` handles parsing/formatting; the engine never sees a float.

### Three truths (spec §72)
- **Auction truth** — `auctionBids` (append-only), accepted exactly once or not
  at all.
- **Financial truth** — double-entry ledger (`ledgerAccounts`,
  `ledgerTransactions`, `ledgerEntries`). Entries are immutable; corrections
  are compensating postings. Wallets are rebuildable projections.
- **Presentation truth** — UI subscriptions; may be stale, never authoritative.

### Bid atomicity (spec §14–17)
`auctions.placeBid` performs, in **one transaction**: authentication →
eligibility → OPEN check → server-time close check → range/increment → per-user
cap → consecutive-bid policy → bid insert → ledger fee posting (throws
`INSUFFICIENT_FUNDS` → bid rolled back) → counters → outbox event → idempotency
key. Client sends a UUID idempotency key; replays return the original outcome.

### Winner resolution (spec §27–28)
`convex/lib/winner.ts::resolveLowestUniqueBid` — deterministic lowest value
with count === 1 among ACCEPTED bids only. Settled once per auction via a
uniqueness fence (one result row per auction), so double settlement is
impossible.

### Payment idempotency (spec §24, Invariant 5)
`payments.confirmProviderPayment` dedupes by `providerEventId` and only credits
a `PENDING` payment once. The V1 "wallet" provider confirms in-session; a
telebirr adapter would call the same function from its webhook.

### Financial invariants enforced (spec §61)
1. Every ledger transaction must balance or posting throws.
2. User paid balances can never go negative (posting guard).
3. Bids after authoritative close are impossible (status + server time).
4. One idempotency key → at most one financial operation.
5. One payment event → at most one credit.
6. A completed auction has exactly one result (unique fence).
7. Winner resolution is deterministic.
8. No presentation-layer state creates financial truth.

## Auction lifecycle (spec §9, §30)

```
SCHEDULED → OPEN → CLOSING → CLOSED → SETTLING → COMPLETED
                    ↘ CANCELLED (any pre-SETTLING state, authorized policy)
```

`lifecycle.tickLifecycle` advances states by **server time only** and invokes
settlement. `lifecycle.processOutbox` drains transactional outbox events
(at-least-once; consumers dedupe).

## Development

```bash
bun convex dev --once   # push backend + regenerate types
bun tsc -b --noEmit     # typecheck everything
```

Seed data (6 prizes, 6 auctions incl. one already closed to demo settlement):
`bunx convex run lifecycle:seedIfEmpty '{}'` then
`bunx convex run lifecycle:tickLifecycle '{}'`.

## Before real launch (not code — decisions)

The blueprint (§69) correctly flags these as **external business/legal
decisions**: license classification, NBE requirements, PSP approval (telebirr),
VAT/tax treatment, AML/KYC depth, final fee levels, and the frozen no-winner
policy. The engine supports the policy set but does not assume any of them.
