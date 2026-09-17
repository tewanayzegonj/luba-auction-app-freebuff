import {
  Countdown,
  PrizeVisual,
  SiteFooter,
  SiteHeader,
} from "@/components/luba";
import { PageFade } from "@/components/motion-primitives";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { formatETB } from "@/lib/money";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { ShieldCheck, Trophy } from "lucide-react";
import { Link } from "react-router";

/** First-name + last-initial masking (matches landing/dashboard masking). */
function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return `${parts[0].slice(0, 2)}***`;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

interface WinnerRow {
  resultId: string;
  auctionCode: string;
  prizeTitle: string;
  prizeImageUrl?: string | null;
  prizeEmoji?: string | null;
  winnerName: string | null;
  winningBidValueSantims: number;
  bidCount: number;
  settledAt?: number;
}

export default function Winners() {
  const { isAuthenticated } = useAuth();
  // recentWinners powers the landing strip; on this page we render more rows.
  const winners = (useQuery(api.auctions.recentWinners, {}) ?? []) as WinnerRow[];

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 md:py-14">
        <PageFade>
        <div className="mx-auto max-w-2xl text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-amber-400/15 text-amber-700 dark:text-amber-400">
            <Trophy className="size-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight md:text-3xl">
            Winners
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">
            Every auction ends the same honest way: the lowest amount that
            exactly one person picked wins. Open any auction to see every bid
            and check the math yourself.
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="size-3.5" />
            Provably fair - no manual picks, ever
          </div>
        </div>

        {winners.length === 0 ? (
          <div className="mx-auto mt-10 max-w-md rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
            <Trophy className="mx-auto size-8 text-muted-foreground/50" />
            <h2 className="mt-3 font-semibold">No settled auctions yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The first winners will appear here the moment auctions close.
            </p>
            <Button className="mt-5" asChild>
              <Link to="/#auctions">Browse open auctions</Link>
            </Button>
          </div>
        ) : (
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {winners.map((w) => (
              <Link
                key={w.resultId}
                to={`/auction/${w.auctionCode}`}
                className="group flex overflow-hidden rounded-xl border border-border bg-card shadow-layered transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-layered-lg active:translate-y-0 sm:flex-col"
              >
                <div className="size-20 shrink-0 sm:aspect-[4/3] sm:size-auto sm:w-full sm:self-stretch">
                  <PrizeVisual
                    emoji={w.prizeEmoji}
                    imageUrl={w.prizeImageUrl}
                    seed={w.auctionCode}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col p-3.5">
                  <h3 className="line-clamp-2 text-sm font-semibold leading-snug group-hover:text-primary">
                    {w.prizeTitle}
                  </h3>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {w.winnerName ? `${maskName(w.winnerName)} won with ` : "Won with "}
                    <span className="font-semibold text-primary tabular-nums">
                      {formatETB(w.winningBidValueSantims)}
                    </span>
                  </p>
                  <p className="mt-auto pt-2 text-[11px] text-muted-foreground">
                    {w.bidCount} bids · verify the result ↗
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
        </PageFade>
      </main>

      <SiteFooter />
    </div>
  );
}
