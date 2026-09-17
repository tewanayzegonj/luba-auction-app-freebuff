import { PrizeVisual, SiteFooter, SiteHeader } from "@/components/luba";
import { Button } from "@/components/ui/button";
import { formatETB } from "@/lib/money";
import { maskName } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Link } from "react-router";

interface WinnerRow {
  resultId: string;
  auctionCode: string;
  prizeTitle: string;
  prizeImageUrl?: string | null;
  prizeEmoji?: string | null;
  winnerName: string | null;
  winningBidValueSantims: number;
  bidCount: number;
  resolvedAt?: number;
}

const dayFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

export default function Winners() {
  const winners = (useQuery(api.auctions.recentWinners, {}) ?? []) as WinnerRow[];

  // Derived figures, computed from the settlement rows themselves - no
  // invented totals, everything on this page traces to a settled auction.
  const totalBids = winners.reduce((n, w) => n + w.bidCount, 0);
  const lowestWin =
    winners.length > 0
      ? Math.min(...winners.map((w) => w.winningBidValueSantims))
      : 0;

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 md:py-14">
        {/* Editorial header: left-aligned, no icon chip, no pill. The page
            is a financial record, so it opens like one. */}
        <header className="max-w-2xl">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Public ledger
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
            Settlement record
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base">
            Every auction ends the same honest way: the lowest amount that
            exactly one person picked wins. Each row below is a completed
            settlement. Open any auction to inspect its full bid frequency
            table and check the math yourself.
          </p>
        </header>

        {winners.length === 0 ? (
          <div className="mt-12 max-w-md rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
            <h2 className="font-semibold">No settled auctions yet</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The first settlements will appear here the moment auctions close.
            </p>
            <Button className="mt-5" asChild>
              <Link to="/#auctions">Browse open auctions</Link>
            </Button>
          </div>
        ) : (
          <>
            {/* Stat strip: three derived figures under a hairline. Numbers,
                not decoration - each one is computable from the rows below. */}
            <dl className="mt-10 grid grid-cols-3 divide-x divide-border border-y border-border py-5">
              {[
                { label: "Auctions settled", value: String(winners.length) },
                { label: "Bids recorded", value: totalBids.toLocaleString() },
                {
                  label: "Lowest winning bid",
                  value: formatETB(lowestWin),
                },
              ].map((s) => (
                <div key={s.label} className="px-4 first:pl-0 last:pr-0">
                  <dd className="text-xl font-bold tabular-nums tracking-tight md:text-2xl">
                    {s.value}
                  </dd>
                  <dt className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </dt>
                </div>
              ))}
            </dl>

            {/* Ledger column heads: desktop only. Mono micro-labels, aligned
                to the same grid the rows use. */}
            <div className="mt-8 hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_120px_72px_96px] items-center gap-4 border-b border-border pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:grid">
              <span>Prize</span>
              <span>Winner</span>
              <span className="text-right">Winning bid</span>
              <span className="text-right">Bids</span>
              <span className="text-right">Result</span>
            </div>

            {/* The ledger: full-width rows. Winning amounts carry the only
                accent color; every other cell stays neutral. Tabular numerals
                so amounts align vertically down the column. */}
            <ul className="divide-y divide-border">
              {winners.map((w) => (
                <li key={w.resultId}>
                  <Link
                    to={`/auction/${w.auctionCode}`}
                    className="group grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4 py-4 transition-colors hover:bg-secondary/40 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_120px_72px_96px] md:gap-4 md:py-3.5"
                  >
                    {/* Mobile figure slot (hidden on desktop where the
                        columns take over). */}
                    <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-secondary/60 md:hidden">
                      <PrizeVisual
                        emoji={w.prizeEmoji}
                        imageUrl={w.prizeImageUrl}
                        seed={w.auctionCode}
                      />
                    </div>

                    <div className="hidden min-w-0 items-center gap-3 md:flex">
                      <div className="size-10 shrink-0 overflow-hidden rounded-md bg-secondary/60">
                        <PrizeVisual
                          emoji={w.prizeEmoji}
                          imageUrl={w.prizeImageUrl}
                          seed={w.auctionCode}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold group-hover:text-primary">
                          {w.prizeTitle}
                        </p>
                        <p className="truncate font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                          {w.auctionCode}
                        </p>
                      </div>
                    </div>

                    {/* Mobile: title + code stacked in the middle column. */}
                    <div className="min-w-0 md:hidden">
                      <p className="truncate text-sm font-semibold group-hover:text-primary">
                        {w.prizeTitle}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {w.winnerName ? maskName(w.winnerName) : "Unclaimed"}
                        <span className="mx-1.5 text-border">|</span>
                        <span className="font-mono uppercase tracking-wider">
                          {w.auctionCode}
                        </span>
                      </p>
                    </div>

                    <span className="hidden truncate text-sm text-foreground/90 md:block">
                      {w.winnerName ? maskName(w.winnerName) : "Unclaimed"}
                    </span>

                    <span className="text-right md:text-right">
                      <span className="whitespace-nowrap text-sm font-bold tabular-nums text-primary md:text-[15px]">
                        {formatETB(w.winningBidValueSantims)}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground md:hidden">
                        winning bid
                      </span>
                    </span>

                    <span className="hidden text-right text-sm tabular-nums text-muted-foreground md:block">
                      {w.bidCount}
                    </span>

                    <span className="hidden text-right md:block">
                      {/* The mobile middle column already shows the date
                          inline; desktop gets the date in the Result slot. */}
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {w.resolvedAt ? dayFmt.format(w.resolvedAt) : "Settled"}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                        Verify
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <p className="mt-6 text-xs leading-5 text-muted-foreground">
              Settlements are computed by the auction engine from the complete
              bid record. Winners' names are partially masked; full identity is
              verified privately at prize handover.
            </p>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
