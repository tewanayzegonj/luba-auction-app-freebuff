import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  TelegramLoginModule,
  type TelegramOidcPayload,
  type TelegramWidgetPayload,
} from "@/components/telegram-login";

import { useAuth } from "@/hooks/use-auth";
import { LubaWordmark } from "@/components/luba";
import { api } from "@/convex/_generated/api";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Gavel,
  ExternalLink,
  Link2,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Smartphone,
  XCircle,
} from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate, useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { useLang } from "@/lib/i18n";
import { useCallback } from "react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

const TELEGRAM_BOT_URL =
  (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined)?.trim()
    ? `https://t.me/${(import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string).trim()}`
    : "https://t.me/luba_auction_bot";

type Provider = "email-otp" | "telegram-otp" | "sms-otp" | "telegram-widget";
type Step = "method" | "identifier" | "verify";

interface AuthProps {
  redirectAfterAuth?: string;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  "email-otp": "email",
  "telegram-otp": "Telegram",
  "sms-otp": "SMS",
  // The widget signs in directly, so this label is only ever read by the
  // type system - the provider never enters the step machine.
  "telegram-widget": "Telegram",
};

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const authMethods = useQuery(api.authConfig.getAuthMethods);
  const confirmLink = useMutation(api.accountLinks.confirmLink);

  const linkToken = searchParams.get("link");
  const [linkState, setLinkState] = useState<
    "working" | "success" | { error: string }
  >(linkToken ? "working" : "success");

  // A user arriving from a Telegram/SMS confirmation link confirms it here -
  // the token is a capability, so no sign-in is required to bind the channel.
  useEffect(() => {
    if (!linkToken) return;
    let cancelled = false;
    confirmLink({ token: linkToken })
      .then((res) => {
        if (!cancelled) setLinkState("success");
        void res;
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLinkState({ error: friendlyError(err) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkToken]);

  const [step, setStep] = useState<Step>("method");
  const [referralBound, setReferralBound] = useState(false);
  const [provider, setProvider] = useState<Provider>("email-otp");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState(false);
  // Telegram's login popup addresses the app by a NUMERIC client id. For
  // the new OIDC system that's the Client ID BotFather shows in the Login
  // Widget screen (TELEGRAM_OIDC_CLIENT_ID), falling back to the bot's
  // numeric token prefix. Without it the popup fails ("client_id is
  // required" / "origin required"), so the button only renders when the id
  // is actually available.
  const telegramClientId =
    authMethods?.telegramOidcClientId ?? authMethods?.telegramBotId ?? null;
  const widgetEnabled =
    authMethods?.telegramWidget === true && telegramClientId !== null;
  const [widgetBusy, setWidgetBusy] = useState(false);
  // Telegram's popup hands its result back to the window that opened it;
  // embedding shells (like a preview iframe) can drop that hand-off. When
  // embedded, offer the same app in a top-level tab, where the popup flow
  // works with no caveats.
  const [isEmbedded] = useState(() =>
    typeof window !== "undefined" && window.self !== window.top
      ? true
      : false,
  );

  const applyReferral = useMutation(api.growth.applyReferralCode);
  const exchangeCode = useAction(
    api.auth.telegramExchange.exchangeTelegramCode,
  );

  /**
   * Standard OIDC code exchange: the ?code= Telegram redirected back with is
   * traded for the signed id_token server-side (Client Secret + PKCE
   * verifier stay off the client), then sign-in proceeds exactly like the
   * token path.
   */
  const completeCodeExchange = useCallback(
    async (code: string, state: string): Promise<void> => {
      setWidgetBusy(true);
      setError(null);
      try {
        const { idToken } = await exchangeCode({
          code,
          state,
          redirectUri: window.location.origin + window.location.pathname,
        });
        await signIn("telegram-oidc", { id_token: idToken });
        setHandoff(true);
        setTimeout(() => setHandoff(false), 8000);
      } catch (err) {
        setError(
          friendlyError(err) ||
            "Telegram sign-in could not be completed. Please try again in a moment.",
        );
      } finally {
        setWidgetBusy(false);
      }
    },
    [exchangeCode, signIn],
  );

  // Telegram redirect return: after the user accepts on Telegram's page,
  // Telegram bounces back to this URL with the signed result in the
  // fragment. The classic widget encodes it as `#tgAuthResult=<base64>`;
  // the OIDC flow can land `code=<...>` / `token=<...>` as query params.
  // This effect consumes it once, strips it from the address bar (the
  // value is single-use), and completes sign-in - no popup messaging
  // involved, so it works identically in tabs, iframes, and Telegram's
  // in-app browser. Guarded by a ref because effects re-run in dev strict
  // mode and a double-consume would trip the single-use replay guard.
  const tgReturnConsumed = useRef(false);
  useEffect(() => {
    const runConsumer = async () => {
    if (tgReturnConsumed.current) return;
    const readReturn = ():
      | { kind: "widget"; payload: TelegramWidgetPayload }
      | { kind: "oidc"; token: string }
      | { kind: "code"; code: string; state: string }
      | { kind: "stale-code" }
      | null => {
      // Classic widget: `#tgAuthResult=<base64(JSON payload)>`.
      const hash = window.location.hash;
      const m = hash.match(/tgAuthResult=([A-Za-z0-9_%-]+)/);
      if (m) {
        try {
          const json = JSON.parse(
            atob(
              m[1]
                .replace(/%3D/g, "=")
                .replace(/-/g, "+")
                .replace(/_/g, "/"),
            ),
          ) as Record<string, unknown>;
          const payload: TelegramWidgetPayload = {};
          for (const [k, v] of Object.entries(json)) {
            if (typeof v === "string" || typeof v === "number") {
              payload[k] = String(v);
            }
          }
          return { kind: "widget", payload };
        } catch {
          return null;
        }
      }
      // New OIDC system: `?code=` (authorization code) + `?state=` per the
      // standard flow. The server validates state at exchange time (it
      // issued and stored the matching PKCE verifier) - a forged, stale, or
      // replayed return is rejected there.
      const qp = new URLSearchParams(window.location.search);
      const code = qp.get("code");
      const state = qp.get("state");
      if (code && state) {
        return { kind: "code", code, state };
      }
      if (code) {
        return { kind: "stale-code" };
      }
      return null;
    };

    const found = readReturn();
    if (!found) return;
    tgReturnConsumed.current = true;
    // Strip the credential from the address bar immediately: it is
    // single-use, and a refresh/re-share must not re-consume it.
    window.history.replaceState(null, "", window.location.pathname);

    // Note: unlike the token/widget paths, a code return is NOT forwarded
    // to an opener window - the PKCE verifier lives in this window's
    // sessionStorage, so the exchange must happen right here. The popup
    // therefore completes sign-in itself; the opener refresh bridge below
    // brings the main page along.
    if (found.kind === "stale-code") {
      setError(
        "That Telegram confirmation link is stale or incomplete. Please tap Continue with Telegram again.",
      );
      return;
    }
    // The flow state (PKCE verifier) is server-side, so the exchange can
    // run in any window context.
    if (found.kind === "code") {
      await completeCodeExchange(found.code, found.state);
      return;
    }
    void handleTelegramAuth(
      found.kind === "widget" ? found.payload : { id_token: found.token },
    );
    };
    void runConsumer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Popup return bridge (token/widget paths): when a Telegram flow completes
  // inside a popup opened by THIS page, the popup posts its result here and
  // closes itself. Same-origin sender + message type check. (The OIDC code
  // path is NOT bridged: the PKCE verifier lives in whichever window started
  // the flow, and that window is the one Telegram redirects back to - so it
  // always completes its own exchange.)
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | { type?: string; payload?: unknown }
        | null;
      if (!data || data.type !== "luba-telegram-auth") return;
      const p = data.payload as
        | TelegramOidcPayload
        | TelegramWidgetPayload
        | null;
      void handleTelegramAuth(p ?? null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      // Referral capture: bind once per session after a successful sign-in.
      const ref = searchParams.get("ref");
      if (ref && !referralBound) {
        setReferralBound(true);
        applyReferral({ code: ref }).catch(() => {
          // Invalid/self/expired codes are silently ignored - never block login.
        });
      }
      navigate(redirect, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, redirect, searchParams, referralBound, applyReferral]);

  const cleanError = (err: unknown, fallback: string) => {
    // Convex auth errors arrive as Error("Uncaught Error: {\"message\":\"...\"}")
    const msg = err instanceof Error ? err.message : "";
    try {
      const match = msg.match(/\{"message":"(.*?)"\}/);
      if (match) return match[1];
      if (msg && !msg.startsWith("Uncaught Error: {")) {
        return msg.replace("Uncaught Error: ", "");
      }
    } catch {
      /* fall through */
    }
    return fallback;
  };

  /** Human error copy for the verify step (master skill: errors explain what
      happened and how to fix it - never leak provider internals like Convex
      Auth's raw "Could not verify code"). A wrong/expired code is by far the
      most common cause, so it's the default; rate limiting and connection
      failures get their own copy because the remedy differs. */
  const friendlyVerifyError = (err: unknown) => {
    const msg = (err instanceof Error ? err.message : "").toLowerCase();
    if (/rate|too many|flood|throttl/.test(msg)) {
      return "Too many attempts - wait a minute, then try your code again.";
    }
    if (/network|failed to fetch|offline|load failed/.test(msg)) {
      return "Connection trouble - check your internet and try again.";
    }
    return "That code didn't match, or it has expired. Double-check the 6 digits - or send a fresh code below.";
  };

  const selectMethod = (p: Provider) => {
    setProvider(p);
    setIdentifier("");
    setError(null);
    setStep("identifier");
  };

  const handleIdentifierSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      // All three providers are Email-type, so the framework expects the
      // identifier in the `email` param (it holds an address, chat ID, or
      // phone depending on the provider).
      await signIn(provider, { email: identifier });
      setOtp("");
      setStep("verify");
    } catch (err) {
      setError(
        cleanError(
          err,
          `Failed to send the code. Please check your details and try again.`,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await signIn(provider, { email: identifier, code: otp });
      // Hand-off screen - do NOT navigate here: ConvexAuth's isAuthenticated
      // flips a round-trip after signIn resolves. Navigating now makes
      // RequireAuth bounce the user back to /auth, which remounts this page
      // at the method step (reads as "sign-in did nothing"). The
      // isAuthenticated effect performs the redirect the moment the session
      // is real; the timer below recovers the form if it never lands.
      setHandoff(true);
      setTimeout(() => setHandoff(false), 8000);
    } catch (err) {
      // Never surface the raw provider error here - a rejected code should
      // read as a normal, recoverable step, not a system failure.
      setError(friendlyVerifyError(err));
      setOtp("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      await signIn(provider, { email: identifier });
      setOtp("");
    } catch (err) {
      const msg = (err instanceof Error ? err.message : "").toLowerCase();
      if (/rate|too many|flood|throttl/.test(msg)) {
        setError("Too many code requests - wait a minute before asking for another.");
      } else if (/network|failed to fetch|offline|load failed/.test(msg)) {
        setError("Connection trouble - check your internet and try again.");
      } else {
        setError("Couldn't send a new code just now. Wait a moment and try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const backToMethod = () => {
    setStep("method");
    setIdentifier("");
    setError(null);
  };

  /**
   * One-tap widget sign-in: Telegram collects the confirmation in its own
   * popup and hands us the signed payload; the ConvexCredentials provider
   * verifies the HMAC server-side. On success we land on the same hand-off
   * screen as the OTP flows - isAuthenticated performs the redirect once the
   * session is real (navigating earlier makes RequireAuth bounce to /auth).
   */
  /**
   * Complete a Telegram sign-in. Accepts BOTH payload kinds so every
   * Telegram path lands here:
   *  - OIDC id_token (from the in-app library flow), verified against
   *    Telegram's JWKS by the telegram-oidc provider, or
   *  - the classic signed widget payload (id, auth_date, hash, ...) from a
   *    redirect return, verified as an HMAC by the telegram-widget provider.
   * On success we land on the same hand-off screen as the OTP flows -
   * isAuthenticated performs the redirect once the session is real
   * (navigating earlier makes RequireAuth bounce back to /auth).
   */
  const handleTelegramAuth = useCallback(
    async (
      payload: TelegramOidcPayload | TelegramWidgetPayload | null,
    ): Promise<void> => {
      if (payload === null) {
        // The user closed the Telegram window - not an error, just a no-op.
        return;
      }
      setWidgetBusy(true);
      setError(null);
      try {
        if ("id_token" in payload) {
          await signIn("telegram-oidc", { id_token: payload.id_token });
        } else {
          await signIn("telegram-widget", payload);
        }
        setHandoff(true);
        setTimeout(() => setHandoff(false), 8000);
      } catch (err) {
        const msg = (err instanceof Error ? err.message : "").toLowerCase();
        if (/rate|too many|flood|throttl/.test(msg)) {
          setError("Too many attempts - wait a minute, then try again.");
        } else if (/already used|expired/.test(msg)) {
          setError(
            "That Telegram confirmation is single-use and has already been consumed. Tap the button once more and confirm again.",
          );
        } else {
          setError(
            friendlyError(err) ||
              "Telegram sign-in failed just now. Please try again in a moment.",
          );
        }
      } finally {
        setWidgetBusy(false);
      }
    },
    [signIn],
  );

  const telegramEnabled = authMethods?.telegramOtp === true;
  const smsEnabled = authMethods?.smsOtp === true;
  const anyMethodEnabled =
    !authMethods || authMethods.emailOtp || telegramEnabled || smsEnabled;

  // Between "code accepted" and "session is live" there's a short window
  // (ConvexAuth still needs a round-trip). Show a quiet hand-off screen so
  // the user never sees the sign-in form flash back, and if the session
  // never lands (dead network) recover instead of hanging forever.
  if (handoff) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.62_0.11_195/0.10),transparent_70%)]"
        />
        <Loader2 className="size-6 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Signing you in…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      {/* Subtle brand backdrop */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.62_0.11_195/0.10),transparent_70%)]"
      />

      <div className="flex items-center justify-between px-4 py-5 sm:px-6">
        <LubaWordmark />
        <Button variant="ghost" className="text-muted-foreground" asChild>
          <a href="/">← Back to auctions</a>
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <Card className="border-border/80 pb-0 shadow-layered-lg">
            {linkToken && (linkState === "success" || typeof linkState === "object") ? (
              <>
                <CardHeader className="mt-4 text-center">
                  <div className="mb-2 flex justify-center">
                    <span
                      className={cn(
                        "flex size-12 items-center justify-center rounded-xl",
                        linkState === "success"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "bg-rose-500/10 text-rose-700 dark:text-rose-400",
                      )}
                    >
                      {linkState === "success" ? (
                        <CheckCircle2 className="size-6" />
                      ) : (
                        <XCircle className="size-6" />
                      )}
                    </span>
                  </div>
                  <CardTitle className="text-xl">
                    {linkState === "success"
                      ? "Sign-in method linked"
                      : "Linking failed"}
                  </CardTitle>
                  <CardDescription>
                    {linkState === "success"
                      ? "Your account is now connected. You can sign in with this method from now on."
                      : typeof linkState === "object"
                        ? linkState.error
                        : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 pb-6">
                  <Button className="w-full" asChild>
                    <a href="/dashboard">Go to dashboard</a>
                  </Button>
                  <Button variant="ghost" className="w-full" asChild>
                    <a href="/">Back to auctions</a>
                  </Button>
                </CardContent>
              </>
            ) : linkToken && linkState === "working" ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Confirming your link…
                </p>
              </div>
            ) : (
              <>
            {step === "method" && (
              <>
                <CardHeader className="text-center">
                  <div className="mb-2 flex justify-center">
                    <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Gavel className="size-6" />
                    </span>
                  </div>
                  <CardTitle className="text-xl">{t("auth.title")}</CardTitle>
                  <CardDescription>{t("auth.subtitle")}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {widgetEnabled && (
                    <div className="flex flex-col gap-3">
                      <TelegramLoginModule
                        clientId={telegramClientId ?? 0}
                        onAuth={(payload) => void handleTelegramAuth(payload)}
                        onError={(message) => setError(message)}
                        disabled={widgetBusy || isLoading}
                      />
                      {widgetBusy && (
                        <p className="text-center text-xs text-muted-foreground">
                          Verifying your Telegram confirmation…
                        </p>
                      )}
                      {/* Method-step errors were previously invisible - the
                          widget's failure copy only existed below the form
                          steps. Surface them where the user actually is. */}
                      {error && (
                        <p role="alert" className="text-center text-sm text-destructive">
                          {error}
                        </p>
                      )}
                      {isEmbedded && (
                        <a
                          href={
                            typeof window !== "undefined"
                              ? window.location.href
                              : "/auth"
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                        >
                          <ExternalLink className="size-3" />
                          Preview tip: open this page in its own browser tab if
                          the Telegram popup confirms but nothing happens
                        </a>
                      )}
                      <div className="flex items-center gap-3" aria-hidden>
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-xs uppercase tracking-wider text-muted-foreground">
                          or use another method
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    className="h-auto justify-start gap-3 py-3"
                    onClick={() => selectMethod("email-otp")}
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Mail className="size-4" />
                    </span>
                    <span className="flex flex-col items-start">
                      <span>{t("auth.continueEmail")}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        A 6-digit code sent to your inbox
                      </span>
                    </span>
                    <ArrowRight className="ml-auto size-4 text-muted-foreground" />
                  </Button>

                  <Button
                    variant="outline"
                    className="h-auto justify-start gap-3 py-3"
                    onClick={() => selectMethod("telegram-otp")}
                    disabled={!telegramEnabled}
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Send className="size-4" />
                    </span>
                    <span className="flex flex-col items-start">
                      <span>{t("auth.continueTelegram")}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {telegramEnabled
                          ? "A 6-digit code sent as a Telegram message"
                          : "Unavailable - not configured"}
                      </span>
                    </span>
                    <ArrowRight className="ml-auto size-4 text-muted-foreground" />
                  </Button>

                  {telegramEnabled && (
                    <a
                      href={TELEGRAM_BOT_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <Send className="size-3.5" />
                      {t("auth.openBot")} ↗
                    </a>
                  )}

                  <Button
                    variant="outline"
                    className="h-auto justify-start gap-3 py-3"
                    onClick={() => selectMethod("sms-otp")}
                    disabled={!smsEnabled}
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Smartphone className="size-4" />
                    </span>
                    <span className="flex flex-col items-start">
                      <span>{t("auth.continueSms")}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {smsEnabled
                          ? "A 6-digit code sent by text message"
                          : "Unavailable - not configured"}
                      </span>
                    </span>
                    <ArrowRight className="ml-auto size-4 text-muted-foreground" />
                  </Button>

                  {!anyMethodEnabled && (
                    <p role="alert" className="mt-2 text-center text-sm text-destructive">
                      No sign-in methods are currently available.
                    </p>
                  )}

                  <ul className="mt-4 space-y-2 text-xs leading-5 text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      One-time codes only - there's no password to manage or
                      leak.
                    </li>
                    <li className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      Every accepted bid is confirmed instantly and recorded on
                      an auditable ledger.
                    </li>
                    <li className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      Bidding requires a verified account and acceptance of the
                      terms. 18+.
                    </li>
                  </ul>
                </CardContent>
              </>
            )}

            {step === "identifier" && (
              <>
                <CardHeader className="text-center">
                  <CardTitle>
                    Sign in with {PROVIDER_LABEL[provider]}
                  </CardTitle>
                  <CardDescription>
                    {provider === "email-otp" &&
                      "Enter your email and we'll send a one-time code."}
                    {provider === "telegram-otp" &&
                      "Enter your numeric Telegram ID and we'll send a code to your Telegram."}
                    {provider === "sms-otp" &&
                      "Enter your phone number and we'll send a code by text."}
                  </CardDescription>
                </CardHeader>
                <form onSubmit={handleIdentifierSubmit}>
                  <CardContent>
                    <div className="space-y-1.5">
                      {/* Visible label - placeholders are never a substitute
                          (master skill: placeholders are not labels). The
                          helper text below carries the example so the
                          placeholder stays minimal. */}
                      <Label htmlFor="auth-identifier" className="text-sm">
                        {provider === "email-otp"
                          ? "Email address"
                          : provider === "telegram-otp"
                            ? "Your Telegram ID"
                            : "Phone number"}
                      </Label>
                      <div className="relative">
                        {provider === "email-otp" ? (
                          <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Smartphone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        )}
                        <Input
                          id="auth-identifier"
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          placeholder={
                            provider === "email-otp"
                              ? "name@example.com"
                              : provider === "telegram-otp"
                                ? "e.g. 123456789"
                                : "e.g. 0911223344"
                          }
                          type={
                            provider === "email-otp" ? "email" : "tel"
                          }
                          className="pl-9"
                          disabled={isLoading}
                          required
                        />
                      </div>
                    </div>
                    {/* destructive token, not raw red-500: raw Tailwind red
                        fails WCAG AA contrast on the card surface. */}
                    {error && (
                      <p
                        role="alert"
                        className="mt-2 text-sm text-destructive"
                      >
                        {error}
                      </p>
                    )}

                    {provider === "telegram-otp" && (
                      <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3">
                        <p className="text-xs leading-5 text-muted-foreground">
                          <span className="font-medium text-foreground">
                            How to get your Telegram ID:
                          </span>{" "}
                          Open our bot and press <em>Start</em> - it replies with
                          your numeric ID. (Telegram doesn't allow lookup by
                          username or phone, so the ID is the one thing it
                          needs.)
                        </p>
                        <a
                          href={TELEGRAM_BOT_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[#229ED9] px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                        >
                          <Send className="size-3.5" />
                          {t("auth.openBotShort")}
                        </a>
                      </div>
                    )}

                    <div className="mt-5 flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={backToMethod}
                        disabled={isLoading}
                      >
                        <ArrowLeft className="size-4" />
                        Back
                      </Button>
                      <Button
                        type="submit"
                        className="flex-1"
                        disabled={isLoading || identifier.trim().length === 0}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Sending code…
                          </>
                        ) : (
                          <>
                            Send code
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </form>
              </>
            )}

            {step === "verify" && (
              <>
                <CardHeader className="mt-4 text-center">
                  <CardTitle>
                    Check your {PROVIDER_LABEL[provider]}
                  </CardTitle>
                  <CardDescription>
                    We sent a 6-digit code to{" "}
                    <span className="font-medium text-foreground">
                      {identifier}
                    </span>
                  </CardDescription>
                </CardHeader>
                <form onSubmit={handleOtpSubmit}>
                  <CardContent className="pb-4">
                    <div className="flex justify-center">
                      {/* Screen readers need a fieldset-style label for the
                          OTP group; visually the card title carries it. */}
                      <VisuallyHidden>
                        <Label htmlFor="otp">6-digit verification code</Label>
                      </VisuallyHidden>
                      <InputOTP
                        value={otp}
                        onChange={setOtp}
                        maxLength={6}
                        disabled={isLoading}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            otp.length === 6 &&
                            !isLoading
                          ) {
                            const form = (e.target as HTMLElement).closest(
                              "form",
                            );
                            if (form) {
                              form.requestSubmit();
                            }
                          }
                        }}
                      >
                        <InputOTPGroup>
                          {Array.from({ length: 6 }).map((_, index) => (
                            <InputOTPSlot key={index} index={index} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    {error && (
                      <p
                        role="alert"
                        className="mt-2 text-sm text-destructive text-center"
                      >
                        {error}
                      </p>
                    )}
                    <p className="mt-4 text-center text-sm text-muted-foreground">
                      Didn't receive a code?{" "}
                      <Button
                        variant="link"
                        className="h-auto p-0"
                        onClick={handleResend}
                        type="button"
                      >
                        {t("auth.resend")}
                      </Button>{" "}
                      or{" "}
                      <Button
                        variant="link"
                        className="h-auto p-0"
                        onClick={backToMethod}
                        type="button"
                      >
                        use another method
                      </Button>
                    </p>
                  </CardContent>
                  <CardFooter className="flex-col gap-2">
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isLoading || otp.length !== 6}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Verifying…
                        </>
                      ) : (
                        <>
                          Verify code
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </CardFooter>
                </form>
              </>
            )}

            <div className="rounded-b-lg border-t bg-muted px-6 py-4 text-center text-xs text-muted-foreground">
              Secured by one-time codes. By continuing you accept Luba's Terms
              &amp; Conditions and confirm you are 18 or older.
            </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
