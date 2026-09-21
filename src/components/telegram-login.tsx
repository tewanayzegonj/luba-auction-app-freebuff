import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useLang } from "@/lib/i18n";

import { cn } from "@/lib/utils";

/**
 * Telegram Login — Telegram's CURRENT official login flow (the one with the
 * "Log in to <site>" page, phone-number option, and QR code — see
 * https://core.telegram.org/bots/telegram-login).
 *
 * Two environments, two paths (mirrors the official library's own split):
 *
 * 1. Telegram's in-app browser (window.TelegramWebviewProxy exists):
 *    we load the official library and let it drive the native flow. Its
 *    in-app branch DOES send `origin` and Telegram hands back the token.
 *
 * 2. Any normal browser (popup): we open `oauth.telegram.org/auth` OURSELVES
 *    with the `origin` parameter — as of 2026 the server rejects the login
 *    page without it ("origin required"), while the official library's
 *    popup branch only sends `redirect_uri` and triggers exactly that error.
 *    The completion contract is identical to the library's: the popup posts
 *    `{ event: 'auth_result', result: <id_token JWT> }` to its opener from
 *    origin https://oauth.telegram.org, which we listen for and forward.
 *
 * The JWT is verified SERVER-SIDE (convex/auth/telegramOidc.ts) against
 * Telegram's published JWKS. The client forwards it verbatim.
 */

export interface TelegramOidcPayload {
  /** The raw OIDC id_token (JWT) — verified server-side, never trusted here. */
  id_token: string;
}

/** Decoded claims we may receive for display (informational only). */
export interface TelegramOidcClaims {
  sub?: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  phone_number?: string;
  [key: string]: unknown;
}

interface TelegramLoginResult {
  id_token?: string;
  user?: TelegramOidcClaims;
  error?: string;
}

interface TelegramLoginRawResult {
  id_token?: unknown;
  user?: Record<string, unknown>;
  error?: unknown;
}

declare global {
  interface Window {
    Telegram?: {
      Login?: {
        auth?: (
          options: {
            client_id: number | string;
            scope?: string[];
            lang?: string;
            nonce?: string;
          },
          callback: (result: TelegramLoginResult) => void,
        ) => void;
      };
    };
    TelegramWebviewProxy?: { postEvent: (type: string, data: string) => void };
  }
}

const LOGIN_SCRIPT_SRC = "https://oauth.telegram.org/js/telegram-login.js";
const TELEGRAM_OAUTH_ORIGIN = "https://oauth.telegram.org";
const SCOPES = ["openid", "profile", "phone", "telegram:bot_access"];

let loginScriptPromise: Promise<void> | null = null;

function isInTelegramInAppBrowser(): boolean {
  return typeof window !== "undefined" && !!window.TelegramWebviewProxy;
}

function loadTelegramLoginScript(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("script-load-failed"));
  }
  if (window.Telegram?.Login?.auth) return Promise.resolve();
  if (loginScriptPromise === null) {
    loginScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = LOGIN_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        // Allow a later retry - the failed promise must not be cached.
        loginScriptPromise = null;
        reject(new Error("script-load-failed"));
      };
      document.head.appendChild(script);
    });
  }
  return loginScriptPromise;
}

/** Build the hosted login URL with the origin param Telegram requires. */
function buildAuthUrl(clientId: number, lang: string): string {
  const params = new URLSearchParams({
    response_type: "post_message",
    client_id: String(clientId),
    // The server rejects the login page without this ("origin required").
    // It must match a domain whitelisted via @BotFather /setdomain.
    origin: window.location.origin,
    scope: SCOPES.join(" "),
    lang,
  });
  return `${TELEGRAM_OAUTH_ORIGIN}/auth?${params.toString()}`;
}

interface AuthResultMessage {
  event?: unknown;
  result?: unknown;
  error?: unknown;
}

function isUsableIdToken(value: unknown): value is string {
  return typeof value === "string" && value.split(".").length === 3;
}

/**
 * Popup path: open the hosted login ourselves and resolve with the id_token
 * posted back by the popup (same contract as the official library), or null
 * if the user closed it without confirming.
 */
function openTelegramAuthPopup(
  clientId: number,
  lang: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(closeCheck);
      clearTimeout(timeout);
      resolve(token);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== TELEGRAM_OAUTH_ORIGIN) return;
      let data: AuthResultMessage;
      try {
        data =
          typeof event.data === "string"
            ? (JSON.parse(event.data) as AuthResultMessage)
            : (event.data as AuthResultMessage);
      } catch {
        return;
      }
      if (!data || data.event !== "auth_result") return;
      finish(isUsableIdToken(data.result) ? data.result : null);
    };
    window.addEventListener("message", onMessage);

    const popup = window.open(
      buildAuthUrl(clientId, lang),
      "telegram_oidc_login",
      "width=550,height=650",
    );
    if (!popup) {
      // Popup blocked: nothing we can do except report it.
      finish(null);
      return;
    }
    popup.focus();

    // The popup may also navigate to a redirect-style completion; when it
    // closes without posting a result, treat it as cancelled.
    const closeCheck = setInterval(() => {
      if (popup.closed) finish(null);
    }, 300);
    // Safety net: never leave listeners behind forever.
    const timeout = setTimeout(() => finish(null), 5 * 60 * 1000);
  });
}

interface TelegramLoginModuleProps {
  /** The bot's numeric ID (OIDC client_id) - exposed by authConfig.getAuthMethods. */
  clientId: number;
  /** id_token payload on success; null when the popup was closed without signing in. */
  onAuth: (payload: TelegramOidcPayload | null) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export function TelegramLoginModule({
  clientId,
  onAuth,
  onError,
  disabled = false,
}: TelegramLoginModuleProps) {
  const { t } = useLang();
  const [opening, setOpening] = useState(false);
  // Guards against the user double-tapping before the popup opens.
  const busyRef = useRef(false);
  // Keep the latest callbacks without re-creating the message listener.
  const onAuthRef = useRef(onAuth);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onAuthRef.current = onAuth;
    onErrorRef.current = onError;
  }, [onAuth, onError]);

  const handleOneTap = useCallback(() => {
    if (disabled || busyRef.current) return;
    if (!Number.isFinite(clientId) || clientId <= 0) {
      onError("Telegram sign-in is not configured right now.");
      return;
    }
    busyRef.current = true;
    setOpening(true);
    const resetBusy = () => {
      busyRef.current = false;
      setOpening(false);
    };

    const forward = (result: TelegramLoginRawResult | null) => {
      resetBusy();
      if (!result || typeof result !== "object") {
        onAuthRef.current(null);
        return;
      }
      if (result.error) {
        if (result.error !== "popup_closed") {
          onErrorRef.current(
            `Telegram sign-in failed: ${String(result.error)}. Please try again.`,
          );
        }
        onAuthRef.current(null);
        return;
      }
      if (!isUsableIdToken(result.id_token)) {
        onErrorRef.current(
          "Telegram's confirmation arrived in an unreadable form. Please try again.",
        );
        return;
      }
      onAuthRef.current({ id_token: result.id_token });
    };

    if (isInTelegramInAppBrowser()) {
      // Telegram's own browser: the official library drives the native flow
      // (its in-app branch sends the required origin automatically).
      void loadTelegramLoginScript()
        .then(() => {
          const auth = window.Telegram?.Login?.auth;
          if (!auth) throw new Error("script-load-failed");
          auth({ client_id: clientId, scope: SCOPES, lang: "en" }, forward);
        })
        .catch(() => {
          resetBusy();
          onErrorRef.current(
            "Couldn't reach Telegram just now. Check your connection and try again.",
          );
        });
      return;
    }

    // Regular browser: open the hosted login ourselves with the required
    // origin parameter (the official library's popup branch omits it and
    // Telegram answers "origin required").
    void openTelegramAuthPopup(clientId, "en").then((idToken) => {
      forward(idToken ? { id_token: idToken } : null);
    });
  }, [clientId, disabled]);

  return (
    <button
      type="button"
      onClick={handleOneTap}
      disabled={disabled || opening}
      aria-label="Continue with Telegram"
      className={cn(
        "flex h-auto w-full items-center justify-center gap-3 rounded-lg bg-[#229ED9] px-4 py-3 text-sm font-semibold text-white",
        "transition-colors hover:bg-[#1d8ec2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229ED9]",
        "disabled:pointer-events-none disabled:opacity-70",
      )}
    >
      {opening ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Send className="size-4" aria-hidden />
      )}
      <span className="flex flex-col items-start leading-tight">
        <span>{t("auth.continueTelegramOneTap")}</span>
        <span className="text-xs font-normal text-white/85">
          {t("auth.continueTelegramOneTapHint")}
        </span>
      </span>
    </button>
  );
}
