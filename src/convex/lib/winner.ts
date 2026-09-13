/**
 * Winner resolution — spec §27–28.
 * Deterministic: given the same set of accepted bids, the result is always
 * the same. No randomness, no client input, no Redis.
 *
 * Uses accepted bids only. Rejected requests never influence the result.
 */

export interface BidLike {
  bidValueSantims: number;
  status: "ACCEPTED" | "REFUNDED";
}

export interface WinnerResolution {
  resolution: "WINNER" | "NO_WINNER";
  winningBidValueSantims?: number;
}

/**
 * Lowest unique bid among ACCEPTED bids.
 * Equivalent SQL (spec §27):
 *   SELECT bid_value_santims FROM auction_bids
 *   WHERE auction_id = $1 AND status = 'ACCEPTED'
 *   GROUP BY bid_value_santims HAVING COUNT(*) = 1
 *   ORDER BY bid_value_santims ASC LIMIT 1;
 */
export function resolveLowestUniqueBid(
  acceptedBids: BidLike[],
): WinnerResolution {
  const counts = new Map<number, number>();
  for (const bid of acceptedBids) {
    if (bid.status !== "ACCEPTED") continue;
    counts.set(bid.bidValueSantims, (counts.get(bid.bidValueSantims) ?? 0) + 1);
  }

  let lowestUnique: number | undefined;
  for (const [value, count] of counts) {
    if (count === 1 && (lowestUnique === undefined || value < lowestUnique)) {
      lowestUnique = value;
    }
  }

  if (lowestUnique === undefined) {
    return { resolution: "NO_WINNER" };
  }
  return { resolution: "WINNER", winningBidValueSantims: lowestUnique };
}

/**
 * Consecutive bid policy — spec §13.
 * THREE_THEN_BLOCK_TWO: a user's bids may not form a run longer than 3
 * consecutive values (1.01, 1.02, 1.03 OK → 1.04, 1.05 blocked → 1.06 OK).
 * Returns true if placing newBidSantims keeps every run ≤ 3.
 */
export function isConsecutiveBidAllowed(
  policy: "NONE" | "THREE_THEN_BLOCK_TWO" | "CUSTOM",
  incrementSantims: number,
  newBidSantims: number,
  userAcceptedBidValues: number[],
): boolean {
  if (policy === "NONE" || policy === "CUSTOM" || incrementSantims <= 0) {
    return true;
  }

  const has = (v: number) => userAcceptedBidValues.includes(v);
  if (has(newBidSantims)) return true; // duplicate value: not a new run

  let runBelow = 0;
  for (let v = newBidSantims - incrementSantims; has(v); v -= incrementSantims) {
    runBelow++;
  }
  let runAbove = 0;
  for (let v = newBidSantims + incrementSantims; has(v); v += incrementSantims) {
    runAbove++;
  }

  // Resulting run through the new bid = 1 + below + above; cap is 3.
  return 1 + runBelow + runAbove <= 3;
}
