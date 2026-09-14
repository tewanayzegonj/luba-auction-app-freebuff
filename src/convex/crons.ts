import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Server-side schedulers (spec §18, §30).
 * tickLifecycle drives the auction state machine and deterministic
 * settlement; processOutbox fans out notifications (Telegram/SMS/in-app
 * channels) to linked destinations. Both are idempotent and safe to overlap.
 */
const crons = cronJobs();

crons.interval("auction lifecycle", { minutes: 1 }, internal.lifecycle.tickLifecycle);

crons.interval(
  "outbox delivery",
  { minutes: 1 },
  internal.lifecycle.processOutbox,
  { max: 50 },
);

crons.interval(
  "ending-soon alerts",
  { minutes: 5 },
  internal.engagement.processEndingSoon,
);

crons.interval(
  "scheduled bid execution",
  { minutes: 1 },
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

export default crons;
