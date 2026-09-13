import {
  Countdown,
  PrizeVisual,
  SiteFooter,
  SiteHeader,
  StatusBadge,
} from "@/components/luba";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatETB, parseETBToSantims } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Clock,
  Gavel,
  Info,
  Loader2,
  Lock,
  ShieldCheck,
  Trophy,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

const FRIENDLY_ERRORS: Record<string, string> = {
  UNAUTHENTICATED: "Please sign in to place a bid.",
  USER_NOT_ELIGIBLE: "Your account is not eligible to bid. Contact support.",
  TERMS_NOT_ACCEPTED: "Please accept the auction terms first.",
  AUCTION_NOT_OPEN: "This auction is not open for bidding.",
  AUCTION_CLOSED: "This auction has closed.",
  BID_OUT_OF_RANGE: "Your bid is outside the allowed range.",
  BID_NOT_ON_INCREMENT: "Your bid must follow the allowed increments.",
  BID_LIMIT_REACHED: "You've used all your bids for this auction.",
  CONSECUTIVE_BID_BLOCKED:
    "That would create a run longer than allowed. Pick a different amount.",
  INSUFFICIENT_BALANCE:
    "Not enough wallet balance for the bid fee. Top up and try again.",
};

interface AuctionDetail {
  _id: Id<"auctions">;
  auctionCode: string;
  title: string;
  description?: string | null;
  status: string;
  opensAt: number;
  closesAt: number;
  minBidSantims: number;
  maxBidSantims: number;
  bidIncrementSantims: number;
  bidServiceFeeSantims: number;
  maximumBidsPerUser: number;
  consecutiveBidPolicy: string;
  noWinnerPolicy: string;
  bidCount: number;
  uniqueBidCount: number;
  prize: {
    title: string;
    description?: string | null;
    emoji?: string | null;
    imageUrl?: string | null;
    valueSantims: number;
    category?: string | null;
  } | null;
  result: {
    resolution: string;
    winningBidValueSantims?: number | null;
    winnerUserId?: Id<"users"> | null;
  } | null;
}

export default function AuctionPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  // Bid form state (declared early — feeds the uniqueness query below)
  const [amountInput, setAmountInput] = useState("");
  const typedSantims = amountInput ? parseETBToSantims(amountInput) : null;

  const auction = useQuery(api.auctions.getAuctionByCode, { code });

  // My accepted bid values in this auction (for uniqueness checks below).
  const myBids = useQuery(
    api.auctions.getMyBidsForAuction,
    auction && isAuthenticated ? { auctionId: auction._id } : "skip",
  );
  const myAcceptedValues = (myBids ?? [])
    .filter((b) => b.status === "ACCEPTED")
    .map((b) => b.bidValueSantims);

  // Uniqueness counts only for my values + the value being typed (spec §33).
  const uniqueness = useQuery(
    api.auctions.getUniquenessForValues,
    auction && isAuthenticated
      ? {
          auctionId: auction._id,
          values: Array.from(
            new Set(
              [
                ...myAcceptedValues,
                ...(typedSantims !== null ? [typedSantims] : []),
              ].slice(0, 25),
            ),
          ),
        }
      : "skip",
  );
  const wallet = useQuery(
    api.payments.getMyWallet,
    isAuthenticated ? {} : "skip",
  );

  const placeBid = useMutation(api.auctions.placeBid);

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const bidValueSantims = typedSantims;

  const myAcceptedCount = (myBids ?? []).filter(
    (b) => b.status === "ACCEPTED",
  ).length;
  const bidsLeft = auction
    ? Math.max(0, auction.maximumBidsPerUser - myAcceptedCount)
    : 0;

  const uniqueMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const u of uniqueness ?? []) m.set(u.valueSantims, u.count);
    return m;
  }, [uniqueness, myBids]);

  const taken =
    auction && bidValueSantims !== null
      ? (uniqueMap.get(bidValueSantims) ?? 0)
      : null;

  const validationError = useMemo(() => {
    if (!auction) return null;
    if (!amountInput) return null;
    if (bidValueSantims === null) return "Enter a valid amount, e.g. 2.50";
    if (bidValueSantims < auction.minBidSantims) return "Below minimum bid.";
    if (bidValueSantims > auction.maxBidSantims) return "Above maximum bid.";
    if (
      auction.bidIncrementSantims > 0 &&
      (bidValueSantims - auction.minBidSantims) % auction.bidIncrementSantims !== 0
    ) {
      return "Not on an allowed increment.";
    }
    if (bidsLeft === 0) return "You've used all your bids for this auction.";
    return null;
  }, [auction, amountInput, bidValueSantims, bidsLeft]);

  if (auction === undefined) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (auction === null) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <Gavel className="size-8 text-muted-foreground/50" />
          <h1 className="text-xl font-semibold">Auction not found</h1>
          <p className="text-sm text-muted-foreground">
            This auction doesn't exist or has been removed.
          </p>
          <Button variant="outline" asChild>
            <Link to="/#auctions">Back to live auctions</Link>
          </Button>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const isOpen = auction.status === "OPEN" || auction.status === "CLOSING";
  const fee = auction.bidServiceFeeSantims;

  const handleConfirmBid = async () => {
    if (bidValueSantims === null || !auction) return;
    setSubmitting(true);
    try {
      // Client generates the idempotency key (spec §17).
      const idempotencyKey = crypto.randomUUID();
      await placeBid({
        auctionId: auction._id,
        bidValueSantims,
        idempotencyKey,
        acceptedTerms: true,
      });
      toast.success("Bid placed", {
        description: `${formatETB(bidValueSantims)} submitted to ${auction.auctionCode}.`,
      });
      setConfirmOpen(false);
      setAmountInput("");
      setTermsAccepted(false);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "UNKNOWN";
      const base = raw.split(":")[0].trim();
      toast.error("Bid not accepted", {
        description:
          FRIENDLY_ERRORS[base] ?? "Something went wrong. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Button
          variant="ghost"
          className="-ml-2 mb-4 gap-1.5 text-muted-foreground"
          onClick={() => navigate("/#auctions")}
        >
          <ArrowLeft className="size-4" />
          All auctions
        </Button>

        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          {/* ─── Prize panel ──────────────────────────────────────────────── */}
          <div className="space-y-6">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-layered">
              <div className="relative aspect-[16/10]">
                <PrizeVisual
                  emoji={auction.prize?.emoji}
                  imageUrl={auction.prize?.imageUrl}
                  seed={auction.auctionCode}
                />
                <div className="absolute left-4 top-4 flex gap-2">
                  <StatusBadge status={auction.status} />
                </div>
                <span className="absolute right-4 top-4 rounded-full bg-background/85 px-3 py-1 font-mono text-xs font-medium backdrop-blur">
                  {auction.auctionCode}
                </span>
              </div>
              <div className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-bold tracking-tight md:text-2xl">
                      {auction.prize?.title ?? auction.title}
                    </h1>
                    {auction.prize?.description && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {auction.prize.description}
                      </p>
                    )}
                  </div>
                  {auction.prize && (
                    <div className="text-right">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Prize value
                      </p>
                      <p className="font-mono text-lg font-bold">
                        {formatETB(auction.prize.valueSantims)}
                      </p>
                    </div>
                  )}
                </div>

                <Separator className="my-4" />

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="font-mono text-xl font-bold">
                      {auction.bidCount}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Total bids
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-xl font-bold text-primary">
                      {auction.uniqueBidCount}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Unique values
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-xl font-bold">
                      {bidsLeft}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Your bids left
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Result banner for completed auctions */}
            {auction.result && (
              <div
                className={cn(
                  "rounded-2xl border p-5 shadow-layered",
                  auction.result.resolution === "WINNER"
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-card",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {auction.result.resolution === "WINNER" ? (
                      <Trophy className="size-5" />
                    ) : (
                      <Ban className="size-5" />
                    )}
                  </span>
                  <div>
                    <h3 className="font-semibold">
                      {auction.result.resolution === "WINNER"
                        ? "Auction completed — winning bid"
                        : "Auction completed — no unique bid"}
                    </h3>
                    {auction.result.resolution === "WINNER" &&
                    auction.result.winningBidValueSantims != null ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        The lowest unique bid was{" "}
                        <span className="font-mono font-semibold text-foreground">
                          {formatETB(auction.result.winningBidValueSantims)}
                        </span>
                        . The winner has been notified.
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        No bid value was unique, so the auction's no-winner
                        policy (
                        {auction.noWinnerPolicy === "CANCEL_AND_REFUND"
                          ? "cancel and refund"
                          : auction.noWinnerPolicy.toLowerCase()}
                        ) was applied.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Rules card (spec §36) */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-layered">                    <h3 className="flex items-center gap-2 font-semibold">
                      <Info className="size-4 text-primary" />
                      Auction rules
                    </h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center justify-between gap-4">
                  <span>Bid range</span>
                  <span className="font-mono text-foreground">
                    {formatETB(auction.minBidSantims)} – {formatETB(auction.maxBidSantims)}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span>Increment</span>
                  <span className="font-mono text-foreground">
                    {formatETB(auction.bidIncrementSantims)}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span>Bid service fee</span>
                  <span className="font-mono text-foreground">
                    {formatETB(fee)} per bid
                  </span>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span>Max bids per person</span>
                  <span className="font-mono text-foreground">
                    {auction.maximumBidsPerUser}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span>Consecutive bids</span>
                  <span className="text-foreground">
                    {auction.consecutiveBidPolicy === "THREE_THEN_BLOCK_TWO"
                      ? "Max 3 in a row"
                      : "Unrestricted"}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span>If nobody wins</span>
                  <span className="text-foreground">
                    {auction.noWinnerPolicy === "CANCEL_AND_REFUND"
                      ? "Fees refunded"
                      : auction.noWinnerPolicy === "EXTEND"
                        ? "Auction extends"
                        : "Rollover"}
                  </span>
                </li>
              </ul>
              <Separator className="my-4" />
              <div className="flex items-start gap-2.5 text-xs leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <p>
                  By bidding you accept Luba's Terms &amp; Conditions. The bid
                  amount is only charged if you win. All times and results are
                  determined by Luba's servers. 18+ only.
                </p>
              </div>
            </div>
          </div>

          {/* ─── Bid panel ────────────────────────────────────────────────── */}
          <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-layered-lg">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Time remaining</h3>
                <Clock className="size-4 text-muted-foreground" />
              </div>
              <Countdown to={auction.closesAt} className="mt-3" />

              <Separator className="my-5" />

              {isOpen ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="bid-amount" className="text-sm">
                      Your bid amount
                    </Label>
                    <div className="relative">
                      <Input
                        id="bid-amount"
                        inputMode="decimal"
                        placeholder="e.g. 2.00"
                        value={amountInput}
                        onChange={(e) => setAmountInput(e.target.value)}
                        className="h-12 pr-16 font-mono text-lg"
                        disabled={!isAuthenticated || bidsLeft === 0}
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                        ETB
                      </span>
                    </div>
                    {bidValueSantims !== null && !validationError && (
                      <p
                        className={cn(
                          "text-xs",
                          taken
                            ? "text-amber-400"
                            : "text-emerald-400",
                        )}
                      >
                        {taken
                          ? `${taken} other ${taken === 1 ? "bid" : "bids"} already at this amount — you'd need to stay unique.`
                          : "Not bid yet — currently would be unique!"}
                      </p>
                    )}
                    {validationError && (
                      <p className="text-xs text-destructive">
                        {validationError}
                      </p>
                    )}
                  </div>

                  {isAuthenticated ? (
                    <div className="flex items-center justify-between rounded-xl bg-secondary/70 px-3.5 py-2.5 text-sm">
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Wallet className="size-4" /> Wallet
                      </span>
                      <span className="font-mono font-semibold">
                        {formatETB(wallet?.paidBalanceSantims ?? 0)}
                      </span>
                    </div>
                  ) : null}

                  {!isAuthenticated ? (
                    <Button className="h-11 w-full" asChild>
                      <Link to={`/auth?returnTo=/auction/${auction.auctionCode}`}>
                        <Lock className="mr-1.5 size-4" />
                        Sign in to bid
                      </Link>
                    </Button>
                  ) : (
                    <>
                      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-background/60 p-3">
                        <Checkbox
                          id="terms"
                          checked={termsAccepted}
                          onCheckedChange={(v) => setTermsAccepted(v === true)}
                          disabled={!amountInput || !!validationError}
                        />
                        <label
                          htmlFor="terms"
                          className="text-xs leading-5 text-muted-foreground"
                        >
                          I confirm the bid fee of{" "}
                          <span className="font-semibold text-foreground">
                            {formatETB(fee)}
                          </span>{" "}
                          will be charged now, I've read the bid rules, and I
                          accept the Terms &amp; Conditions.
                        </label>
                      </div>
                      <Button
                        className="h-11 w-full"
                        disabled={
                          !amountInput ||
                          !!validationError ||
                          bidValueSantims === null ||
                          !termsAccepted ||
                          submitting
                        }
                        onClick={() => setConfirmOpen(true)}
                      >
                        <Gavel className="mr-1.5 size-4" />
                        Review bid
                      </Button>
                      {bidsLeft === 0 && (
                        <p className="text-center text-xs text-muted-foreground">
                          Bid limit reached for this auction.
                        </p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="rounded-xl bg-secondary/70 p-4 text-center text-sm text-muted-foreground">
                  {auction.status === "SCHEDULED"
                    ? `Bidding opens ${new Date(auction.opensAt).toLocaleString()}`
                    : "Bidding has closed for this auction."}
                </div>
              )}
            </div>

            {/* My bids in this auction */}
            {isAuthenticated && myBids && myBids.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-layered">
                <h3 className="flex items-center gap-2 font-semibold">
                  <BadgeCheck className="size-4 text-primary" />
                  Your bids here
                  <Badge variant="secondary" className="ml-1">
                    {myAcceptedCount}
                  </Badge>
                </h3>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {myBids.slice(0, 24).map((b) => (
                    <span
                      key={b._id}
                      className={cn(
                        "rounded-md px-2 py-1 font-mono text-xs",
                        b.status === "ACCEPTED"
                          ? (uniqueMap.get(b.bidValueSantims) ?? 0) === 1
                            ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/25"
                            : "bg-secondary text-secondary-foreground ring-1 ring-inset ring-foreground/5"
                          : "bg-rose-500/10 text-rose-300 line-through",
                      )}
                    >
                      {formatETB(b.bidValueSantims)}
                    </span>
                  ))}
                </div>
                <p className="mt-2.5 text-xs text-muted-foreground">
                  Green = currently unique. Amounts stay hidden from other
                  bidders.
                </p>
              </div>
            )}

            {/* Per-value popularity is intentionally NOT shown to other
                bidders during the auction (spec §33: limited public info).
                Bidders see only aggregate counts and their own bids above. */}
          </div>
        </div>
      </main>

      {/* ─── Confirmation dialog (spec §36) ─────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm your bid</DialogTitle>
            <DialogDescription>
              One last check before it's locked in.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 rounded-xl border border-border bg-secondary/50 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Auction</span>
              <span className="font-medium">{auction.auctionCode}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bid value</span>
              <span className="font-mono font-semibold">
                {bidValueSantims !== null ? formatETB(bidValueSantims) : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Service fee (charged now)
              </span>
              <span className="font-mono font-semibold">{formatETB(fee)}</span>
            </div>
            <Separator />
            <p className="text-xs leading-5 text-muted-foreground">
              The bid amount itself is only charged if you win. Bids cannot be
              cancelled or refunded once accepted. The lowest unique bid wins.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmBid} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Placing bid…
                </>
              ) : (
                <>
                  <Gavel className="mr-1.5 size-4" />
                  Confirm bid
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SiteFooter />
    </div>
  );
}
