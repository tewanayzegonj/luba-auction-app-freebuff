import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Notification helper — spec §38.
 * In-app notification is inserted transactionally with the business event.
 * An outbox event is written for SMS/realtime consumers; delivery is
 * at-least-once, so consumers must dedupe by the outbox event id.
 */
export async function insertNotification(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    type:
      | "BID_ACCEPTED"
      | "AUCTION_ENDING"
      | "WINNER_ANNOUNCED"
      | "PAYMENT_REMINDER"
      | "PAYMENT_SUCCESS"
      | "PRIZE_STATUS"
      | "SYSTEM";
    title: string;
    body: string;
    auctionId?: Id<"auctions">;
    now: number;
  },
): Promise<void> {
  await ctx.db.insert("notifications", {
    userId: args.userId,
    type: args.type,
    title: args.title,
    body: args.body,
    auctionId: args.auctionId,
    read: false,
    createdAt: args.now,
  });

  await ctx.db.insert("outboxEvents", {
    eventType: "NOTIFICATION",
    payload: {
      userId: args.userId,
      channel: "SMS",
      type: args.type,
      title: args.title,
      body: args.body,
    },
    processed: false,
    createdAt: args.now,
  });
}

/** Audit log helper — spec §43 (append-only). */
export async function insertAuditLog(
  ctx: MutationCtx,
  args: {
    actor?: Id<"users">;
    action: string;
    resource: string;
    details?: string;
    now: number;
  },
): Promise<void> {
  await ctx.db.insert("auditLogs", {
    actor: args.actor,
    action: args.action,
    resource: args.resource,
    details: args.details,
    createdAt: args.now,
  });
}
