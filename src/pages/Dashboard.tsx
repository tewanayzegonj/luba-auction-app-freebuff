import {
  Countdown,
  LubaMark,
  PrizeVisual,
  SiteFooter,
  SiteHeader,
} from "@/components/luba";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatETB, parseETBToSantims } from "@/lib/money";
import { useLang } from "@/lib/i18n";
import { WithdrawCard } from "@/components/withdraw-card";
import { WinnerJourneyCard } from "@/components/winner-journey-card";
import { DailyBonusCard } from "@/components/daily-bonus-card";
import { ScrollableTabs, ActiveTabScroll } from "@/components/scrollable-tabs";
import { OnboardingTour } from "@/components/onboarding-tour";
import { PageFade } from "@/components/motion-primitives";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { smoothScrollTo } from "@/lib/scroll";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Eye,
  FlaskConical,
  Gavel,
  Gift,
  Link2,
  Loader2,
  LogOut,
  Mail,
  ReceiptText,
  Send,
  Smartphone,
  Trophy,
  Unlink,
  UserRound,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

const TOPUP_PRESETS = [5000, 10000, 25000, 50000, 100000]; // santims: 50/100/250/500/1000 ETB

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const validTabs = [
    "bids",
    "wallet",
    "notifications",
    "watchlist",
    "receipts",
    "profile",
  ];
  const initialTab =
    requestedTab && validTabs.includes(requestedTab) ? requestedTab : "bids";

  const wallet = useQuery(api.payments.getMyWallet, {});
  const myBids = useQuery(api.bids.getMyBids, {});
  const notifications = useQuery(api.bids.getMyNotifications, {});
  const settlements = useQuery(api.payments.getMySettlements, {});
  const auctions = useQuery(api.auctions.listOpenAuctions, {});

  const markRead = useMutation(api.bids.markNotificationsRead);
  const topUp = useMutation(api.payments.initiateTopUp);
  const requestWithdrawal = useMutation(api.accountOps.requestWithdrawal);
  const confirmManualTopUp = useMutation(api.payments.confirmManualTopUp);
  const cancelMyTopUp = useMutation(api.payments.cancelMyTopUp);
  const startChapaCheckout = useAction(api.chapa.initializeCheckout);
  const payWinningBid = useMutation(api.payments.payWinningBid);

  const [topUpInput, setTopUpInput] = useState("");
  const [topUpProvider, setTopUpProvider] = useState<
    "chapa" | "manual" | "linkset"
  >("chapa");
  // links.et bank-receipt verification (provider === "linkset").
  const [receiptInput, setReceiptInput] = useState("");
  const startReceiptVerify = useMutation(api.linkset.submitReceipt);
  const [busy, setBusy] = useState<string | null>(null);

  const chapaStatus = useQuery(api.chapa.getChapaStatus, {});
  const linkMethods = useQuery(api.accountLinks.getLinkMethods, {});

  const setMyName = useMutation(api.profile.setMyName);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [onboardingDismissed, setOnboardingDismissed] = useState(true);
  const [alertsBannerDismissed, setAlertsBannerDismissed] = useState(true);

  // Onboarding: first visit without a display name → quick setup modal.
  useEffect(() => {
    if (!user) return;
    setOnboardingDismissed(localStorage.getItem("luba.onboardedName") === "1");
    setAlertsBannerDismissed(localStorage.getItem("luba.dismissedAlerts") === "1");
  }, [user]);

  // Cross-page section landing: /dashboard?tab=X&scroll=1 scrolls to the
  // panel once it's mounted (retry ~1s for lazy content), then cleans the
  // URL so back-navigation doesn't re-scroll. Uses the shared scroll engine
  // (moving-target anchoring — skeletons loading mid-glide don't break the
  // landing) instead of browser smooth scroll.
  useEffect(() => {
    if (searchParams.get("scroll") !== "1" || !requestedTab) return;
    let frames = 0;
    const tryScroll = () => {
      const el = document.getElementById(`section-${requestedTab}`);
      if (el instanceof HTMLElement) {
        smoothScrollTo(el);
        searchParams.delete("scroll");
        setSearchParams(searchParams, { replace: true });
      } else if (frames++ < 60) {
        requestAnimationFrame(tryScroll);
      }
    };
    requestAnimationFrame(tryScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  useEffect(() => {
    if (user && !user.name && !onboardingDismissed) {
      setNameInput("");
      setNameOpen(true);
    }
  }, [user, onboardingDismissed]);

  // P2.6: alert opt-in — visible when the user has no alert channel linked.
  const showAlertsBanner =
    Boolean(user) &&
    !alertsBannerDismissed &&
    linkMethods != null &&
    !linkMethods.telegramChatId &&
    !linkMethods.signedInViaTelegram;

  const startLink = useMutation(api.accountLinks.startLink);
  const unlinkMethod = useMutation(api.accountLinks.unlink);

  const unreadCount = (notifications ?? []).filter((n) => !n.read).length;
  const activeBidAuctionIds = new Set(
    (myBids ?? [])
      .filter((b) => b.status === "ACCEPTED")
      .map((b) => b.auctionId),
  );
  const pendingSettlements = (settlements ?? []).filter(
    (s) => s.status === "PENDING_PAYMENT",
  );

  // Return flow: coming back from the Chapa hosted checkout, verify the
  // transaction server-side (webhooks can lag) and surface the result.
  useEffect(() => {
    const pending = sessionStorage.getItem("luba_pending_chapa");
    if (!pending) return;
    sessionStorage.removeItem("luba_pending_chapa");
    let parsed: {
      merchantReference: string;
      token: string;
      amountSantims: number;
    };
    try {
      parsed = JSON.parse(pending);
    } catch {
      return;
    }
    setBusy("topup");
    // The verify endpoint lives on the Convex site deployment (web actions),
    // NOT on this app's origin — in dev/preview the two domains differ, so an
    // app-relative path would 404. Derive it from VITE_CONVEX_URL (always
    // present — the app boots from it): the cloud↔site swap is Convex's
    // documented convention. The old hardcoded fallback pointed at a STALE
    // deployment, so every verify failed when the env var was unset.
    const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
    const verifyBase = (
      (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ??
      convexUrl?.replace(".convex.cloud", ".convex.site") ??
      ""
    ).replace(/\/$/, "");
    if (!verifyBase) {
      toast.error("We could not confirm your payment", {
        description: "Open Wallet → Payment history and tap Verify again.",
      });
      setBusy(null);
      return;
    }

    /** Ask the server whether the provider has confirmed yet. Chapa's own
        ledger can lag the hosted-checkout redirect by a few seconds, so a
        short poll closes the gap instead of showing "still processing"
        immediately (that message made every successful payment look hung). */
    const verifyOnce = (): Promise<{
      ok?: boolean;
      status?: string;
      error?: string;
    }> =>
      fetch(`${verifyBase}/payments/chapa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantReference: parsed.merchantReference,
          token: parsed.token,
        }),
      }).then((r) => r.json());

    const confirm = (res: { ok?: boolean; status?: string; error?: string }) => {
      if (res.ok && res.status === "COMPLETED") {
        toast.success("Top-up complete", {
          description: `${formatETB(parsed.amountSantims)} added to your wallet.`,
        });
      } else if (res.ok) {
        toast.info("Payment still processing", {
          description:
            "Your wallet will be credited automatically — or tap Verify again in Payment history.",
        });
      } else {
        toast.error("We could not confirm your payment", {
          description:
            res.error === "CHAPA_NOT_CONFIGURED"
              ? "Online payments are not configured yet."
              : "Open Payment history and tap Verify again, or contact support.",
        });
      }
    };

    (async () => {
      // Up to 5 checks over ~15s before reporting PENDING — most Chapa
      // transactions confirm on the first or second poll.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await verifyOnce();
          if (res.ok && res.status === "COMPLETED") {
            confirm(res);
            return;
          }
          if (!res.ok) {
            confirm(res);
            return;
          }
        } catch {
          // Network blip — keep polling; final failure handled below.
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      confirm({ ok: true, status: "PENDING" });
    })().finally(() => setBusy(null));
  }, []);

  const handleTopUp = async (santims: number) => {
    setBusy("topup");
    try {
      if (topUpProvider === "linkset") {
        // links.et bank receipt: create the PENDING payment, remember it,
        // then the user pastes the receipt link/reference to verify.
        const { paymentId } = await topUp({
          amountSantims: santims,
          provider: "linkset",
        });
        sessionStorage.setItem(
          "luba_linkset_payment",
          JSON.stringify({ paymentId, amountSantims: santims }),
        );
        toast.info("Step 1: send the money", {
          description: `Transfer exactly ${formatETB(santims)} to the account shown below, then paste your receipt.`,
        });
        setTopUpInput("");
        return;
      }
      if (topUpProvider === "manual") {
        // Sandbox adapter: settles immediately so the product is testable
        // before production PSP credentials are configured.
        const { merchantReference } = await topUp({
          amountSantims: santims,
          provider: "manual",
        });
        await confirmManualTopUp({ merchantReference, succeeded: true });
        toast.success("Top-up complete", {
          description: `${formatETB(santims)} added to your wallet (sandbox).`,
        });
        setTopUpInput("");
        return;
      }

      // Chapa: create the PENDING payment, then hand off to the hosted
      // checkout (telebirr, CBE Birr, M-Pesa, cards).
      const { merchantReference, verifyToken } = await topUp({
        amountSantims: santims,
        provider: "chapa",
      });
      const [firstName, ...rest] = (user?.name ?? "").split(" ");
      const result = await startChapaCheckout({
        merchantReference,
        amountSantims: santims,
        email: user?.email ?? undefined,
        firstName: firstName || undefined,
        lastName: rest.join(" ") || undefined,
        returnUrl: `${window.location.origin}/dashboard`,
      });
      if (!result.ok) {
        await cancelMyTopUp({ merchantReference });
        toast.error("Could not start the payment", {
          description:
            result.error === "CHAPA_NOT_CONFIGURED"
              ? "Online payments are not configured yet — use the sandbox option below."
              : result.detail
                ? `Chapa: ${result.detail}`
                : `Provider error: ${result.error}`,
        });
        return;
      }
      sessionStorage.setItem(
        "luba_pending_chapa",
        JSON.stringify({
          merchantReference,
          token: verifyToken,
          amountSantims: santims,
        }),
      );
      window.location.href = result.checkoutUrl;
    } catch (err) {
      toast.error("Top-up failed", {
        description: friendlyError(err),
      });
    } finally {
      setBusy(null);
    }
  };

  /** links.et: submit the pasted receipt for bank-side verification. The
      scheduled action writes linksetStatus back onto the payment row — the
      reactive query below picks up the result (verifying → verified/failed). */
  const handleVerifyReceipt = async () => {
    const stored = sessionStorage.getItem("luba_linkset_payment");
    if (!stored) {
      toast.error("No pending top-up", {
        description: "Start a top-up first, transfer the money, then verify.",
      });
      return;
    }
    const { paymentId, amountSantims } = JSON.parse(stored) as {
      paymentId: string;
      amountSantims: number;
    };
    const value = receiptInput.trim();
    if (!value) {
      toast.error("Paste your receipt first", {
        description:
          "Copy the receipt link from your bank app or SMS, or type your telebirr reference.",
      });
      return;
    }
    const isUrl = /^https?:\/\//i.test(value);
    setBusy("verify-receipt");
    try {
      await startReceiptVerify({
        paymentId: paymentId as unknown as Id<"payments">,
        receiptUrl: isUrl ? value : undefined,
        telebirrReference: isUrl ? undefined : value,
      });
      toast.info("Verifying with your bank…", {
        description: `Checking ${formatETB(amountSantims)} — this usually takes under a minute.`,
      });
      setReceiptInput("");
    } catch (err) {
      toast.error("Could not start verification", {
        description: friendlyError(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const handlePayWin = async (settlementId: Id<"winnerSettlements">) => {
    setBusy(settlementId);
    try {
      await payWinningBid({ settlementId });
      toast.success("Payment complete", {
        description: "Your prize will be fulfilled shortly.",
      });
    } catch (err) {
      toast.error("Payment failed", {
        description: friendlyError(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleSaveName = async () => {
    const name = nameInput.trim();
    if (name.length < 2) return;
    try {
      await setMyName({ name });
      localStorage.setItem("luba.onboardedName", "1");
      setOnboardingDismissed(true);
      setNameOpen(false);
      toast.success("Display name saved", {
        description: "You can change it any time in Profile.",
      });
    } catch (err) {
      toast.error("Could not save your name", {
        description: friendlyError(err),
      });
    }
  };

  const auctionTitle = (auctionId: Id<"auctions">) =>
    (auctions ?? []).find((a) => a._id === auctionId);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* First-visit guided tour — shown once per device, skippable. */}
      <OnboardingTour />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pb-24 sm:px-6 md:pb-8">
        <PageFade>
        {/* Header row — sign-out lives in the avatar menu on phones (the
            bottom tab bar owns nav); visible from sm up. */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Account overview
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl md:text-3xl">
              Welcome{user?.name ? `, ${user.name}` : ""}
            </h1>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Button variant="outline" className="gap-2" onClick={handleSignOut}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>

        {/* Daily check-in bonus — one claim per Addis day, growing streak. */}
        <div className="mt-5">
          <DailyBonusCard />
        </div>

        {/* Stat cards — 2×2 on phones (4-across stamps get illegible),
            4-across from lg. */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-4">
          <StatCard
            icon={<Wallet className="size-5" />}
            label="Wallet balance"
            value={formatETB(wallet?.paidBalanceSantims ?? 0)}
            tone="primary"
          />
          <StatCard
            icon={<Gavel className="size-5" />}
            label="Active bids"
            value={String(
              (myBids ?? []).filter((b) => b.status === "ACCEPTED").length,
            )}
          />
          <StatCard
            icon={<Trophy className="size-5" />}
            label="Wins to pay"
            value={String(pendingSettlements.length)}
            tone={pendingSettlements.length > 0 ? "amber" : "default"}
          />
          <StatCard
            icon={<Bell className="size-5" />}
            label="Unread alerts"
            value={String(unreadCount)}
          />
        </div>

        {/* Pay-your-win banner */}
        {pendingSettlements.length > 0 && (
          <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
            <h2 className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
              <Trophy className="size-5" />
              {t("dashboard.wins")} — {t("dashboard.payToWin")}
            </h2>
            <div className="mt-4 space-y-3">
              {pendingSettlements.map((s) => (
                <WinnerJourneyCard key={s._id} settlement={s} />
              ))}
            </div>
          </div>
        )}

        {/* P2.6: alert opt-in banner */}
        {showAlertsBanner && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Bell className="size-4.5" />
              </span>
              <div>
                <p className="text-sm font-semibold">
                  {t("dashboard.alertsBannerTitle")}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {t("dashboard.alertsBannerBody")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {linkMethods?.telegramConfigured && (
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    localStorage.setItem("luba.dismissedAlerts", "1");
                    setAlertsBannerDismissed(true);
                    navigate("/dashboard?tab=profile");
                  }}
                >
                  <Send className="size-3.5" />
                  {t("dashboard.alertsBannerCta")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  localStorage.setItem("luba.dismissedAlerts", "1");
                  setAlertsBannerDismissed(true);
                }}
              >
                {t("dashboard.alertsBannerDismiss")}
              </Button>
            </div>
          </div>
        )}

        {/* Tabs — controlled by ?tab=. NOT keyed by the tab: keying remounted
            the entire tab tree on every tap, which (a) threw away tab-panel
            scroll state and (b) reset the tab strip's horizontal scroll to 0
            while the last tab stayed selected — the "jumps back to the first
            tab" bug on phones. */}
        <Tabs
          value={initialTab}
          onValueChange={(v) => {
            if (v === "bids") setSearchParams({}, { replace: true });
            else setSearchParams({ tab: v }, { replace: true });
          }}
          className="mt-8"
        >
          {/* Scrollable tab strip on small screens — scroll-aware fades +
              chevrons (see ScrollableTabs). */}
          <ScrollableTabs>
            {/* min-w-max: when the labels can't fit the viewport the pill grows
                to its content and scrolls inside ScrollableTabs — without it
                the trailing triggers spill OUTSIDE the rounded background
                (the "junky" cut-off look on phones). */}
            <TabsList className="h-11 w-full min-w-max justify-start gap-1 rounded-xl bg-secondary/70 p-1">
              <TabsTrigger value="bids" className="gap-1.5 rounded-lg">
                <Gavel className="size-4" /> {t("dashboard.myBids")}
              </TabsTrigger>
              <TabsTrigger value="wallet" className="gap-1.5 rounded-lg">
                <Wallet className="size-4" /> {t("wallet.balance")}
              </TabsTrigger>
              <TabsTrigger value="notifications" className="gap-1.5 rounded-lg">
                <Bell className="size-4" />
                {t("dashboard.alerts")}
                {unreadCount > 0 && (
                  <Badge className="ml-1 h-5 border-transparent bg-primary px-1.5 text-[10px] text-primary-foreground">
                    {unreadCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="watchlist" className="gap-1.5 rounded-lg">
                <Eye className="size-4" /> {t("dashboard.watchlist")}
              </TabsTrigger>
              <TabsTrigger value="receipts" className="gap-1.5 rounded-lg">
                <ReceiptText className="size-4" /> {t("wallet.transactions")}
              </TabsTrigger>
              <TabsTrigger value="profile" className="gap-1.5 rounded-lg">
                {t("dashboard.profile")}
              </TabsTrigger>
            </TabsList>
            {/* Keeps the selected tab in view when navigating from the bottom
                bar (?tab= can select a trigger that's scrolled off-screen). */}
            <ActiveTabScroll />
          </ScrollableTabs>

          {/* ─── My Bids ──────────────────────────────────────────────────── */}
          <TabsContent value="bids" id="section-bids" className="mt-5 scroll-mt-24">
            {myBids === undefined ? (
              <LoadingRows />
            ) : myBids.length === 0 ? (
              <EmptyState
                icon={<Gavel className="size-8 text-muted-foreground/50" />}
                title="No bids yet"
                body="Browse live auctions and place your first unique bid."
                action={
                  <Button asChild>
                    <Link to="/#auctions">Browse live auctions</Link>
                  </Button>
                }
              />
            ) : (
              /* Scroll container: overflow-x lives here (NOT on the card —
                 overflow-hidden would kill it). The inner div rounds corners
                 so the scrolled table still clips cleanly. */
              <div className="table-scroll">
                <div className="min-w-[620px] overflow-hidden rounded-2xl border border-border bg-card shadow-layered">
                  <table className="data-table w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Auction</th>
                      <th className="px-4 py-3 font-medium">Bid amount</th>
                      <th className="px-4 py-3 font-medium">Fee paid</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myBids.slice(0, 30).map((b) => {
                      const live = auctionTitle(b.auctionId);
                      return (
                        <tr
                          key={b._id}
                          className="border-b border-border/60 last:border-0 hover:bg-secondary/30"
                        >
                          <td className="px-4 py-3">
                            {live ? (
                              <Link
                                to={`/auction/${live.auctionCode}`}
                                className="font-medium hover:text-primary"
                              >
                                {live.prize?.title ?? live.title}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">
                                {String(b.auctionId).slice(-6)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 tabular-nums">
                            {formatETB(b.bidValueSantims)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground tabular-nums">
                            {formatETB(b.bidServiceFeeSantims)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(b.acceptedAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              className={cn(
                                "border-transparent",
                                b.status === "ACCEPTED"
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                              )}
                            >
                              {b.status === "ACCEPTED" ? "Accepted" : "Refunded"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}

            {/* Active auctions I've bid on */}
            {(auctions ?? []).filter((a) => activeBidAuctionIds.has(a._id))
              .length > 0 && (
              <div className="mt-8">
                <h2 className="text-lg font-bold tracking-tight">
                  Auctions you're in
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(auctions ?? [])
                    .filter((a) => activeBidAuctionIds.has(a._id))
                    .map((a) => (
                      <Link
                        key={a._id}
                        to={`/auction/${a.auctionCode}`}
                        className="group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 shadow-layered transition-all hover:-translate-y-0.5 hover:shadow-layered-lg"
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
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {a.bidCount} bids total
                          </p>
                        </div>
                        <Countdown to={a.closesAt} compact className="shrink-0" />
                      </Link>
                    ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ─── Wallet ───────────────────────────────────────────────────── */}
          <TabsContent value="wallet" id="section-wallet" className="mt-5 scroll-mt-24">
            <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LubaMark className="size-8" />
                    Top up wallet
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-xl bg-secondary/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Current balance
                    </p>
                    <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
                      {formatETB(wallet?.paidBalanceSantims ?? 0)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Lifetime deposits{" "}
                      {formatETB(wallet?.totalDepositedSantims ?? 0)} · spent{" "}
                      {formatETB(wallet?.totalSpentSantims ?? 0)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="topup" className="text-sm">
                      Amount (ETB)
                    </Label>
                    <Input
                      id="topup"
                      inputMode="decimal"
                      placeholder="e.g. 100.00"
                      value={topUpInput}
                      onChange={(e) => setTopUpInput(e.target.value)}
                      className="h-12 text-base tabular-nums sm:h-11 sm:text-sm"
                    />
                    <Button
                      className="h-12 w-full text-base sm:h-11 sm:text-sm"
                      disabled={
                        busy === "topup" ||
                        parseETBToSantims(topUpInput) === null ||
                        (parseETBToSantims(topUpInput) ?? 0) <= 0
                      }
                      onClick={() => {
                        const s = parseETBToSantims(topUpInput);
                        if (s) handleTopUp(s);
                      }}
                    >
                      {busy === "topup" ? (
                        <>
                          <Loader2 className="mr-1.5 size-4 animate-spin" />
                          Processing…
                        </>
                      ) : (
                        <>
                          <CreditCard className="mr-1.5 size-4" />
                          {topUpProvider === "chapa"
                            ? "Continue to secure payment"
                            : "Add funds"}
                        </>
                      )}
                    </Button>
                  </div>
                  {/* Presets: 2-up grid on phones — four tiny buttons in a
                      row mis-tap constantly on narrow screens. */}
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    {TOPUP_PRESETS.map((p) => (
                      <Button
                        key={p}
                        variant="outline"
                        size="sm"
                        className="h-10 sm:h-8"
                        disabled={busy === "topup"}
                        onClick={() => handleTopUp(p)}
                      >
                        {formatETB(p)}
                      </Button>
                    ))}
                  </div>
                  {chapaStatus && (
                    <div
                      className={cn(
                        "flex items-start gap-2.5 rounded-xl border p-3 text-xs leading-5",
                        chapaStatus.configured && chapaStatus.webhookSecretSet
                          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                          : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-200",
                      )}
                    >
                      {chapaStatus.configured && chapaStatus.webhookSecretSet ? (
                        <>
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                          <span>
                            <span className="font-semibold">Chapa is live.</span>{" "}
                            telebirr, CBE Birr, M-Pesa, and card payments are
                            active.
                          </span>
                        </>
                      ) : (
                        <>
                          <Clock className="mt-0.5 size-4 shrink-0" />
                          <span>
                            <span className="font-semibold">
                              Online payments pending setup.
                            </span>{" "}
                            {chapaStatus.configured
                              ? "Add CHAPA_WEBHOOK_SECRET to receive payment confirmations."
                              : "Add CHAPA_SECRET_KEY (and CHAPA_WEBHOOK_SECRET) in the project's Keys tab, then create a Chapa business account at chapa.co."}{" "}
                            Until then, use the sandbox deposit below.
                          </span>
                        </>
                      )}
                    </div>
                    )}
                  <div className="rounded-xl border border-border bg-secondary/40 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Payment method
                    </p>
                    <div className="mt-2 grid gap-2">
                      <button
                        type="button"
                        onClick={() => setTopUpProvider("chapa")}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                          topUpProvider === "chapa"
                            ? "border-primary/50 bg-primary/5"
                            : "border-border hover:border-border/80 hover:bg-secondary/40",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-md",
                            topUpProvider === "chapa"
                              ? "bg-primary/15 text-primary"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          <CreditCard className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            Chapa — telebirr, CBE Birr, M-Pesa, cards
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            Pay on the provider's secure checkout page.
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTopUpProvider("linkset")}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                          topUpProvider === "linkset"
                            ? "border-primary/50 bg-primary/5"
                            : "border-border hover:border-border/80 hover:bg-secondary/40",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-md",
                            topUpProvider === "linkset"
                              ? "bg-primary/15 text-primary"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          <ReceiptText className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            Bank transfer — verified by the bank
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            Send the money yourself, then paste your receipt
                            link — the bank confirms it, credited in ~1 min.
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTopUpProvider("manual")}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                          topUpProvider === "manual"
                            ? "border-primary/50 bg-primary/5"
                            : "border-border hover:border-border/80 hover:bg-secondary/40",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-md",
                            topUpProvider === "manual"
                              ? "bg-primary/15 text-primary"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          <FlaskConical className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            Sandbox deposit
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            Simulated funds for testing — removed at launch.
                          </span>
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* links.et bank-receipt verification — appears after the
                      user starts a bank-transfer top-up. */}
                  {topUpProvider === "linkset" && (
                    <ReceiptVerifyPanel
                      receiptInput={receiptInput}
                      onInputChange={setReceiptInput}
                      onVerify={handleVerifyReceipt}
                      busy={busy === "verify-receipt"}
                    />
                  )}

                  <p className="text-xs leading-5 text-muted-foreground">
                    Deposits are credited to your wallet as soon as the provider
                    confirms the payment. Bid fees are charged from this balance
                    per bid.
                  </p>
                </CardContent>
              </Card>

              <div className="space-y-5">
                <Card className="border-border shadow-layered">
                  <CardHeader>
                    <CardTitle className="text-base">Withdraw funds</CardTitle>
                    <CardDescription>
                      Payouts go to telebirr/CBE/bank via manual review — funds
                      leave your spendable balance immediately and are refunded
                      automatically if the request is rejected.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <WithdrawCard
                      balanceSantims={wallet?.paidBalanceSantims ?? 0}
                    />
                  </CardContent>
                </Card>
                <Card className="border-border shadow-layered">
                  <CardHeader>
                    <CardTitle className="text-base">Payment history</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PaymentsList />
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ─── Notifications ────────────────────────────────────────────── */}
          <TabsContent value="notifications" id="section-notifications" className="mt-5 scroll-mt-24">
            {notifications === undefined ? (
              <LoadingRows />
            ) : notifications.length === 0 ? (
              <EmptyState
                icon={<Bell className="size-8 text-muted-foreground/50" />}
                title="No notifications yet"
                body="Bid confirmations, winner announcements, and payment reminders appear here."
              />
            ) : (
              <div className="space-y-3">
                {/* HowLow's stats bar: Total / Unread / Read at a glance, with
                    mark-all-read attached. One number per bucket, big type. */}
                <div className="flex items-stretch justify-between gap-2 rounded-2xl border border-border bg-card p-3 shadow-layered">
                  {[
                    {
                      label: "Total",
                      value: notifications.length,
                      tone: "text-foreground",
                    },
                    {
                      label: "Unread",
                      value: unreadCount,
                      tone: unreadCount > 0 ? "text-amber-700 dark:text-amber-500" : "text-muted-foreground",
                    },
                    {
                      label: "Read",
                      value: notifications.length - unreadCount,
                      tone: "text-muted-foreground",
                    },
                  ].map((s, i) => (
                    <div
                      key={s.label}
                      className={cn(
                        "flex-1 text-center",
                        i > 0 && "border-l border-border/70",
                      )}
                    >
                      <p className={cn("text-xl font-bold tabular-nums", s.tone)}>
                        {s.value}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {s.label}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={unreadCount === 0}
                    onClick={() =>
                      markRead({
                        ids: (notifications ?? [])
                          .filter((n) => !n.read)
                          .map((n) => n._id),
                      })
                    }
                  >
                    <CheckCircle2 className="mr-1.5 size-4" />
                    Mark all read
                  </Button>
                </div>
                {(notifications ?? []).map((n) => (
                  <div
                    key={n._id}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-4 shadow-layered",
                      n.read
                        ? "border-border bg-card"
                        : "border-primary/25 bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                        n.type === "WINNER_ANNOUNCED"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "bg-primary/10 text-primary",
                      )}
                    >
                      {n.type === "WINNER_ANNOUNCED" ? (
                        <Trophy className="size-4.5" />
                      ) : n.type === "PAYMENT_SUCCESS" || n.type === "PRIZE_STATUS" ? (
                        <Wallet className="size-4.5" />
                      ) : (
                        <Gavel className="size-4.5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {!n.read && (
                            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" />
                          )}
                          {n.title}
                        </p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {new Date(n.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {n.body}
                      </p>
                      {n.auctionId && auctionTitle(n.auctionId) && (
                        <Link
                          to={`/auction/${auctionTitle(n.auctionId)!.auctionCode}`}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          View auction <ArrowUpRight className="size-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ─── Watchlist ────────────────────────────────────────────────── */}
          <TabsContent value="watchlist" id="section-watchlist" className="mt-5 scroll-mt-24">
            <WatchlistPanel />
          </TabsContent>

          {/* ─── Receipts ─────────────────────────────────────────────────── */}
          <TabsContent value="receipts" id="section-receipts" className="mt-5 scroll-mt-24">
            <ReceiptsPanel />
          </TabsContent>

          {/* ─── Profile ──────────────────────────────────────────────────── */}
          <TabsContent value="profile" id="section-profile" className="mt-5 scroll-mt-24">
            <div className="grid max-w-4xl gap-5">
              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="text-base">Profile</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-4 py-3">
                    <span className="text-muted-foreground">Name</span>
                    <span className="flex items-center gap-2 font-medium">
                      {user?.name ?? user?.email ?? "—"}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-xs"
                        onClick={() => {
                          setNameInput(user?.name ?? "");
                          setNameOpen(true);
                        }}
                      >
                        <UserRound className="size-3.5" />
                        {user?.name ? "Edit" : t("dashboard.setName")}
                      </Button>
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-4 py-3">
                    <span className="text-muted-foreground">Email</span>
                    <span className="font-medium">{user?.email ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-4 py-3">
                    <span className="text-muted-foreground">
                      Verification status
                    </span>
                    <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      Verified
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="text-base">Refer &amp; earn</CardTitle>
                </CardHeader>
                <CardContent>
                  <ReferralCard />
                </CardContent>
              </Card>

              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="text-base">Notifications</CardTitle>
                </CardHeader>
                <CardContent>
                  <NotificationPrefsCard />
                </CardContent>
              </Card>

              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="text-base">Responsible play</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiblePlayCard />
                </CardContent>
              </Card>

              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="text-base">Sign-in methods</CardTitle>
                </CardHeader>
                <CardContent>                  {linkMethods == null ? (
                    <div className="h-24 animate-pulse rounded-xl bg-secondary/50" />
                  ) : (
                    <div className="space-y-3">
                      {linkMethods.signedInViaTelegram ? (
                        <MethodRow
                          icon={<Send className="size-4" />}
                          title="Telegram (sign-in)"
                          subtitle={`Chat ID ${linkMethods.signInEmail}`}
                          connected
                        />
                      ) : (
                        <MethodRow
                          icon={<Mail className="size-4" />}
                          title="Email"
                          subtitle={linkMethods.email ?? "Not set"}
                          connected={Boolean(linkMethods.email)}
                          locked={Boolean(linkMethods.email)}
                        />
                      )}
                      {linkMethods.signedInViaTelegram && (
                        <p className="rounded-xl bg-secondary/40 px-4 py-3 text-xs leading-5 text-muted-foreground">
                          You signed in with your Telegram ID ({linkMethods.signInEmail}).
                          Link it below to receive bid and winner alerts there, or add an
                          email for receipts.
                        </p>
                      )}
                      <TelegramLinkRow
                        methods={{
                          telegramChatId: linkMethods.telegramChatId,
                          telegramConfigured: linkMethods.telegramConfigured,
                        }}
                        onStart={startLink}
                        onUnlink={unlinkMethod}
                        busy={busy === "link-telegram" || busy === "unlink-telegram"}
                        setBusy={setBusy}
                      />
                      {linkMethods.smsConfigured && (
                        <PhoneLinkRow
                          methods={{
                            phone: linkMethods.phone,
                            phoneVerified: linkMethods.phoneVerified,
                            smsConfigured: linkMethods.smsConfigured,
                          }}
                          onStart={startLink}
                          onUnlink={unlinkMethod}
                          busy={busy === "link-phone" || busy === "unlink-phone"}
                          setBusy={setBusy}
                        />
                      )}
                      <p className="pt-1 text-xs leading-5 text-muted-foreground">
                        Linking a method lets you sign in with it and receive
                        alerts there. Each Telegram account and phone number can
                        be connected to only one Luba profile.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="text-base">Identity verification</CardTitle>
                  <CardDescription>
                    Winners may be asked to verify their identity before prize
                    fulfillment. Uploading a government-issued ID now saves time later.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <KycVerificationCard />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
        </PageFade>
      </main>

      {/* P2.5: display-name onboarding (dismissible) */}
      <Dialog open={nameOpen} onOpenChange={setNameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserRound className="size-5 text-primary" />
              {t("dashboard.namePromptTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("dashboard.namePromptBody")}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="Your display name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="e.g. Abel Tesfaye"
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nameInput.trim().length >= 2) {
                void handleSaveName();
              }
            }}
          />
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                localStorage.setItem("luba.onboardedName", "1");
                setOnboardingDismissed(true);
                setNameOpen(false);
              }}
            >
              {t("dashboard.nameMaybeLater")}
            </Button>
            <Button
              disabled={nameInput.trim().length < 2}
              onClick={() => void handleSaveName()}
            >
              <CheckCircle2 className="mr-1.5 size-4" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SiteFooter />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function WatchlistPanel() {
  const watchlist = useQuery(api.engagement.listWatchlist, {});
  if (watchlist === undefined) return <LoadingRows />;
  if (watchlist.length === 0) {
    return (
      <EmptyState
        icon={<Eye className="size-8 text-muted-foreground/50" />}
        title="Nothing on your watchlist"
        body="Tap “Watch this auction” on any live auction and we'll alert you before it closes."
      />
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {watchlist.map((w) => (
        <Link
          key={w.watchId}
          to={`/auction/${w.auctionCode}`}
          className="group flex items-center gap-3.5 rounded-xl border border-border bg-card p-4 shadow-layered transition-all hover:-translate-y-0.5 hover:shadow-layered-lg"
        >
          <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-secondary/60">
            <PrizeVisual
              emoji={w.prizeEmoji ?? undefined}
              imageUrl={w.prizeImage ?? undefined}
              seed={w.auctionCode}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold group-hover:text-primary">
              {w.prizeTitle ?? w.title}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {w.bidCount} bids · {w.status === "OPEN" ? "live now" : w.status.toLowerCase()}
            </p>
          </div>
          {w.status === "OPEN" && <Countdown to={w.closesAt} compact />}
        </Link>
      ))}
    </div>
  );
}

/**
 * links.et bank-receipt verification panel: shows the transfer instructions
 * and takes the receipt link / telebirr reference. After submit, the
 * scheduled action verifies at the bank — linksetStatus flows back through
 * the reactive payment query.
 */
/** Where customers send money for bank-transfer top-ups. Set these in the
    project's env/Keys UI — they are public-facing details, safe as VITE_ vars. */
const BANK_DETAILS = {
  telebirr: import.meta.env.VITE_LUBA_TELEBIRR as string | undefined,
  bankName: import.meta.env.VITE_LUBA_BANK_NAME as string | undefined,
  accountNumber: import.meta.env.VITE_LUBA_BANK_ACCOUNT as string | undefined,
  accountName: import.meta.env.VITE_LUBA_ACCOUNT_NAME as string | undefined,
};

function ReceiptVerifyPanel({
  receiptInput,
  onInputChange,
  onVerify,
  busy,
}: {
  receiptInput: string;
  onInputChange: (v: string) => void;
  onVerify: () => void;
  busy: boolean;
}) {
  const [pending, setPending] = useState<{
    paymentId: string;
    amountSantims: number;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("luba_linkset_payment");
      setPending(raw ? JSON.parse(raw) : null);
    } catch {
      setPending(null);
    }
  }, []);

  const hasDetails = Boolean(BANK_DETAILS.telebirr || BANK_DETAILS.accountNumber);

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
      <p className="text-sm font-semibold">Bank transfer — 3 steps</p>

      {/* Step 1: where to send the money. The previous version said "details
          below" but never showed them — the #1 source of confusion. */}
      <div className="mt-3 rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Step 1 — Send exactly{" "}
          <span className="text-foreground">
            {pending ? formatETB(pending.amountSantims) + " ETB" : "your amount"}
          </span>
        </p>
        {hasDetails ? (
          <dl className="mt-2 space-y-1.5 text-sm">
            {BANK_DETAILS.telebirr && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-xs text-muted-foreground">telebirr</dt>
                <dd className="flex items-center gap-1.5 font-mono font-semibold">
                  {BANK_DETAILS.telebirr}
                  <button
                    type="button"
                    aria-label="Copy telebirr number"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      void navigator.clipboard.writeText(BANK_DETAILS.telebirr!);
                      toast.success("telebirr number copied");
                    }}
                  >
                    <Copy className="size-3.5" />
                  </button>
                </dd>
              </div>
            )}
            {BANK_DETAILS.accountNumber && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-xs text-muted-foreground">
                  {BANK_DETAILS.bankName ?? "Bank"}
                </dt>
                <dd className="flex items-center gap-1.5 font-mono font-semibold">
                  {BANK_DETAILS.accountNumber}
                  <button
                    type="button"
                    aria-label="Copy account number"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        BANK_DETAILS.accountNumber!,
                      );
                      toast.success("Account number copied");
                    }}
                  >
                    <Copy className="size-3.5" />
                  </button>
                </dd>
              </div>
            )}
            {BANK_DETAILS.accountName && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-xs text-muted-foreground">Account name</dt>
                <dd className="text-sm font-medium">{BANK_DETAILS.accountName}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
            Account details are not configured yet — add VITE_LUBA_TELEBIRR (and
            optionally VITE_LUBA_BANK_NAME / VITE_LUBA_BANK_ACCOUNT /
            VITE_LUBA_ACCOUNT_NAME) in the project's Keys tab.
          </p>
        )}
      </div>

      {/* Step 2: get the receipt */}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        <span className="font-semibold text-foreground">Step 2 — </span>
        After paying, copy the receipt link from your bank app / telebirr SMS
        confirmation (or note the transaction reference).
      </p>

      {/* Step 3: verify */}
      <p className="mt-2.5 text-xs leading-5 text-muted-foreground">
        <span className="font-semibold text-foreground">Step 3 — </span>
        Paste it below. Our system fetches the receipt from the bank itself and
        credits your wallet — usually under a minute.
      </p>
      <div className="mt-2.5 space-y-2">
        <Label htmlFor="receipt-value" className="text-xs">
          Receipt link or reference
        </Label>
        <Input
          id="receipt-value"
          placeholder="https://… or telebirr reference"
          value={receiptInput}
          onChange={(e) => onInputChange(e.target.value)}
          className="h-12 text-base sm:h-10 sm:text-sm"
        />
        <Button
          className="h-12 w-full text-base sm:h-10 sm:text-sm"
          disabled={busy || !pending || !receiptInput.trim()}
          onClick={onVerify}
        >
          {busy ? (
            <>
              <Loader2 className="mr-1.5 size-4 animate-spin" />
              Verifying with your bank…
            </>
          ) : (
            "Verify receipt"
          )}
        </Button>
      </div>
      {!pending && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-500">
          Start the top-up first (enter an amount above and tap Add funds) —
          that registers the exact amount we'll verify against.
        </p>
      )}
    </div>
  );
}

function ReceiptsPanel() {
  const receipts = useQuery(api.transparency.myReceipts, {}) ?? [];
  if (receipts.length === 0) {
    return (
      <EmptyState
        icon={<ReceiptText className="size-8 text-muted-foreground/50" />}
        title="No transactions yet"
        body="Every deposit, bid fee, refund, and win appears here as an auditable receipt."
      />
    );
  }
  return (
    /* Scroll container outside, rounded card inside — overflow-x must own
       the scroll or the card's overflow-hidden clips it (prior bug). */
    <div className="table-scroll">
      <div className="min-w-[560px] overflow-hidden rounded-2xl border border-border bg-card shadow-layered">
        <table className="data-table w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 font-medium">Event</th>
            <th className="px-4 py-3 font-medium">Reference</th>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r._id} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-3 font-medium">{r.description}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {String(r.reference).slice(0, 18)}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleString()}
              </td>
              <td
                className={cn(
                  "px-4 py-3 text-right font-semibold tabular-nums",
                  r.amountSantims >= 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-foreground",
                )}
              >
                {r.amountSantims >= 0 ? "+" : "−"}
                {formatETB(Math.abs(r.amountSantims))}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

function ReferralCard() {
  const info = useQuery(api.growth.getMyReferralInfo, {});
  const ensureCode = useMutation(api.growth.ensureReferralCode);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (info && info.referralCode === null && !busy) {
      setBusy(true);
      ensureCode({}).finally(() => setBusy(false));
    }
  }, [info, busy, ensureCode]);

  if (!info) return <div className="h-20 animate-pulse rounded-xl bg-secondary/50" />;

  const shareUrl = info.referralCode
    ? `${window.location.origin}/auth?ref=${info.referralCode}`
    : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-secondary/60 p-3">
          <p className="text-lg font-bold tabular-nums">{info.totalReferred}</p>
          <p className="text-[11px] text-muted-foreground">Friends joined</p>
        </div>
        <div className="rounded-xl bg-secondary/60 p-3">
          <p className="text-lg font-bold tabular-nums">{info.totalRewarded}</p>
          <p className="text-[11px] text-muted-foreground">Rewards earned</p>
        </div>
        <div className="rounded-xl bg-secondary/60 p-3">
          <p className="text-lg font-bold text-primary tabular-nums">
            {formatETB(info.promoBalanceSantims)}
          </p>
          <p className="text-[11px] text-muted-foreground">Promo balance</p>
        </div>
      </div>
      {shareUrl && (
        <>
          <div className="rounded-xl border border-border bg-secondary/40 p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Your code
            </p>
            <p className="mt-0.5 font-mono text-lg font-bold tracking-widest">
              {info.referralCode}
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              void navigator.clipboard.writeText(shareUrl);
              toast.success("Invite link copied", {
                description: "You both get promo credit when they place their first bid.",
              });
            }}
          >
            <Gift className="mr-1.5 size-4" />
            Copy invite link
          </Button>
          {/* Telegram viral share: pre-formatted invite via t.me/share */}
          <a
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#229ED9]/40 bg-[#229ED9]/10 text-sm font-medium text-[#229ED9] transition-colors hover:bg-[#229ED9]/20"
            target="_blank"
            rel="noreferrer"
            href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent("🎁 Join me on LUBA — the lowest UNIQUE bid wins the prize. Sign up and we both get bonus credit:")}`}
          >
            <Send className="size-4" />
            Share invite on Telegram
          </a>
        </>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Promo credit is spent automatically on bid fees before your deposited
        balance.
      </p>
    </div>
  );
}

const PREF_LABELS: Record<string, string> = {
  BID_ACCEPTED: "Bid confirmations",
  AUCTION_ENDING: "Auction ending soon",
  WINNER_ANNOUNCED: "Winner announcements",
  PAYMENT_REMINDER: "Payment reminders",
  PAYMENT_SUCCESS: "Payment receipts",
  PRIZE_STATUS: "Prize delivery updates",
  WATCHLIST_ALERT: "Watchlist alerts",
};

const PREF_DESCRIPTIONS: Record<string, string> = {
  BID_ACCEPTED: "Confirmation each time one of your bids is accepted",
  AUCTION_ENDING: "Alert before an auction you entered is about to close",
  WINNER_ANNOUNCED: "Results when an auction you bid in is settled",
  PAYMENT_REMINDER: "Nudges when a winning-bid payment is due",
  PAYMENT_SUCCESS: "Receipts for deposits and wallet credits",
  PRIZE_STATUS: "Claim, verification and delivery milestones",
  WATCHLIST_ALERT: "Ending-soon alerts for auctions you're watching",
};

function NotificationPrefsCard() {
  const prefs = useQuery(api.engagement.getMyNotificationPrefs, {});
  const setPref = useMutation(api.engagement.setNotificationPref);
  const [pending, setPending] = useState<string | null>(null);

  if (!prefs) return <div className="h-24 animate-pulse rounded-xl bg-secondary/50" />;

  return (
    <div className="space-y-2">
      {Object.entries(PREF_LABELS).map(([key, label]) => {
        const value = (prefs as Record<string, unknown>)[key] !== false;
        // The whole row is the control (role="switch", aria-checked) — one
        // generous tap target with the title, the description, and the
        // visual toggle. The inner Switch is decorative (aria-hidden,
        // pointer-events-none) so a single tap can never double-fire.
        return (
          <button
            key={key}
            type="button"
            role="switch"
            aria-checked={value}
            disabled={pending === key}
            onClick={() => {
              setPending(key);
              setPref({ key, value: !value })
                .then(() => toast.success(`"${label}" ${!value ? "on" : "off"}`))
                .finally(() => setPending(null));
            }}
            className="flex w-full items-center justify-between gap-3 rounded-xl bg-secondary/40 px-4 py-3 text-left transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {PREF_DESCRIPTIONS[key]}
              </span>
            </span>
            <Switch checked={value} aria-hidden tabIndex={-1} className="pointer-events-none" />
          </button>
        );
      })}
      <p className="text-xs leading-5 text-muted-foreground">
        Critical security and account notices are always delivered.
      </p>
    </div>
  );
}

function ResponsiblePlayCard() {
  const limits = useQuery(api.growth.getMyLimits, {});
  const setLimits = useMutation(api.growth.setResponsiblePlayLimits);
  const [capInput, setCapInput] = useState("");
  const [busy, setBusy] = useState(false);

  if (!limits) return <div className="h-20 animate-pulse rounded-xl bg-secondary/50" />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-secondary/40 p-3.5 text-sm">
        <p className="text-muted-foreground">
          Daily deposit cap:{" "}
          <span className="font-semibold text-foreground">
            {limits.depositCapSantims !== null
              ? formatETB(limits.depositCapSantims)
              : "No limit set"}
          </span>
        </p>
        {limits.capPendingSantims !== null && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Raise to {formatETB(limits.capPendingSantims)} takes effect after 24h.
          </p>
        )}
        {limits.currentlyExcluded && limits.selfExcludedUntil && (
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">
            You are self-excluded until{" "}
            {new Date(limits.selfExcludedUntil).toLocaleDateString()}.
          </p>
        )}
      </div>
      {/* Stack on phones — input + button side-by-side overflows at 320px. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Daily deposit cap in ETB"
          value={capInput}
          onChange={(e) => setCapInput(e.target.value)}
          placeholder="e.g. 500"
          inputMode="decimal"
          className="h-10"
        />
        <Button
          variant="outline"
          className="h-10 shrink-0"
          disabled={busy || parseETBToSantims(capInput) === null}
          onClick={async () => {
            const s = parseETBToSantims(capInput);
            if (s === null) return;
            setBusy(true);
            try {
              await setLimits({ dailyDepositCapSantims: s });
              toast.success("Deposit cap saved");
              setCapInput("");
            } catch (err) {
              toast.error("Couldn't save your cap", { description: friendlyError(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          Set cap
        </Button>
      </div>
      <Button
        variant="outline"
        className="w-full border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-400"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await setLimits({ selfExcludeDays: 30 });
            toast.info("Self-exclusion active for 30 days", {
              description: "Bidding and deposits are disabled until it lifts.",
            });
          } catch (err) {
            toast.error("Couldn't start your break", { description: friendlyError(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        Take a 30-day break
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">
        Caps you set can only be lowered instantly; raising one takes 24 hours
        to take effect. Limits are enforced server-side and cannot be bypassed.
      </p>
    </div>
  );
}

function MethodRow({
  icon,
  title,
  subtitle,
  connected,
  locked = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  connected: boolean;
  locked?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {connected ? (
        <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="mr-1 size-3" /> Connected
        </Badge>
      ) : (
        <Badge variant="secondary">Not linked</Badge>
      )}
      {locked && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
          Primary
        </span>
      )}
    </div>
  );
}

function TelegramLinkRow({
  methods,
  onStart,
  onUnlink,
  busy,
  setBusy,
}: {
  methods: {
    telegramChatId: string | null;
    telegramConfigured: boolean;
  };
  onStart: (args: {
    method: "telegram" | "phone";
    destination: string;
    appOrigin?: string;
  }) => Promise<unknown>;
  onUnlink: (args: { method: "telegram" | "phone" }) => Promise<unknown>;
  busy: boolean;
  setBusy: (v: string | null) => void;
}) {
  const [chatId, setChatId] = useState("");
  const connected = Boolean(methods.telegramChatId);

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-3.5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Send className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Telegram</p>
          <p className="truncate text-xs text-muted-foreground">
            {connected
              ? `Linked to chat ID ${methods.telegramChatId}`
              : methods.telegramConfigured
                ? "Get alerts and sign in with Telegram"
                : "Unavailable — bot not configured"}
          </p>
        </div>
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy("unlink-telegram");
              try {
                await onUnlink({ method: "telegram" });
                toast.success("Telegram unlinked");
              } catch (err) {
                toast.error("Couldn't unlink Telegram", { description: friendlyError(err) });
              } finally {
                setBusy(null);
              }
            }}
          >
            <Unlink className="mr-1.5 size-3.5" />
            Unlink
          </Button>
        ) : (
          <Badge variant="secondary">Not linked</Badge>
        )}
      </div>
      {!connected && methods.telegramConfigured && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={chatId}
            aria-label="Your Telegram chat ID"
            onChange={(e) => setChatId(e.target.value)}
            placeholder="Your Telegram ID — e.g. 123456789"
            inputMode="numeric"
            className="h-10 font-mono"
          />
          <Button
            className="h-10 shrink-0"
            disabled={busy || !/^\d{5,}$/.test(chatId.trim())}
            onClick={async () => {
              setBusy("link-telegram");
              try {
                await onStart({
                  method: "telegram",
                  destination: chatId.trim(),
                  appOrigin: window.location.origin,
                });
                toast.success("Check your Telegram", {
                  description: "We sent a confirmation link — open it to finish linking.",
                });
                setChatId("");
              } catch (err) {
                toast.error("Couldn't start linking", { description: friendlyError(err) });
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Link2 className="mr-1.5 size-4" />
            )}
            Link
          </Button>
        </div>
      )}
      {/* P5.2: direct deep-link to the bot so users can grab their ID / verify
          the chat is with the exact account they signed up with. */}
      <a
        href="https://t.me/luba_auction_bot"
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        <Send className="size-3.5" />
        Open @luba_auction_bot in Telegram
      </a>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
        Caution: use the exact Telegram account you originally signed up with.
      </p>
    </div>
  );
}

function PhoneLinkRow({
  methods,
  onStart,
  onUnlink,
  busy,
  setBusy,
}: {
  methods: { phone: string | null; phoneVerified: boolean; smsConfigured: boolean };
  onStart: (args: {
    method: "telegram" | "phone";
    destination: string;
    appOrigin?: string;
  }) => Promise<unknown>;
  onUnlink: (args: { method: "telegram" | "phone" }) => Promise<unknown>;
  busy: boolean;
  setBusy: (v: string | null) => void;
}) {
  const [phone, setPhone] = useState("");
  const connected = Boolean(methods.phoneVerified);

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-3.5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Smartphone className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Phone (SMS)</p>
          <p className="truncate text-xs text-muted-foreground">
            {connected
              ? `Verified ${methods.phone}`
              : "Get alerts and sign in with SMS"}
          </p>
        </div>
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy("unlink-phone");
              try {
                await onUnlink({ method: "phone" });
                toast.success("Phone unlinked");
              } catch (err) {
                toast.error("Couldn't unlink your phone", { description: friendlyError(err) });
              } finally {
                setBusy(null);
              }
            }}
          >
            <Unlink className="mr-1.5 size-3.5" />
            Unlink
          </Button>
        ) : (
          <Badge variant="secondary">Not linked</Badge>
        )}
      </div>
      {!connected && methods.smsConfigured && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={phone}
            aria-label="Your phone number"
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 0911223344"
            inputMode="tel"
            className="h-10"
          />
          <Button
            className="h-10 shrink-0"
            disabled={busy || phone.trim().length < 10}
            onClick={async () => {
              setBusy("link-phone");
              try {
                await onStart({
                  method: "phone",
                  destination: phone.trim(),
                  appOrigin: window.location.origin,
                });
                toast.success("Check your messages", {
                  description: "We sent a confirmation link by SMS — open it to finish linking.",
                });
                setPhone("");
              } catch (err) {
                toast.error("Couldn't start linking", { description: friendlyError(err) });
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Link2 className="mr-1.5 size-4" />
            )}
            Link
          </Button>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "primary" | "amber";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 shadow-layered sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            tone === "primary"
              ? "bg-primary/10 text-primary"
              : tone === "amber"
                ? "bg-amber-100 text-amber-700"
                : "bg-secondary text-muted-foreground",
          )}
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 text-xl font-bold tabular-nums tracking-tight sm:text-2xl">
        {value}
      </p>
    </div>
  );
}

function PaymentsList() {
  const payments = useQuery(api.payments.getMyPayments, {});
  const reverify = useMutation(api.payments.startChapaReverify);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const handleReverify = async (paymentId: string) => {
    setVerifyingId(paymentId);
    try {
      const res = await reverify({ paymentId: paymentId as never });
      if (res.scheduled) {
        toast.info("Checking with Chapa…", {
          description:
            "This takes a few seconds — the payment updates automatically when confirmed.",
        });
      }
      // When !scheduled the row was already COMPLETED; the live query reflects it.
    } catch (err) {
      toast.error("Could not check that payment", {
        description: friendlyError(err),
      });
    } finally {
      setVerifyingId(null);
    }
  };

  if (payments === undefined) return <LoadingRows />;
  if (payments.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No payments yet.
      </p>
    );
  }
  return (
    <div className="divide-y divide-border/60">
      {payments.map((p) => (
        <div key={p._id} className="flex items-center justify-between py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {p.kind === "DEPOSIT" ? "Wallet top-up" : "Winning bid payment"}
            </p>
            {/* links.et receipts surface their live verification state. */}
            {p.provider === "linkset" && p.linksetStatus === "verifying" ? (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                <Loader2 className="size-3 animate-spin" /> Verifying with
                bank…
              </p>
            ) : p.provider === "linkset" && p.linksetError ? (
              <p className="mt-0.5 line-clamp-2 max-w-xs text-xs text-rose-700 dark:text-rose-300">
                {p.linksetError}
              </p>
            ) : (
              <p className="truncate font-mono text-xs text-muted-foreground">
                {p.merchantReference}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums">
              {formatETB(p.amountSantims)}
            </p>
            <Badge
              className={cn(
                "mt-0.5 border-transparent",
                p.status === "COMPLETED"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : p.status === "PENDING"
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
              )}
            >
              {p.status === "PENDING" && p.linksetStatus === "verifying"
                ? "VERIFYING"
                : p.status}
            </Badge>
            {/* Recovery path: a Chapa payment can sit in PENDING when the
                webhook was missed and the user closed the tab mid-verify.
                Give the user a direct way to re-check with the provider —
                the reconciler cron also self-heals these every 10 minutes. */}
            {p.status === "PENDING" && p.provider === "chapa" && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-7 px-2 text-xs"
                disabled={verifyingId !== null}
                onClick={() => handleReverify(p._id)}
              >
                {verifyingId === p._id ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <Clock className="mr-1 size-3" />
                )}
                Verify again
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl border border-border bg-card"
        />
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-12 text-center">
      <div className="flex justify-center">{icon}</div>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {body}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

function KycVerificationCard() {
  const kyc = useQuery(api.kyc.getMyKyc, {});
  const generateUrl = useMutation(api.kyc.generateKycUploadUrl);
  const submitDoc = useMutation(api.kyc.submitKycDocument);
  const [uploading, setUploading] = useState(false);

  if (kyc === undefined) {
    return <div className="h-20 animate-pulse rounded-xl bg-secondary/50" />;
  }
  if (kyc === null) {
    return <p className="text-sm text-muted-foreground">Sign in to manage verification.</p>;
  }

  /* Dual-tone status map — light theme needs 700-weights on white (master
     skill contrast rule); 500-weight on a 15% tint is ~2.5:1. */
  const statusBadge = {
    UNVERIFIED: { label: "Not verified", cls: "bg-secondary text-secondary-foreground" },
    PENDING: { label: "Under review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-500" },
    VERIFIED: { label: "Verified", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-500" },
    REJECTED: { label: "Rejected — you can resubmit", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-500" },
  }[kyc.kycStatus] ?? { label: kyc.kycStatus, cls: "bg-secondary text-secondary-foreground" };

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File is larger than 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const uploadUrl = await generateUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await submitDoc({ storageId, fileName: file.name });
      toast.success("Document submitted for review.");
    } catch (err) {
      toast.error("Upload failed", { description: friendlyError(err) });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className={cn("border-transparent", statusBadge.cls)}>
          {statusBadge.label}
        </Badge>
        {kyc.kycStatus === "VERIFIED" && <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-500" />}
      </div>

      {kyc.kycNote && kyc.kycStatus === "REJECTED" && (
        <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          {kyc.kycNote}
        </p>
      )}

      {kyc.documents.length > 0 && (
        <div className="space-y-1.5">
          {kyc.documents.map((doc) => (
            <div
              key={doc._id}
              className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs"
            >
              <span className="truncate">{doc.fileName}</span>
              <span
                className={cn(
                  "ml-2 shrink-0 font-medium",
                  doc.status === "APPROVED" &&
                    "text-emerald-700 dark:text-emerald-500",
                  doc.status === "PENDING" && "text-amber-700 dark:text-amber-500",
                  doc.status === "REJECTED" && "text-rose-700 dark:text-rose-500",
                )}
              >
                {doc.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {kyc.kycStatus !== "PENDING" && (
        <div>
          <Label htmlFor="kyc-upload" className="text-xs text-muted-foreground">
            Government-issued ID, passport, or driving license (JPEG, PNG, WebP, or PDF · max 5 MB)
          </Label>
          <Input
            id="kyc-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="mt-2 cursor-pointer"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          {uploading && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Uploading…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
