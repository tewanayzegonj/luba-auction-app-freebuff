"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { sendSms, sendTelegramMessage } from "./auth/senders";

/**
 * Outbox delivery worker (spec §18, §37, §38).
 *
 * `processOutbox` (mutation) hands NOTIFICATION events to this action, which
 * performs the network sends: Telegram for linked accounts, SMS where the
 * gateway is enabled. Delivery is best-effort and idempotent per event:
 * each event is marked processed exactly once, and a channel is skipped if
 * the user has no destination for it.
 */
export const deliverNotifications = internalAction({
  args: {
    events: v.array(
      v.object({
        eventId: v.id("outboxEvents"),
        userId: v.id("users"),
        type: v.string(),
        title: v.string(),
        body: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const results = { sent: 0, skipped: 0, failed: 0 };

    for (const event of args.events) {
      // Preference gate: skip channels the user turned off for this type.
      const wants = await ctx.runQuery(internal.engagement.userWantsTypeInternal, {
        userId: event.userId,
        type: event.type,
      });
      if (!wants) {
        results.skipped++;
        continue;
      }
      const channels = await ctx.runQuery(
        internal.accountLinks.getUserChannelsInternal,
        { userId: event.userId },
      );
      if (channels === null) {
        results.skipped++;
        continue;
      }
      const user = {
        telegramChatId: channels.telegramChatId ?? undefined,
        phone: channels.phone ?? undefined,
        phoneVerificationTime: channels.phoneVerificationTime ?? undefined,
      };

      const text = `${event.title}\n\n${event.body}`;
      let delivered = false;

      // Telegram first (free, instant), then SMS as a channel where enabled.
      if (user.telegramChatId) {
        try {
          await sendTelegramMessage(user.telegramChatId, text);
          delivered = true;
        } catch (err) {
          console.warn("[outbox] telegram send failed", event.eventId, err);
        }
      }
      if (!delivered && user.phone && user.phoneVerificationTime !== undefined) {
        try {
          await sendSms(user.phone, text);
          delivered = true;
        } catch (err) {
          console.warn("[outbox] sms send failed", event.eventId, err);
        }
      }

      if (delivered) results.sent++;
      else results.skipped++;
    }

    return results;
  },
});
