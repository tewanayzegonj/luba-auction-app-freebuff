import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Transparency & trust queries (spec §33, §71).
 *
 * The winner wall and published bid histories are the platform's strongest
 * anti-"rigged" signal: every settled auction can show its full frequency
 * map, and recent winners are public. Receipts give each user an auditable
 * view of their own financial events, sourced from the ledger.
 */

/** Recent settled auctions with winners, for the public winner wall. */
export const recentWinners = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("auctionResults")
      .withIndex("by_auction")
      .order("desc")
      .take(args.limit ?? 12)
      .then(async (rs) => {
        const out: {
          auctionCode: string;
          auctionTitle: string;
          prizeTitle: string | null;
          prizeImage: string | null;
          prizeEmoji: string | null;
          winningBidValueSantims: number | null;
          winnerFirstName: string | null;
          resolvedAt: number;
          resolution: "WINNER" | "NO_WINNER";
        }[] = [];
        for (const r of rs) {
          if (r.resolution !== "WINNER" || r.winnerUserId === undefined) continue;
          const auction = await ctx.db.get(r.auctionId);
          if (!auction) continue;
          const prize = await ctx.db.get(auction.prizeId);
          const winner = await ctx.db.get(r.winnerUserId);
          out.push({
            auctionCode: auction.auctionCode,
            auctionTitle: auction.title,
            prizeTitle: prize?.title ?? null,
            prizeImage: prize?.imageUrl ?? null,
            prizeEmoji: prize?.emoji ?? null,
            winningBidValueSantims: r.winningBidValueSantims ?? null,
            // First name + last initial only — never full identities.
            winnerFirstName: winner?.name
              ? maskName(winner.name)
              : maskName(winner?.email?.split("@")[0] ?? "Winner"),
            resolvedAt: r.resolvedAt,
            resolution: r.resolution,
          });
        }
        return out;
      });
    return results;
  },
});

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }
  return parts[0];
}

/** Premium anonymized bidder label: "User ***89" from the user id tail. */
function maskBidder(userId: Id<"users">): string {
  return `User ***${userId.toString().slice(-2)}`;
}

/**
 * Full public frequency map for a CLOSED/COMPLETED auction — only when the
 * admin enabled publishBidHistory. Values ascending; reveals exactly how
 * the winner was determined.
 */
export const publishedBidHistory = query({
  args: { auctionCode: v.string() },
  handler: async (ctx, args) => {
    const auction = await ctx.db
      .query("auctions")
      .withIndex("by_code", (q) => q.eq("auctionCode", args.auctionCode))
      .unique();
    if (!auction) return null;
    if (!auction.publishBidHistory) return { published: false as const };
    if (auction.status !== "CLOSED" && auction.status !== "COMPLETED") {
      return { published: false as const };
    }

    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_value", (q) => q.eq("auctionId", auction._id))
      .collect();
    const accepted = bids.filter((b) => b.status === "ACCEPTED");

    const byValue = new Map<number, number>();
    for (const b of accepted) {
      byValue.set(b.bidValueSantims, (byValue.get(b.bidValueSantims) ?? 0) + 1);
    }
    const winning = await ctx.db
      .query("auctionResults")
      .withIndex("by_auction", (q) => q.eq("auctionId", auction._id))
      .unique();

    const map = [...byValue.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([value, count]) => ({
        valueSantims: value,
        count,
        unique: count === 1,
        isWinning:
          count === 1 && winning?.winningBidValueSantims === value,
      }));
    return {
      published: true as const,
      map,
      totalBids: accepted.length,
      uniqueValues: byValue.size,
      winningBidValueSantims: winning?.winningBidValueSantims ?? null,
    };
  },
});

/**
 * Bid heatmap (§6.5): anonymized, aggregated bid-frequency buckets over the
 * auction's configured range. Reveals where bidding is crowded and where it
 * is empty without exposing exact values, so users are nudged toward empty
 * zones instead of being handed the winner. Bounded: one indexed read of the
 * auction's accepted bids (the display reconciler pattern).
 */
export const bidHeatmap = query({
  args: { auctionCode: v.string(), bucketCount: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const auction = await ctx.db
      .query("auctions")
      .withIndex("by_code", (q) => q.eq("auctionCode", args.auctionCode))
      .unique();
    if (!auction) return null;

    const buckets = Math.max(4, Math.min(16, args.bucketCount ?? 8));
    const span = auction.maxBidSantims - auction.minBidSantims;
    const width = Math.max(1, Math.ceil(span / buckets));

    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_value", (q) => q.eq("auctionId", auction._id))
      .collect();
    const accepted = bids.filter((b) => b.status === "ACCEPTED");

    const counts = new Array<number>(buckets).fill(0);
    for (const b of accepted) {
      const idx = Math.min(
        buckets - 1,
        Math.floor((b.bidValueSantims - auction.minBidSantims) / width),
      );
      counts[idx]++;
    }
    return {
      buckets: counts.map((count, i) => ({
        fromSantims: auction.minBidSantims + i * width,
        toSantims: auction.minBidSantims + (i + 1) * width,
        count,
      })),
      totalBids: accepted.length,
    };
  },
});

/** Live activity feed for an OPEN auction (countdown-page ticker). */
export const auctionActivity = query({
  args: { auctionCode: v.string() },
  handler: async (ctx, args) => {
    const auction = await ctx.db
      .query("auctions")
      .withIndex("by_code", (q) => q.eq("auctionCode", args.auctionCode))
      .unique();
    if (!auction) return null;

    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_accepted", (q) =>
        q.eq("auctionId", auction._id),
      )
      .order("desc")
      .take(8);

    // Aggregate uniqueness info only — individual values stay hidden while
    // the auction is live (spec §33: limited public information during run).
    const allAccepted = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_value", (q) => q.eq("auctionId", auction._id))
      .collect()
      .then((bs) => bs.filter((b) => b.status === "ACCEPTED"));
    const counts = new Map<number, number>();
    for (const b of allAccepted) {
      counts.set(b.bidValueSantims, (counts.get(b.bidValueSantims) ?? 0) + 1);
    }

    return {
      totalBids: auction.bidCount,
      uniqueValues: counts.size,
      uniqueBids: [...counts.values()].filter((c) => c === 1).length,
      recent: bids.map((b) => ({
        // Anonymized ticker (§4.16): "User ***89" premium masking — last two
        // characters of the user id, never a name, never the bid value.
        who: maskBidder(b.userId),
        feeSantims: b.bidServiceFeeSantims,
        acceptedAt: b.acceptedAt,
      })),
    };
  },
});

/** One user's receipt feed — their own ledger transactions with entries. */
export const myReceipts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const receipts: {
      _id: string;
      txType: string;
      description: string;
      amountSantims: number; // signed from the user's perspective
      createdAt: number;
      reference: string;
    }[] = [];

    if (!wallet) return receipts;

    const accounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_owner", (q) => q.eq("owner", userId))
      .collect();
    const accountById = new Map(accounts.map((a) => [a._id, a]));

    const txs = await ctx.db
      .query("ledgerTransactions")
      .withIndex("by_creation_time")
      .order("desc")
      .take(args.limit ?? 100);

    for (const tx of txs) {
      const entries = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_transaction", (q) => q.eq("transactionId", tx._id))
        .collect();
      const mine = entries.filter((e) => accountById.has(e.accountId));
      if (mine.length === 0) continue;
      // Net effect on the user's own accounts (paid + promo).
      let net = 0;
      for (const e of mine) {
        const acct = accountById.get(e.accountId)!;
        const isDebitNormal = acct.type === "ASSET" || acct.type === "EXPENSE";
        net += (isDebitNormal ? 1 : -1) * (e.direction === "DEBIT" ? e.amountSantims : -e.amountSantims);
      }
      receipts.push({
        _id: tx._id,
        txType: tx.txType,
        description: tx.description,
        amountSantims: net,
        createdAt: tx.createdAt,
        reference: tx.reference,
      });
    }
    return receipts;
  },
});
