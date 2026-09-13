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
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatETB, parseETBToSantims } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Clock,
  CreditCard,
  FlaskConical,
  Gavel,
  Gift,
  Loader2,
  LogOut,
  Trophy,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

const TOPUP_PRESETS = [5000, 10000, 25000, 50000, 100000]; // santims: 50 / 100 / 250 / 500 / 1000 ETB

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const wallet = useQuery(api.payments.getMyWallet, {});
  const myBids = useQuery(api.bids.getMyBids, {});
  const notifications = useQuery(api.bids.getMyNotifications, {});
  const settlements = useQuery(api.payments.getMySettlements, {});
  const auctions = useQuery(api.auctions.listOpenAuctions, {});

  const markRead = useMutation(api.bids.markNotificationsRead);
  const topUp = useMutation(api.payments.initiateTopUp);
  const confirmManualTopUp = useMutation(api.payments.confirmManualTopUp);
  const cancelMyTopUp = useMutation(api.payments.cancelMyTopUp);
  const startChapaCheckout = useAction(api.chapa.initializeCheckout);
  const payWinningBid = useMutation(api.payments.payWinningBid);

  const [topUpInput, setTopUpInput] = useState("");
  const [topUpProvider, setTopUpProvider] = useState<"chapa" | "manual">(
    "chapa",
  );
  const [busy, setBusy] = useState<string | null>(null);

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
    fetch("/payments/chapa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantReference: parsed.merchantReference,
        token: parsed.token,
      }),
    })
      .then((r) => r.json())
      .then((res: { ok?: boolean; status?: string; error?: string }) => {
        if (res.ok && res.status === "COMPLETED") {
          toast.success("Top-up complete", {
            description: `${formatETB(parsed.amountSantims)} added to your wallet.`,
          });
        } else if (res.ok) {
          toast.info("Payment still processing", {
            description:
              "Your wallet will be credited automatically once the provider confirms the payment.",
          });
        } else {
          toast.error("We could not confirm your payment", {
            description: res.error ?? "Please try again or contact support.",
          });
        }
      })
      .catch(() =>
        toast.error("We could not confirm your payment", {
          description: "Check your payment history in a moment.",
        }),
      )
      .finally(() => setBusy(null));
  }, []);

  const handleTopUp = async (santims: number) => {
    setBusy("topup");
    try {
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
      const raw = err instanceof Error ? err.message : "UNKNOWN";
      toast.error("Top-up failed", {
        description:
          raw === "INVALID_AMOUNT"
            ? "Enter a valid amount."
            : raw === "UNAUTHENTICATED"
              ? "Your session expired — sign in and try again."
              : raw,
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
      const raw = err instanceof Error ? err.message : "";
      toast.error(
        raw.includes("INSUFFICIENT") || raw.includes("insufficient")
          ? "Not enough balance"
          : "Payment failed",
        { description: "Top up your wallet and try again." },
      );
    } finally {
      setBusy(null);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const auctionTitle = (auctionId: Id<"auctions">) =>
    (auctions ?? []).find((a) => a._id === auctionId);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Account overview
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
              Welcome{user?.name ? `, ${user.name}` : ""}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={handleSignOut}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <h2 className="flex items-center gap-2 font-semibold text-amber-300">
              <Trophy className="size-5" />
              Congratulations — you have {pendingSettlements.length === 1 ? "a win" : `${pendingSettlements.length} wins`} to pay
            </h2>
            <div className="mt-4 space-y-3">
              {pendingSettlements.map((s) => (
                <div
                  key={s._id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-card p-4"
                >
                  <div>
                    <p className="font-mono text-sm font-semibold">
                      Winning bid {formatETB(s.winningBidValueSantims)}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="size-3.5" />
                      Pay before {new Date(s.paymentDeadline).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    onClick={() => handlePayWin(s._id)}
                    disabled={busy === s._id}
                  >
                    {busy === s._id ? (
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                    ) : (
                      <ArrowUpRight className="mr-1.5 size-4" />
                    )}
                    Pay winning bid
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="bids" className="mt-8">
          <TabsList className="h-11 w-full justify-start gap-1 rounded-xl bg-secondary/70 p-1 sm:w-auto">
            <TabsTrigger value="bids" className="gap-1.5 rounded-lg">
              <Gavel className="size-4" /> My Bids
            </TabsTrigger>
            <TabsTrigger value="wallet" className="gap-1.5 rounded-lg">
              <Wallet className="size-4" /> Wallet
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5 rounded-lg">
              <Bell className="size-4" />
              Alerts
              {unreadCount > 0 && (
                <Badge className="ml-1 h-5 border-transparent bg-primary px-1.5 text-[10px] text-primary-foreground">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="profile" className="gap-1.5 rounded-lg">
              Profile
            </TabsTrigger>
          </TabsList>

          {/* ─── My Bids ──────────────────────────────────────────────────── */}
          <TabsContent value="bids" className="mt-5">
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
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-layered">
                <table className="w-full text-sm">
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
                          <td className="px-4 py-3 font-mono">
                            {formatETB(b.bidValueSantims)}
                          </td>
                          <td className="px-4 py-3 font-mono text-muted-foreground">
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
                                  ? "bg-emerald-500/10 text-emerald-300"
                                  : "bg-rose-500/10 text-rose-300",
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
                        <div className="size-14 shrink-0 overflow-hidden rounded-lg">
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
          <TabsContent value="wallet" className="mt-5">
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
                    <p className="mt-1 font-mono text-3xl font-bold">
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
                      className="h-11 font-mono"
                    />
                    <Button
                      className="h-11 w-full"
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
                  <div className="flex flex-wrap gap-2">
                    {TOPUP_PRESETS.map((p) => (
                      <Button
                        key={p}
                        variant="outline"
                        size="sm"
                        disabled={busy === "topup"}
                        onClick={() => handleTopUp(p)}
                      >
                        {formatETB(p)}
                      </Button>
                    ))}
                  </div>
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
                  <p className="text-xs leading-5 text-muted-foreground">
                    Deposits are credited to your wallet as soon as the provider
                    confirms the payment. Bid fees are charged from this balance
                    per bid.
                  </p>
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
          </TabsContent>

          {/* ─── Notifications ────────────────────────────────────────────── */}
          <TabsContent value="notifications" className="mt-5">
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
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
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
                          ? "bg-amber-500/10 text-amber-300"
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

          {/* ─── Profile ──────────────────────────────────────────────────── */}
          <TabsContent value="profile" className="mt-5">
            <Card className="max-w-xl border-border shadow-layered">
              <CardHeader>
                <CardTitle className="text-base">Profile</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-4 py-3">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">
                    {user?.name ?? user?.email ?? "—"}
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
                  <Badge className="border-transparent bg-emerald-500/10 text-emerald-300">
                    Verified
                  </Badge>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Account settings, language preferences, and security options
                  arrive with the next release. Your wallet and bids remain
                  fully functional.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <SiteFooter />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

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
    <div className="rounded-2xl border border-border bg-card p-4 shadow-layered">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-lg",
            tone === "primary"
              ? "bg-primary/10 text-primary"
              : tone === "amber"
                ? "bg-amber-100 text-amber-700"
                : "bg-secondary text-secondary-foreground",
          )}
        >
          {icon}
        </span>
        <TrendingUp className="size-4 text-muted-foreground/40" />
      </div>
      <p className="mt-3 font-mono text-xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function PaymentsList() {
  const payments = useQuery(api.payments.getMyPayments, {});
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
          <div>
            <p className="text-sm font-medium">
              {p.kind === "DEPOSIT" ? "Wallet top-up" : "Winning bid payment"}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {p.merchantReference}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm font-semibold">
              {formatETB(p.amountSantims)}
            </p>
            <Badge
              className={cn(
                "mt-0.5 border-transparent",
                p.status === "COMPLETED"
                  ? "bg-emerald-500/10 text-emerald-300"
                  : p.status === "PENDING"
                    ? "bg-amber-500/10 text-amber-300"
                    : "bg-rose-500/10 text-rose-300",
              )}
            >
              {p.status}
            </Badge>
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
