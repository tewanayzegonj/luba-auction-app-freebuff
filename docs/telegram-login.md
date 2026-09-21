# Telegram Login in Luba — the working approach

This is the documented, verified implementation of Telegram sign-in as it
actually works in this codebase. Read this before touching
`telegram-login.tsx`, `Auth.tsx`, or the Telegram auth providers.

**What the user experiences** (this is Telegram's *current* official login):

1. Click **Continue with Telegram** on `/auth`.
2. Telegram hosts the whole experience — a popup (or, on phones, Telegram's
   own in-app browser / native sheet) opens on `oauth.telegram.org`:
   * **"Log in with Telegram"** — one tap to confirm.
   * **"Or log in with a phone number"** — enter the phone linked to your
     Telegram, confirm in the app ("This site will receive your name,
     username and profile photo" + device/IP details).
   * **Login options** — Use Telegram on this device / phone number /
     QR code.
3. We receive a signed OIDC **`id_token`** (JWT) → server verifies → session
   → redirect to the app. No codes to copy, no app switch.

**Key point:** the phone-number and QR screens are not something we build.
They are part of Telegram's hosted flow, shown automatically by the official
library. We only open it and hand over the token it returns.

---

## 1. The five moving parts

| # | Piece | Where | What it does |
|---|-------|-------|--------------|
| 1 | Bot token | Keys/API keys tab → `TELEGRAM_BOT_TOKEN` | Server secret. Its public numeric prefix is the bot ID (OIDC `client_id`) and the token's expected `aud` claim. |
| 2 | Bot numeric ID | Derived server-side (`authConfig.getAuthMethods`) | The library requires it — the popup throws "client_id is required" without it. |
| 3 | Whitelisted domains | @BotFather → `/setdomain` | Telegram refuses the login page on any other domain ("bot domain invalid"). Applies to dev previews too. |
| 4 | Login button component | `src/components/telegram-login.tsx` | Loads `oauth.telegram.org/js/telegram-login.js`, opens the hosted login with our scopes, returns the `id_token`. |
| 5 | Verification provider | `src/convex/auth/telegramOidc.ts` | Verifies the JWT against Telegram's published JWKS; resolves/creates the user; enforces single use. |

Wiring: **(4) calls Convex Auth `signIn("telegram-oidc", { id_token })` →
(5) verifies → session.** The client never verifies anything; it forwards the
token verbatim.

## 2. Setup checklist (in order)

1. **Token** — create the bot with @BotFather, paste the token into the Keys
   tab as `TELEGRAM_BOT_TOKEN`. Nothing else is required for login itself
   (no OIDC client secret — see §4).
2. **Domain whitelist** — in @BotFather: `/setdomain` → pick your bot → send
   the exact URL you're on, one command per domain:
   ```
   https://5173-….daytonaproxy01.net   (current preview URL)
   ```
   Re-run `/setdomain` whenever the dev URL changes or you deploy to a real
   domain. This applies to dev previews too — not just production.
3. **Reload** the app. The login page should open.

The newer BotFather mini-app also has a **Login Widget** screen with a
*Client ID / Client Secret*. We don't need the secret: our popup flow
(`response_type=post_message`) delivers the signed token directly to the
page, so verification is by public key, not client secret. Ignore those
fields; only the allowed-URLs list matters.

## 3. Frontend: `src/components/telegram-login.tsx`

Design points (kept deliberately):

- **Official library, programmatic open.** We inject
  `https://oauth.telegram.org/js/telegram-login.js` once per page load
  (module-level promise; failures are not cached so a retry can succeed) and
  call `Telegram.Login.auth({ client_id, scope }, cb)`. Keeps the button
  fully branded instead of Telegram's default embed.
- **`client_id` is the NUMERIC bot ID.** Same number as the classic widget's
  `bot_id`. The earlier dead-button bug was exactly this class of mistake —
  see §6.
- **Scopes:** `openid profile` → name/username/photo; `phone` → phone number
  *with explicit consent in Telegram's UI*; `telegram:bot_access` → our bot
  may message the user (outbid/winner alerts work with zero extra setup).
- **Trust nothing locally.** The callback result is checked structurally
  (three-segment JWT) before being forwarded; the server decides validity.
- **Busy state guards double taps.** A cancelled popup resets the button.

```tsx
// The essential call, after the script loads:
Telegram.Login.auth(
  {
    client_id: 7123456789,
    scope: ["openid", "profile", "phone", "telegram:bot_access"],
    lang: "en",
  },
  (result) => {
    if (!result?.id_token) return; // closed or unreadable → no-op / error
    signIn("telegram-oidc", { id_token: result.id_token });
  },
);
```

## 4. Backend: `src/convex/auth/telegramOidc.ts`

A Convex Auth `ConvexCredentials` provider with id `telegram-oidc`. The
`authorize` handler does, in order:

1. Read `TELEGRAM_BOT_TOKEN`; hard-fail if missing (config error, not user error).
2. Derive `botId` from the token's public prefix.
3. **Claims check:** `iss === https://oauth.telegram.org`,
   `aud === String(botId)`, `sub` present, `exp`/`iat` present.
4. **Freshness:** reject stale/future tokens; enforce a tight 10-minute max
   age regardless of Telegram's longer `exp` window, with 60s clock skew.
5. **Signature:** RS256 (or ES256) against Telegram's JWKS
   (`oauth.telegram.org/.well-known/jwks.json`, cached 10 min; unknown `kid`
   triggers one refresh for key rotation). Verified with WebCrypto — no
   extra dependency.
6. **Anti-replay:** each token's SHA-256 is stored in `idempotencyKeys`
   (scope `telegram-oidc-login`); a repeat is rejected. Client-supplied
   nonces are single-use too (scope `telegram-oidc-nonce`). A captured token
   must never mint a second session.
7. Resolve the user via `resolveTelegramOidcUser` (below), return `{ userId }`
   so Convex Auth issues the session.

**No client secret needed.** Standard OIDC code flow would require one, but
the popup returns the token directly (post_message), so the JWT's signature —
checked against Telegram's *public* keys — is the trust anchor.

**Account resolution** (`resolveTelegramOidcUser`, mirrors
`auth/telegramWidget.ts` so every Telegram entry point — widget, bot OTP,
OIDC — lands on ONE account):

1. existing account by `users.telegramChatId`, else
2. legacy `telegram-otp` accounts (chat ID stored in `email`) — adopted and
   normalized to `telegramChatId` on first sign-in, else
3. a new account (`email` stays unset on purpose — it's the email sign-in
   identity and must never collide with a chat ID; `name`/`image` seeded
   from the Telegram profile if present).

Display info is refreshed only when missing (we never overwrite an existing
name/photo). The **Telegram-verified phone number** is stored when the
account has none — with `phoneVerificationTime` — because the user consented
to it explicitly in Telegram's UI. Soft-deleted accounts are never revived.

**Why this also enables alerts:** the token's `sub` is the user's chat ID —
the same key the notification bridge uses to send Telegram messages (outbid
alerts, wins, deposit status).

## 5. The page wiring (`src/pages/Auth.tsx`)

```tsx
const authMethods = useQuery(api.authConfig.getAuthMethods);
const widgetBotId = authMethods?.telegramBotId ?? null;
const widgetEnabled = authMethods?.telegramWidget === true && widgetBotId !== null;

<TelegramLoginModule
  clientId={widgetBotId ?? 0}
  onAuth={(payload) => void handleWidgetAuth(payload)}
  onError={(message) => setError(message)}
  disabled={widgetBusy || isLoading}
/>
```

- The bot ID arrives from the server (`authConfig.getAuthMethods`) — the
  client never parses the token. (`telegramWidget` is the flag's historical
  name; it simply means "a bot token is configured".)
- `handleWidgetAuth` calls `signIn("telegram-oidc", { id_token })`, then
  shows a quiet hand-off screen; navigation happens when Convex Auth's
  `isAuthenticated` flips (navigating earlier makes RequireAuth bounce back
  to /auth).
- **Method-step errors are rendered** under the button, with friendly copy
  for the common cases: replayed/expired token, rate limit, generic failure.
- **Embedded detection.** When the app detects it is inside an iframe (the
  preview pane), the auth page shows a link to open itself in a top-level
  tab — the environment where the popup flow verifiably works end to end.
  Embedding shells can drop the popup→opener hand-off; the fallback link
  gives users a reliable escape hatch.

## 6. The bugs we hit (so you never repeat them)

1. **Prop mismatch — the dead button.** The page passed `botUsername` (a
   string) while the component needs the bot's **numeric ID**. TypeScript
   flagged it; at runtime the ID guard bailed before the popup could open,
   and the produced error was never rendered. Lesson: both the classic
   widget (`bot_id`) and the new flow (`client_id`) take the numeric ID;
   usernames belong in `t.me/` links only.
2. **"Bot domain invalid" — the error page instead of a login page.**
   Telegram checks the page's `origin` against the bot's whitelisted domains
   on EVERY open, including dev previews. Fix: `/setdomain` in @BotFather
   with the exact URL. My earlier "production only" note was wrong.
3. **Popup confirms, closes, nothing happens (preview pane).** The app ran
   inside the platform's preview iframe and Telegram's popup→opener hand-off
   was dropped by the shell — no code of ours ever failed, so no error
   appeared. Mitigation: the embedded "open in own tab" tip. If it recurs in
   a new embedding context, prefer top-level testing first.

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Button click does nothing | `clientId` missing/invalid (prop mismatch class of bug) | Pass the numeric ID from `getAuthMethods`; check console for "client_id is required" |
| Login page shows "bot domain invalid" | Current URL not whitelisted on the bot | `/setdomain` in @BotFather with the exact URL you're on |
| "This Telegram confirmation expired…" | More than 10 min between confirm and sign-in | Tap the button again |
| "…already used" | Token replay (double-submit or stale retry) | Expected single-use guard; sign in again |
| "Telegram sign-in is not configured" | `TELEGRAM_BOT_TOKEN` missing server-side | Add it in the Keys tab |
| "…could not be matched to a trusted key" | Telegram rotated signing keys mid-flight | Transient — retry; the JWKS cache refreshes automatically |
| Popup confirms, closes, page unchanged | App runs inside an embedding iframe; the popup→opener hand-off is dropped | Open the app in its own tab (the embedded tip link) |

Deployment reminders: re-run `/setdomain` for every new origin (preview URLs
change; production needs its own), and keep the token server-side only.
