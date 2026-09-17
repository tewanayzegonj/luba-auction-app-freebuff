import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Custom user resolution for sign-ins (wired into convexAuth callbacks).
 *
 * Default framework behavior links by verified email/phone and would
 * otherwise create a brand-new account for every Telegram chat ID / SMS
 * number. We extend it so that:
 *
 *  - telegram-otp: a chat ID linked via accountLinks resolves to the linked
 *    user (no new account, no clobbering of their real email field).
 *  - sms-otp: a phone verified on an account resolves to that user.
 *  - everything else (email-otp, Anonymous) keeps the framework's default
 *    behavior, reimplemented faithfully below.
 */
export async function resolveCreateOrUpdateUser(
  ctx: MutationCtx,
  args: {
    existingUserId: Id<"users"> | null;
    provider: { id: string; type: string };
    profile: {
      email?: string;
      emailVerified?: boolean | string;
      phone?: string;
      phoneVerified?: boolean | string;
    } & Record<string, unknown>;
    shouldLinkViaEmail?: boolean;
    shouldLinkViaPhone?: boolean;
  },
): Promise<Id<"users">> {
  const { provider, profile } = args;
  const identifier = profile.email;

  // ── Telegram: resolve via linked chat ID ────────────────────────────────
  if (provider.id === "telegram-otp" && typeof identifier === "string") {
    const linked = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("telegramChatId"), identifier))
      .first();
    if (linked !== null) {
      // Attach the auth account to the linked user; do NOT patch the user
      // document (their real email/name must be preserved).
      return linked._id;
    }
    // Unlinked chat ID → new/standalone Telegram account (default path).
    return defaultUpsert(ctx, args);
  }

  // ── SMS: resolve via verified phone ─────────────────────────────────────
  if (provider.id === "sms-otp" && typeof identifier === "string") {
    const byPhone = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", identifier))
      .filter((q) => q.neq(q.field("phoneVerificationTime"), undefined))
      .take(2);
    if (byPhone.length === 1) {
      // Exactly one account has this phone verified → it owns the number.
      return byPhone[0]._id;
    }
    if (byPhone.length > 1) {
      // Should not happen (link flow prevents duplicates) - fail safe by
      // refusing to merge: treat as a fresh account instead of guessing.
      return defaultUpsert(ctx, { ...args, profile: { email: identifier } });
    }
    return defaultUpsert(ctx, args);
  }

  // ── Email OTP / Anonymous: framework default behavior ───────────────────
  return defaultUpsert(ctx, args);
}

/**
 * Faithful reimplementation of @convex-dev/auth's defaultCreateOrUpdateUser
 * for the provider types this app uses (email-type OTP + Anonymous).
 */
async function defaultUpsert(
  ctx: MutationCtx,
  args: Parameters<typeof resolveCreateOrUpdateUser>[1],
): Promise<Id<"users">> {
  const { provider, profile } = args;

  const emailVerified =
    profile.emailVerified === true ||
    (typeof profile.emailVerified === "string" && profile.emailVerified !== "") ||
    provider.type === "email";
  const shouldLinkViaEmail =
    args.shouldLinkViaEmail || emailVerified || provider.type === "email";

  let userId = args.existingUserId ?? null;

  if (
    userId === null &&
    typeof profile.email === "string" &&
    shouldLinkViaEmail
  ) {
    // Link to a unique user whose email is already verified.
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", profile.email as string))
      .filter((q) => q.neq(q.field("emailVerificationTime"), undefined))
      .take(2);
    if (users.length === 1) {
      userId = users[0]._id;
    }
  }

  const userData = {
    ...(emailVerified ? { emailVerificationTime: Date.now() } : null),
    ...profile,
  };

  if (userId !== null) {
    await ctx.db.patch(userId, userData);
  } else {
    userId = await ctx.db.insert("users", userData);
  }
  return userId;
}
