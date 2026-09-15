import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatETB, parseETBToSantims } from "@/lib/money";

const WITHDRAW_PRESETS = [25_00, 50_00, 100_00, 250_00];

type Method = "TELEBIRR" | "CBE_BIRR" | "BANK";

export function WithdrawCard({ balanceSantims }: { balanceSantims: number }) {
  const request = useMutation(api.accountOps.requestWithdrawal);
  const cancel = useMutation(api.accountOps.cancelMyWithdrawal);
  const withdrawals = useQuery(api.accountOps.getMyWithdrawals, {});
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("TELEBIRR");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);

  const santims = parseETBToSantims(amount);
  const canSubmit =
    !busy &&
    santims !== null &&
    santims >= 2_500 &&
    santims <= balanceSantims &&
    destination.trim().length >= 6;

  const submit = async () => {
    if (!canSubmit || santims === null) return;
    setBusy(true);
    try {
      await request({
        amountSantims: santims,
        method,
        destination: destination.trim(),
      });
      toast.success("Withdrawal requested", {
        description:
          "We'll review it and update you here and by notification.",
      });
      setAmount("");
      setDestination("");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message.replace(/^Uncaught Error: /, "")
          : "Request failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Amount (ETB)</Label>
          <Input
            inputMode="decimal"
            placeholder="min 25.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-10 font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Payout method</Label>
          <Select
            value={method}
            onValueChange={(v) => setMethod(v as Method)}
          >
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TELEBIRR">telebirr</SelectItem>
              <SelectItem value="CBE_BIRR">CBE Birr</SelectItem>
              <SelectItem value="BANK">Bank transfer</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          {method === "BANK" ? "Bank account number" : "Payout phone (09xx…)"}
        </Label>
        <Input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder={
            method === "BANK" ? "e.g. 1000123456789" : "e.g. 0911223344"
          }
          className="h-10 font-mono"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {WITHDRAW_PRESETS.map((p) => (
          <Button
            key={p}
            variant="outline"
            size="sm"
            disabled={busy || p > balanceSantims}
            onClick={() => setAmount((p / 100).toFixed(2))}
          >
            {formatETB(p)}
          </Button>
        ))}
      </div>

      <Button
        className="h-11 w-full"
        disabled={!canSubmit}
        onClick={() => void submit()}
      >
        {busy ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" />
        ) : (
          <Banknote className="mr-1.5 size-4" />
        )}
        Request withdrawal
      </Button>

      <p className="text-xs leading-5 text-muted-foreground">
        Minimum 25 ETB · one pending request at a time · reviewed within one
        business day. Rejected requests return the funds to your wallet
        automatically.
      </p>

      {withdrawals && withdrawals.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your withdrawal requests
          </p>
          {withdrawals.slice(0, 6).map((w) => (
            <div
              key={w._id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
            >
              <span className="font-mono font-medium">
                {formatETB(w.amountSantims)}
              </span>
              <span className="text-xs text-muted-foreground">
                {w.method.toLowerCase()} · {w.destination}
              </span>
              {w.status === "PENDING" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await cancel({ withdrawalId: w._id as Id<"withdrawals"> });
                      toast.success(
                        "Withdrawal cancelled — funds returned to wallet",
                      );
                    } catch {
                      toast.error("Could not cancel");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Cancel
                </Button>
              ) : (
                <Badge
                  variant="outline"
                  className={cn(
                    "font-mono text-[10px] uppercase",
                    w.status === "PAID" && "text-emerald-500",
                    w.status === "REJECTED" && "text-rose-500",
                    w.status === "CANCELLED" && "text-muted-foreground",
                  )}
                >
                  {w.status}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
