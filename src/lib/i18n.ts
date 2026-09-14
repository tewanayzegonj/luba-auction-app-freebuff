import { useCallback, useEffect, useState } from "react";

/**
 * i18n foundation (roadmap: Amharic localization).
 *
 * Deliberately tiny — a typed dictionary and a language hook persisted to
 * localStorage. Core flows (landing, bidding, wallet, auth) are covered;
 * untranslated keys fall back to English so nothing ever renders blank.
 */

export type Lang = "en" | "am";

export const LANGS: { value: Lang; label: string; native: string }[] = [
  { value: "en", label: "English", native: "English" },
  { value: "am", label: "Amharic", native: "አማርኛ" },
];

const STRINGS = {
  en: {
    "nav.dashboard": "Dashboard",
    "nav.auctions": "Live auctions",
    "nav.howItWorks": "How it works",
    "nav.faq": "FAQ",
    "nav.signIn": "Sign in",
    "nav.signOut": "Sign out",
    "hero.title": "Lowest unique bid wins.",
    "hero.subtitle":
      "Bid the lowest amount nobody else thought of. Deterministic settlement, published bid history, every fee on the ledger.",
    "hero.cta": "Start bidding",
    "hero.ctaSecondary": "How it works",
    "auction.bidNow": "Bid now",
    "auction.bidFee": "Bid fee",
    "auction.bids": "bids",
    "auction.unique": "unique",
    "auction.endsIn": "Ends in",
    "auction.min": "Min bid",
    "auction.max": "Max bid",
    "auction.placeBid": "Place bid",
    "auction.confirmBid": "Confirm bid",
    "auction.serviceFee": "Service fee",
    "wallet.balance": "Wallet balance",
    "wallet.topUp": "Top up",
    "wallet.promo": "Promo balance",
    "dashboard.welcome": "Welcome back",
    "dashboard.myBids": "My bids",
    "dashboard.watchlist": "Watchlist",
    "dashboard.wins": "Wins",
    "auth.chooseMethod": "How would you like to sign in?",
    "auth.continueTelegram": "Continue with Telegram",
    "auth.continueEmail": "Continue with Email",
    "auth.continueSms": "Continue with SMS",
    "auth.verifyCode": "Enter the 6-digit code",
    "auth.verify": "Verify",
    "footer.rights": "All rights reserved.",
    "common.loading": "Loading…",
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.close": "Close",
  },
  am: {
    "nav.dashboard": "ዳሽቦርድ",
    "nav.auctions": "በሂደት ላይ ያሉ ልዩ ሽያጮች",
    "nav.howItWorks": "እንዴት እንደሚሰራ",
    "nav.faq": "የተለመዱ ጥያቄዎች",
    "nav.signIn": "ግባ",
    "nav.signOut": "ውጣ",
    "hero.title": "ትንሹ የተለየ ውርርድ ያሸንፋል።",
    "hero.subtitle":
      "ሌላ ሰው ያሰበውን ትንሸኛ መጠን ውርርድ። ታማኝ ውጤት፣ የታተመ የውርርድ ታሪክ፣ እያንዳንዱ ክፍያ በተመዘገበ ቅፅ።",
    "hero.cta": "ውርርድ ጀምር",
    "hero.ctaSecondary": "እንዴት እንደሚሰራ",
    "auction.bidNow": "አሁን ውረስ",
    "auction.bidFee": "የውርርድ ክፍያ",
    "auction.bids": "ውርርዶች",
    "auction.unique": "ልዩ",
    "auction.endsIn": "ይጨረሳል በ",
    "auction.min": "ትንሸኛ",
    "auction.max": "ትልቁ",
    "auction.placeBid": "ውርርድ አስገባ",
    "auction.confirmBid": "ውርርድ አረጋግጥ",
    "auction.serviceFee": "የአገልግሎት ክፍያ",
    "wallet.balance": "የኪስ ቀሪ ሂሳብ",
    "wallet.topUp": "አስገባ",
    "wallet.promo": "የማበረታቻ ሂሳብ",
    "dashboard.welcome": "እንኳን ደህና መጡ",
    "dashboard.myBids": "የእኔ ውርርዶች",
    "dashboard.watchlist": "የታያቸው",
    "dashboard.wins": "ድሎች",
    "auth.chooseMethod": "በምን መንገድ መግብዎት ይፈልጋሉ?",
    "auth.continueTelegram": "በቴሌግራም ግባ",
    "auth.continueEmail": "በኢሜይል ግባ",
    "auth.continueSms": "በኤስኤምኤስ ግባ",
    "auth.verifyCode": "6-አሃዙን ኮድ ያስገቡ",
    "auth.verify": "አረጋግጥ",
    "footer.rights": "መብቱ በህግ የተጠበቀ ነው።",
    "common.loading": "በመጫን ላይ…",
    "common.cancel": "ሰርዝ",
    "common.confirm": "አረጋግጥ",
    "common.close": "ዝጋ",
  },
} as const;

export type TKey = keyof typeof STRINGS.en;

const STORAGE_KEY = "luba.lang";

export function useLang(): {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey) => string;
} {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === "am" ? "am" : "en";
    } catch {
      return "en";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // private mode — language just won't persist
    }
    document.documentElement.lang = lang === "am" ? "am" : "en";
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);

  const t = useCallback(
    (key: TKey) => STRINGS[lang][key] ?? STRINGS.en[key],
    [lang],
  );

  return { lang, setLang, t };
}
