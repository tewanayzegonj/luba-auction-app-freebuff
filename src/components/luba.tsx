import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import {
  Gavel,
  Gift,
  LayoutDashboard,
  LogIn,
  Menu,
  Sparkles,
  Timer,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

// ─── Brand wordmark ─────────────────────────────────────────────────────────

export function LubaMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-layered",
        className,
      )}
    >
      <Gavel className="size-4.5" strokeWidth={2.25} />
    </span>
  );
}

export function LubaWordmark({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5">
      <LubaMark />
      <div className="leading-none">
        <div className="text-[17px] font-bold tracking-tight">LUBA</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Ethiopia
        </div>
      </div>
      <span className="sr-only">LUBA Ethiopia home</span>
    </Link>
  );
}

// ─── Header / footer ────────────────────────────────────────────────────────

export function SiteHeader() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <LubaWordmark />

        <nav className="hidden items-center gap-1 md:flex">
          <Button variant="ghost" asChild>
            <Link to="/#auctions">Live Auctions</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/#how-it-works">How It Works</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/#faq">FAQ</Link>
          </Button>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {isLoading ? null : isAuthenticated ? (
            <>
              <Button variant="ghost" className="gap-2" asChild>
                <Link to="/dashboard">
                  <LayoutDashboard className="size-4" />
                  Dashboard
                </Link>
              </Button>
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                {initials(user?.name ?? user?.email ?? "L")}
              </span>
            </>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
              <Button asChild>
                <Link to="/auth">Get started</Link>
              </Button>
            </>
          )}
        </div>

        <button
          className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <Menu className="size-4.5" />
        </button>
      </div>

      {open && (
        <div className="border-t border-border/70 bg-background px-4 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            <Button variant="ghost" asChild onClick={() => setOpen(false)}>
              <Link to="/#auctions">Live Auctions</Link>
            </Button>
            <Button variant="ghost" asChild onClick={() => setOpen(false)}>
              <Link to="/#how-it-works">How It Works</Link>
            </Button>
            <Button variant="ghost" asChild onClick={() => setOpen(false)}>
              <Link to="/#faq">FAQ</Link>
            </Button>
            {isAuthenticated ? (
              <Button variant="ghost" asChild onClick={() => setOpen(false)}>
                <Link to="/dashboard">Dashboard</Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild onClick={() => setOpen(false)}>
                  <Link to="/auth">Sign in</Link>
                </Button>
                <Button asChild onClick={() => setOpen(false)}>
                  <Link to="/auth">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 bg-card/60">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <LubaWordmark />
          <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
            The lowest unique bid wins. Fair, deterministic, and
            server-authoritative auctions for Ethiopia.
          </p>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Platform</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <Link className="hover:text-foreground" to="/#auctions">
                Live auctions
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" to="/#how-it-works">
                How it works
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" to="/#faq">
                FAQ
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Legal</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>Terms &amp; Conditions</li>
            <li>Privacy Policy</li>
            <li>Responsible Play</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/70 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} LUBA Ethiopia. All rights reserved.
      </div>
    </footer>
  );
}

// ─── Countdown ────────────────────────────==────────────────────────────────

export function Countdown({
  to,
  className,
  compact = false,
}: {
  to: number;
  className?: string;
  compact?: boolean;
  }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = Math.max(0, to - now);
  const d = Math.floor(remaining / 86_400_000);
  const h = Math.floor((remaining % 86_400_000) / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);

  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-mono text-xs tabular-nums",
          remaining === 0 ? "text-muted-foreground" : "text-foreground/80",
          className,
        )}
      >
        <Timer className="size-3.5" />
        {remaining === 0
          ? "Closed"
          : d > 0
            ? `${d}d ${h}h`
            : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`}
      </span>
    );
  }

  const units = [
    { label: "Days", value: d },
    { label: "Hours", value: h },
    { label: "Min", value: m },
    { label: "Sec", value: s },
  ];
  return (
    <div className={cn("flex gap-2", className)}>
      {units.map((u) => (
        <div
          key={u.label}
          className="flex min-w-14 flex-col items-center rounded-lg border border-border bg-card px-2.5 py-2 shadow-layered"
        >
          <span className="font-mono text-lg font-semibold tabular-nums">
            {String(u.value).padStart(2, "0")}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {u.label}
          </span>
        </div>
        ))}
    </div>
  );
}

// ─── Prize visual ───────────────────────────────────────────────────────────

const PRIZE_GRADIENTS = [
  "from-teal-100 to-cyan-50",
  "from-amber-100 to-orange-50",
  "from-sky-100 to-blue-50",
  "from-emerald-100 to-teal-50",
  "from-violet-100 to-purple-50",
  "from-rose-100 to-pink-50",
];

export function PrizeVisual({
  emoji,
  imageUrl,
  seed,
  className,
}: {
  emoji?: string | null;
  imageUrl?: string | null;
  seed: string;
  className?: string;
}) {
  const idx = hashSeed(seed) % PRIZE_GRADIENTS.length;
  const gradient = PRIZE_GRADIENTS[idx];
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center bg-gradient-to-br",
        gradient,
        className,
      )}
    >
      <span className="text-5xl drop-shadow-sm">{emoji ?? "🎁"}</span>
    </div>
  );
}

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ─── Status badge ───────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    OPEN: "bg-emerald-100 text-emerald-800",
    CLOSING: "bg-amber-100 text-amber-800",
    SCHEDULED: "bg-sky-100 text-sky-800",
    CLOSED: "bg-stone-200 text-stone-700",
    SETTLING: "bg-violet-100 text-violet-800",
    COMPLETED: "bg-teal-100 text-teal-800",
    CANCELLED: "bg-rose-100 text-rose-800",
  };
  return (
    <Badge className={cn("border-transparent font-semibold", styles[status] ?? "bg-secondary text-secondary-foreground")}>
      {status === "OPEN" && <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />}
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

// ─── Auction card ───────────────────────────────────────────────────────────

export interface AuctionListItem {
  _id: Id<"auctions">;
  auctionCode: string;
  title: string;
  status: string;
  closesAt: number;
  bidServiceFeeSantims: number;
  minBidSantims: number;
  maxBidSantims: number;
  bidCount: number;
  uniqueBidCount: number;
  prize: {
    title: string;
    emoji?: string | null;
    imageUrl?: string | null;
    valueSantims: number;
    category?: string | null;
  } | null;
}

export function AuctionCard({ auction }: { auction: AuctionListItem }) {
  const prize = auction.prize;
  return (
    <Link
      to={`/auction/${auction.auctionCode}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-layered transition-all hover:-translate-y-0.5 hover:shadow-layered-lg"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden">
        <PrizeVisual
          emoji={prize?.emoji}
          imageUrl={prize?.imageUrl}
          seed={auction.auctionCode}
        />
        <div className="absolute left-3 top-3 flex gap-2">
          <StatusBadge status={auction.status} />
        </div>
        {prize?.category && (
          <span className="absolute right-3 top-3 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-medium text-foreground/80 backdrop-blur">
            {prize.category}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {auction.auctionCode}
          </p>
          <h3 className="mt-0.5 text-[15px] font-semibold leading-snug text-foreground group-hover:text-primary">
            {prize?.title ?? auction.title}
          </h3>
        </div>

        <div className="mt-auto space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Gift className="size-3.5" />
              Worth {formatETBShort(prize?.valueSantims ?? 0)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" />
              {auction.bidCount} bids
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-border/70 pt-3">
            <Countdown to={auction.closesAt} compact />
            <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              Fee {formatETBShort(auction.bidServiceFeeSantims)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function formatETBShort(santims: number): string {
  const abs = Math.abs(Math.trunc(santims));
  if (abs >= 1_000_000) {
    return `${(abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M ETB`;
  }
  if (abs >= 10_000) {
    return `${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}K ETB`;
  }
  return `${(abs / 100).toFixed(2)} ETB`;
}
