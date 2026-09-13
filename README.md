# Luba — Lowest Unique Bid Auction Platform

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
| Landing page with live auction list | Production PSP credentials & go-live review |
| Auction detail + bid flow with confirmation & terms | SMS channel (outbox-ready) |
| Wallet top-up via **Chapa** (telebirr, CBE Birr, M-Pesa, cards) + sandbox adapter | Direct telebirr super-app integration (Chapa aggregates it) |
| Admin console: users, payments, auctions, audit log (spec §41–43) | Monte Carlo simulator (spec §48–53) |
| Deterministic winner resolution & settlement | Multi-language, advanced fraud engine |
| No-winner refund policy | Full bid-history publication |
| Notifications (in-app), my bids, wins, profile | |

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
Every deposit flows: `initiateTopUp` (PENDING payment + capability token) →
provider → `confirmProviderPaymentInternal` (webhook/return verify) → ledger
deposit. It dedupes by `providerEventId` (replayed webhooks are no-ops),
verifies the provider's amount against the initiated payment, and only credits
PENDING/FAILED payments — a COMPLETED payment is terminal. No public mutation
can credit a wallet; crediting is internal-only.

### Payments — Chapa adapter (`convex/chapa.ts`, `convex/chapaWebhook.ts`)
- **Initialize**: `POST /v1/transaction/initialize` with our merchant reference
  as `tx_ref` → hosted `checkout_url` (telebirr, CBE Birr, M-Pesa, cards).
- **Webhook**: `POST /webhooks/chapa` verifies the HMAC-SHA256 signature of the
  raw body against `CHAPA_WEBHOOK_SECRET` (headers `x-chapa-signature` /
  `chapa-signature`), then settles via the internal confirm core.
- **Return flow**: `POST /payments/chapa/verify` re-verifies the transaction
  server-side when the browser returns (webhooks can lag); authenticated by a
  capability token only the initiating browser received.
- **Sandbox adapter**: "manual" provider settles instantly so the product is
  testable before PSP credentials exist; removed at launch.
- Configure: `CHAPA_SECRET_KEY`, `CHAPA_WEBHOOK_SECRET`; set the dashboard
  webhook URL to `https://<deployment>.convex.site/webhooks/chapa`.

### Admin (spec §41–43)
`/admin` (admin role required): platform stats, live ledger-balance check,
user management (suspend/reactivate, role grants, audited wallet credits),
payments view, and the append-only audit log. The first registered account
can claim the admin role once (`bootstrapAdmin`); afterwards only admins
grant roles.

### Campaign management (admin → Campaigns tab)
Create and run auction campaigns without touching code:
- **Prizes**: create once, reuse across campaigns (`createPrize`, inventory
  shows how many campaigns use each prize).
- **Campaigns** (`createAuction`): full spec §10 rule set per campaign — bid
  range, increment, service fee, per-user cap, consecutive-bid policy,
  no-winner policy, winner payment deadline, visibility. Codes are generated
  (`LUBA-<year>-<6 digits>`); launch immediately or on schedule.
- **Lifecycle controls**: open a scheduled campaign early, cancel any live
  campaign (all fees refund through the ledger, audited), force-settle a
  closed one. Rules are editable only while SCHEDULED — once open, rules
  freeze so bidders face a moving target (spec §29).
- Every campaign action writes an audit-log entry with the actor and reason.

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
