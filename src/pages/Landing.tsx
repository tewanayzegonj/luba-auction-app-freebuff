import {
  AuctionCard,
  Countdown,
  PrizeVisual,
  SiteFooter,
  SiteHeader,
} from "@/components/luba";
import { BidFrequencyDemo } from "@/components/bid-frequency-demo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useAuth } from "@/hooks/use-auth";
import { formatETB } from "@/lib/money";
import { maskName } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { ArrowRight, Search, Trophy, TrendingDown } from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

/** Unified section header: one scale across the whole page (the old page
 *  drifted text-xl/2xl/3xl per section, which reads as weak hierarchy).
 *  Editorial pattern: headline + one sub-line stacked vertically - never a
 *  split header (left headline + right floating paragraph is a banned tell). */
function SectionHead({
  title,
  sub,
  align = "left",
}: {
  title: string;
  sub?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn(align === "center" && "text-center")}>
      <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
      {sub && (
        <p
          className={cn(
            "mt-1 text-sm text-muted-foreground md:text-base",
            align === "center" && "mx-auto max-w-xl",
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const { t } = useLang();
  // Favorites hearts: one reactive subscription for the signed-in user's
  // watchlist; the mutation fires optimistically per tap.
  const watchlist = useQuery(
    api.engagement.listWatchlist,
    isAuthenticated ? {} : "skip",
  );
  const toggleWatch = useMutation(api.engagement.toggleWatchlist);
  const watchingIds = new Set(
    (watchlist ?? []).map((w: { auctionId: string }) => w.auctionId),
  );
  const auctions = useQuery(api.auctions.listOpenAuctions, {}) ?? [];
  const openAuctions = auctions.filter(
    (a) => a.status === "OPEN" || a.status === "CLOSING",
  );
  const liveAuctions = openAuctions.slice(0, 6);
  const endingSoon = [...openAuctions]
    .sort((a, b) => a.closesAt - b.closesAt)
    .slice(0, 3);

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      {/* - Hero ---------------------------------------------------------------- */
      /*  Stack discipline (taste-skill §4.7): exactly 4 text elements -
          eyebrow, 3-line headline, one-line subtext, CTAs. No trust strip,
          no tagline, no feature bullets inside the hero. Left-aligned,
          split layout with the product's own game rule as the visual. */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.62_0.11_195/0.12),transparent_70%)]"
        />
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 pb-14 pt-10 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:gap-10 md:pb-24 md:pt-20">
          <div>
            <Badge
              variant="outline"
              className="mb-4 gap-1.5 border-primary/25 bg-primary/5 px-3 py-1 text-xs tabular-nums text-primary md:mb-5"
            >
              <TrendingDown className="size-3.5" />
              Lowest unique bid wins
            </Badge>
            {/* 36px on phones (3 tight lines), 60px from md up. */}
            <h1 className="text-balance text-3xl font-bold leading-[1.12] tracking-tight sm:text-4xl sm:leading-[1.08] md:text-6xl">
              {t("hero.title.line1")}
              <br />
              {t("hero.title.line2")}
              <br />
              <span className="text-primary">{t("hero.title.line3")}</span>
            </h1>
            <p className="mt-4 max-w-md text-pretty text-[15px] leading-6 text-muted-foreground md:mt-5 md:text-lg md:leading-7">
              {t("hero.subtitle")}
            </p>
            {/* Full-width stacked CTAs on phones - thumb-sized targets. */}
            <div className="mt-6 grid gap-2.5 sm:mt-8 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
              <Button size="lg" className="h-12 px-6 sm:h-11 sm:flex-1 sm:px-6" asChild>
                <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
                  {isAuthenticated ? t("hero.ctaSignedIn") : t("hero.cta")}
                  <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 px-6 sm:h-11 sm:flex-1 sm:px-6"
                asChild
              >
                {/* App scroll engine, not a raw anchor: native jumps are
                    instant and jar; the glide lands with the header offset. */}
                <a
                  href="#how-it-works"
                  onClick={(e) => {
                    const el =
                      document.querySelector<HTMLElement>("#how-it-works");
                    if (el) {
                      e.preventDefault();
                      import("@/lib/scroll").then(({ smoothScrollTo }) =>
                        smoothScrollTo(el),
                      );
                    }
                  }}
                >
                  {t("hero.ctaSecondary")}
                </a>
              </Button>
            </div>
          </div>

          {/* Hero mechanic - THE RULE, PLAYED. A self-running demonstration
              of bid frequency (the product's ownable moment). No fake prize
              name, no price, no countdown: nothing that could be mistaken
              for a live listing by a new visitor (trust rule). */}
          <div className="relative mx-auto w-full max-w-sm">
            <BidFrequencyDemo />
          </div>
        </div>
      </section>

      {/* - Live auctions ------------------------------------------------------ */}
      <section id="auctions" className="scroll-mt-20 py-14 md:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHead
              title="Open auctions"
              sub="Each closes on server time. Place your bid before the countdown reaches zero."
            />
            {isAuthenticated && (
              <Button variant="outline" asChild>
                <Link to="/dashboard">My bids</Link>
              </Button>
            )}
          </div>

          {auctions === undefined ? (
            /* Skeleton mirrors the real layout: full-width rows on phones,
               the 3-col grid from lg. */
            <div className="mt-6 flex flex-col gap-3 sm:mt-8 lg:grid lg:grid-cols-3 lg:gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-xl border border-border bg-card sm:h-64"
                />
              ))}
            </div>
          ) : liveAuctions.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center sm:p-12">
              <Search className="mx-auto size-8 text-muted-foreground/60" />
              <h3 className="mt-3 font-semibold">No live auctions right now</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                New auctions are announced here the moment they open. Check back
                soon.
              </p>
            </div>
          ) : (
            /* Phones: single-column full-width row cards; sm+: 2-up media-top
               cards; lg: the 3-col grid. */
            <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:grid sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
              {liveAuctions.map((a) => (
                <AuctionCard
                  key={a._id}
                  auction={a}
                  watching={isAuthenticated ? watchingIds.has(a._id) : undefined}
                  onToggleWatch={
                    isAuthenticated
                      ? (auctionId) => {
                          void toggleWatch({ auctionId }).then((r) => {
                            toast.success(
                              r.watching
                                ? "Added to your watchlist - we'll alert you before it closes."
                                : "Removed from your watchlist.",
                            );
                          });
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* - The mechanics (editorial spec-sheet strip, not cards) -------------- */}
      {/*  Layout family #2. Big muted figures, hairline dividers, no icon
          chips. The winning step is the single accent-colored moment. */}
      <section id="how-it-works" className="scroll-mt-20 py-14 md:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHead
            align="center"
            title="The mechanics"
            sub="Four steps between you and the prize. No luck, no hidden rules - just game theory."
          />
          <div className="mt-10 flex flex-col divide-y divide-border md:grid md:grid-cols-4 md:gap-0 md:divide-x md:divide-y-0">
            {[
              {
                title: "Top up",
                body: "Add funds to your wallet once - then bid without friction.",
              },
              {
                title: "Choose an amount",
                body: "Pick any value in the auction's range - say, 2.00 ETB - and keep it to yourself.",
              },
              {
                title: "Pay the service fee",
                body: "Each bid costs a small fixed fee. The bid value itself is charged only if you win.",
              },
              {
                title: "Lowest unique wins",
                body: "When the clock expires, the lowest amount submitted exactly once takes the prize.",
              },
            ].map((s, i) => (
              <div
                key={s.title}
                className="flex gap-5 py-6 md:block md:px-6 md:py-2 md:first:pl-0 md:last:pr-0"
              >
                <span
                  className={cn(
                    "font-display w-12 shrink-0 text-2xl font-semibold tabular-nums md:w-auto",
                    i === 3 ? "text-primary" : "text-foreground/25",
                  )}
                >
                  0{i + 1}
                </span>
                <div>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* The catch - set as editorial text with a hairline, not a card.
              A bordered box around one paragraph is the card-as-grouping
              anti-pattern: whitespace is the structural tool. */}
          <div className="mx-auto mt-10 max-w-2xl border-t border-border pt-6 text-center">
            <p className="text-sm leading-6 text-foreground/90">
              <span className="font-semibold">The catch:</span> everyone pays
              the same fee, but nobody sees anyone else's amounts. The lowest
              value that exactly one person chose wins - so the winning move is
              to be precise, not aggressive.
            </p>
          </div>
        </div>
      </section>

      {/* - Settlement record (ledger table, not cards) ------------------------- */}
      {/*  Layout family #3. Winners are financial records: a settlement
          ledger reads true to the product; winner cards read as a template.
          Names masked (privacy) via the shared maskName rule. */}
      <section className="border-y border-border/70 bg-card/40 py-12 md:py-16">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHead
            title="Settlement record"
            sub="Every closed auction resolves deterministically and is published here - permanently and independently verifiable."
          />
          <RecentWinners />
        </div>
      </section>

      {/* - FAQ ----------------------------------------------------------------- */}
      <section id="faq" className="scroll-mt-20 py-14 md:py-20">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <SectionHead
            align="center"
            title="Questions, answered precisely"
          />
          <Accordion type="single" collapsible className="mt-8">
            <AccordionItem value="q1">
              <AccordionTrigger>What exactly is a "unique bid"?</AccordionTrigger>
              <AccordionContent>
                A bid amount that only one participant submitted. If 1.00 ETB was
                placed by two people and 2.00 ETB by exactly one, then 2.00 ETB is
                the lowest unique bid - and 2.00 ETB wins, even though 1.00 ETB is
                lower.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q2">
              <AccordionTrigger>What do I pay when I place a bid?</AccordionTrigger>
              <AccordionContent>
                Only the fixed service fee for that auction. The amount you bid
                is not charged up front - if you win, you pay your bid amount
                (plus applicable taxes and fees) to claim the prize.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q3">
              <AccordionTrigger>How is the winner decided?</AccordionTrigger>
              <AccordionContent>
                Automatically and deterministically. When the auction closes, the
                engine selects the lowest accepted amount that exactly one
                participant submitted. The same set of bids always produces the
                same winner - no manual picks, no randomness, no exceptions.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q4">
              <AccordionTrigger>
                Can I place more than one bid?
              </AccordionTrigger>
              <AccordionContent>
                Yes - each auction shows the maximum bids per participant
                (typically up to 100). Each bid pays its own service fee.
                Back-to-back amounts may be limited by the auction's
                consecutive-bid rule.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q5">
              <AccordionTrigger>What if nobody wins?</AccordionTrigger>
              <AccordionContent>
                If no bid value is unique, the auction's published no-winner
                policy applies - for example, all bid service fees are refunded
                and the auction is cancelled. The policy is locked in before the
                auction opens.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q6">
              <AccordionTrigger>Is the platform fair?</AccordionTrigger>
              <AccordionContent>
                By construction. Every accepted bid is treated identically, all
                timing is server-controlled, results are deterministic, and every
                fee moves through a double-entry ledger that balances to the
                santim.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      {/* - Closing soon (countdown rows, a third distinct layout family) ------- */}
      {/*  NOT a card grid - the winners grid below already uses cards' slot.
          Full-width rows with the countdown as the dominant figure: urgency
          is the content, so urgency owns the layout. */}
      {endingSoon.length > 0 && (
        <section className="py-14 md:py-16">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <SectionHead
              title="Closing soon"
              sub="Final minutes decide everything. One unique amount changes the outcome."
            />
            <div className="mt-8 divide-y divide-border border-y border-border">
              {endingSoon.map((a) => (
                <Link
                  key={a._id}
                  to={`/auction/${a.auctionCode}`}
                  className="group flex items-center gap-4 py-4 transition-colors hover:bg-secondary/40"
                >
                  <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-secondary/60">
                    <PrizeVisual
                      emoji={a.prize?.emoji}
                      imageUrl={a.prize?.imageUrl}
                      seed={a.auctionCode}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold group-hover:text-primary">
                      {a.prize?.title ?? a.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      Fee {formatETB(a.bidServiceFeeSantims)} · {a.bidCount} bids
                    </p>
                  </div>
                  {/* Countdown as the row's dominant figure. */}
                  <div className="shrink-0 text-right">
                    <Countdown to={a.closesAt} compact />
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* - Final CTA (the page's one loud moment) ------------------------------ */}
      {/*  CTA intent is "start bidding" here; the hero's is "create account" -
          one label per intent (no duplicates). Elevated card panel lit by
          the brand's cyan rim-glow, one cyan signal: the button. */}
      <section className="px-4 pb-16 sm:px-6 md:pb-24">
        <div className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-primary/25 bg-card shadow-layered-lg">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_120%_at_50%_-10%,oklch(0.62_0.11_195/0.16),transparent_60%)]"
          />
          <div className="relative flex flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between sm:gap-10 sm:px-10 sm:py-12">
            <div className="max-w-lg">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Place your first unique bid
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
                Create an account, top up your wallet, and pick an amount nobody
                else will think of. It takes about two minutes.
              </p>
            </div>
            <div className="shrink-0">
              <Button
                size="lg"
                className="h-12 w-full px-7 sm:h-11 sm:w-auto"
                asChild
              >
                <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
                  {isAuthenticated ? t("hero.ctaSignedIn") : t("hero.cta")}
                  <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/** Settlement ledger rows - full-width records, not winner cards. */
function RecentWinners() {
  const winners = useQuery(api.auctions.recentWinners, {}) ?? [];

  // No settled auctions yet - an honest empty state only. No fake winner
  // rows: invented names/prizes read as phantom listings to new visitors.
  if (winners.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-border bg-card/60 p-6 text-center">
        <Trophy className="mx-auto size-8 text-muted-foreground/50" />
        <h3 className="mt-3 font-semibold">No settled auctions yet</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Once the first auctions close, every winning bid is recorded here
          and stays public - permanently verifiable.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 divide-y divide-border border-y border-border">
      {winners.slice(0, 6).map((w) => (
        <Link
          key={w.resultId}
          to={`/auction/${w.auctionCode}`}
          className="group flex items-center gap-4 py-4 transition-colors hover:bg-secondary/40"
        >
          <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-secondary/60">
            <PrizeVisual
              emoji={w.prizeEmoji}
              imageUrl={w.prizeImageUrl}
              seed={w.auctionCode}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold group-hover:text-primary">
              {w.prizeTitle}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {w.winnerName ? `${maskName(w.winnerName)} won with ` : "Won with "}
              <span className="font-semibold tabular-nums text-primary">
                {formatETB(w.winningBidValueSantims)}
              </span>
            </p>
          </div>
          <div className="shrink-0 text-right text-[11px] text-muted-foreground">
            <p className="font-mono uppercase tracking-wider">{w.auctionCode}</p>
            <p className="mt-0.5">{w.bidCount} bids</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
