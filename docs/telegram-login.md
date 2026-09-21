# Telegram Login in Luba — the working approach

This is the documented, verified implementation of one-tap Telegram sign-in as
it actually works in this codebase (post-fix). Read this before touching
`telegram-login.tsx`, `Auth.tsx`, or the Telegram auth provider.

**What the user experiences:** click "Continue with Telegram" → Telegram's own
popup opens → one tap to confirm → signed in, redirected to the dashboard. No
code to copy, no app switch.

**Flow we use:** the classic Telegram Login **widget** (`oauth.telegram.org`
popup + HMAC-verified payload), NOT the newer OIDC flow, NOT a bot-chat OTP.

---

## 1. The five moving parts

| # | Piece | Where | What it does |
|---|-------|-------|--------------|
| 1 | Bot token | Keys/API keys tab → `TELEGRAM_BOT_TOKEN` | Server secret. Proves payloads came from Telegram. |
| 2 | Bot numeric ID | Derived server-side | Public part of the token (before the `:`). The popup API requires it. |
| 3 | Whitelisted domains | @BotFather → `/setdomain` | Telegram refuses the popup on any other domain ("bot domain invalid"). |
| 4 | Popup button component | `src/components/telegram-login.tsx` | Loads Telegram's widget script, opens the popup, returns the signed payload. |
| 5 | Verification provider | `src/convex/auth/telegramWidget.ts` | Recomputes the HMAC server-side; resolves/creates the user; enforces single use. |

Wiring: **(4) passes the payload to Convex Auth `signIn("telegram-widget", …)`
→ (5) verifies → session.** The frontend never verifies anything itself; it
forwards exactly what Telegram sent.

---

## 2. Setup checklist (in order)

1. **Token** — create the bot with @BotFather, paste the token into the Keys
   tab as `TELEGRAM_BOT_TOKEN`. Nothing else is required for login itself.
2. **Numeric bot ID** — the server computes it from the token automatically
   (`src/convex/authConfig.ts` splits the token at `:` and exposes just the
   number to the client). Do **not** put the token in any `VITE_*` var.
3. **Domain whitelist** — in @BotFather: `/setdomain` → pick your bot → send
   ONE domain per line/statement:
   ```
   https://5173-….daytonaproxy01.net   (current preview URL)
   ```
   Re-run `/setdomain` whenever the dev URL changes or you deploy to a real
   domain. This applies to dev previews too — not just production.
4. **Reload** the app. The popup should now open.

Note: newer BotFather builds expose a **Login Widget** screen in the mini app
with a *Client ID / Client Secret*. Ignore those — that's the separate OIDC
flow. Luba uses the classic widget; the only thing that matters on that screen
is the allowed-URLs list.

---

## 3. Frontend: `src/components/telegram-login.tsx`

Key design points (kept deliberately):

- **Programmatic popup, no embedded widget markup.** The component injects
  `https://telegram.org/js/telegram-widget.js?22` once per page load (a cached
  module-level promise; failures are not cached so a retry can succeed) and
  calls `Telegram.Login.auth({ bot_id, request_access: true }, cb)`. This keeps
  the button fully branded instead of Telegram's default look.
- **`bot_id` is the NUMERIC ID.** The popup API throws "Bot id required" if you
  pass a username. This exact mismatch caused our dead-button bug — see §6.
- **Trust nothing locally.** `normalizePayload()` coerces Telegram's callback
  to string fields and drops anything malformed; the hash check happens
  server-side only.
- **Busy state guards double taps.** A cancelled popup resets the button;
  the callback still fires later if the user goes on to confirm.

```tsx
// The essential call, after the script is loaded:
Telegram.Login.auth({ bot_id: 7123456789, request_access: true }, (user) => {
  if (user === false) return; // popup closed without confirming
  signIn("telegram-widget", { /* forward user fields verbatim */ });
});
```

## 4. Backend: `src/convex/auth/telegramWidget.ts`

A Convex Auth `ConvexCredentials` provider with id `telegram-widget`. The
`authorize` handler does, in order:

1. Read `TELEGRAM_BOT_TOKEN`; hard-fail if missing (config error, not user error).
2. Validate presence of `id`, `first_name`, `auth_date`, `hash`.
3. **Freshness:** `auth_date` must be within 10 minutes of server time.
4. **HMAC verification (the whole security model):**
   - `data_check_string` = every received field except `hash`, sorted by key,
     joined as `key=value` lines.
   - secret key = `SHA256(bot_token)`.
   - expected = `HMAC-SHA256(data_check_string, secret)`, hex.
   - compare with the payload's `hash` using a constant-time comparison.
5. **Single use:** each accepted hash is stored in `idempotencyKeys` (scope
   `telegram-widget-login`); a repeat is rejected. A captured payload must not
   mint a second session.
6. Resolve the user via `resolveTelegramWidgetUser` (see below), then return
   `{ userId }` so Convex Auth issues the session.

**Account resolution** (mirrors `auth/userResolution.ts` so every Telegram
entry point lands on one account):

1. existing account by `users.telegramChatId` (widget-native), else
2. legacy `telegram-otp` accounts (chat ID stored in `email`) — adopted and
   normalized to `telegramChatId` on first widget sign-in, else
3. a new account (`email` stays unset on purpose; `name`/`image` seeded from
   the Telegram profile if present).

Soft-deleted accounts are never revived — a fresh account is created.

**Why this also enables alerts:** the payload's numeric `id` is the user's
chat ID — the same key the notification outbox uses to send Telegram messages
(outbid alerts, wins, deposit status). Widget sign-in therefore wires up
notifications with zero extra work.

## 5. The page wiring (`src/pages/Auth.tsx`)

```tsx
const authMethods = useQuery(api.authConfig.getAuthMethods);
const widgetBotId = authMethods?.telegramBotId ?? null;
const widgetEnabled = authMethods?.telegramWidget === true && widgetBotId !== null;

<TelegramLoginModule
  botId={widgetBotId ?? 0}
  onAuth={(payload) => void handleWidgetAuth(payload)}
  onError={(message) => setError(message)}
  disabled={widgetBusy || isLoading}
/>
```

- The bot ID arrives from the server (`authConfig.getAuthMethods`) — the client
  never parses the token.
- `handleWidgetAuth` calls `signIn("telegram-widget", …)` with the payload
  fields verbatim, then shows a quiet hand-off screen; navigation happens when
  Convex Auth's `isAuthenticated` flips (navigating earlier makes RequireAuth
  bounce back to /auth).
- **Method-step errors are rendered.** During the dead-button bug, the widget's
  error messages were produced but never displayed on the method step — the
  failure was invisible. There is now an explicit error line under the button.
- **Two completion paths.** Besides the popup callback, Auth.tsx consumes the
  OAuth-style `#key=value` return (normalized via
  `normalizeTelegramWidgetPayload`), strips the hash from the URL immediately
  (single-use capability), and completes sign-in through the same handler.
  This covers embedding shells that drop the popup→opener message.
- **Embedded detection.** When the app detects it is inside an iframe, the auth
  page shows a link to open itself in a top-level tab — the environment where
  the popup flow verifiably works end to end.

## 6. The two bugs we hit (so you never repeat them)

1. **Prop mismatch — the dead button.** `Auth.tsx` passed `botUsername`
   (string) while `telegram-login.tsx` requires `botId` (number). TypeScript
   flagged it as a build error and at runtime the `botId` guard bailed before
   the popup could open. Lesson: the widget API takes the numeric bot ID;
   usernames belong in `t.me/` links only.
2. **"Bot domain invalid" — the popup error page.** Telegram checks the
   popup's `origin` against the bot's whitelisted domains on EVERY open,
   including dev previews. The fix is @BotFather → `/setdomain` → the exact
   preview URL. My earlier "production only" note was wrong; it is required
   for dev too.

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Button click does nothing | `botId` missing/invalid (prop mismatch class of bug) | Pass the numeric ID from `getAuthMethods`; check console for "Bot id required" |
| Popup shows "bot domain invalid" | Current URL not whitelisted on the bot | `/setdomain` in @BotFather with the exact URL you're on |
| "confirmation expired" | Slower than 10 min between confirm and sign-in | Just tap the button again |
| "already used" | Payload replay (double-submit or stale retry) | Expected single-use guard; retry fresh |
| "Telegram sign-in is not configured" | `TELEGRAM_BOT_TOKEN` missing server-side | Add it in the Keys tab |
| Popup opens but payload never arrives | COOP header blocking popup↔opener messaging (see Telegram docs) | Serve `Cross-Origin-Opener-Policy: same-origin-allow-popups` (or remove the header) |
| Popup confirms, closes, page unchanged | App runs inside an embedding iframe (preview pane); Telegram's popup→opener hand-off is dropped by the shell | Use the URL-hash return fallback (implemented in Auth.tsx) or open the app in its own tab — the embedded-tip link under the button does this |

Deployment reminders: re-run `/setdomain` for every new origin (preview URLs
change; production needs its own), and keep the token server-side only.
