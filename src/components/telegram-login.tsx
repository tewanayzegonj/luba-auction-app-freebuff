import { useCallback, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useLang } from "@/lib/i18n";

import { cn } from "@/lib/utils";

/**
 * Telegram Login - the one-tap popup sign-in.
 *
 * Loads Telegram's official widget script (once per page load) and calls its
 * programmatic API, Telegram.Login.auth({ bot_id, request_access }, cb),
 * behind a branded button of our own. The script opens oauth.telegram.org in
 * a popup, collects the user's confirmation, and hands us the signed payload.
 * The payload's hash is verified SERVER-SIDE (convex/auth/telegramWidget.ts) -
 * this module trusts nothing and forwards exactly what Telegram sent.
 *
 * The API takes the bot's NUMERIC ID (the public part of the bot token before
 * the colon), not its username - "Bot id required" is thrown otherwise.
 * Values are normalized to strings because the Convex credentials contract
 * carries string fields only.
 *
 * Two completion paths exist by design:
 *  1. popup callback (normal): Telegram calls `cb(user)` in the opener;
 *  2. URL-hash return (fallback): Telegram may instead append the same signed
 *     fields as `#key=value` pairs on this page - the OAuth return path. This
 *     matters inside iframes, where the popup→opener message can be dropped
 *     by the embedding shell. Auth.tsx parses that hash and feeds it through
 *     the same normalization here.
 */

export interface TelegramWidgetPayload {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
}

interface TelegramLoginRawUser {
  id?: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date?: number | string;
  hash?: string;
}

declare global {
  interface Window {
    Telegram?: {
      Login?: {
        auth?: (
          options: { bot_id: number; request_access?: boolean },
          callback: (user: TelegramLoginRawUser | false) => void,
        ) => void;
      };
    };
  }
}

const WIDGET_SCRIPT_SRC = "https://telegram.org/js/telegram-widget.js?22";

let widgetScriptPromise: Promise<void> | null = null;

function loadTelegramWidgetScript(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("script-load-failed"));
  }
  if (window.Telegram?.Login?.auth) return Promise.resolve();
  if (widgetScriptPromise === null) {
    widgetScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = WIDGET_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        // Allow a later retry - the failed promise must not be cached.
        widgetScriptPromise = null;
        reject(new Error("script-load-failed"));
      };
      document.head.appendChild(script);
    });
  }
  return widgetScriptPromise;
}

/**
 * Coerce a Telegram widget payload (popup callback object or URL-hash params)
 * into the string-only shape the Convex credentials provider expects, or null
 * if it is not a usable payload.
 */
export function normalizeTelegramWidgetPayload(
  user: TelegramLoginRawUser,
): TelegramWidgetPayload | null {
  if (
    typeof user.id === "number" ||
    (typeof user.id === "string" && /^\d+$/.test(user.id))
  ) {
    return {
      id: String(user.id),
      first_name: typeof user.first_name === "string" ? user.first_name : "",
      ...(typeof user.last_name === "string" ? { last_name: user.last_name } : {}),
      ...(typeof user.username === "string" ? { username: user.username } : {}),
      ...(typeof user.photo_url === "string" ? { photo_url: user.photo_url } : {}),
      auth_date: String(user.auth_date ?? ""),
      hash: typeof user.hash === "string" ? user.hash : "",
    };
  }
  return null;
}

interface TelegramLoginModuleProps {
  /** The bot's numeric ID - exposed publicly by authConfig.getAuthMethods. */
  botId: number;
  /** Signed payload on success; null when the popup was closed without signing in. */
  onAuth: (payload: TelegramWidgetPayload | null) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export function TelegramLoginModule({
  botId,
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
    if (!Number.isFinite(botId) || botId <= 0) {
      onError("Telegram sign-in is not configured right now.");
      return;
    }
    busyRef.current = true;
    setOpening(true);
    void loadTelegramWidgetScript()
      .then(() => {
        const auth = window.Telegram?.Login?.auth;
        if (!auth) throw new Error("script-load-failed");
        // Restores the button so a cancelled popup leaves the UI clean; the
        // callback still fires later if the user goes on to confirm.
        const resetBusy = () => {
          busyRef.current = false;
          setOpening(false);
        };
        auth({ bot_id: botId, request_access: true }, (user) => {
          resetBusy();
          if (user === false) {
            onAuth(null);
            return;
          }
          onAuth(normalizeTelegramWidgetPayload(user));
        });
        window.setTimeout(resetBusy, 1500);
      })
      .catch(() => {
        busyRef.current = false;
        setOpening(false);
        onError(
          "Couldn't reach Telegram just now. Check your connection and try again.",
        );
      });
  }, [botId, disabled, onAuth, onError]);

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
