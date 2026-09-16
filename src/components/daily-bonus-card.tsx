import { useMutation, useQuery } from "convex/react";
import { CalendarCheck, Gift, Loader2, PartyPopper } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { formatETB } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Daily check-in bonus card — one promo-credit claim per Addis day with a
 * growing streak (5 ETB day 1 → +2.5 ETB per consecutive day, 30 ETB cap).
 * Promo credit pays bid fees only — the same instrument as referral rewards.
 */
export function DailyBonusCard() {
  const status = useQuery(api.dailyBonus.getDailyBonusStatus, {});
  const claim = useMutation(api.dailyBonus.claimDailyBonus);

  if (status === undefined) return null;
  // Signed-out users have nothing to claim — the card simply doesn't render.
  if (status === null) return null;

  const doClaim = async () => {
    try {
      const res = await claim({});
      if (res.claimed) {
        toast.success("Bonus claimed! 🎁", {
          description: `${formatETB(res.rewardSantims)} promo credit added — day ${res.streak} of your streak.`,
        });
      }
      // ALREADY_CLAIMED_TODAY: state will reflect it via the live query.
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message.replace(/^Uncaught Error: /, "")
          : "Could not claim the bonus.",
      );
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Gift className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Daily bonus — come back every day</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {status.claimedToday
              ? `Claimed today. Your streak: ${status.streak} ${status.streak === 1 ? "day" : "days"}. Next reward tomorrow.`
              : status.streak > 0
                ? `Claim now for ${formatETB(status.nextRewardSantims)} — extends your ${status.streak}-day streak!`
                : `Claim now for ${formatETB(status.nextRewardSantims)} promo credit. Streaks grow the reward — up to ${formatETB(status.capSantims)}.`}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        className={cn(
          "h-10 shrink-0 gap-2",
          status.claimedToday && "pointer-events-none opacity-50",
        )}
        disabled={status.claimedToday}
        onClick={doClaim}
      >
        {status.claimedToday ? (
          <>
            <CalendarCheck className="size-4" />
            Claimed today
          </>
        ) : (
          <>
            <PartyPopper className="size-4" />
            Claim {formatETB(status.nextRewardSantims)}
          </>
        )}
      </Button>
    </div>
  );
}
