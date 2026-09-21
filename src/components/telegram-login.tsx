import { useCallback, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useLang } from "@/lib/i18n";

import { cn } from "@/lib/utils";

/**
 * Telegram Login Widget - the one-tap popup sign-in.
 *
 * Loads Telegram's official widget script (once per page load) and uses its
 * documented programmatic entry point, Telegram.Login.Widget.open(), with a
 * branded button of our own. Telegram renders the confirmation popup itself;
 * the script receives the signed payload and hands it to our callback. The
 * payload's hash is verified SERVER-SIDE (convex/auth/telegramWidget.ts) -
 * this module trusts nothing and forwards exactly what Telegram sent.
 *
 * Values are normalized to strings because the Convex credentials contract
 * (and our provider's authorize params) carry string fields only.
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
        Widget?: {
          open?: (
            botName: string,
            options: { request_access?: boolean; size?: string },
            callback: (user: TelegramLoginRawUser | false) => void,
          ) => void;
        };
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
  if (window.Telegram?.Login?.Widget?.open) return Promise.resolve();
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

function normalizePayload(
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
  botUsername: string;
  /** Signed payload on success; null when the popup was closed without signing in. */
  onAuth: (payload: TelegramWidgetPayload | null) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export function TelegramLoginModule({
  botUsername,
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
    busyRef.current = true;
    setOpening(true);
    void loadTelegramWidgetScript()
      .then(() => {
        const open = window.Telegram?.Login?.Widget?.open;
        if (!open) throw new Error("script-load-failed");
        open(
          botUsername,
          { request_access: true },
          (user) => {
            busyRef.current = false;
            setOpening(false);
            if (user === false) {
              onAuth(null);
              return;
            }
            onAuth(normalizePayload(user));
          },
        );
        // The popup is Telegram's own window from here - restore the button
        // so a cancelled popup leaves the UI in a clean state.
        window.setTimeout(() => {
          busyRef.current = false;
          setOpening(false);
        }, 1500);
      })
      .catch(() => {
        busyRef.current = false;
        setOpening(false);
        onError(
          "Couldn't reach Telegram just now. Check your connection and try again.",
        );
      });
  }, [botUsername, disabled, onAuth, onError]);

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
