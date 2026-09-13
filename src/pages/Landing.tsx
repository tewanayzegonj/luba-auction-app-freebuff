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
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
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
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-16 pt-14 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:pb-24 md:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Badge
              variant="outline"
              className="mb-5 gap-1.5 border-primary/25 bg-primary/5 px-3 py-1 text-primary"
            >
              <TrendingDown className="size-3.5" />
              Lowest unique bid wins
            </Badge>
            <h1 className="text-balance text-4xl font-bold leading-[1.08] tracking-tight md:text-6xl">
              Bid low.
              <br />
              Bid <span className="text-primary">uniquely.</span>
              <br />
              Win big.
            </h1>
            <p className="mt-5 max-w-md text-pretty text-base leading-7 text-muted-foreground md:text-lg">
              Not the lowest bid — the lowest{" "}
              <span className="font-medium text-foreground">
                unique
              </span>{" "}
              bid. Pick an amount nobody else picked, and the prize is yours.
              Fair odds, transparent rules, instant confirmation.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" className="h-11 px-6" asChild>
                <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
                  {isAuthenticated ? "Go to dashboard" : "Start bidding"}
                  <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-11 px-6" asChild>
                <a href="#how-it-works">How it works</a>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-primary" /> Server-verified
                results
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-4 text-primary" /> Bids stay private
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BadgeCheck className="size-4 text-primary" /> Deterministic
                winner
              </span>
            </div>
          </motion.div>

          {/* Hero demo card */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="relative mx-auto w-full max-w-sm"
          >
            <div className="rounded-2xl border border-border bg-card p-5 shadow-layered-lg">
              <div className="flex items-center justify-between">
                <Badge
                  className="border-transparent bg-emerald-100 text-emerald-800"
                >
                  <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Live example
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  LUBA-2026-107
                </span>
              </div>
              <div className="mt-4 overflow-hidden rounded-xl">
                <div className="aspect-[16/10]">
                  <PrizeVisual emoji="📱" seed="hero" />
                </div>
              </div>
              <h3 className="mt-4 font-semibold">iPhone 17 Pro Max</h3>
              <p className="text-sm text-muted-foreground">
                Worth 145,000.00 ETB
              </p>
              <div className="mt-4 rounded-xl bg-secondary/70 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Lowest unique bid example
                </p>
                <p className="mt-1 font-mono text-2xl font-bold text-primary">
                  2.00 ETB
                </p>
                <div className="mt-2 grid grid-cols-4 gap-1.5 font-mono text-[10px]">
                  {[
                    { v: "1.00", n: 2 },
                    { v: "2.00", n: 1, win: true },
                    { v: "3.00", n: 2 },
                    { v: "4.00", n: 1 },
                  ].map((b) => (
                    <div
                      key={b.v}
                      className={
                        b.win
                          ? "rounded-md bg-primary px-1.5 py-1.5 text-center font-semibold text-primary-foreground"
                          : "rounded-md bg-background px-1.5 py-1.5 text-center text-muted-foreground"
                      }
                    >
                      <div>{b.v}</div>
                      <div className="text-[9px] opacity-75">×{b.n}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3">
                <span className="text-xs text-muted-foreground">
                  Ends in
                </span>
                <Countdown
                  to={Date.now() + 1000 * 60 * 60 * 34 + 42_000}
                  compact
                />
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
                Live auctions
              </h2>
              <p className="mt-1 text-sm text-muted-foreground md:text-base">
                Place your bid before the countdown hits zero.
              </p>
            </div>
            {isAuthenticated && (
              <Button variant="outline" asChild>
                <Link to="/dashboard">My bids</Link>
              </Button>
            )}
          </div>

          {auctions === undefined ? (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-72 animate-pulse rounded-xl border border-border bg-card"
                />
              ))}
            </div>
          ) : liveAuctions.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/60 p-12 text-center">
              <Search className="mx-auto size-8 text-muted-foreground/60" />
              <h3 className="mt-3 font-semibold">No live auctions right now</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                New auctions are announced here the moment they open. Check back
                soon.
              </p>
            </div>
          ) : (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {liveAuctions.map((a) => (
                <AuctionCard key={a._id} auction={a} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ─── Ending soon ──────────────────────────────────────────────────── */}
      {endingSoon.length > 0 && (
        <section className="border-y border-border/70 bg-card/50 py-12">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <h2 className="text-xl font-bold tracking-tight md:text-2xl">
              Ending soon
            </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {endingSoon.map((a) => (
                <Link
                  key={a._id}
                  to={`/auction/${a.auctionCode}`}
                  className="group flex items-center gap-4 rounded-xl border border-border bg-card p-3.5 shadow-layered transition-all hover:-translate-y-0.5 hover:shadow-layered-lg"
                >
                  <div className="size-16 shrink-0 overflow-hidden rounded-lg">
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
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Fee {formatETB(a.bidServiceFeeSantims)} ·{" "}
                      {a.bidCount} bids
                    </p>
                  </div>
                  <Countdown to={a.closesAt} compact className="shrink-0" />
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
              How LUBA works
            </h2>
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              Four steps between you and the prize. Strategy beats spending.
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
                title: "Pick an amount",
                body: "Choose any bid value in the auction's range. e.g. 2.00 ETB.",
              },
              {
                icon: Gavel,
                title: "Pay the bid fee",
                body: "A small service fee per bid. The bid value itself is only charged if you win.",
              },
              {
                icon: Trophy,
                title: "Win the prize",
                body: "When the clock runs out, the lowest amount submitted exactly once wins.",
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
              <span className="font-semibold">The twist:</span> everyone can see
              the bid fee, but nobody can see your amount. The lowest value that
              exactly one person picked takes the prize — so thinking low and
              thinking different is the winning move.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Recent winners ───────────────────────────────────────────────── */}
      <section className="border-y border-border/70 bg-card/50 py-12">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">
            Recent winners
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Deterministic results, published after every auction closes.
          </p>
          <RecentWinners />
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-20 py-14 md:py-20">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">
            Frequently asked questions
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
                Only the bid service fee for that auction. Your bid amount is not
                charged when you bid. If you win, you pay the winning bid amount
                (plus applicable taxes and fees) to claim the prize.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q3">
              <AccordionTrigger>How is the winner decided?</AccordionTrigger>
              <AccordionContent>
                Automatically and deterministically: after the auction closes, the
                system selects the lowest bid value with exactly one accepted bid.
                The same bids always produce the same winner — no manual picks, no
                randomness.
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
              <AccordionTrigger>Is LUBA fair?</AccordionTrigger>
              <AccordionContent>
                Yes. Every accepted bid is treated identically, all timing is
                server-controlled, results are deterministic, and every financial
                event is recorded in an auditable double-entry ledger.
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
              Ready to outsmart the crowd?
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground md:text-base">
              Create your free account, top up, and place your first unique bid
              in under two minutes.
            </p>
            <Button size="lg" className="mt-6 h-11 px-7" asChild>
              <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
                {isAuthenticated ? "Browse live auctions" : "Create your account"}
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

  // No settled auctions yet — show an honest "coming soon" state plus the
  // example outcome from the hero so visitors still see how winning works.
  if (winners.length === 0) {
    return (
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center sm:col-span-3">
          <Trophy className="mx-auto size-8 text-muted-foreground/50" />
          <h3 className="mt-3 font-semibold">Winners will appear here</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            As soon as the first auctions settle, winning bids are published
            here — permanently and verifiably.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-layered sm:col-span-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Example outcome
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              { name: "Selam T.", prize: "iPhone 17 Pro Max", bid: "2.00 ETB" },
              { name: "Dawit M.", prize: "50,000 ETB Voucher", bid: "7.50 ETB" },
              { name: "Hanna G.", prize: 'Smart TV 43"', bid: "1.25 ETB" },
            ].map((w) => (
              <div key={w.name} className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                  <Trophy className="size-4.5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{w.name}</p>
                  <p className="text-xs text-muted-foreground">{w.prize}</p>
                  <p className="font-mono text-xs text-primary">
                    Winning bid {w.bid}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Illustrative example — not real winners.
          </p>
        </div>
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
          <p className="mt-3 font-mono text-sm text-primary">
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
