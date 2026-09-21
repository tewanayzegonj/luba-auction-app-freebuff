import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
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

/**
 * The classic widget's signed payload (id, first_name, auth_date, hash, …).
 * All values are forwarded verbatim and verified server-side via HMAC; the
 * client never trusts or transforms them beyond string coercion.
 */
export interface TelegramWidgetPayload {
  [field: string]: string;
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
const SCOPES = "openid profile phone";

/** base64url helpers for the PKCE challenge pair. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

/** S256 PKCE challenge from a verifier string. */
async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}



function isUsableIdToken(value: unknown): value is string {
  return typeof value === "string" && value.split(".").length === 3;
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
  const startFlow = useMutation(api.auth.telegramFlow.startTelegramFlow);
  const [opening, setOpening] = useState(false);
  // Guards against the user double-tapping before the navigation starts.
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
          auth(
            {
              client_id: clientId,
              scope: ["openid", "profile", "phone", "telegram:bot_access"],
              lang: "en",
            },
            forward,
          );
        })
        .catch(() => {
          resetBusy();
          onErrorRef.current(
            "Couldn't reach Telegram just now. Check your connection and try again.",
          );
        });
      return;
    }

    // Regular browser (and the preview iframe): standard OIDC code flow.
    // Generate verifier+state, register them server-side, then navigate.
    // When running INSIDE an iframe (preview pane), navigate the TOP window:
    // Telegram's login page refuses to render in frames
    // (X-Frame-Options: SAMEORIGIN → "refused to connect"), and the top
    // frame is the app's real browser context. Otherwise navigate in place.
    const random = new Uint8Array(32);
    crypto.getRandomValues(random);
    const verifier = base64UrlEncode(random);
    const stateRandom = new Uint8Array(16);
    crypto.getRandomValues(stateRandom);
    const state = base64UrlEncode(stateRandom);

    startFlow({ state, verifier })
      .then(() => challengeFromVerifier(verifier))
      .then((challenge) => {
        const redirectUri = window.location.origin + window.location.pathname;
        const params = new URLSearchParams({
          response_type: "code",
          client_id: String(clientId),
          redirect_uri: redirectUri,
          scope: SCOPES,
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
          lang: "en",
        });
        const authUrl = `${TELEGRAM_OAUTH_ORIGIN}/auth?${params.toString()}`;
        const top = window.top;
        const inIframe =
          typeof top !== "undefined" && top !== null && top !== window.self;
        if (inIframe) {
          // Escape the embedding frame: Telegram refuses to render inside
          // iframes, so the login must happen in the top-level context.
          top!.location.href = authUrl;
        } else {
          window.location.href = authUrl;
        }
      })
      .catch(() => {
        resetBusy();
        onErrorRef.current(
          "Couldn't start Telegram sign-in just now. Please try again.",
        );
      });
  }, [clientId, disabled, startFlow]);

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
