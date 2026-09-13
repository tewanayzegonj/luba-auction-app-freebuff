import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { formatETB } from "@/lib/money";
import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  Gavel,
  Loader2,
  Search,
  ShieldCheck,
  ShieldX,
  Users,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/luba";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {isLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : user?.role !== "admin" ? (
          <RestrictedArea userName={user?.email ?? null} />
        ) : (
          <AdminConsole />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function AdminConsole() {
  const stats = useQuery(api.admin.getPlatformStats, {});
  const users = useQuery(api.admin.listUsers, {});
  const payments = useQuery(api.admin.listPaymentsAdmin, {});
  const auditLogs = useQuery(api.admin.listAuditLogs, {});
  const campaigns = useQuery(api.admin.listAllAuctions, {});
  const prizes = useQuery(api.admin.listPrizes, {});

  const grantRole = useMutation(api.admin.grantRole);
  const setUserStatus = useMutation(api.admin.setUserStatus);
  const cancelAuction = useMutation(api.admin.adminCancelAuction);
  const settleAuction = useMutation(api.admin.adminSettleAuction);
  const adjustWallet = useMutation(api.admin.adminAdjustWallet);
  const createAuction = useMutation(api.admin.createAuction);
  const createPrize = useMutation(api.admin.createPrize);
  const openNow = useMutation(api.admin.openAuctionNow);

  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showCampaignForm, setShowCampaignForm] = useState(false);

  const filteredUsers = (users ?? []).filter(
    (u) =>
      !search ||
      (u.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
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

        {/* Ledger integrity banner */}
        {stats && (
          <div
            className={cn(
              "mt-4 rounded-xl border p-4 text-sm",
              stats.ledger.balanced
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/5 text-rose-300",
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
          <TabsList className="h-11 w-full justify-start gap-1 rounded-xl bg-secondary/70 p-1 sm:w-auto">
            <TabsTrigger value="users" className="gap-1.5 rounded-lg">
              <Users className="size-4" /> Users
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5 rounded-lg">
              <Wallet className="size-4" /> Payments
            </TabsTrigger>
            <TabsTrigger value="auctions" className="gap-1.5 rounded-lg">
              <Gavel className="size-4" /> Campaigns
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1.5 rounded-lg">
              <Activity className="size-4" /> Audit log
            </TabsTrigger>
          </TabsList>

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
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">Status</th>
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
                        <td className="px-4 py-3">
                          <p className="font-medium">{u.email ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {u.name ?? "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {u.role === "admin" ? (
                            <Badge className="border-transparent bg-primary/15 text-primary">
                              admin
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
                                ? "bg-emerald-500/10 text-emerald-300"
                                : "bg-rose-500/10 text-rose-300",
                            )}
                          >
                            {u.status}
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
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-8 text-center text-sm text-muted-foreground"
                        >
                          No users match this search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
                <table className="w-full text-sm">
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
                                ? "bg-emerald-500/10 text-emerald-300"
                                : p.status === "PENDING"
                                  ? "bg-amber-500/10 text-amber-300"
                                  : "bg-rose-500/10 text-rose-300",
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
              <Button
                size="sm"
                onClick={() => setShowCampaignForm((s) => !s)}
                className="gap-1.5"
              >
                {showCampaignForm ? "Close form" : "New campaign"}
                <Gavel className="size-3.5" />
              </Button>
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
                    toast.error(
                      err instanceof Error ? err.message : "Failed to create campaign",
                    );
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
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span>{a.prizeEmoji}</span>
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
                          : a.status === "OPEN" || a.status === "CLOSING"
                            ? `Closes ${new Date(a.closesAt).toLocaleString()}`
                            : `Settled · created ${new Date(a.createdAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
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
                      {(a.status === "OPEN" ||
                        a.status === "CLOSING" ||
                        a.status === "SCHEDULED") && (
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
    </>
  );
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
        <span className="flex size-12 items-center justify-center rounded-xl bg-rose-500/10 text-rose-300">
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
  const styles: Record<string, string> = {
    SCHEDULED: "bg-secondary text-secondary-foreground",
    OPEN: "bg-emerald-500/10 text-emerald-300",
    CLOSING: "bg-amber-500/10 text-amber-300",
    CLOSED: "bg-secondary text-secondary-foreground",
    SETTLING: "bg-amber-500/10 text-amber-300",
    COMPLETED: "bg-primary/15 text-primary",
    CANCELLED: "bg-rose-500/10 text-rose-300",
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [durationDays, setDurationDays] = useState("3");
  const [openImmediately, setOpenImmediately] = useState(true);
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
  const closesAt = now + (Number(durationDays) || 3) * DAY;

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
                title: title.trim(),
                description: description.trim(),
                opensAt: now,
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
