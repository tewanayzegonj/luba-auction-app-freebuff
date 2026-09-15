import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import {
  Eye,
  Gavel,
  Gift,
  Languages,
  LogOut,
  Moon,
  Sun,
  LayoutDashboard,
  LogIn,
  Menu,
  Settings,
  ShieldCheck,
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
        <div className="text-[17px] font-semibold tracking-tight">Luba</div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Unique-bid auctions
        </div>
      </div>
      <span className="sr-only">Luba — home</span>
    </Link>
  );
}

// ─── Header / footer ────────────────────────────────────────────────────────

// ─── Language & theme toggles ─────────────────────────────────────────────

function LangToggle() {
  const { lang, setLang, t } = useLang();
  return (
    <button
      onClick={() => setLang(lang === "en" ? "am" : "en")}
      title={t("nav.language")}
      aria-label={t("nav.language")}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 font-mono text-xs font-semibold transition-colors hover:bg-secondary"
    >
      <Languages className="size-3.5 text-muted-foreground" />
      {lang === "en" ? "Eng" : "አማ"}
    </button>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-secondary"
    >
      {theme === "dark" ? (
        <Sun className="size-4 text-muted-foreground" />
      ) : (
        <Moon className="size-4 text-muted-foreground" />
      )}
    </button>
  );
}

export function SiteHeader() {
  const { isAuthenticated, isLoading, user, signOut } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <LubaWordmark />

        <nav className="hidden items-center gap-1 md:flex">
          <Button variant="ghost" asChild>
            <a href="/#auctions" onClick={scrollToAnchor}>{t("nav.auctions")}</a>
          </Button>
          <Button variant="ghost" asChild>
            <a href="/#how-it-works" onClick={scrollToAnchor}>{t("nav.howItWorks")}</a>
          </Button>
          <Button variant="ghost" asChild>
            <a href="/#faq" onClick={scrollToAnchor}>{t("nav.faq")}</a>
          </Button>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <LangToggle />
          <ThemeToggle />
          {isLoading ? null : isAuthenticated ? (
            <>
              {(user?.role === "admin" || user?.role === "super_admin") && (
                <Button variant="ghost" className="gap-2" asChild>
                  <Link to="/admin">
                    <ShieldCheck className="size-4" />
                    Admin
                  </Link>
                </Button>
              )}
              <UserMenu
                name={user?.name ?? user?.email ?? "L"}
                isOwner={user?.role === "super_admin"}
                onSignOut={() => {
                  void signOut();
                  navigate("/");
                }}
              />
            </>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link to="/auth">{t("nav.signIn")}</Link>
              </Button>
              <Button asChild>
                <Link to="/auth">{t("nav.getStarted")}</Link>
              </Button>
            </>
          )}
        </div>

        <button
          className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          <Menu className="size-4.5" />
        </button>
      </div>

      {/* Mobile drawer: fixed overlay closes on outside tap (§3.12). */}
      {open && (
        <>
          <div
            aria-hidden
            className="fixed inset-0 top-16 z-30 bg-black/40 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-40 border-t border-border/70 bg-background px-4 py-3 md:hidden">
            <div className="mb-2 flex items-center gap-2">
              <LangToggle />
              <ThemeToggle />
            </div>
            <div className="flex flex-col gap-1">
              <Button variant="ghost" asChild onClick={() => setOpen(false)}>
                <a href="/#auctions">{t("nav.auctions")}</a>
              </Button>
              <Button variant="ghost" asChild onClick={() => setOpen(false)}>
                <a href="/#how-it-works">{t("nav.howItWorks")}</a>
              </Button>
              <Button variant="ghost" asChild onClick={() => setOpen(false)}>
                <a href="/#faq">{t("nav.faq")}</a>
              </Button>
              {isAuthenticated ? (
                <>
                  <Button variant="ghost" asChild onClick={() => setOpen(false)}>
                    <Link to="/dashboard">{t("nav.dashboard")}</Link>
                  </Button>
                  {(user?.role === "admin" || user?.role === "super_admin") && (
                    <Button variant="ghost" asChild onClick={() => setOpen(false)}>
                      <Link to="/admin">Admin</Link>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="justify-start"
                    onClick={() => {
                      setOpen(false);
                      void signOut();
                      navigate("/");
                    }}
                  >
                    <LogOut className="mr-1.5 size-4" />
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" asChild onClick={() => setOpen(false)}>
                    <Link to="/auth">{t("nav.signIn")}</Link>
                  </Button>
                  <Button asChild onClick={() => setOpen(false)}>
                    <Link to="/auth">{t("nav.getStarted")}</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
}

/** Smooth-scroll anchor handler — native hash links without a router jump. */
function scrollToAnchor(e: React.MouseEvent<HTMLAnchorElement>) {
  const hash = e.currentTarget.hash;
  if (!hash) return;
  const target = document.querySelector(hash);
  if (target) {
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/** §3.11 — the header avatar is a dropdown with profile shortcuts. */
function UserMenu({
  name,
  isOwner,
  onSignOut,
}: {
  name: string;
  isOwner: boolean;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex size-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground ring-1 ring-inset ring-foreground/10 transition-shadow hover:ring-primary/40"
          aria-label="Account menu"
        >
          {initials(name)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate font-mono text-xs text-muted-foreground">
          {name}
          {isOwner ? " · Owner" : ""}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/dashboard" className="cursor-pointer">
            <LayoutDashboard className="mr-2 size-4" />
            Dashboard
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard?tab=profile" className="cursor-pointer">
            <Settings className="mr-2 size-4" />
            Profile settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onSignOut}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const { t } = useLang();
  return (
    <footer className="border-t border-border/70 bg-card/60">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <LubaWordmark />
          <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
            A lowest-unique-bid auction engine: deterministic settlement,
            server-authoritative timing, and an append-only ledger behind every
            fee.
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
          <h4 className="text-sm font-semibold">{t("footer.terms")}</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <Link className="hover:text-foreground" to="/legal/terms">
                {t("footer.terms")}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" to="/legal/privacy">
                {t("footer.privacy")}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" to="/legal/responsible-play">
                {t("footer.responsiblePlay")}
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/70 py-4 text-center font-mono text-xs text-muted-foreground">
        © {new Date().getFullYear()} Luba. All rights reserved.
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
  "from-[oklch(0.22_0.03_210)] to-[oklch(0.15_0.012_250)]",
  "from-[oklch(0.23_0.03_260)] to-[oklch(0.15_0.012_250)]",
  "from-[oklch(0.22_0.035_170)] to-[oklch(0.15_0.012_250)]",
  "from-[oklch(0.24_0.03_80)] to-[oklch(0.15_0.012_250)]",
  "from-[oklch(0.23_0.03_320)] to-[oklch(0.15_0.012_250)]",
  "from-[oklch(0.23_0.035_25)] to-[oklch(0.15_0.012_250)]",
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
      <span
        className={cn(
          "relative block h-full w-full overflow-hidden",
          // Opaque backdrop so transparent PNG pixels never show the card's
          // plain background through the blurred layer (the "one side white"
          // artifact).
          "bg-gradient-to-br",
          gradient,
          className,
        )}
      >
        {/* Blurred self-backdrop (§3.9): the same image scaled well past the
            box so the blur's transparent fade band lands fully outside the
            visible area — a mere scale-125 leaves it peeking through on one
            side. object-cover + saturate keeps the backdrop vivid. */}
        <img
          src={imageUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-150 object-cover blur-2xl saturate-150 brightness-90"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        {/* Foreground: the full product, never cropped. */}
        <img
          src={imageUrl}
          alt=""
          className="relative h-full w-full object-contain drop-shadow-lg"
          onError={(e) => {
            e.currentTarget.src = "/placeholder.svg";
            e.currentTarget.style.objectFit = "cover";
          }}
        />
      </span>
    );
  }
  return (
    <div
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br",
        gradient,
        className,
      )}
    >
      {/* faint technical grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(oklch(1_0_0)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0)_1px,transparent_1px)] [background-size:22px_22px]"
      />
      <span className="relative text-5xl drop-shadow-[0_6px_16px_oklch(0_0_0/0.45)]">
        {emoji ?? "🎁"}
      </span>
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
    OPEN: "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/30",
    CLOSING: "bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/30",
    SCHEDULED: "bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-500/30",
    CLOSED: "bg-foreground/5 text-muted-foreground ring-1 ring-inset ring-foreground/10",
    SETTLING: "bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-500/30",
    COMPLETED: "bg-teal-500/10 text-teal-300 ring-1 ring-inset ring-teal-500/30",
    CANCELLED: "bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-500/30",
  };
  return (
    <Badge className={cn("border-transparent bg-transparent font-medium font-mono text-xs uppercase tracking-wider", styles[status] ?? "bg-secondary text-secondary-foreground")}>
      {status === "OPEN" && <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />}
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
  participantCount?: number;
  viewCount?: number;
  prize: {
    title: string;
    emoji?: string | null;
    imageUrl?: string | null;
    valueSantims: number;
    category?: string | null;
  } | null;
}

/** 3.1K-style compact display for view/participant counts. */
function compactCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
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
          <span className="absolute right-3 top-3 rounded-full bg-background/70 px-2.5 py-1 font-mono text-[11px] font-medium text-foreground/80 ring-1 ring-inset ring-foreground/10 backdrop-blur">
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
          {/* §3.10: engagement stats live on the card itself. */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3.5" />
              {compactCount(auction.viewCount ?? 0)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Gift className="size-3.5" />
              {auction.bidCount} {auction.bidCount === 1 ? "bid" : "bids"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              {compactCount(auction.participantCount ?? 0)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Worth {formatETBShort(prize?.valueSantims ?? 0)}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-border/70 pt-3">
            <Countdown to={auction.closesAt} compact />
            <span className="rounded-lg bg-primary/10 px-2.5 py-1 font-mono text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
              Fee {formatETBShort(auction.bidServiceFeeSantims)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function formatETBShort(santims: number): string {
  const etb = Math.abs(Math.trunc(santims)) / 100;
  // §3.10: standard thousands formatting (145,000 ETB) — never “14.5M”.
  return `${etb.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ETB`;
}
