import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Server-side schedulers (spec §18, §30).
 * tickLifecycle drives the auction state machine and deterministic
 * settlement; processOutbox fans out notifications (Telegram/SMS/in-app
 * channels) to linked destinations. Both are idempotent and safe to overlap.
 */
const crons = cronJobs();

crons.interval("auction lifecycle", { minutes: 5 }, internal.lifecycle.tickLifecycle);

crons.interval(
  "outbox delivery",
  { minutes: 5 }, // Phase 6: sub-minute notification fan-out latency
  internal.lifecycle.processOutbox,
  { max: 100 },
);

// Phase 6: refresh stale display counters (bidCount / uniqueBidCount /
// participantCount) for live auctions. Presentation-only — the reconciler
// never touches financial state.
crons.interval(
  "display counters sweeper",
  { minutes: 5 },
  internal.auctions.sweepStaleCounters,
);

crons.interval(
  "ending-soon alerts",
  { minutes: 5 },
  internal.engagement.processEndingSoon,
);

crons.interval(
  "scheduled bid execution",
  { minutes: 5 },
  internal.engagement.processScheduledBids,
);

crons.interval(
  "payment deadline chaser",
  { minutes: 30 },
  internal.engagement.chasePaymentDeadlines,
);

crons.interval(
  "ledger reconciliation",
  { minutes: 15 },
  internal.engagement.reconcileInternal,
);

// Phase 6 §6.4: auto-bidder plans — randomized bid execution through the
// shared attemptBid engine. Short interval keeps plan latency low while
// per-tick randomized values avoid telegraphing a pattern.
crons.interval(
  "auto-bid executor",
  { minutes: 5 },
  internal.accountOps.processAutoBids,
);

export default crons;
