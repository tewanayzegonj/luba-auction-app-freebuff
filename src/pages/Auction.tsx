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
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Activity,
  BadgeCheck,
  Ban,
  BarChart3,
  Send,
  Clock,
  Eye,
  Gavel,
  Users,
  Info,
  Loader2,
  Lock,
  ShieldCheck,
  Trophy,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

/** Compact view/bid counters: 3140 → "3.1K" (P3.8). */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

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
  const { t } = useLang();

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
  const toggleWatch = useMutation(api.engagement.toggleWatchlist);

  const watching = useQuery(
    api.engagement.isWatching,
    auction && isAuthenticated ? { auctionId: auction._id } : "skip",
  );
  const activity = useQuery(
    api.transparency.auctionActivity,
    auction ? { auctionCode: code } : "skip",
  );
  const history = useQuery(
    api.transparency.publishedBidHistory,
    auction ? { auctionCode: code } : "skip",
  );
  // Provably-fair per-bid breakdown (anti-fraud transparency).
  const fairResults = useQuery(
    api.winnerJourney.provablyFairResults,
    auction ? { auctionCode: code } : "skip",
  );

  const recordView = useMutation(api.auctions.recordAuctionView);

  // Record one view per session per auction (P3.8); presentation metric only.
  useEffect(() => {
    if (!auction) return;
    const key = `luba.viewed.${auction.auctionCode}`;
    try {
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
    } catch {
      // storage unavailable — still record, just unthrottled
    }
    void recordView({ code: auction.auctionCode }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction?.auctionCode]);

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [insufficientOpen, setInsufficientOpen] = useState(false);
  const [feeAcknowledged, setFeeAcknowledged] = useState(false);
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

  // P6.7: real-time outbid toast — when one of my accepted unique bids becomes
  // duplicated (someone else matched the value), fire a toast once per value.
  const outbidRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!isAuthenticated || myBids === undefined) return;
    for (const b of myBids) {
      if (b.status !== "ACCEPTED") continue;
      const count = uniqueMap.get(b.bidValueSantims);
      if (count !== undefined && count > 1 && !outbidRef.current.has(b.bidValueSantims)) {
        outbidRef.current.add(b.bidValueSantims);
        toast.warning(t("auction.notUnique"), {
          description: `${formatETB(b.bidValueSantims)} ETB is no longer unique — another bidder matched it.`,
        });
      }
    }
  }, [uniqueMap, myBids, isAuthenticated, t]);

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

  // Available funds: the server spends promo credit before paid balance, so
  // the client gate mirrors that exactly (server remains authoritative).
  const availableSantims =
    (wallet?.promoBalanceSantims ?? 0) + (wallet?.paidBalanceSantims ?? 0);
  const insufficientFunds =
    isAuthenticated && bidValueSantims !== null && availableSantims < fee;
  const insufficientDialog = { open: insufficientOpen, onOpenChange: setInsufficientOpen };

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
      toast.success(t("auction.bidPlaced"), {
        description: `${formatETB(bidValueSantims)} · ${auction.auctionCode}`,
      });
      setConfirmOpen(false);
      setAmountInput("");
      setTermsAccepted(false);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "UNKNOWN";
      const base = raw.split(":")[0].trim();
      toast.error(t("auction.notUnique"), {
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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pb-24 sm:px-6 md:pb-8">
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
              <div className="relative aspect-[16/10] bg-secondary/50">
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

                {/* P3.8: engagement indicators, industry-standard row */}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="size-3.5" />
                    {formatCount(auction.viewCount ?? 0)} {t("auction.views")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Gavel className="size-3.5" />
                    {formatCount(auction.bidCount)} {t("auction.bids")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" />
                    {formatCount(auction.participantCount ?? 0)}{" "}
                    {t("auction.participants")}
                  </span>
                </div>

                <Separator className="my-4" />

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="font-mono text-xl font-bold">
                      {auction.bidCount}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t("auction.totalBids")}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-xl font-bold text-primary">
                      {auction.uniqueBidCount}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t("auction.uniqueValues")}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-xl font-bold">
                      {bidsLeft}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t("auction.bidsLeft")}
                    </p>
                  </div>
                </div>
              </div>

            {/* Watchlist toggle */}
            {isAuthenticated && (
              <Button
                variant="outline"
                className={cn("w-full", watching && "border-primary/50 bg-primary/5")}
                disabled={togglePending}
                onClick={async () => {
                  setTogglePending(true);
                  try {
                    const res = await toggleWatch({ auctionId: auction._id });
                    toast.success(
                      res.watching
                        ? "Added to your watchlist — we'll alert you before it closes."
                        : "Removed from your watchlist.",
                    );
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed");
                  } finally {
                    setTogglePending(false);
                  }
                }}
              >
                {togglePending ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Eye className="mr-1.5 size-4" />
                )}
                {watching ? "Watching — alerts on" : "Watch this auction"}
              </Button>
            )}

            {/* Telegram viral share (zero-cost growth loop) */}
            <a
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#229ED9]/40 bg-[#229ED9]/10 text-sm font-medium text-[#229ED9] transition-colors hover:bg-[#229ED9]/20"
              target="_blank"
              rel="noreferrer"              href={`https://t.me/share/url?url=${encodeURIComponent(`${typeof window !== "undefined" ? window.location.href : ""}`)}&text=${encodeURIComponent(`🔥 ${auction.prize?.title ?? auction.title} is being auctioned on LUBA — lowest unique bid wins! Place your bid:`)}`}>
              <Send className="size-4" />
              Share to Telegram
            </a>

            {/* Live activity ticker (aggregates + anonymized recent bids) */}
            {activity && activity.recent.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-layered">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Activity className="size-4 text-primary" />
                  Live activity
                </h3>
                <div className="mt-3 space-y-1.5">
                  {activity.recent.slice(0, 5).map((r, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{r.who}</span>{" "}
                      placed a bid · {new Date(r.acceptedAt).toLocaleTimeString()}
                    </p>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {activity.uniqueBids} of {activity.totalBids} bids are currently
                  on unique values. Bid amounts stay hidden until close.
                </p>
              </div>
            )}

            {/* Published bid history (post-close transparency, spec §33) */}
            {history && history.published && (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-layered">
                <h3 className="flex items-center gap-2 font-semibold">
                  <BarChart3 className="size-4 text-primary" />
                  Full bid history — published
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every accepted bid from this auction, lowest first. The winning
                  value is highlighted — exactly how the result was determined.
                </p>
                <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
                  {history.map.map((row) => (
                    <div
                      key={row.valueSantims}
                      className={cn(
                        "flex items-center justify-between rounded-lg px-2.5 py-1.5 font-mono text-xs",
                        row.isWinning
                          ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/25"
                          : row.unique
                            ? "bg-primary/5 text-primary"
                            : "bg-secondary/50 text-secondary-foreground",
                      )}
                    >
                      <span>{formatETB(row.valueSantims)}</span>
                      <span className="text-[11px] opacity-70">
                        ×{row.count}{row.unique ? " · unique" : ""}
                        {row.isWinning ? " · WINNER" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Provably-fair per-bid breakdown — verifiable anti-fraud proof */}
            {fairResults && fairResults.published && (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-layered">
                <h3 className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="size-4 text-emerald-500" />
                  Provably fair — verify it yourself
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  All {fairResults.totalBids} accepted bids, anonymized, lowest
                  first. {fairResults.uniqueCount} landed on unique values. The
                  lowest unique value won — the math is right here.
                </p>
                <div className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-1">
                  {fairResults.rows.map((row) => (
                    <div
                      key={row.position}
                      className={cn(
                        "flex items-center justify-between rounded-lg px-2.5 py-1.5 font-mono text-xs",
                        row.isWinning
                          ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/25"
                          : row.unique
                            ? "bg-primary/5 text-primary"
                            : "bg-secondary/50 text-secondary-foreground",
                      )}
                    >
                      <span className="text-muted-foreground">{row.maskedBidder}</span>
                      <span>{formatETB(row.valueSantims)}</span>
                      <span
                        className={cn(
                          "text-[11px]",
                          row.isWinning
                            ? "font-semibold text-emerald-400"
                            : row.unique
                              ? "text-primary"
                              : "text-muted-foreground",
                        )}
                      >
                        {row.isWinning ? "★ WINNER" : row.unique ? "unique" : "duplicate"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                      </div>                      <Button
                        className="h-11 w-full"
                        disabled={
                          !amountInput ||
                          !!validationError ||
                          bidValueSantims === null ||
                          !termsAccepted ||
                          submitting
                        }
                        onClick={() => {
                          if (insufficientFunds) {
                            // Intercept before any confirmation: not enough
                            // funds for the service fee (P2.4).
                            setInsufficientOpen(true);
                            return;
                          }
                          setFeeAcknowledged(false); // require a fresh acknowledgment each bid
                          setConfirmOpen(true);
                        }}
                      >
                        {insufficientFunds ? (
                          <>
                            <Wallet className="mr-1.5 size-4" />
                            {t("auction.topUpToBid")}
                          </>
                        ) : (
                          <>
                            <Gavel className="mr-1.5 size-4" />
                            Review bid
                          </>
                        )}
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
            <DialogTitle>{t("auction.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("auction.confirmSubtitle")}
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
              {t("auction.termsNote")}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox
              checked={feeAcknowledged}
              onCheckedChange={(v) => setFeeAcknowledged(v === true)}
              disabled={submitting}
              className="mt-0.5"
            />
            <span className="leading-5 text-muted-foreground">
              {t("auction.termsAck")}
            </span>
          </label>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleConfirmBid}
              disabled={submitting || !feeAcknowledged}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  {t("auction.placing")}…
                </>
              ) : (
                <>
                  <Gavel className="mr-1.5 size-4" />
                  {t("common.confirm")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Insufficient balance intercept (P2.4) ───────────────────── */}
      <Dialog open={insufficientOpen} onOpenChange={setInsufficientOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="size-5 text-amber-400" />
              {t("auction.insufficientTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("auction.insufficientNeed").replace(
                "{fee}",
                formatETB(fee),
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-secondary/60 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("auction.insufficientAvailable")}
              </span>
              <span className="font-mono font-semibold">
                {formatETB(availableSantims)}
              </span>
            </div>
            <div className="mt-1.5 flex justify-between">
              <span className="text-muted-foreground">
                {t("auction.insufficientNeeded")}
              </span>
              <span className="font-mono font-semibold">{formatETB(fee)}</span>
            </div>
            {bidValueSantims !== null && (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {t("auction.insufficientNote").replace(
                  "{bid}",
                  formatETB(bidValueSantims),
                )}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setInsufficientOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                setInsufficientOpen(false);
                navigate("/dashboard?tab=wallet");
              }}
            >
              <Wallet className="mr-1.5 size-4" />
              {t("auction.topUpCta")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SiteFooter />

      {/* Mobile sticky bid bar: the primary action never leaves the thumb.
          Hidden on lg where the sticky side panel owns the CTA. */}
      {isOpen && (
        <div
          className="fixed inset-x-0 bottom-16 z-30 border-t border-border/70 bg-background/92 px-4 py-3 backdrop-blur-lg lg:hidden"
          style={{ paddingBottom: "calc(0.75rem * 0 + var(--safe-bottom))" }}
        >
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="min-w-0 flex-1">
              {bidValueSantims !== null && !validationError ? (
                <p className="truncate font-mono text-sm font-semibold">
                  {formatETB(bidValueSantims)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    + {formatETB(fee)} fee
                  </span>
                </p>
              ) : (
                <p className="truncate text-xs text-muted-foreground">
                  Enter your bid amount above
                </p>
              )}
            </div>
            {insufficientFunds ? (
              <Button className="h-10 shrink-0" onClick={() => setInsufficientOpen(true)}>
                <Wallet className="mr-1.5 size-4" />
                Top up
              </Button>
            ) : (
              <Button
                className="h-10 shrink-0"
                disabled={!amountInput || !!validationError || submitting}
                onClick={() => {
                  if (!isAuthenticated) {
                    navigate(`/auth?returnTo=/auction/${auction.auctionCode}`);
                    return;
                  }
                  if (!termsAccepted) {
                    // Scroll the full form into view so the user checks the
                    // fee box — keeps consent explicit on small screens.
                    document
                      .querySelector("#terms")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                    return;
                  }
                  setFeeAcknowledged(false);
                  setConfirmOpen(true);
                }}
              >
                <Gavel className="mr-1.5 size-4" />
                Review bid
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
