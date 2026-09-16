import {
  AuctionCard,
  Countdown,
  PrizeVisual,
  SiteFooter,
  SiteHeader,
} from "@/components/luba";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useAuth } from "@/hooks/use-auth";
import { formatETB, formatSantims } from "@/lib/money";
import { useLang } from "@/lib/i18n";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Gavel,
  HandCoins,
  Lock,
  MousePointerClick,
  Search,
  ShieldCheck,
  Smartphone,
  Trophy,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { Link } from "react-router";

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
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      {/* ─── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.62_0.11_195/0.12),transparent_70%)]"
        />
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 pb-14 pt-10 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:gap-10 md:pb-24 md:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
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
            {/* Full-width stacked CTAs on phones — thumb-sized targets. */}
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
                <a href="#how-it-works">{t("hero.ctaSecondary")}</a>
              </Button>
            </div>
            <div className="mt-6 flex flex-col gap-2 text-xs uppercase tracking-wider text-muted-foreground sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-primary" /> Deterministic
                settlement
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-4 text-primary" /> Private bid amounts
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BadgeCheck className="size-4 text-primary" /> Auditable ledger
              </span>
            </div>
          </motion.div>

          {/* Hero mechanic card — a pure illustration of the RULE. No fake
              prize name, no price, no countdown: nothing that could be
              mistaken for a live listing by a new visitor (trust rule).
              Real listings appear in the Open auctions section below. */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="relative mx-auto w-full max-w-sm"
          >
            <div className="relative rounded-2xl border border-border bg-card p-5 shadow-layered-lg">
              <div className="flex items-center justify-between">
                <Badge className="border-transparent bg-secondary text-secondary-foreground ring-1 ring-inset ring-foreground/10">
                  How winning works
                </Badge>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                Four bids come in. The lowest amount chosen by{' '}
                <span className="font-medium text-foreground">exactly one person</span>{' '}
                wins — not simply the lowest number.
              </p>
              <div className="mt-4 space-y-1.5">
                {[
                  { v: "1.00", n: 2, state: "dup" },
                  { v: "2.00", n: 1, state: "win" },
                  { v: "3.00", n: 2, state: "dup" },
                  { v: "4.00", n: 1, state: "uniq" },
                ].map((b) => (
                  <div
                    key={b.v}
                    className={
                      b.state === "win"
                        ? "flex items-center justify-between rounded-lg bg-primary px-3 py-2 text-xs font-semibold tabular-nums text-primary-foreground"
                        : b.state === "uniq"
                          ? "flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium tabular-nums text-primary ring-1 ring-inset ring-primary/25"
                          : "flex items-center justify-between rounded-lg bg-secondary/60 px-3 py-2 text-xs tabular-nums text-muted-foreground"
                    }
                  >
                    <span>{b.v} ETB</span>
                    <span className="text-[10px] font-medium uppercase tracking-wider">
                      {b.state === "win"
                        ? "★ Winner — lowest & unique"
                        : b.state === "uniq"
                          ? "Unique, but not lowest"
                          : `×${b.n} — not unique`}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-start gap-2 border-t border-border/70 pt-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <p className="text-xs leading-5 text-muted-foreground">
                  After close, every auction publishes its full bid math —
                  you can verify each result yourself.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Live auctions ────────────────────────────────────────────────── */}
      <section id="auctions" className="scroll-mt-20 py-14 md:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                Open auctions
              </h2>
              <p className="mt-1 text-sm text-muted-foreground md:text-base">
                Each closes on server time. Place your bid before the countdown
                reaches zero.
              </p>
            </div>
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
              ))
              }
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
            /* Phones: single-column full-width row cards — thumb-sized
               targets, no 160px cramping. sm+: proper 2-up media-top cards,
               lg: the 3-col grid. */
            <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:grid sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
              {liveAuctions.map((a) => (
                <AuctionCard
                  key={a._id}
                  auction={a}
                  watching={isAuthenticated ? watchingIds.has(a._id) : undefined}
                  onToggleWatch={
                    isAuthenticated
                      ? (auctionId, next) => {
                          void toggleWatch({ auctionId }).then((r) => {
                            toast.success(
                              r.watching
                                ? "Added to your watchlist — we'll alert you before it closes."
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

      {/* ─── Ending soon ──────────────────────────────────────────────────── */}
      {endingSoon.length > 0 && (
      <section className="border-y border-border/70 bg-card/40 py-12">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">
            Closing soon
          </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {endingSoon.map((a) => (
                <Link
                  key={a._id}
                  to={`/auction/${a.auctionCode}`}
                  className="group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3 shadow-layered transition-all hover:-translate-y-0.5 hover:shadow-layered-lg sm:p-3.5"
                >
                  <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-secondary/60">
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
                      Fee {formatETB(a.bidServiceFeeSantims)} ·{" "}
                      {a.bidCount} bids
                    </p>
                    <div className="mt-1.5">
                      <Countdown to={a.closesAt} compact />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── How it works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-20 py-14 md:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
              The mechanics
            </h2>
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              Four steps between you and the prize. No luck, no hidden
              rules — just game theory.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-4">
            {[
              {
                icon: Wallet,
                title: "Top up",
                body: "Add funds to your wallet once — then bid without friction.",
              },
              {
                icon: MousePointerClick,
                title: "Choose an amount",
                body: "Pick any value in the auction's range — say, 2.00 ETB — and keep it to yourself.",
              },
              {
                icon: Gavel,
                title: "Pay the service fee",
                body: "Each bid costs a small fixed fee. The bid value itself is charged only if you win.",
              },
              {
                icon: Trophy,
                title: "Lowest unique wins",
                body: "When the clock expires, the lowest amount submitted exactly once takes the prize.",
              },
            ].map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: i * 0.07 }}
                className="relative rounded-xl border border-border bg-card p-5 shadow-layered"
              >
                <span className="absolute right-4 top-4 font-mono text-xs text-muted-foreground/60">
                  0{i + 1}
                </span>
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </div>
                <h3 className="mt-3.5 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {s.body}
                </p>
              </motion.div>
            ))}
          </div>

          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
            <p className="text-sm leading-6 text-foreground/90">
              <span className="font-semibold">The catch:</span> everyone pays
              the same fee, but nobody sees anyone else's amounts. The lowest
              value that exactly one person chose wins — so the winning move is
              to be precise, not aggressive.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Winners (social proof + settlement record, consolidated) ────── */}
      <section className="border-y border-border/70 bg-card/50 py-12">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">
            Winners & settlement record
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every closed auction resolves deterministically and is published
            here — permanently and independently verifiable.
          </p>
          <RecentWinners />
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-20 py-14 md:py-20">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">
            Questions, answered precisely
          </h2>
          <Accordion type="single" collapsible className="mt-8">
            <AccordionItem value="q1">
              <AccordionTrigger>What exactly is a “unique bid”?</AccordionTrigger>
              <AccordionContent>
                A bid amount that only one participant submitted. If 1.00 ETB was
                placed by two people and 2.00 ETB by exactly one, then 2.00 ETB is
                the lowest unique bid — and 2.00 ETB wins, even though 1.00 ETB is
                lower.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q2">
              <AccordionTrigger>What do I pay when I place a bid?</AccordionTrigger>
              <AccordionContent>
                Only the fixed service fee for that auction. The amount you bid
                is not charged up front — if you win, you pay your bid amount
                (plus applicable taxes and fees) to claim the prize.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q3">
              <AccordionTrigger>How is the winner decided?</AccordionTrigger>
              <AccordionContent>
                Automatically and deterministically. When the auction closes, the
                engine selects the lowest accepted amount that exactly one
                participant submitted. The same set of bids always produces the
                same winner — no manual picks, no randomness, no exceptions.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q4">
              <AccordionTrigger>
                Can I place more than one bid?
              </AccordionTrigger>
              <AccordionContent>
                Yes — each auction shows the maximum bids per participant
                (typically up to 100). Each bid pays its own service fee. Back-to-back
                amounts may be limited by the auction’s consecutive-bid rule.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q5">
              <AccordionTrigger>What if nobody wins?</AccordionTrigger>
              <AccordionContent>
                If no bid value is unique, the auction’s published no-winner policy
                applies — for example, all bid service fees are refunded and the
                auction is cancelled. The policy is locked in before the auction
                opens.
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

      {/* ─── CTA ──────────────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 sm:px-6 md:pb-24">
        <div className="mx-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-card shadow-layered-lg">
          <div className="relative bg-[radial-gradient(80%_120%_at_50%_-10%,oklch(0.62_0.11_195/0.18),transparent_60%)] px-6 py-14 text-center">
            <HandCoins className="mx-auto size-10 text-primary" />
            <h2 className="mt-4 text-2xl font-bold tracking-tight md:text-3xl">
              Place your first unique bid
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground md:text-base">
              Create an account, top up your wallet, and pick an amount nobody
              else will think of. It takes about two minutes.
            </p>
            <Button size="lg" className="mt-6 h-11 px-7" asChild>
              <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
                {isAuthenticated ? "Browse open auctions" : "Create your account"}
                <ArrowRight className="ml-1.5 size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

function RecentWinners() {
  const winners = useQuery(api.auctions.recentWinners, {}) ?? [];

  // No settled auctions yet — an honest empty state only. No fake winner
  // cards: invented names/prizes read as phantom listings to new visitors.
  if (winners.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-border bg-card/60 p-6 text-center">
        <Trophy className="mx-auto size-8 text-muted-foreground/50" />
        <h3 className="mt-3 font-semibold">No settled auctions yet</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Once the first auctions close, every winning bid is recorded here
          and stays public — permanently verifiable.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-3">
      {winners.slice(0, 6).map((w) => (
        <div
          key={w.resultId}
          className="rounded-xl border border-border bg-card p-4 shadow-layered"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Trophy className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{w.prizeTitle}</p>
              <p className="text-xs text-muted-foreground">
                {w.winnerName ?? "Winner"} ·{" "}
                <Smartphone className="inline size-3" /> notified
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm font-semibold tabular-nums text-primary">
            Winning bid {formatSantims(w.winningBidValueSantims ?? 0)} ETB
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {w.bidCount} bids · {w.auctionCode}
          </p>
        </div>
      ))}
    </div>
  );
}
