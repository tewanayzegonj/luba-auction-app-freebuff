"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { sendSms, sendTelegramMessage } from "./auth/senders";

/**
 * Bilingual Telegram titles - natural Amharic first, English second.
 * SMS stays English-only (cost per character).
 */
const TG_TITLES: Record<string, string> = {
  BID_ACCEPTED: "✅ ጨረታዎ ተቀብለናል · Bid confirmed",
  AUCTION_ENDING: "⏰ ጨረታው እያለቀ ነው · Ending soon",
  WINNER_ANNOUNCED: "🎉 እንኳን ደስ አለዎት አሸናፊ! · You won!",
  PAYMENT_REMINDER: "💳 የክፍያ አስታዋሽ · Payment reminder",
  PAYMENT_SUCCESS: "✅ ክፍያው በተሳካ ሁኔታ ተጠናቋል · Payment successful",
  PRIZE_STATUS: "📦 የሽልማት ሁኔታ · Prize status",
  SYSTEM: "📣 ሉባ · Luba",
};

/** Native Amharic lead-in shown above the English detail body. */
const TG_LEADINS: Record<string, string> = {
  BID_ACCEPTED: "ጨረታዎ ገብቷል - ዝርዝሩ ከታች፦",
  AUCTION_ENDING: "ጨረታው እየተጠናቀቀ ነው - ልዩ ዋጋዎን ያስገቡ።",
  WINNER_ANNOUNCED: "እንኳን አሸነፉ! የክፍያ ዝርዝር ከታች ይገኛል።",
  PAYMENT_REMINDER: "እባክዎ የሽንፍታ ክፍያዎን በጊዜው ይክፈሉ።",
  PAYMENT_SUCCESS: "የዋሌት ሒሳብዎ ተሟልቷል።",
  PRIZE_STATUS: "የሽልማትዎ ሁኔታ ተዘምኗል።",
  SYSTEM: "",
};

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
          const leadin = TG_LEADINS[event.type] ?? "";
          const tgText = leadin
            ? `${TG_TITLES[event.type] ?? event.title}\n\n${leadin}\n\n${event.body}`
            : `${TG_TITLES[event.type] ?? event.title}\n\n${event.body}`;
          await sendTelegramMessage(user.telegramChatId, tgText);
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
