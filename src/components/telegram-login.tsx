import { useCallback, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useLang } from "@/lib/i18n";

import { cn } from "@/lib/utils";

/**
 * Telegram Login — Telegram's CURRENT official login flow (the one with the
 * "Log in to <site>" page, phone-number option, and QR code — see
 * https://core.telegram.org/bots/telegram-login).
 *
 * How it works:
 * - We load Telegram's official library (telegram-login.js) and call
 *   Telegram.Login.auth({ client_id, scope }, cb).
 * - client_id is the bot's NUMERIC ID (same number as the classic widget's
 *   bot_id) — the popup throws "client_id is required" otherwise.
 * - scope "openid profile" returns name/username/photo; "phone" additionally
 *   asks the user's consent for the phone number; "telegram:bot_access"
 *   lets our bot message the user (enables outbid/winner alerts).
 * - Telegram hosts the whole experience on oauth.telegram.org (or natively
 *   inside the Telegram app browser). On success we receive an OIDC
 *   **id_token** (JWT) plus its decoded `user` claims.
 * - The JWT is verified SERVER-SIDE (convex/auth/telegramOidc.ts) against
 *   Telegram's published JWKS. The client forwards it verbatim.
 *
 * Values are normalized to strings because the Convex credentials contract
 * carries string fields only.
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
        init?: (
          options: {
            client_id: number | string;
            scope?: string[];
            lang?: string;
            nonce?: string;
          },
          callback?: (result: TelegramLoginResult) => void,
        ) => void;
        open?: (callback?: (result: TelegramLoginResult) => void) => void;
        auth?: (
          options: {
            client_id: number | string;
            scope?: string[];
            lang?: string;
            nonce?: string;
          },
          callback: (result: TelegramLoginResult) => void,
        ) => void;
        close?: () => void;
      };
    };
  }
}

const LOGIN_SCRIPT_SRC = "https://oauth.telegram.org/js/telegram-login.js";

let loginScriptPromise: Promise<void> | null = null;

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

/** The callback result can be a result object or an error object; normalize. */
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
  const [opening, setOpening] = useState(false);
  // Guards against the user double-tapping before the popup opens.
  const busyRef = useRef(false);

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
    void loadTelegramLoginScript()
      .then(() => {
        const auth = window.Telegram?.Login?.auth;
        if (!auth) throw new Error("script-load-failed");
        auth(
          {
            client_id: clientId,
            // Matches Telegram's own login page: name/username/photo, the
            // phone number (with explicit consent), and permission for our
            // bot to message the user (notification bridge).
            scope: ["openid", "profile", "phone", "telegram:bot_access"],
            lang: "en",
          },
          (result) => {
            resetBusy();
            if (!result || typeof result !== "object") {
              onAuth(null);
              return;
            }
            if (result.error) {
              if (result.error !== "popup_closed") {
                onError(
                  `Telegram sign-in failed: ${String(result.error)}. Please try again.`,
                );
              }
              onAuth(null);
              return;
            }
            if (!isUsableIdToken(result.id_token)) {
              onError(
                "Telegram's confirmation arrived in an unreadable form. Please try again.",
              );
              return;
            }
            onAuth({ id_token: result.id_token });
          },
        );
      })
      .catch(() => {
        resetBusy();
        onError(
          "Couldn't reach Telegram just now. Check your connection and try again.",
        );
      });
  }, [clientId, disabled, onAuth, onError]);

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
