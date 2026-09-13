import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { formatETB } from "@/lib/money";
import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  Gavel,
  Search,
  ShieldCheck,
  ShieldX,
  Users,
  Wallet,
} from "lucide-react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/luba";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  const openAuctions = useQuery(api.auctions.listOpenAuctions, {});

  const grantRole = useMutation(api.admin.grantRole);
  const setUserStatus = useMutation(api.admin.setUserStatus);
  const cancelAuction = useMutation(api.admin.adminCancelAuction);
  const settleAuction = useMutation(api.admin.adminSettleAuction);
  const adjustWallet = useMutation(api.admin.adminAdjustWallet);

  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

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
              <Gavel className="size-4" /> Auctions
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

          {/* Auctions */}
          <TabsContent value="auctions" className="mt-5">
            {openAuctions === undefined ? (
              <LoadingRows />
            ) : (
              <div className="space-y-3">
                {openAuctions.map((a) => (
                  <div
                    key={a._id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-layered"
                  >
                    <div>
                      <p className="font-semibold">{a.prize?.title ?? a.title}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {a.auctionCode} · {a.bidCount} bids · fee{" "}
                        {formatETB(a.bidServiceFeeSantims)} · {a.status}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === `cancel-${a._id}`}
                        onClick={() => {
                          const reason = window.prompt(
                            "Cancellation reason (recorded in the audit log):",
                            "Prize unavailable",
                          );
                          if (!reason) return;
                          void act(`cancel-${a._id}`, () =>
                            cancelAuction({ auctionId: a._id, reason }),
                          );
                        }}
                      >
                        Cancel & refund
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === `settle-${a._id}`}
                        onClick={() =>
                          void act(`settle-${a._id}`, () =>
                            settleAuction({ auctionId: a._id }),
                          )
                        }
                      >
                        Force settle
                      </Button>
                    </div>
                  </div>
                ))}
                {openAuctions.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No open auctions.
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
