/**
 * Friendly error handling for Convex mutations.
 *
 * Convex wraps uncaught `throw new Error("CODE")` as
 * `err.message = "Uncaught Error: CODE"`. Server functions may also throw
 * multi-word human sentences (accountLinks.ts) that are safe to show as-is.
 *
 * One home for: (1) stripping the wrapper, (2) turning known codes into
 * user-facing copy, (3) a safe fallback for unknown codes that still gives
 * the user a way forward instead of a stack-trace smell.
 */

/** Server codes we know, with copy that states the problem and the fix. */
const FRIENDLY: Record<string, string> = {
  // Auth / session
  UNAUTHENTICATED: "Your session expired - sign in again and retry.",
  USER_NOT_FOUND: "We couldn't find your account. Sign in again or contact support.",
  ACCOUNT_RESTRICTED: "This account can't take that action right now. Contact support if you think this is a mistake.",

  // Wallet / payments
  INVALID_AMOUNT: "Enter a valid amount to top up.",
  PAYMENT_NOT_FOUND: "That payment no longer exists - start the top-up again.",
  PAYMENT_NOT_YOURS: "That payment belongs to another account.",
  NOT_A_MANUAL_PAYMENT: "This payment type can't be verified manually.",
  AMOUNT_MISMATCH: "The transferred amount doesn't match the top-up request. Start a new top-up for the exact amount.",
  SETTLEMENT_NOT_FOUND: "That prize settlement no longer exists.",
  NOT_THE_WINNER: "Only the auction winner can pay for this prize.",
  SETTLEMENT_ALREADY_SETTLED: "This prize is already paid.",
  INSUFFICIENT_BALANCE: "Not enough balance in your wallet - top up first.",
  SELF_EXCLUDED: "You're on a self-exclusion break. Bidding and deposits are paused until it lifts.",
  DEPOSIT_CAP: "That amount is above your daily deposit cap. Lower the amount or adjust the cap in Responsible play.",

  // Bidding
  USER_NOT_ELIGIBLE: "Your account is not eligible to bid. Contact support.",
  TERMS_NOT_ACCEPTED: "Please accept the auction terms first.",
  AUCTION_NOT_OPEN: "This auction is not open for bidding.",
  AUCTION_CLOSED: "This auction has closed.",
  BID_OUT_OF_RANGE: "Your bid is outside the allowed range for this auction.",
  BID_NOT_ON_INCREMENT: "Your bid must follow the allowed increments.",
  BID_LIMIT_REACHED: "You've used all your bids for this auction.",
  CONSECUTIVE_BID_BLOCKED: "That would create a run longer than allowed. Pick a different amount.",

  // Receipts (links.et manual verification)
  PASTE_RECEIPT_FIRST: "Paste your receipt link or telebirr reference first.",
  RECEIPT_URL_MUST_BE_HTTPS: "Paste the full https:// link from your bank app or SMS.",

  // KYC
  KYC_ALREADY_PENDING: "You already have a document under review. We'll notify you when it's done.",
  ACCOUNT_NOT_ELIGIBLE: "Your account isn't eligible for verification yet. Complete your profile first.",
  FILE_NOT_FOUND: "We couldn't read that file - pick it again.",
  FILE_TYPE_NOT_ALLOWED: "Only JPEG, PNG, WebP, or PDF files are accepted.",
  FILE_TOO_LARGE_5MB: "That file is over 5 MB - pick a smaller one.",

  // Profile
  NAME_TOO_SHORT: "Your name needs at least 2 characters.",
  NAME_TOO_LONG: "That name is too long - keep it under 40 characters.",
  INVALID_NAME: "Use letters and spaces only for your display name.",
};

/** Strip Convex's "Uncaught Error: " wrapper from thrown server errors. */
export function cleanConvexError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Uncaught Error:\s*/, "").trim();
}

/**
 * Map a caught error to a user-facing message.
 * Known codes → friendly copy; multi-word human sentences → passed through;
 * opaque single-token codes → generic fallback with a recovery path.
 */
export function friendlyError(err: unknown): string {
  const msg = cleanConvexError(err);
  if (FRIENDLY[msg]) return FRIENDLY[msg];
  // Human sentences from the server (e.g. "That phone number is already
  // linked to another user.") are already user-facing.
  if (msg.includes(" ")) return msg;
  // Opaque unknown code - never show it raw.
  return "That didn't go through. Check your connection and try again.";
}
