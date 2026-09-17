import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { formatETB } from "@/lib/money";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Activity,
  Ban,
  Banknote,
  Camera,
  CheckCircle2,
  Gavel,
  ImageIcon,
  Loader2,
  Megaphone,
  Pause,
  Play,
  Search,
  ShieldCheck,
  ShieldX,
  Square,
  Timer,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/luba";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableTabs, ActiveTabScroll } from "@/components/scrollable-tabs";
import { cn } from "@/lib/utils";
import { cleanConvexError } from "@/lib/errors";

/**
 * Admin console — spec §41–43.
 * Reachable only by users with the admin role; every sensitive action is
 * audited server-side. Convex reactive queries keep the views live.
 *
 * The role gate renders BEFORE the console so a non-admin never subscribes
 * to the admin queries (which would throw FORBIDDEN_ADMIN_ONLY).
 */
export default function Admin() {
  const { user, isLoading } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pb-24 sm:px-6 md:pb-8">
        {isLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : user?.role !== "admin" && user?.role !== "super_admin" ? (
          <RestrictedArea userName={user?.email ?? null} />
        ) : (
          <AdminConsole />
        )}
      </main>
      <SiteFooter />          </div>
  );
}


function AdminConsole() {
  const { user: currentUser } = useAuth();
  const stats = useQuery(api.admin.getPlatformStats, {});
  const users = useQuery(api.admin.listUsers, {});
  const payments = useQuery(api.admin.listPaymentsAdmin, {});
  const auditLogs = useQuery(api.admin.listAuditLogs, {});
  const campaigns = useQuery(api.admin.listAllAuctions, {});
  const prizes = useQuery(api.admin.listPrizes, {});
  const finance = useQuery(api.admin.getFinanceDashboard, {});
  const settlements = useQuery(api.admin.listSettlementsAdmin, {});
  const notifSettings = useQuery(api.admin.getNotificationSettings, {});

  const grantRole = useMutation(api.admin.grantRole);
  const revokeAdmin = useMutation(api.admin.revokeAdmin);
  const setUserStatus = useMutation(api.admin.setUserStatus);
  const cancelAuction = useMutation(api.admin.adminCancelAuction);
  const settleAuction = useMutation(api.admin.adminSettleAuction);
  const adjustWallet = useMutation(api.admin.adminAdjustWallet);
  const createAuction = useMutation(api.admin.createAuction);
  const createPrize = useMutation(api.admin.createPrize);
  const openNow = useMutation(api.admin.openAuctionNow);
  const pauseAuction = useMutation(api.admin.pauseAuction);
  const resumeAuction = useMutation(api.admin.resumeAuction);
  const extendAuction = useMutation(api.admin.extendAuction);
  const markWinnerPaid = useMutation(api.admin.markWinnerPaid);
  const markPrizeFulfilled = useMutation(api.admin.markPrizeFulfilled);
  const forfeitAndReopen = useMutation(api.admin.forfeitAndReopen);
  const adminRefund = useMutation(api.admin.adminRefund);
  const setKycStatus = useMutation(api.admin.setKycStatus);
  const removeBid = useMutation(api.admin.removeBid);
  const setNotificationSetting = useMutation(api.admin.setNotificationSetting);
  const broadcastAnnouncement = useMutation(api.admin.broadcastAnnouncement);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const attachImageToPrize = useMutation(api.files.attachImageToPrize);
  const deductWallet = useMutation(api.admin.adminDeductWallet);
  const forceClose = useMutation(api.admin.forceCloseAuction);
  const setGatewayEnabled = useMutation(api.admin.setGatewayEnabled);
  const gateways = useQuery(api.admin.getGatewaySettings, {});
  const ledgerTxs = useQuery(api.admin.listLedgerTransactions, { limit: 50 });
  const withdrawals = useQuery(api.accountOps.listWithdrawalsAdmin, {});
  const fraudSignals = useQuery(api.admin.listFraudSignalsAdmin, {});
  const reviewWithdrawal = useMutation(api.accountOps.reviewWithdrawal);
  const runFraudScan = useMutation(api.admin.scanSharedPayerPhones);
  const markSignalReviewed = useMutation(api.admin.reviewFraudSignal);
  const [profileUser, setProfileUser] = useState<Id<"users"> | null>(null);

  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [freqAuction, setFreqAuction] = useState<{
    id: Id<"auctions">;
    code: string;
    title: string;
  } | null>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);

  const filteredUsers = (users ?? []).filter(
    (u) =>
      !search ||
      (u.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const act = async (key: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(key);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      return true;
    } catch (err) {
      toast.error(cleanConvexError(err) || "Action failed");
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Operations console
            </p>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              Admin
            </h1>
          </div>
        </div>

        {/* Platform stats */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Users className="size-5" />}
            label="Registered users"
            value={stats ? String(stats.userCount) : "…"}
          />
          <StatCard
            icon={<Gavel className="size-5" />}
            label="Open auctions"
            value={stats ? `${stats.activeAuctions} / ${stats.totalAuctions}` : "…"}
          />
          <StatCard
            icon={<Activity className="size-5" />}
            label="Accepted bids"
            value={stats ? String(stats.totalBids) : "…"}
          />
          <StatCard
            icon={<Wallet className="size-5" />}
            label="Deposits (completed)"
            value={stats ? formatETB(stats.payments.depositedSantims) : "…"}
          />
        </div>

        {/* Financial overview (from the ledger — spec §41) */}
        {finance && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<TrendingUp className="size-5" />}
              label="Bid-fee revenue"
              value={formatETB(finance.feeRevenueSantims)}
            />
            <StatCard
              icon={<Banknote className="size-5" />}
              label="Winner payments"
              value={formatETB(finance.winnerPaymentsSantims)}
            />
            <StatCard
              icon={<Activity className="size-5" />}
              label="Refunds issued"
              value={formatETB(finance.refundsSantims)}
            />
            <StatCard
              icon={<Timer className="size-5" />}
              label="Pending / overdue claims"
              value={`${finance.pendingSettlements} / ${finance.overdueSettlements}`}
            />
          </div>
        )}

        {/* Ledger integrity banner */}
        {stats && (
          <div
            className={cn(
              "mt-4 rounded-xl border p-4 text-sm",
              stats.ledger.balanced
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                : "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300",
            )}
          >
            {stats.ledger.balanced ? (
              <>
                <span className="font-semibold">Ledger balanced.</span>{" "}
                {stats.ledger.transactionCount} transactions · debits{" "}
                {formatETB(stats.ledger.totalDebitsSantims)} = credits{" "}
                {formatETB(stats.ledger.totalCreditsSantims)} · outbox pending:{" "}
                {stats.outboxPending}
              </>
            ) : (
              <>
                <span className="font-semibold">LEDGER IMBALANCE DETECTED.</span>{" "}
                Debits {formatETB(stats.ledger.totalDebitsSantims)} ≠ credits{" "}
                {formatETB(stats.ledger.totalCreditsSantims)} — investigate
                immediately.
              </>
            )}
          </div>
        )}

        <Tabs defaultValue="users" className="mt-8">
          {/* P4.10: horizontally scrollable tab strip on small screens —
              scroll-aware fades + chevrons (see ScrollableTabs). */}
          <ScrollableTabs>
          {/* min-w-max: keep the pill behind ALL triggers when the 12 tabs
              overflow (see Dashboard note). */}
          <TabsList className="h-11 w-full min-w-max justify-start gap-1 rounded-xl bg-secondary/70 p-1">
            <TabsTrigger value="users" className="gap-1.5 rounded-lg">
              <Users className="size-4" /> Users
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5 rounded-lg">
              <Wallet className="size-4" /> Payments
            </TabsTrigger>
            <TabsTrigger value="auctions" className="gap-1.5 rounded-lg">
              <Gavel className="size-4" /> Campaigns
            </TabsTrigger>
            <TabsTrigger value="claims" className="gap-1.5 rounded-lg">
              <UserCheck className="size-4" /> Claims
            </TabsTrigger>
            <TabsTrigger value="finance" className="gap-1.5 rounded-lg">
              <Banknote className="size-4" /> Finance
            </TabsTrigger>
            <TabsTrigger value="kyc" className="gap-1.5 rounded-lg">
              <ShieldCheck className="size-4" /> KYC
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 rounded-lg">
              <Megaphone className="size-4" /> Settings
            </TabsTrigger>
            <TabsTrigger value="withdrawals" className="gap-1.5 rounded-lg">
              <Banknote className="size-4" /> Withdrawals
            </TabsTrigger>
            <TabsTrigger value="fraud" className="gap-1.5 rounded-lg">
              <ShieldX className="size-4" /> Fraud
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1.5 rounded-lg">
              <Activity className="size-4" /> Audit log
            </TabsTrigger>
          </TabsList>
          <ActiveTabScroll />
          </ScrollableTabs>

          {/* Users */}
          <TabsContent value="users" className="mt-5">
            <div className="relative mb-4 max-w-sm">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by email or name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {users === undefined ? (
              <LoadingRows />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-layered">
                <div className="overflow-x-auto">
                <table className="data-table w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">KYC</th>
                      <th className="px-4 py-3 font-medium">Wallet</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b border-border/60 last:border-0 hover:bg-secondary/30"
                      >
                        <td className="cursor-pointer px-4 py-3" onClick={() => setProfileUser(u.id)}>
                          <p className="font-medium hover:underline">{u.email ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {u.name ?? "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {u.role === "admin" ? (
                            <div className="flex items-center gap-2">
                              <Badge className="border-transparent bg-primary/15 text-primary">
                                admin
                              </Badge>
                              {/* Owner-only revoke (Phase 2 §4) */}
                              {currentUser?.role === "super_admin" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs text-rose-700 dark:text-rose-400"
                                  disabled={busy === `role-${u.id}`}
                                  onClick={() => {
                                    if (!window.confirm(`Revoke admin from ${u.email ?? u.name ?? "this user"}?`)) return;
                                    void act(`role-${u.id}`, () =>
                                      revokeAdmin({ userId: u.id }),
                                      "Admin revoked",
                                    );
                                  }}
                                >
                                  Revoke
                                </Button>
                              )}
                            </div>
                          ) : u.role === "super_admin" ? (
                            <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">
                              owner
                            </Badge>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy === `role-${u.id}`}
                              onClick={() =>
                                act(`role-${u.id}`, () =>
                                  grantRole({ userId: u.id, role: "admin" }),
                                )
                              }
                            >
                              Make admin
                            </Button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={cn(
                              "border-transparent",
                              u.status === "ACTIVE"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                            )}
                          >
                            {u.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={cn(
                              "border-transparent font-mono text-[10px] uppercase",
                              u.kycStatus === "VERIFIED"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : u.kycStatus === "REJECTED"
                                  ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                            )}
                          >
                            {u.kycStatus}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {formatETB(u.walletSantims)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {u.status === "ACTIVE" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy === `status-${u.id}`}
                                onClick={() =>
                                  act(`status-${u.id}`, () =>
                                    setUserStatus({
                                      userId: u.id,
                                      status: "SUSPENDED",
                                      reason: "Suspended by admin",
                                    }),
                                  )
                                }
                              >
                                Suspend
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy === `status-${u.id}`}
                                onClick={() =>
                                  act(`status-${u.id}`, () =>
                                    setUserStatus({
                                      userId: u.id,
                                      status: "ACTIVE",
                                      reason: "Reactivated by admin",
                                    }),
                                  )
                                }
                              >
                                Reactivate
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy === `kyc-${u.id}`}
                              onClick={() =>
                                void act(`kyc-${u.id}`, () =>
                                  setKycStatus({
                                    userId: u.id,
                                    kycStatus: u.kycStatus === "VERIFIED" ? "UNVERIFIED" : "VERIFIED",
                                    note: u.kycStatus === "VERIFIED"
                                      ? "Revoked by admin"
                                      : "Verified by admin review",
                                  }),
                                )
                              }
                            >
                              {u.kycStatus === "VERIFIED" ? "Unverify" : "Verify ID"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy === `adjust-${u.id}`}
                              onClick={() => {
                                const input = window.prompt(
                                  `Credit amount in ETB for ${u.email}:`,
                                  "50",
                                );
                                if (!input) return;
                                const s = Math.round(Number(input) * 100);
                                if (!Number.isFinite(s) || s <= 0) {
                                  toast.error("Invalid amount");
                                  return;
                                }
                                void act(`adjust-${u.id}`, () =>
                                  adjustWallet({
                                    userId: u.id,
                                    amountSantims: s,
                                    reason: "Manual admin credit",
                                  }),
                                );
                              }}
                            >
                              Credit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy === `refund-${u.id}`}
                              onClick={() => {
                                const input = window.prompt(
                                  `Refund amount in ETB for ${u.email}:`,
                                  "10",
                                );
                                if (!input) return;
                                const s = Math.round(Number(input) * 100);
                                if (!Number.isFinite(s) || s <= 0) {
                                  toast.error("Invalid amount");
                                  return;
                                }
                                void act(`refund-${u.id}`, () =>
                                  adminRefund({
                                    userId: u.id,
                                    amountSantims: s,
                                    reason: "Admin-issued refund",
                                  }),
                                );
                              }}
                            >
                              Refund
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-rose-700 dark:text-rose-300"
                              disabled={busy === `deduct-${u.id}`}
                              onClick={() => {
                                const input = window.prompt(
                                  `Deduct amount in ETB from ${u.email} (max ${formatETB(u.walletSantims)}):`,
                                  "10",
                                );
                                if (!input) return;
                                const s = Math.round(Number(input) * 100);
                                if (!Number.isFinite(s) || s <= 0) {
                                  toast.error("Invalid amount");
                                  return;
                                }
                                const reason = window.prompt("Reason for the deduction:", "Correction");
                                if (!reason?.trim()) {
                                  toast.error("A reason is required");
                                  return;
                                }
                                void act(`deduct-${u.id}`, () =>
                                  deductWallet({
                                    userId: u.id,
                                    amountSantims: s,
                                    reason,
                                  }),
                                );
                              }}
                            >
                              Deduct
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-sm text-muted-foreground"
                        >
                          No users match this search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                  </div>
              </div>
            )}
          </TabsContent>

          {/* Payments */}
          <TabsContent value="payments" className="mt-5">
            {payments === undefined ? (
              <LoadingRows />
            ) : payments.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No payments recorded yet.
              </p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-layered">
                <div className="overflow-x-auto">
                <table className="data-table w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Kind</th>
                      <th className="px-4 py-3 font-medium">Provider</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-border/60 last:border-0 hover:bg-secondary/30"
                      >
                        <td className="px-4 py-3">{p.email}</td>
                        <td className="px-4 py-3 font-mono">
                          {formatETB(p.amountSantims)}
                        </td>
                        <td className="px-4 py-3">{p.kind}</td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {p.provider}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={cn(
                              "border-transparent",
                              p.status === "COMPLETED"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : p.status === "PENDING"
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                            )}
                          >
                            {p.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {p.merchantReference}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                  </div>
              </div>
            )}
          </TabsContent>

          {/* Campaigns */}
          <TabsContent value="auctions" className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {campaigns
                  ? `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} total`
                  : "Loading…"}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAnnounceOpen(true)}
                  className="gap-1.5"
                >
                  <Megaphone className="size-3.5" /> Announce
                </Button>
                <Button
                  size="sm"
                  onClick={() => setShowCampaignForm((s) => !s)}
                  className="gap-1.5"
                >
                  {showCampaignForm ? "Close form" : "New campaign"}
                  <Gavel className="size-3.5" />
                </Button>
              </div>
            </div>

            {showCampaignForm && (
              <CampaignForm
                prizes={prizes ?? []}
                busy={busy === "create-campaign"}
                onCancel={() => setShowCampaignForm(false)}
                onSubmit={async (input) => {
                  setBusy("create-campaign");
                  try {
                    let prizeId = input.existingPrizeId;
                    if (!prizeId) {
                      const res = await createPrize({
                        title: input.prizeTitle,
                        description: input.prizeDescription,
                        category: input.prizeCategory,
                        valueSantims: input.prizeValueSantims,
                        emoji: input.prizeEmoji,
                        stock: 1,
                      });
                      prizeId = res.prizeId;

                      // Upload the prize image, if one was chosen (spec §41).
                      if (input.prizeImageFile) {
                        const uploadUrl = await generateUploadUrl({});
                        const uploadRes = await fetch(uploadUrl, {
                          method: "POST",
                          headers: {
                            "Content-Type": input.prizeImageFile.type,
                          },
                          body: input.prizeImageFile,
                        });
                        if (!uploadRes.ok) {
                          throw new Error("Image upload failed");
                        }
                        const { storageId } = (await uploadRes.json()) as {
                          storageId: Id<"_storage">;
                        };
                        await attachImageToPrize({ prizeId, storageId });
                      }
                    }
                    const res = await createAuction({
                      prizeId,
                      title: input.title,
                      description: input.description,
                      opensAt: input.opensAt,
                      closesAt: input.closesAt,
                      minBidSantims: input.minBidSantims,
                      maxBidSantims: input.maxBidSantims,
                      bidIncrementSantims: input.bidIncrementSantims,
                      bidServiceFeeSantims: input.bidServiceFeeSantims,
                      maximumBidsPerUser: input.maximumBidsPerUser,
                      consecutiveBidPolicy: input.consecutiveBidPolicy,
                      noWinnerPolicy: input.noWinnerPolicy,
                      winnerPaymentDeadline: input.winnerPaymentDeadline,
                      visibilityPolicy: input.visibilityPolicy,
                      openImmediately: input.openImmediately,
                    });
                    toast.success(`Campaign ${res.auctionCode} created`);
                    setShowCampaignForm(false);
                  } catch (err) {
                    toast.error("Failed to create campaign", {
                      description: cleanConvexError(err),
                    });
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            )}

            {campaigns === undefined ? (
              <LoadingRows />
            ) : (
              <div className="mt-4 space-y-3">
                {campaigns.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-layered"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {a.prizeImageUrl ? (
                        <img
                          src={a.prizeImageUrl}
                          alt={a.prizeTitle}
                          className="size-14 shrink-0 rounded-lg border border-border object-cover"
                        />
                      ) : (
                        <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-2xl">
                          {a.prizeEmoji}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold">{a.title}</p>
                          <StatusBadge status={a.status} />
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {a.auctionCode} · prize {a.prizeTitle} · {a.bidCount} bids ({
                            a.uniqueBidCount
                          }{" "}
                          unique) · fee {formatETB(a.bidServiceFeeSantims)} · est.
                          revenue {formatETB(a.grossFeeRevenueSantims)} · cap{" "}
                          {a.maxBidsPerUser}/user · {a.noWinnerPolicy.replace(/_/g, " ").toLowerCase()}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {a.status === "SCHEDULED"
                            ? `Opens ${new Date(a.opensAt).toLocaleString()} → closes ${new Date(a.closesAt).toLocaleString()}`
                            : a.status === "OPEN" || a.status === "CLOSING" || a.status === "PAUSED"
                              ? `Closes ${new Date(a.closesAt).toLocaleString()}`
                              : `Settled · created ${new Date(a.createdAt).toLocaleDateString()}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() =>
                          setFreqAuction({ id: a.id, code: a.auctionCode, title: a.title })
                        }
                      >
                        <ImageIcon className="size-3.5" /> Bid audit
                      </Button>
                      {a.status === "SCHEDULED" && (
                        <Button
                          size="sm"
                          disabled={busy === `open-${a.id}`}
                          onClick={() =>
                            void act(`open-${a.id}`, () => openNow({ auctionId: a.id }))
                          }
                        >
                          Open now
                        </Button>
                      )}
                      {(a.status === "OPEN" || a.status === "CLOSING") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          disabled={busy === `pause-${a.id}`}
                          onClick={() => {
                            const reason = window.prompt(
                              `Pause ${a.auctionCode} — reason (recorded in the audit log):`,
                              "Technical issue",
                            );
                            if (!reason) return;
                            void act(`pause-${a.id}`, () =>
                              pauseAuction({ auctionId: a.id, reason }),
                            );
                          }}
                        >
                          <Pause className="size-3.5" /> Pause
                        </Button>
                      )}
                      {(a.status === "OPEN" || a.status === "CLOSING" || a.status === "PAUSED") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-amber-700 dark:text-amber-300"
                          disabled={busy === `close-${a.id}`}
                          onClick={() => {
                            const reason = window.prompt(
                              `Force-close ${a.auctionCode} now? Bids stop and the winner is resolved immediately. Reason:`,
                              "Emergency close",
                            );
                            if (!reason) return;
                            void act(`close-${a.id}`, () =>
                              forceClose({ auctionId: a.id, reason }),
                            );
                          }}
                        >
                          Close now
                        </Button>
                      )}
                      {a.status === "PAUSED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          disabled={busy === `resume-${a.id}`}
                          onClick={() =>
                            void act(`resume-${a.id}`, () => resumeAuction({ auctionId: a.id }))
                          }
                        >
                          <Play className="size-3.5" /> Resume
                        </Button>
                      )}
                      {(a.status === "OPEN" ||
                        a.status === "CLOSING" ||
                        a.status === "PAUSED") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          disabled={busy === `extend-${a.id}`}
                          onClick={() => {
                            const input = window.prompt(
                              `Extend ${a.auctionCode} — additional hours:`,
                              "24",
                            );
                            if (!input) return;
                            const h = Number(input);
                            if (!Number.isFinite(h) || h <= 0) {
                              toast.error("Invalid hours");
                              return;
                            }
                            void act(`extend-${a.id}`, () =>
                              extendAuction({ auctionId: a.id, additionalMs: h * 3_600_000 }),
                            );
                          }}
                        >
                          <Timer className="size-3.5" /> Extend
                        </Button>
                      )}
                      {(a.status === "OPEN" ||
                        a.status === "CLOSING" ||
                        a.status === "SCHEDULED" ||
                        a.status === "PAUSED") && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === `cancel-${a.id}`}
                          onClick={() => {
                            const reason = window.prompt(
                              `Cancel ${a.auctionCode} — reason (recorded in the audit log, fees refunded to all bidders):`,
                              "Prize unavailable",
                            );
                            if (!reason) return;
                            void act(`cancel-${a.id}`, () =>
                              cancelAuction({ auctionId: a.id, reason }),
                            );
                          }}
                        >
                          Cancel & refund
                        </Button>
                      )}
                      {(a.status === "OPEN" ||
                        a.status === "CLOSING" ||
                        a.status === "PAUSED") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-rose-700 dark:text-rose-300"
                          disabled={busy === `close-${a.id}`}
                          onClick={() => {
                            const reason = window.prompt(
                              `Force-close ${a.auctionCode}? Bidding stops immediately and normal settlement runs. Reason:`,
                              "Emergency stop",
                            );
                            if (!reason) return;
                            void act(`close-${a.id}`, () =>
                              forceClose({ auctionId: a.id, reason }),
                            );
                          }}
                        >
                          <Square className="size-3.5" /> Force close
                        </Button>
                      )}
                      {(a.status === "CLOSED" || a.status === "SETTLING") && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === `settle-${a.id}`}
                          onClick={() =>
                            void act(`settle-${a.id}`, () =>
                              settleAuction({ auctionId: a.id }),
                            )
                          }
                        >
                          Settle now
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {campaigns.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No campaigns yet — create the first one above.
                  </p>
                )}
              </div>
            )}

            {/* Prize inventory with images (spec §41 products/prizes) */}
            {prizes && prizes.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Prize inventory
                </p>
                <div className="flex flex-wrap gap-3">
                  {prizes.map((p) => (
                    <div
                      key={p._id}
                      className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 pr-4 shadow-layered"
                    >
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt={p.title}
                          className="size-11 rounded-lg border border-border object-cover"
                        />
                      ) : (
                        <span className="flex size-11 items-center justify-center rounded-lg border border-dashed border-border text-lg">
                          {p.emoji ?? "🎁"}
                        </span>
                      )}
                      <div>
                        <p className="text-sm font-medium leading-tight">{p.title}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {formatETB(p.valueSantims)} · used in {p.usedInAuctions}
                        </p>
                      </div>
                      {!p.imageUrl && (
                        <label
                          className="group/btn relative cursor-pointer"
                          title="Upload image — recommended 1200×800 (3:2) or square, PNG/JPG up to 5 MB"
                        >
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (file.size > 5 * 1024 * 1024) {
                                toast.error("Image must be under 5 MB");
                                return;
                              }
                              void (async () => {
                                setBusy(`img-${p._id}`);
                                try {
                                  const uploadUrl = await generateUploadUrl({});
                                  const uploadRes = await fetch(uploadUrl, {
                                    method: "POST",
                                    headers: { "Content-Type": file.type },
                                    body: file,
                                  });
                                  if (!uploadRes.ok) throw new Error("Upload failed");
                                  const { storageId } = (await uploadRes.json()) as {
                                    storageId: Id<"_storage">;
                                  };
                                  await attachImageToPrize({ prizeId: p._id, storageId });
                                  toast.success("Image attached");
                                } catch (err) {
                                  toast.error("Upload failed", {
                                    description: cleanConvexError(err),
                                  });
                                } finally {
                                  setBusy(null);
                                }
                              })();
                            }}
                          />
                          <span className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-secondary">
                            {busy === `img-${p._id}` ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Camera className="size-4" />
                            )}
                          </span>
                          {/* P3.7: upload guidance badge */}
                          <span
                            className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 shadow-layered transition-opacity group-hover/btn:opacity-100"
                          >
                            Recommended: 1200×800 (3:2) or square · PNG/JPG · ≤5 MB
                          </span>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Claims (winner settlement & payout) */}
          <TabsContent value="claims" className="mt-5">
            {settlements === undefined ? (
              <LoadingRows />
            ) : settlements.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No winner settlements yet. Claims appear here when auctions with a unique lowest bid complete.
              </p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-layered">
                <div className="overflow-x-auto">
                <table className="data-table w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Auction</th>
                      <th className="px-4 py-3 font-medium">Winner</th>
                      <th className="px-4 py-3 font-medium">Winning bid</th>
                      <th className="px-4 py-3 font-medium">Deadline</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlements.map((s) => (
                      <tr
                        key={s.id}
                        className="border-b border-border/60 last:border-0 hover:bg-secondary/30"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{s.auctionTitle}</p>
                          <p className="font-mono text-xs text-muted-foreground">{s.auctionCode}</p>
                        </td>
                        <td className="px-4 py-3">{s.winnerEmail}</td>
                        <td className="px-4 py-3 font-mono">{formatETB(s.winningBidValueSantims)}</td>
                        <td className="px-4 py-3 text-xs">
                          {new Date(s.paymentDeadline).toLocaleString()}
                          {s.overdue && (
                            <Badge className="ml-1.5 border-transparent bg-rose-500/10 text-rose-700 dark:text-rose-300">
                              OVERDUE
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={cn(
                              "border-transparent font-mono text-[10px] uppercase",
                              s.status === "PAID" || s.status === "FULFILLED"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : s.status === "FORFEITED"
                                  ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                            )}
                          >
                            {s.status.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {s.status === "PENDING_PAYMENT" && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busy === `paid-${s.id}`}
                                  onClick={() =>
                                    void act(`paid-${s.id}`, () =>
                                      markWinnerPaid({
                                        settlementId: s.id,
                                        note: "Payment verified by admin",
                                      }),
                                    )
                                  }
                                >
                                  Confirm payment
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-rose-700 dark:text-rose-300"
                                  disabled={busy === `forfeit-${s.id}`}
                                  onClick={() => {
                                    const reason = window.prompt(
                                      `Forfeit ${s.winnerEmail}'s claim on ${s.auctionCode}? Their fees will be refunded and the auction reopens. Reason:`,
                                      "Payment deadline passed",
                                    );
                                    if (!reason) return;
                                    void act(`forfeit-${s.id}`, () =>
                                      forfeitAndReopen({ settlementId: s.id, reason }),
                                    );
                                  }}
                                >
                                  Forfeit & reopen
                                </Button>
                              </>
                            )}
                            {s.status === "PAID" && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy === `fulfill-${s.id}`}
                                onClick={() =>
                                  void act(`fulfill-${s.id}`, () =>
                                    markPrizeFulfilled({
                                      settlementId: s.id,
                                      note: "Prize delivered",
                                    }),
                                  )
                                }
                              >
                                Mark delivered
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Finance */}
          <TabsContent value="finance" className="mt-5">
            {finance === undefined ? (
              <LoadingRows />
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    icon={<TrendingUp className="size-5" />}
                    label="Bid-fee revenue (net)"
                    value={formatETB(finance.feeRevenueSantims)}
                  />
                  <StatCard
                    icon={<Banknote className="size-5" />}
                    label="Winner payments"
                    value={formatETB(finance.winnerPaymentsSantims)}
                  />
                  <StatCard
                    icon={<Activity className="size-5" />}
                    label="Refunds issued"
                    value={formatETB(finance.refundsSantims)}
                  />
                  <StatCard
                    icon={<Wallet className="size-5" />}
                    label="Pending deposits"
                    value={formatETB(finance.pendingDepositsSantims)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  All figures are computed from the append-only double-entry ledger — the financial source of truth. Pending deposits are awaiting provider confirmation; {finance.pendingSettlements} winner claim{finance.pendingSettlements === 1 ? "" : "s"} await payment ({finance.overdueSettlements} overdue). {finance.txCount} ledger transactions posted to date.
                </p>

                {/* Ledger browser — every posting with its balanced entries */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Transaction ledger (last 50)
                  </p>
                  {ledgerTxs === undefined ? (
                    <LoadingRows />
                  ) : ledgerTxs.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No ledger transactions posted yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {ledgerTxs.map((t) => (
                        <div
                          key={t.id}
                          className="rounded-lg border border-border bg-card px-4 py-3 text-sm"
                        >
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <span className="font-mono text-xs text-muted-foreground">
                              {new Date(t.createdAt).toLocaleString()}
                            </span>
                            <Badge
                              variant="outline"
                              className="font-mono text-[10px] uppercase"
                            >
                              {t.txType.replace(/_/g, " ")}
                            </Badge>
                            <span className="font-medium">{t.description}</span>
                            <span
                              className={cn(
                                "ml-auto font-mono text-xs",
                                t.balanced
                                  ? "text-emerald-700 dark:text-emerald-300"
                                  : "font-semibold text-rose-700 dark:text-rose-300",
                              )}
                            >
                              {t.balanced
                                ? `balanced · ${formatETB(t.debitsSantims)}`
                                : `IMBALANCE ${formatETB(t.debitsSantims)} ≠ ${formatETB(t.creditsSantims)}`}
                            </span>
                          </div>
                          <div className="mt-1.5 space-y-0.5 font-mono text-xs text-muted-foreground">
                            {t.lines.map((line, i) => (
                              <p key={i}>
                                {line.direction === "DEBIT" ? "Dr" : "Cr"}{" "}
                                {formatETB(line.amountSantims)} · {line.account}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Transaction ledger browser (spec §41 reconciliation) */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Transaction ledger — every monetary event, latest first
                  </p>
                  {ledgerTxs === undefined ? (
                    <LoadingRows />
                  ) : ledgerTxs.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No transactions posted yet.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-layered">
                      <div className="overflow-x-auto">
                      <table className="data-table w-full min-w-[640px] text-sm">
                        <thead>
                          <tr className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                            <th className="px-4 py-3 font-medium">When</th>
                            <th className="px-4 py-3 font-medium">Type</th>
                            <th className="px-4 py-3 font-medium">Description</th>
                            <th className="px-4 py-3 font-medium">Debit = Credit</th>
                            <th className="px-4 py-3 font-medium">Entries</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerTxs.map((t) => (
                            <tr
                              key={t.id}
                              className="border-b border-border/60 align-top last:border-0 hover:bg-secondary/30"
                            >
                              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                                {new Date(t.createdAt).toLocaleString()}
                              </td>
                              <td className="px-4 py-3">
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[10px] uppercase"
                                >
                                  {t.txType}
                                </Badge>
                              </td>
                              <td className="max-w-xs px-4 py-3 text-xs text-muted-foreground">
                                {t.description}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">
                                <span
                                  className={cn(
                                    t.balanced ? "text-emerald-700 dark:text-emerald-300" : "font-bold text-rose-700 dark:text-rose-400",
                                  )}
                                >
                                  {formatETB(t.debitsSantims)} = {formatETB(t.creditsSantims)}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                                {t.lines.map((l, i) => (
                                  <div key={i}>
                                    {l.direction === "DEBIT" ? "DR" : "CR"} {l.account} {formatETB(l.amountSantims)}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Settings */}
          <TabsContent value="settings" className="mt-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="text-base">Notification settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {notifSettings === undefined ? (
                    <LoadingRows />
                  ) : (
                    notifSettings.map((n) => (
                      <div
                        key={n.key}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {n.key.replace("NOTIFY_", "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {n.enabled ? "Users receive these notifications" : "Suppressed platform-wide"}
                          </p>
                        </div>
                        <Switch
                          checked={n.enabled}
                          disabled={busy === `notif-${n.key}`}
                          onCheckedChange={(enabled) =>
                            void act(`notif-${n.key}`, () =>
                              setNotificationSetting({ key: n.key, enabled }),
                            )
                          }
                        />
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="text-base">Payment gateways</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Toggle payment processors on or off. A disabled gateway rejects new deposits immediately.
                  </p>
                  {gateways === undefined ? (
                    <LoadingRows />
                  ) : (
                    gateways.map((g) => (
                      <div
                        key={g.gateway}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium capitalize">{g.gateway}</p>
                          <p className="text-xs text-muted-foreground">
                            {g.configured
                              ? g.enabled
                                ? "Accepting new deposits"
                                : "Disabled — deposits rejected"
                              : "Not configured — add API keys first"}
                          </p>
                        </div>
                        <Switch
                          checked={g.enabled}
                          disabled={!g.configured || busy === `gw-${g.gateway}`}
                          onCheckedChange={(enabled) =>
                            void act(`gw-${g.gateway}`, () =>
                              setGatewayEnabled({ gateway: g.gateway, enabled }),
                            )
                          }
                        />
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="text-base">Payment gateways</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {gateways === undefined ? (
                    <LoadingRows />
                  ) : (
                    gateways.map((g) => (
                      <div
                        key={g.gateway}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium capitalize">{g.gateway}</p>
                          <p className="text-xs text-muted-foreground">
                            {g.configured
                              ? g.enabled
                                ? "Active — users can top up through it"
                                : "Configured but disabled"
                              : "Keys not set yet"}
                          </p>
                        </div>
                        <Switch
                          checked={g.enabled}
                          disabled={busy === `gw-${g.gateway}` || !g.configured}
                          onCheckedChange={(enabled) =>
                            void act(`gw-${g.gateway}`, () =>
                              setGatewayEnabled({ gateway: g.gateway, enabled }),
                            )
                          }
                        />
                      </div>
                    ))
                  )}
                  <p className="text-xs text-muted-foreground">
                    Disabling a gateway immediately stops new top-ups through it (existing payments still settle). The manual gateway is for testing — disable it before going live.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border shadow-layered">
                <CardHeader>
                  <CardTitle className="text-base">Platform announcement</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Send an in-app notification to every active user — auction starts, maintenance windows, policy changes.
                  </p>
                  <Button variant="outline" onClick={() => setAnnounceOpen(true)}>
                    <Megaphone className="mr-1.5 size-4" /> Compose announcement
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* KYC review queue */}
          <TabsContent value="kyc" className="mt-5">
            <KycReviewPanel />
          </TabsContent>

          {/* Audit log */}
          <TabsContent value="audit" className="mt-5">
            {auditLogs === undefined ? (
              <LoadingRows />
            ) : auditLogs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No audit entries yet.
              </p>
            ) : (
              <div className="space-y-2">
                {auditLogs.map((l) => (
                  <div
                    key={l.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(l.createdAt).toLocaleString()}
                    </span>
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] uppercase"
                    >
                      {l.action}
                    </Badge>
                    <span className="font-medium">{l.actor}</span>
                    <span className="text-muted-foreground">
                      {l.resource}
                      {l.details ? ` — ${l.details}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Withdrawals review (Phase 1 §3) */}
          <TabsContent value="withdrawals" className="mt-5">
            {withdrawals === undefined ? (
              <LoadingRows />
            ) : withdrawals.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No withdrawal requests yet.
              </p>
            ) : (
              <div className="space-y-2">
                {withdrawals.map((w) => (
                  <div
                    key={w.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm"
                  >
                    <div className="min-w-40">
                      <p className="font-mono font-medium">{formatETB(w.amountSantims)}</p>
                      <p className="text-xs text-muted-foreground">{w.userEmail}</p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <p className="font-mono uppercase">{w.method}</p>
                      <p className="font-mono">{w.destination}</p>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(w.createdAt).toLocaleString()}
                    </span>
                    {w.status === "PENDING" ? (
                      <div className="ml-auto flex gap-2">
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => {
                            void act(
                              `wd-${w.id}-paid`,
                              () => reviewWithdrawal({ withdrawalId: w.id, decision: "PAID" }),
                              "Marked as paid",
                            );
                          }}
                        >
                          {busy === `wd-${w.id}-paid` ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Banknote className="size-4" />
                          )}
                          Mark paid
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => {
                            const note = window.prompt("Rejection reason (returned to the user):", "Verification failed");
                            if (note === null) return;
                            void act(
                              `wd-${w.id}-rej`,
                              () => reviewWithdrawal({ withdrawalId: w.id, decision: "REJECTED", note: note || undefined }),
                              "Withdrawal rejected — funds returned",
                            );
                          }}
                        >
                          {busy === `wd-${w.id}-rej` ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <ShieldX className="size-4" />
                          )}
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <Badge
                        variant="outline"
                        className={cn(
                          "ml-auto font-mono text-[10px] uppercase",
                          w.status === "PAID" && "text-emerald-500",
                          w.status === "REJECTED" && "text-rose-700 dark:text-rose-500",
                          w.status === "CANCELLED" && "text-muted-foreground",
                        )}
                      >
                        {w.status}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Fraud review queue (spec §39 / Phase 2 §6) */}
          <TabsContent value="fraud" className="mt-5">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Heuristic signals for manual review — multiple accounts funded
                  by the same payment source, velocity spikes, etc.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => {
                    void act(
                      "fraud-scan",
                      () => runFraudScan({}),
                      `Scan complete`,
                    );
                  }}
                >
                  {busy === "fraud-scan" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                  Scan shared payer phones
                </Button>
              </div>
              {fraudSignals === undefined ? (
                <LoadingRows />
              ) : fraudSignals.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No open fraud signals.
                </p>
              ) : (
                <div className="space-y-2">
                  {fraudSignals.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm"
                    >
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-[10px] uppercase",
                          s.severity === "HIGH" && "border-rose-500/40 text-rose-700 dark:text-rose-400",
                          s.severity === "MEDIUM" && "border-amber-500/40 text-amber-700 dark:text-amber-500",
                        )}
                      >
                        {s.severity}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{s.signal.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.details ?? ""} · {s.userEmail}
                        </p>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {new Date(s.createdAt).toLocaleString()}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => {
                          void act(
                            `sig-${s.id}`,
                            () => markSignalReviewed({ signalId: s.id, reviewed: true }),
                            "Signal marked reviewed",
                          );
                        }}
                      >
                        <CheckCircle2 className="size-4" /> Reviewed
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <Card className="mt-8 border-border shadow-layered">
          <CardHeader>
            <CardTitle className="text-base">Role bootstrap</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The first registered account can claim the admin role once; after
            that, roles are granted here by an existing admin. Sensitive
            actions on this page are recorded in the append-only audit log.
          </CardContent>
        </Card>

        <BidAuditDialog />
        <AnnounceDialog />
        <UserProfileDialog
          userId={profileUser}
          onClose={() => setProfileUser(null)}
        />
      </>
  );

  function UserProfileDialog({
    userId,
    onClose,
  }: {
    userId: Id<"users"> | null;
    onClose: () => void;
  }) {
    const profile = useQuery(
      api.admin.getUserProfileAdmin,
      userId ? { userId } : "skip",
    );

    return (
      <Dialog
        open={userId !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>User profile</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {profile === undefined
                ? "Loading…"
                : profile.user.email ?? "unknown user"}
            </DialogDescription>
          </DialogHeader>

          {profile === undefined ? (
            <LoadingRows />
          ) : (
            <ScrollArea className="max-h-[60vh] pr-3">
              <div className="space-y-4">
                {/* Identity + flags */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {profile.user.name ?? "Unnamed user"}
                  </span>
                  <Badge
                    className={cn(
                      "border-transparent",
                      profile.user.role === "admin"
                        ? "bg-primary/15 text-primary"
                        : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {profile.user.role ?? "user"}
                  </Badge>
                  <Badge
                    className={cn(
                      "border-transparent",
                      profile.user.status === "ACTIVE"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                    )}
                  >
                    {profile.user.status}
                  </Badge>
                  <Badge
                    className={cn(
                      "border-transparent",
                      profile.user.kycStatus === "VERIFIED"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                    )}
                  >
                    KYC {profile.user.kycStatus}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    Registered {new Date(profile.user.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Wallet */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-border bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">Paid balance</p>
                    <p className="mt-0.5 font-semibold">
                      {formatETB(profile.wallet?.paidSantims ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">Promo balance</p>
                    <p className="mt-0.5 font-semibold">
                      {formatETB(profile.wallet?.promoSantims ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">Deposited</p>
                    <p className="mt-0.5 font-semibold">
                      {formatETB(profile.wallet?.totalDepositedSantims ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">Spent</p>
                    <p className="mt-0.5 font-semibold">
                      {formatETB(profile.wallet?.totalSpentSantims ?? 0)}
                    </p>
                  </div>
                </div>

                {/* Bid stats */}
                <div className="rounded-lg border border-border p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Bid activity
                  </p>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                    <span>
                      <b>{profile.bidStats.total}</b> bids
                    </span>
                    <span>
                      <b>{profile.bidStats.accepted}</b> accepted
                    </span>
                    <span>
                      <b>{profile.bidStats.removed}</b> removed
                    </span>
                    <span>
                      <b>{profile.bidStats.refunded}</b> refunded
                    </span>
                    <span>
                      <b>{profile.bidStats.auctionsEntered}</b> auctions
                    </span>
                    <span>
                      Fees paid {formatETB(profile.bidStats.feesPaidSantims)}
                    </span>
                  </div>
                </div>

                {/* Wins */}
                {profile.wins.length > 0 && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Wins / claims
                    </p>
                    <div className="space-y-1.5 text-sm">
                      {profile.wins.map((w) => (
                        <div
                          key={w.settlementId}
                          className="flex flex-wrap items-center gap-x-2.5"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {w.auctionCode}
                          </span>
                          <span>
                            Winning bid {formatETB(w.winningBidValueSantims)}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "ml-auto font-mono text-[10px] uppercase",
                              w.overdue && "border-rose-500/40 text-rose-700 dark:text-rose-300",
                            )}
                          >
                            {w.status.replace(/_/g, " ")}
                            {w.overdue ? " · overdue" : ""}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent bids */}
                {profile.bids.length > 0 && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Recent bids (last 15)
                    </p>
                    <div className="space-y-1 text-sm">
                      {profile.bids.slice(0, 15).map((b) => (
                        <div
                          key={b.id}
                          className="flex flex-wrap items-baseline gap-x-2.5"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {b.auctionCode}
                          </span>
                          <span className="font-medium">
                            {formatETB(b.bidValueSantims)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            fee {formatETB(b.feeSantims)} ·{" "}
                            {new Date(b.acceptedAt).toLocaleString()}
                          </span>
                          <Badge
                            variant="outline"
                            className="ml-auto font-mono text-[10px] uppercase"
                          >
                            {b.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payments */}
                {profile.payments.length > 0 && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Payments
                    </p>
                    <div className="space-y-1 text-sm">
                      {profile.payments.slice(0, 15).map((p) => (
                        <div
                          key={p.id}
                          className="flex flex-wrap items-baseline gap-x-2.5"
                        >
                          <span className="font-medium">
                            {formatETB(p.amountSantims)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {p.kind} · {p.provider} ·{" "}
                            {new Date(p.createdAt).toLocaleString()}
                          </span>
                          <Badge
                            variant="outline"
                            className="ml-auto font-mono text-[10px] uppercase"
                          >
                            {p.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  function BidAuditDialog() {
    const freq = useQuery(
      api.admin.getBidFrequencyMap,
      freqAuction ? { auctionId: freqAuction.id } : "skip",
    );
    const bids = useQuery(
      api.admin.listBidsAdmin,
      freqAuction ? { auctionId: freqAuction.id } : "skip",
    );

    return (
      <Dialog open={!!freqAuction} onOpenChange={(open) => !open && setFreqAuction(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bid audit — {freqAuction?.title}</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {freqAuction?.code} · complete frequency map of accepted bids, lowest first. The winning bid is the lowest value held by exactly one bidder.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[45vh] pr-3">
            {freq === undefined ? (
              <LoadingRows />
            ) : freq.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No accepted bids in this auction yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {freq.map((f) => (
                  <div
                    key={f.valueSantims}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm",
                      f.unique
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/60",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{formatETB(f.valueSantims)}</span>
                      {f.unique && (
                        <Badge className="border-transparent bg-primary/15 font-mono text-[10px] uppercase text-primary">
                          unique
                        </Badge>
                      )}
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      ×{f.count} · {f.holders.join(", ")}
                    </span>
                    {f.unique && f.count === 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-rose-700 dark:text-rose-300"
                        disabled={busy === `rm-${f.bidIds[0]}`}
                        onClick={() => {
                          const reason = window.prompt(
                            `Remove the ${formatETB(f.valueSantims)} bid by ${f.holders[0]}? The bid is excluded from settlement (fee is not auto-refunded). Reason:`,
                            "Rule violation",
                          );
                          if (!reason) return;
                          void act(`rm-${f.bidIds[0]}`, () =>
                            removeBid({ bidId: f.bidIds[0], reason }),
                          );
                        }}
                      >
                        <Ban className="mr-1 size-3" /> Remove
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          <p className="text-xs text-muted-foreground">
            {bids?.length ?? 0} bids on record (including removed and refunded, kept for the audit trail).
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  function AnnounceDialog() {
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [sending, setSending] = useState(false);

    const send = async () => {
      if (!title.trim() || !body.trim()) {
        toast.error("Title and body are required");
        return;
      }
      setSending(true);
      try {
        const res = await broadcastAnnouncement({ title, body });
        toast.success(`Announcement sent to ${res.sent} user${res.sent === 1 ? "" : "s"}`);
        setAnnounceOpen(false);
        setTitle("");
        setBody("");
      } catch (err) {
        toast.error("Failed to send", { description: cleanConvexError(err) });
      } finally {
        setSending(false);
      }
    };

    return (
      <Dialog open={announceOpen} onOpenChange={setAnnounceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Platform announcement</DialogTitle>
            <DialogDescription>
              Delivered as an in-app notification to every active user.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New auction opening tonight at 8 PM"
              />
            </Field>
            <Field label="Message">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="The iPhone 17 Pro campaign opens this evening — the first 100 bidders get a discounted entry fee."
                rows={4}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnounceOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={sending}>
              {sending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Send to all users
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
}

/**
 * Non-admin view. If no admin exists yet (first-run bootstrap), the first
 * account can claim the role; otherwise it's a hard stop.
 */
function RestrictedArea({ userName }: { userName: string | null }) {
  const bootstrapAdmin = useMutation(api.admin.bootstrapAdmin);
  const [claiming, setClaiming] = useState(false);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      await bootstrapAdmin({});
      toast.success("Admin role granted. Reloading the console…");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast.error(
        err instanceof Error && err.message.includes("BOOTSTRAP_CLOSED")
          ? "Bootstrap is closed — an admin already exists and must grant roles."
          : "Could not claim the admin role.",
      );
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <div className="flex justify-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-300">
          <ShieldX className="size-6" />
        </span>
      </div>
      <h1 className="mt-4 text-xl font-bold">Restricted area</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This console is available to platform administrators only.
        {userName ? " Signed in as " + userName + "." : ""}
      </p>
      <Button
        className="mt-6"
        variant="outline"
        disabled={claiming}
        onClick={handleClaim}
      >
        {claiming ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" />
        ) : (
          <ShieldCheck className="mr-1.5 size-4" />
        )}
        Claim admin role (first account only)
      </Button>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-layered">
      <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        {icon}
      </span>
      <p className="mt-3 font-mono text-xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
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

function StatusBadge({ status }: { status: string }) {
  // Distinct semantic colors (P4.11): active = emerald, pending/transition
  // = amber, closed = slate, voided/cancelled = rose.
  const styles: Record<string, string> = {
    SCHEDULED: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    OPEN: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    CLOSING: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    CLOSED: "bg-slate-500/15 text-slate-300",
    SETTLING: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    COMPLETED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    CANCELLED: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  };
  return (
    <Badge
      className={cn(
        "border-transparent font-mono text-[10px] uppercase",
        styles[status] ?? "bg-secondary",
      )}
    >
      {status}
    </Badge>
  );
}

type CampaignInput = {
  existingPrizeId: Id<"prizes"> | null;
  prizeTitle: string;
  prizeDescription: string;
  prizeCategory: string;
  prizeValueSantims: number;
  prizeEmoji: string;
  prizeImageFile: File | null;
  title: string;
  description: string;
  opensAt: number;
  closesAt: number;
  minBidSantims: number;
  maxBidSantims: number;
  bidIncrementSantims: number;
  bidServiceFeeSantims: number;
  maximumBidsPerUser: number;
  consecutiveBidPolicy: "NONE" | "THREE_THEN_BLOCK_TWO" | "CUSTOM";
  noWinnerPolicy: "CANCEL_AND_REFUND" | "EXTEND" | "ROLLOVER";
  winnerPaymentDeadline: number;
  visibilityPolicy: "PUBLIC" | "PRIVATE";
  openImmediately: boolean;
};

/**
 * Campaign creation form — spec §10's full configurable rule set. Money
 * fields are entered in ETB and converted to integer santims.
 */
function CampaignForm({
  prizes,
  busy,
  onSubmit,
  onCancel,
}: {
  prizes: Array<{
    _id: Id<"prizes">;
    title: string;
    emoji?: string | null;
    valueSantims: number;
  }>;
  busy: boolean;
  onSubmit: (input: CampaignInput) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [existingPrizeId, setExistingPrizeId] = useState<Id<"prizes"> | null>(null);
  const [prizeTitle, setPrizeTitle] = useState("");
  const [prizeDescription, setPrizeDescription] = useState("");
  const [prizeCategory, setPrizeCategory] = useState("");
  const [prizeValue, setPrizeValue] = useState("");
  const [prizeEmoji, setPrizeEmoji] = useState("🎁");
  const [prizeImageFile, setPrizeImageFile] = useState<File | null>(null);
  const [prizeImagePreview, setPrizeImagePreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [durationDays, setDurationDays] = useState("3");
  const [openImmediately, setOpenImmediately] = useState(true);
  const [startInHours, setStartInHours] = useState("0");
  const [minBid, setMinBid] = useState("1");
  const [maxBid, setMaxBid] = useState("100");
  const [increment, setIncrement] = useState("0.01");
  const [fee, setFee] = useState("10");
  const [maxBids, setMaxBids] = useState("100");
  const [consecutive, setConsecutive] = useState<
    "NONE" | "THREE_THEN_BLOCK_TWO" | "CUSTOM"
  >("THREE_THEN_BLOCK_TWO");
  const [noWinner, setNoWinner] = useState<
    "CANCEL_AND_REFUND" | "EXTEND" | "ROLLOVER"
  >("CANCEL_AND_REFUND");
  const [payDeadlineDays, setPayDeadlineDays] = useState("7");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");

  const DAY = 86_400_000;
  const now = Date.now();
  const opensAt = now + Math.max(0, Number(startInHours) || 0) * 3_600_000;
  const closesAt = opensAt + (Number(durationDays) || 3) * DAY;

  const money = (v: string): number | null => {
    if (!/^\d+(\.\d{1,2})?$/.test(v.trim())) return null;
    const [w, f = ""] = v.trim().split(".");
    const s = Number(w) * 100 + Number((f + "00").slice(0, 2));
    return Number.isInteger(s) ? s : null;
  };

  const minS = money(minBid);
  const maxS = money(maxBid);
  const incS = money(increment);
  const feeS = money(fee);
  const valueS = money(prizeValue);
  const formValid =
    (mode === "new"
      ? prizeTitle.trim().length > 0 && valueS !== null && valueS > 0
      : existingPrizeId !== "") &&
    title.trim().length > 0 &&
    minS !== null &&
    maxS !== null &&
    maxS > minS &&
    feeS !== null &&
    feeS > 0 &&
    Number(maxBids) >= 1 &&
    Number(durationDays) > 0;

  return (
    <Card className="mt-3 border-border shadow-layered">
      <CardHeader>
        <CardTitle className="text-base">New campaign</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Prize source */}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "new" ? "default" : "outline"}
            onClick={() => setMode("new")}
          >
            New prize
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "existing" ? "default" : "outline"}
            onClick={() => setMode("existing")}
            disabled={(prizes?.length ?? 0) === 0}
          >
            Existing prize
          </Button>
        </div>

        {mode === "new" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Prize title">
              <Input
                value={prizeTitle}
                onChange={(e) => setPrizeTitle(e.target.value)}
                placeholder="iPhone 17 Pro"
              />
            </Field>
            <Field label="Prize value (ETB)">
              <Input
                value={prizeValue}
                onChange={(e) => setPrizeValue(e.target.value)}
                placeholder="145000"
                className="font-mono"
                inputMode="decimal"
              />
            </Field>
            <Field label="Category (optional)">
              <Input
                value={prizeCategory}
                onChange={(e) => setPrizeCategory(e.target.value)}
                placeholder="Electronics"
              />
            </Field>
            <Field label="Emoji">
              <Input
                value={prizeEmoji}
                onChange={(e) => setPrizeEmoji(e.target.value)}
                className="w-20"
              />
            </Field>
            <Field label="Description (optional)" className="sm:col-span-2">
              <Input
                value={prizeDescription}
                onChange={(e) => setPrizeDescription(e.target.value)}
                placeholder="512GB, official warranty"
              />
            </Field>
            <Field label="Prize image" className="sm:col-span-2">
              <div className="flex items-center gap-3">
                {prizeImagePreview ? (
                  <img
                    src={prizeImagePreview}
                    alt="Prize preview"
                    className="size-16 rounded-lg border border-border object-cover"
                  />
                ) : (
                  <span className="flex size-16 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                    <ImageIcon className="size-5" />
                  </span>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        if (file) {
                          if (file.size > 5 * 1024 * 1024) {
                            toast.error("Image must be under 5 MB");
                            return;
                          }
                          setPrizeImageFile(file);
                          setPrizeImagePreview(URL.createObjectURL(file));
                        }
                      }}
                    />
                    <span className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 text-xs font-medium hover:bg-secondary">
                      <Camera className="size-3.5" /> Choose image
                    </span>
                  </label>
                  {prizeImageFile && (
                    <button
                      type="button"
                      className="text-left text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setPrizeImageFile(null);
                        setPrizeImagePreview(null);
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </Field>
          </div>
        ) : (
          <Field label="Prize">
            <Select
              value={existingPrizeId ?? ""}
              onValueChange={(v) => setExistingPrizeId(v as Id<"prizes">)}
            >
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue placeholder="Choose a prize" />
              </SelectTrigger>
              <SelectContent>
                {(prizes ?? []).map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.emoji ?? "🎁"} {p.title} — {formatETB(p.valueSantims)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <div className="border-t border-border pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Campaign title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Win an iPhone 17 Pro"
              />
            </Field>
            <Field label="Description (optional)">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Lowest unique bid takes it home"
              />
            </Field>
            <Field label="Duration (days once live)">
              <Input
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                className="font-mono"
                inputMode="numeric"
              />
            </Field>
            <Field label="Starts in (hours, 0 = now)">
              <Input
                value={startInHours}
                onChange={(e) => setStartInHours(e.target.value)}
                className="font-mono"
                inputMode="numeric"
              />
            </Field>
            <div className="flex items-end pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch
                  checked={openImmediately}
                  onCheckedChange={setOpenImmediately}
                />
                Open immediately
              </label>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Bid rules (the engine enforces exactly these)
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Min bid (ETB)">
              <Input
                value={minBid}
                onChange={(e) => setMinBid(e.target.value)}
                className="font-mono"
                inputMode="decimal"
              />
            </Field>
            <Field label="Max bid (ETB)">
              <Input
                value={maxBid}
                onChange={(e) => setMaxBid(e.target.value)}
                className="font-mono"
                inputMode="decimal"
              />
            </Field>
            <Field label="Increment (ETB)">
              <Input
                value={increment}
                onChange={(e) => setIncrement(e.target.value)}
                className="font-mono"
                inputMode="decimal"
              />
            </Field>
            <Field label="Bid fee (ETB per bid)">
              <Input
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className="font-mono"
                inputMode="decimal"
              />
            </Field>
            <Field label="Max bids per user">
              <Input
                value={maxBids}
                onChange={(e) => setMaxBids(e.target.value)}
                className="font-mono"
                inputMode="numeric"
              />
            </Field>
            <Field label="Consecutive-bid rule">
              <Select
                value={consecutive}
                onValueChange={(v) =>
                  setConsecutive(v as typeof consecutive)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">None</SelectItem>
                  <SelectItem value="THREE_THEN_BLOCK_TWO">
                    3 allowed, then block 2
                  </SelectItem>
                  <SelectItem value="CUSTOM">Custom</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="No-winner policy">
              <Select
                value={noWinner}
                onValueChange={(v) => setNoWinner(v as typeof noWinner)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CANCEL_AND_REFUND">
                    Cancel & refund all fees
                  </SelectItem>
                  <SelectItem value="EXTEND">Extend auction</SelectItem>
                  <SelectItem value="ROLLOVER">Roll over prize</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Payment deadline (days)">
              <Input
                value={payDeadlineDays}
                onChange={(e) => setPayDeadlineDays(e.target.value)}
                className="font-mono"
                inputMode="numeric"
              />
            </Field>
            <Field label="Visibility">
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as typeof visibility)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC">Public</SelectItem>
                  <SelectItem value="PRIVATE">Private</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!formValid || busy}
            onClick={() => {
              if (!formValid || minS === null || maxS === null || feeS === null) {
                return;
              }
              onSubmit({
                existingPrizeId: mode === "existing" ? existingPrizeId : null,
                prizeTitle: prizeTitle.trim(),
                prizeDescription: prizeDescription.trim(),
                prizeCategory: prizeCategory.trim(),
                prizeValueSantims: valueS ?? 0,
                prizeEmoji: prizeEmoji.trim(),
                prizeImageFile,
                title: title.trim(),
                description: description.trim(),
                opensAt,
                closesAt,
                minBidSantims: minS,
                maxBidSantims: maxS,
                bidIncrementSantims: incS ?? 1,
                bidServiceFeeSantims: feeS,
                maximumBidsPerUser: Math.floor(Number(maxBids)),
                consecutiveBidPolicy: consecutive,
                noWinnerPolicy: noWinner,
                winnerPaymentDeadline:
                  (Number(payDeadlineDays) || 7) * DAY,
                visibilityPolicy: visibility,
                openImmediately,
              });
            }}
          >
            {busy ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Gavel className="mr-1.5 size-4" />
            )}
            Create campaign
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function KycReviewPanel() {
  const pending = useQuery(api.kyc.listPendingKyc, {});
  const review = useMutation(api.kyc.reviewKycDocument);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(okMsg);
    } catch (err) {
      toast.error(cleanConvexError(err) || "Action failed");
    } finally {
      setBusy(null);
    }
  }

  if (pending === undefined) return <LoadingRows />;
  if (pending.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No documents awaiting review.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {pending.map((doc) => (
        <Card key={doc._id} className="border-border shadow-layered">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{doc.userName ?? doc.userEmail ?? doc.userId}</p>
              <p className="text-xs text-muted-foreground">
                {doc.userEmail} · {doc.fileName} · {(doc.sizeBytes / 1024).toFixed(0)} KB
              </p>
              <a
                href={doc.documentUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Open document ↗
              </a>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void act(
                    doc._id,
                    () => review({ documentId: doc._id, decision: "APPROVED" }),
                    "Identity verified",
                  )
                }
              >
                {busy === doc._id ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => {
                  const note = window.prompt("Rejection reason (shown to the user):", "Document unclear");
                  if (note === null) return;
                  void act(
                    `${doc._id}-rej`,
                    () => review({ documentId: doc._id, decision: "REJECTED", note: note || undefined }),
                    "Document rejected",
                  );
                }}
              >
                <ShieldX className="size-4" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
