import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

// ─── Auction state machine (spec §9) ──────────────────────────────────────────
export const AUCTION_STATUSES = [
  "SCHEDULED",
  "OPEN",
  "CLOSING",
  "PAUSED",
  "CLOSED",
  "SETTLING",
  "COMPLETED",
  "CANCELLED",
] as const;
export const auctionStatusValidator = v.union(
  ...AUCTION_STATUSES.map((s) => v.literal(s)),
);
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

// ─── No-winner policies (spec §29) ──────────────────────────────────────────
export const NO_WINNER_POLICIES = ["CANCEL_AND_REFUND", "EXTEND", "ROLLOVER"] as const;
export const noWinnerPolicyValidator = v.union(
  ...NO_WINNER_POLICIES.map((p) => v.literal(p)),
);

export const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
      // LUBA fields
      phone: v.optional(v.string()),
      phoneVerificationTime: v.optional(v.number()),
      telegramChatId: v.optional(v.string()),
      kycStatus: v.optional(
        v.union(
          v.literal("UNVERIFIED"),
          v.literal("PENDING"),
          v.literal("VERIFIED"),
          v.literal("REJECTED"),
        ),
      ),
      kycNote: v.optional(v.string()),
      // Referrals (growth loop)
      referralCode: v.optional(v.string()), // unique, auto-generated
      referredBy: v.optional(v.id("users")),
      referredAt: v.optional(v.number()),
      // Responsible play (self-set caps; admins cannot raise them)
      selfDepositCapSantims: v.optional(v.number()),
      selfDepositCapPendingSince: v.optional(v.number()),
      selfExcludedUntil: v.optional(v.number()),
      status: v.optional(
        v.union(
          ...["ACTIVE", "SUSPENDED", "RESTRICTED", "LOCKED", "PENDING_VERIFICATION", "CLOSED"].map(
            (s) => v.literal(s),
          ),
        ),
      ),
    })
      .index("email", ["email"])
      .index("phone", ["phone"])
      .index("by_referral_code", ["referralCode"]),

    // ─── Prizes ────────────────────────────────────────────────────────────
    prizes: defineTable({
      title: v.string(),
      description: v.optional(v.string()),
      category: v.optional(v.string()),
      valueSantims: v.number(),
      imageUrl: v.optional(v.string()),
      imageStorageId: v.optional(v.id("_storage")), // Convex file storage
      emoji: v.optional(v.string()),
      stock: v.number(), // available units
      createdAt: v.number(),
    }).index("category", ["category"]),

    // ─── Auctions (spec §10) ───────────────────────────────────────────────
    auctions: defineTable({
      auctionCode: v.string(),
      title: v.string(),
      description: v.optional(v.string()),
      prizeId: v.id("prizes"),
      opensAt: v.number(),
      closesAt: v.number(),
      status: auctionStatusValidator,
      minBidSantims: v.number(), // lowest allowed bid value
      maxBidSantims: v.number(), // highest allowed bid value
      bidIncrementSantims: v.number(),
      bidServiceFeeSantims: v.number(),
      maximumBidsPerUser: v.number(), // per-user cap (spec §12)
      consecutiveBidPolicy: v.union(
        v.literal("NONE"),
        v.literal("THREE_THEN_BLOCK_TWO"),
        v.literal("CUSTOM"),
      ),
      noWinnerPolicy: noWinnerPolicyValidator, // frozen when OPEN (spec §29)
      winnerPaymentDeadline: v.number(), // ms after settlement
      visibilityPolicy: v.union(v.literal("PUBLIC"), v.literal("PRIVATE")),
      revenueTargetSantims: v.optional(v.number()), // admin tracking target
      publishBidHistory: v.optional(v.boolean()), // transparency toggle (spec §33); default false
      bidCount: v.number(), // denormalized counter, refreshed by throttled reconciler (Phase 6)
      uniqueBidCount: v.number(), // denormalized, for public display
      participantCount: v.optional(v.number()), // denormalized distinct bidders (spec §34 stats)
      viewCount: v.optional(v.number()), // denormalized page views (throttled client-side)
      countersUpdatedAt: v.optional(v.number()), // last reconciler refresh (staleness check)
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_code", ["auctionCode"])
      .index("by_status", ["status"])
      .index("by_status_opens", ["status", "opensAt"])
      .index("by_status_closes", ["status", "closesAt"])
      .index("by_prize", ["prizeId"]),

    // ─── Bids (spec §11, §14, §26) ─────────────────────────────────────────
    // append-only. bidValueSantims drives winner resolution. Never store floats.
    auctionBids: defineTable({
      auctionId: v.id("auctions"),
      userId: v.id("users"),
      bidValueSantims: v.number(), // the auction bid amount (spec §26)
      bidServiceFeeSantims: v.number(), // fee actually charged for this bid
      idempotencyKey: v.string(), // client-generated UUID (spec §17)
      acceptedAt: v.number(), // server time — never client time
      status: v.union(
        v.literal("ACCEPTED"),
        v.literal("REFUNDED"),
        v.literal("REMOVED"), // admin-moderated spam/rule-breaking
      ),
    })
      .index("by_auction_value", ["auctionId", "bidValueSantims"]) // winner resolution (spec §46)
      .index("by_auction_user", ["auctionId", "userId"])
      .index("by_user", ["userId", "acceptedAt"])
      .index("by_auction_user_idem", ["auctionId", "userId", "idempotencyKey"]) // idempotency (spec §17)
      .index("by_auction_accepted", ["auctionId", "acceptedAt"]),

    // ─── Auction result: exactly one per auction (Invariant 6) ─────────────
    auctionResults: defineTable({
      auctionId: v.id("auctions"), // UNIQUE — see by_auction index
      winnerUserId: v.optional(v.id("users")), // null if no unique bid
      winningBidValueSantims: v.optional(v.number()),
      winningBidId: v.optional(v.id("auctionBids")),
      totalBids: v.number(),
      resolvedAt: v.number(),
      resolution: v.union(v.literal("WINNER"), v.literal("NO_WINNER")),
      noWinnerPolicyApplied: v.optional(noWinnerPolicyValidator),
    }).index("by_auction", ["auctionId"]),

    // ─── Winner settlement: one per result (spec §32) ──────────────────────
    winnerSettlements: defineTable({
      auctionId: v.id("auctions"),
      resultId: v.id("auctionResults"),
      winnerUserId: v.id("users"),
      winningBidValueSantims: v.number(),
      paymentDeadline: v.number(),
      paidAt: v.optional(v.number()),
      status: v.union(
        v.literal("PENDING_PAYMENT"),
        v.literal("PAID"),
        v.literal("FULFILLED"),
        v.literal("FORFEITED"),
      ),
    })
      .index("by_result", ["resultId"])
      .index("by_status_deadline", ["status", "paymentDeadline"])
      .index("by_winner", ["winnerUserId"]),

    // ─── Wallets (spec §25): paid + promo, projection of ledger ────────────
    wallets: defineTable({
      userId: v.id("users"), // UNIQUE per user
      paidBalanceSantims: v.number(), // ledger projection — always ≥ 0 (Invariant 2)
      promoBalanceSantims: v.number(),
      totalDepositedSantims: v.number(),
      totalSpentSantims: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    // ─── Double-entry ledger (spec §19–21) ─────────────────────────────────
    // append-only. Invariant 1: Σ debits = Σ credits for every transaction.
    ledgerAccounts: defineTable({
      owner: v.optional(v.id("users")), // null = platform account
      code: v.string(), // chart-of-accounts code, e.g. USER_PAID:userId, PLATFORM_REVENUE
      name: v.string(),
      type: v.union(
        v.literal("ASSET"),
        v.literal("LIABILITY"),
        v.literal("EQUITY"),
        v.literal("REVENUE"),
        v.literal("EXPENSE"),
      ),
      balanceSantims: v.number(), // projection for fast reads; truth = entries
    })
      .index("by_code", ["code"]) // UNIQUE chart codes
      .index("by_owner", ["owner"]),

    ledgerTransactions: defineTable({
      txType: v.string(), // DEPOSIT | BID_FEE | WINNER_PAYMENT | REFUND | PRIZE_EXPENSE | PROMO_CREDIT
      reference: v.string(), // domain reference: bidId, paymentId, auctionId…
      description: v.string(),
      idempotencyKey: v.string(), // UNIQUE — one op can never be posted twice (Invariant 4)
      createdAt: v.number(),
    })
      .index("by_idempotency", ["idempotencyKey"])
      .index("by_type", ["txType"]), // admin finance filters / type aggregation (Phase 6)

    // append-only, never deleted or edited (spec §20)
    ledgerEntries: defineTable({
      transactionId: v.id("ledgerTransactions"),
      accountId: v.id("ledgerAccounts"),
      direction: v.union(v.literal("DEBIT"), v.literal("CREDIT")),
      amountSantims: v.number(), // always > 0
      userId: v.optional(v.id("users")), // denormalized owner for user-entry lookups (Phase 6)
      createdAt: v.number(),
    })
      .index("by_transaction", ["transactionId"])
      .index("by_account", ["accountId"])
      .index("by_user", ["userId"]), // user ledger history without table scans

    // ─── Payments (spec §22–24) ────────────────────────────────────────────
    payments: defineTable({
      userId: v.id("users"),
      amountSantims: v.number(),
      currency: v.literal("ETB"),
      kind: v.union(v.literal("DEPOSIT"), v.literal("WINNER_PAYMENT")),
      provider: v.string(), // "wallet" | "telebirr" | … provider adapter id
      providerReference: v.optional(v.string()), // UNIQUE with provider
      merchantReference: v.string(), // UNIQUE — our id for this payment
      status: v.union(
        v.literal("PENDING"),
        v.literal("COMPLETED"),
        v.literal("FAILED"),
        v.literal("REFUNDED"),
      ),
      completedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_merchant_ref", ["merchantReference"])
      .index("by_user", ["userId"])
      .index("by_provider_ref", ["provider", "providerReference"])
      .index("by_status", ["status"]),

    paymentEvents: defineTable({
      paymentId: v.id("payments"),
      providerEventId: v.string(), // UNIQUE — webhook idempotency (spec §24)
      eventType: v.string(),
      payload: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_event_id", ["providerEventId"]),

    refunds: defineTable({
      paymentId: v.id("payments"),
      userId: v.id("users"),
      amountSantims: v.number(),
      reason: v.string(),
      reference: v.string(), // bid id / settlement id
      createdAt: v.number(),
    }).index("by_payment", ["paymentId"]),

    // ─── Notifications (spec §38) ──────────────────────────────────────────
    notifications: defineTable({
      userId: v.id("users"),
      type: v.string(), // BID_ACCEPTED | AUCTION_ENDING | WINNER_ANNOUNCED | PAYMENT_REMINDER | PAYMENT_SUCCESS | PRIZE_STATUS
      title: v.string(),
      body: v.string(),
      auctionId: v.optional(v.id("auctions")),
      read: v.boolean(),
      createdAt: v.number(),
    }).index("by_user", ["userId", "createdAt"]).index("by_user_unread", ["userId", "read"]),

    // ─── Outbox (spec §18): transactional events, processed async ──────────
    outboxEvents: defineTable({
      eventType: v.string(), // BID_ACCEPTED | AUCTION_SETTLED | NOTIFICATION | PAYMENT_COMPLETED …
      payload: v.any(),
      processed: v.boolean(), // false → pending, true → consumed by workers
      processedAt: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_unprocessed", ["processed"]),

    // ─── Idempotency keys (spec §17): unique per scope ─────────────────────
    idempotencyKeys: defineTable({
      scope: v.string(), // e.g. "place_bid", "payment_webhook"
      userId: v.optional(v.id("users")),
      auctionId: v.optional(v.id("auctions")),
      key: v.string(),
      result: v.optional(v.any()), // stored first response, replayed on retry
      createdAt: v.number(),
    }).index("by_scope_key", ["scope", "key"]),

    // ─── Platform settings (admin-controlled feature flags) ───────────────
    // ─── Rate limiting (spec §40): per-window counters ────────────────────
    rateLimits: defineTable({
      scope: v.string(), // BID | TOPUP | OTP
      key: v.string(), // userId or `${userId}:${auctionId}`
      windowStart: v.number(),
      count: v.number(),
    }).index("by_scope_key", ["scope", "key"]),

    platformSettings: defineTable({
      key: v.string(), // e.g. NOTIFY_BID_ACCEPTED, NOTIFY_WINNER
      value: v.boolean(),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    // ─── Audit log (spec §43): append-only ─────────────────────────────────
    auditLogs: defineTable({
      actor: v.optional(v.id("users")), // null = system
      action: v.string(),
      resource: v.string(),
      details: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_resource", ["resource"]),

    // ─── Account linking (email ↔ Telegram ↔ phone) ───────────────────────
    // Short-lived HMAC capability token bound to a signed-in user + method.
    // Delivered through Telegram/SMS only (never rendered in the browser),
    // so the user proves channel ownership by clicking the link.
    linkCodes: defineTable({
      tokenHash: v.string(), // sha256 of the token — the token itself is never stored
      userId: v.id("users"),
      method: v.union(v.literal("telegram"), v.literal("phone")),
      destination: v.string(), // chat id or phone (2519xxxxxxxx)
      expiresAt: v.number(),
      consumedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_token", ["tokenHash"])
      .index("by_user_method", ["userId", "method"]),

    // ─── Referrals (growth loop) ────────────────────────────────────────────
    // Both sides receive promo credit when the referee's first bid fee posts.
    // State machine: PENDING → REWARDED (or EXPIRED if unrewarded).
    referrals: defineTable({
      referrerId: v.id("users"),
      refereeId: v.id("users"), // unique — a user can only be referred once
      code: v.string(), // the code the referee used
      status: v.union(v.literal("PENDING"), v.literal("REWARDED"), v.literal("EXPIRED")),
      rewardedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_referee", ["refereeId"])
      .index("by_referrer", ["referrerId", "status"])
      .index("by_code", ["code"]),

    // ─── Watchlist (ending-soon alerts) ────────────────────────────────────
    watchlist: defineTable({
      userId: v.id("users"),
      auctionId: v.id("auctions"), // unique per pair
      createdAt: v.number(),
    }).index("by_user", ["userId"]).index("by_auction", ["auctionId"]),

    // ─── Scheduled bids (queue for future execution) ───────────────────────
    scheduledBids: defineTable({
      userId: v.id("users"),
      auctionId: v.id("auctions"),
      bidValueSantims: v.number(),
      idempotencyKey: v.string(), // carried into placeBid at execution
      executeAt: v.number(),
      status: v.union(v.literal("QUEUED"), v.literal("EXECUTED"), v.literal("CANCELLED"), v.literal("FAILED")),
      failureReason: v.optional(v.string()),
      bidId: v.optional(v.id("auctionBids")),
      createdAt: v.number(),
    })
      .index("by_status_time", ["status", "executeAt"])
      .index("by_auction_status", ["auctionId", "status"]),

    // ─── Fraud signals (spec §39): heuristics feed admin review ────────────
    fraudSignals: defineTable({
      userId: v.optional(v.id("users")),
      signal: v.string(), // BID_VELOCITY | PAYMENT_FAILURES | MULTI_ACCOUNT_SUSPECT
      severity: v.union(v.literal("LOW"), v.literal("MEDIUM"), v.literal("HIGH")),
      details: v.optional(v.string()),
      reviewed: v.boolean(),
      createdAt: v.number(),
    })
      .index("by_reviewed", ["reviewed"])
      .index("by_user", ["userId"]),

    // ─── KYC documents (winner verification) ───────────────────────────────
    kycDocuments: defineTable({
      userId: v.id("users"),
      storageId: v.id("_storage"),
      fileName: v.string(),
      contentType: v.string(),
      sizeBytes: v.number(),
      status: v.union(v.literal("PENDING"), v.literal("APPROVED"), v.literal("REJECTED")),
      reviewedBy: v.optional(v.id("users")),
      reviewedAt: v.optional(v.number()),
      reviewNote: v.optional(v.string()),
      uploadedAt: v.number(),
    }).index("by_user", ["userId"]).index("by_status", ["status"]),

    // ─── Per-user notification preferences ──────────────────────────────────
    notificationPrefs: defineTable({
      userId: v.id("users"), // unique
      BID_ACCEPTED: v.optional(v.boolean()),
      AUCTION_ENDING: v.optional(v.boolean()),
      WINNER_ANNOUNCED: v.optional(v.boolean()),
      PAYMENT_REMINDER: v.optional(v.boolean()),
      PAYMENT_SUCCESS: v.optional(v.boolean()),
      PRIZE_STATUS: v.optional(v.boolean()),
      WATCHLIST_ALERT: v.optional(v.boolean()),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    // ─── Web push subscriptions (PWA) ──────────────────────────────────────
    pushSubscriptions: defineTable({
      userId: v.id("users"),
      endpoint: v.string(), // unique per browser
      p256dh: v.string(),
      auth: v.string(),
      userAgent: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_endpoint", ["endpoint"]).index("by_user", ["userId"]),

    // ─── Platform settings gains a text value channel (push keys, fees) ────
    // (platformSettings value:boolean is kept for existing flags)
    platformSettingsText: defineTable({
      key: v.string(), // e.g. PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY / REFERRAL_REWARD_SANTIMS
      value: v.string(),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
