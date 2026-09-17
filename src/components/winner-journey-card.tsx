import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  BadgeCheck,
  Banknote,
  Copy,
  FileCheck2,
  Loader2,
  MapPin,
  PackageCheck,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { formatETB } from "@/lib/money";

type Settlement = Doc<"winnerSettlements">;

/**
 * Winner journey (4 steps): Won → ID Verification → Payment → Delivery.
 * Shows the claim code, gates payment behind KYC, collects pickup/delivery
 * details, and tracks fulfillment to the handover.
 */
export function WinnerJourneyCard({ settlement }: { settlement: Settlement }) {
  const claimAndPay = useMutation(api.winnerJourney.claimAndPay);
  const [method, setMethod] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  const step =
    settlement.status === "PENDING_PAYMENT"
      ? 2
      : settlement.status === "PAID"
        ? 4
        : settlement.status === "FULFILLED"
          ? 5 // all done
          : 1;

  const paid = settlement.status !== "PENDING_PAYMENT";

  const steps = [
    { icon: Trophy, label: "Won", done: true },
    { icon: FileCheck2, label: "ID Verification", done: step > 2 },
    { icon: Banknote, label: "Payment", done: step > 3 },
    { icon: PackageCheck, label: "Delivery / Pickup", done: step > 4 },
  ];

  const submit = async () => {
    setBusy(true);
    try {
      await claimAndPay({
        settlementId: settlement._id,
        deliveryMethod: method,
        deliveryPhone: method === "DELIVERY" ? phone.trim() : undefined,
        deliveryAddress: method === "DELIVERY" ? address.trim() : undefined,
      });
      toast.success("Claim submitted - you're all set!", {
        description:
          method === "DELIVERY"
            ? "We'll deliver to your address shortly."
            : "Show your claim code and ID at pickup.",
      });
    } catch (err) {
      toast.error("Claim failed", { description: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-card p-4">
      {/* Stepper */}
      <div className="flex items-center gap-1.5">
        {steps.map((s, i) => (
          <div key={s.label} className="flex flex-1 items-center gap-1.5">
            <div
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                s.done
                  ? "bg-emerald-500 text-white"
                  : i + 1 === step
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              {s.done ? <BadgeCheck className="size-4" /> : i + 1}
            </div>
            <span
              className={cn(
                "hidden text-[11px] font-medium sm:block",
                s.done || i + 1 === step ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "h-px flex-1",
                  s.done ? "bg-emerald-500/50" : "bg-border",
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-sm font-semibold">
              Winning bid {formatETB(settlement.winningBidValueSantims)}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              Pay before {new Date(settlement.paymentDeadline).toLocaleString()}
            </p>
          </div>
          {settlement.claimCode && (
            <button
              type="button"
              className="group flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1.5"
              onClick={() => {
                void navigator.clipboard.writeText(settlement.claimCode!);
                toast.success("Claim code copied");
              }}
            >
              <span className="font-mono text-sm font-bold tracking-widest text-primary">
                {settlement.claimCode}
              </span>
              <Copy className="size-3.5 text-muted-foreground group-hover:text-foreground" />
            </button>
          )}
        </div>

        {!paid ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMethod("PICKUP")}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors",
                  method === "PICKUP"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-secondary/40",
                )}
              >
                <MapPin className="size-4 text-primary" />
                <span>
                  <span className="block font-medium">Pickup</span>
                  <span className="block text-xs text-muted-foreground">
                    Collect in person
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMethod("DELIVERY")}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors",
                  method === "DELIVERY"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-secondary/40",
                )}
              >
                <PackageCheck className="size-4 text-primary" />
                <span>
                  <span className="block font-medium">Delivery</span>
                  <span className="block text-xs text-muted-foreground">
                    We bring it to you
                  </span>
                </span>
              </button>
            </div>

            {method === "DELIVERY" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Phone</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="09xx xxx xxx"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Address</Label>
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Sub-city, woreda, landmark…"
                    className="h-9"
                  />
                </div>
              </div>
            )}

            <Button
              className="h-11 w-full"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Banknote className="mr-1.5 size-4" />
              )}
              Verify identity &amp; pay {formatETB(settlement.winningBidValueSantims)}
            </Button>
            <p className="text-[11px] leading-4 text-muted-foreground">
              Identity verification (KYC) is required before payment - upload
              your ID in Profile → Verification if you haven't yet.
            </p>
          </>
        ) : (
          <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2.5">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              {settlement.status === "FULFILLED"
                ? "Prize handed over - enjoy! 🎉"
                : settlement.deliveryMethod === "DELIVERY"
                  ? "Paid - on the way to your address"
                  : "Paid - show your claim code + ID at pickup"}
            </p>
            <Badge
              variant="outline"
              className="border-emerald-500/40 font-mono text-[10px] uppercase text-emerald-700 dark:text-emerald-400"
            >
              {settlement.status}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}

export type { Id };
