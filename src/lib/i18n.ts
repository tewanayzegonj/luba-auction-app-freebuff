import { useCallback, useEffect, useState } from "react";

/**
 * i18n (roadmap: Amharic localization).
 *
 * A typed dictionary and a language hook persisted to localStorage.
 * Amharic copy is written natively — concise, product-appropriate phrasing,
 * not word-for-word translation. Untranslated keys fall back to English.
 */

export type Lang = "en" | "am";

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
    (key: TKey) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key,
    [lang],
  );

  return { lang, setLang, t };
}

export const STRINGS = {
  en: {
    // Navigation
    "nav.dashboard": "Dashboard",
    "nav.auctions": "Live Auctions",
    "nav.howItWorks": "How It Works",
    "nav.faq": "FAQ",
    "nav.signIn": "Sign in",
    "nav.signOut": "Sign out",
    "nav.getStarted": "Get started",
    "nav.language": "Language / ቋንቋ",

    // Hero / landing
    "hero.title.line1": "The lowest bid",
    "hero.title.line2": "nobody else",
    "hero.title.line3": "submitted.",
    "hero.subtitle":
      "Luba awards each prize to the lowest amount placed exactly once — so strategy beats spending. Timing is server-authoritative, settlement is deterministic, and every fee is recorded on an append-only ledger.",
    "hero.cta": "Create an account",
    "hero.ctaSignedIn": "Open dashboard",
    "hero.ctaSecondary": "See the mechanics",

    // Auction
    "auction.bidNow": "Bid now",
    "auction.bidFee": "Bid fee",
    "auction.bids": "bids",
    "auction.unique": "unique",
    "auction.totalBids": "Total bids",
    "auction.uniqueValues": "Unique values",
    "auction.confirmTitle": "Confirm your bid",
    "auction.confirmSubtitle": "One last check before it's locked in.",
    "auction.placing": "Placing bid",
    "auction.endsIn": "Ends in",
    "auction.min": "Min bid",
    "auction.max": "Max bid",
    "auction.placeBid": "Place bid",
    "auction.confirmBid": "Confirm bid",
    "auction.serviceFee": "Service fee",
    "auction.yourBid": "Your bid",
    "auction.termsNote":
      "The service fee is charged now and is non-refundable. You only pay your bid amount if you win.",
    "auction.termsAck":
      "I understand the service fee is non-refundable.",
    "auction.winnerPays": "Winner pays only the winning bid amount.",
    "auction.bidsLeft": "bids left for you",
    "auction.insufficientBalance": "Not enough balance — top up to bid.",

    // Wallet
    "wallet.balance": "Wallet balance",
    "wallet.topUp": "Top up",
    "wallet.promo": "Promo balance",

    // Dashboard
    "dashboard.welcome": "Welcome back",
    "dashboard.myBids": "My bids",
    "dashboard.watchlist": "Watchlist",
    "dashboard.wins": "Wins",

    // Auth
    "auth.title": "Sign in to Luba",
    "auth.subtitle":
      "Choose how you'd like to receive your one-time sign-in code. New here? That's the whole sign-up.",
    "auth.openBotShort": "Open Telegram bot",
    "auth.chooseMethod": "How would you like to sign in?",
    "auth.continueTelegram": "Continue with Telegram",
    "auth.continueEmail": "Continue with Email",
    "auth.continueSms": "Continue with SMS",
    "auth.verifyCode": "Enter the 6-digit code",
    "auth.verify": "Verify",
    "auth.openBot": "Get your Telegram ID",
    "auth.openBotHint":
      "Opens our Telegram bot — press Start and it replies with your numeric ID to sign in with.",

    // Common
    "footer.rights": "All rights reserved.",
    "common.loading": "Loading…",
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.close": "Close",
  },

  am: {
    // Navigation
    "nav.dashboard": "ዳሽቦርድ",
    "nav.auctions": "እየተካሄዱ ያሉ ሽያጮች",
    "nav.howItWorks": "እንዴት እንደሚሰራ",
    "nav.faq": "ጥያቄዎች",
    "nav.signIn": "ግባ",
    "nav.signOut": "ውጣ",
    "nav.getStarted": "ጀምር",
    "nav.language": "ቋንቋ / Language",

    // Hero / landing
    "hero.title.line1": "ያለ ተፎካካሪ",
    "hero.title.line2": "የተገባው",
    "hero.title.line3": "ትንሸኛ ውርርድ።",
    "hero.subtitle":
      "ሉባ ሽልማቱን አንድ ጊዜ ብቻ የተገባውን ትንሸኛ መጠን ያሸንፋል — ስትራቴጂ ከመጠን በላይ መፈፈዝ ይጠቅማል። ጊዜው በአገልጋይ ይቆጣጠራል፣ ውጤቱ በተመሳሳይ ስሌት ይወሰናል፣ እያንዳንዱ ክፍያ በማይሰረዝ መዝገብ ይቀመጣል።",
    "hero.cta": "መለያ ክፈት",
    "hero.ctaSignedIn": "ዳሽቦርድ ክፈት",
    "hero.ctaSecondary": "ስራውን ተመልከት",

    // Auction
    "auction.bidNow": "አሁን ውረስ",
    "auction.bidFee": "የውርርድ ክፍያ",
    "auction.bids": "ውርርዶች",
    "auction.unique": "ልዩ",
    "auction.totalBids": "ጠቅላላ ውርርዶች",
    "auction.uniqueValues": "ልዩ መጠኖች",
    "auction.confirmTitle": "ውርርድዎን ያረጋግጡ",
    "auction.confirmSubtitle": "ከመቀመጡ በፊት የመጨረሻው ማረጋገጫ።",
    "auction.placing": "ውርርድ በመካከል",
    "auction.endsIn": "ሚዛው ይጨረሳል",
    "auction.min": "ዝቅተኛ",
    "auction.max": "ከፍተኛ",
    "auction.placeBid": "ውርርድ አስገባ",
    "auction.confirmBid": "ውርርድዎን ያረጋግጡ",
    "auction.serviceFee": "የአገልግሎት ክፍያ",
    "auction.yourBid": "የእርስዎ ውርርድ",
    "auction.termsNote":
      "የአገልግሎቱ ክፍያ አሁን ይቆረጣል እና በምንም ሁኔታ አይመለስም። የውርርድዎን መጠን የሚከፍሉት ብቻ ሽንፍታውን ካገኙ ነው።",
    "auction.termsAck": "ክፍያው የማይመለስ መሆኑን ተረድቻለሁ።",
    "auction.winnerPays": "አሸናፊው የሚከፍለው የሽንፍታ ውርርዱን መጠን ብቻ ነው።",
    "auction.bidsLeft": "የሚቀሩልዎ ውርርዶች",
    "auction.insufficientBalance": "ሂሳብዎ አይበቃም — ለመውረስ እባክዎ ያስገቡ።",

    // Wallet
    "wallet.balance": "የኪስ ቀሪ ሂሳብ",
    "wallet.topUp": "ገንዘብ አስገባ",
    "wallet.promo": "የማበረታቻ ሂሳብ",

    // Dashboard
    "dashboard.welcome": "እንኳን ደህና መጡ",
    "dashboard.myBids": "የእኔ ውርርዶች",
    "dashboard.watchlist": "የከተለቀዋቸው",
    "dashboard.wins": "ድሎች",

    // Auth
    "auth.title": "ወደ ሉባ ይግቡ",
    "auth.subtitle":
      "የመግቢያ ኮድዎን በምን መንገድ እንደሚቀበሉ ይምረጡ። አዲስ ከሆኑ ይሄ ምዝገባው ነው።",
    "auth.openBotShort": "ቴሌግራም ቦት ክፈት",
    "auth.chooseMethod": "በምን መንገድ መግብዎት ይፈልጋሉ?",
    "auth.continueTelegram": "በቴሌግራም ይግቡ",
    "auth.continueEmail": "በኢሜይል ይግቡ",
    "auth.continueSms": "በኤስኤምኤስ ይግቡ",
    "auth.verifyCode": "6-አሃዙን ኮድ ያስገቡ",
    "auth.verify": "አረጋግጥ",
    "auth.openBot": "የቴሌግራም መለያዎን ያግኙ",
    "auth.openBotHint":
      "ወደ ቴሌግራም ቦታችን ይወስድዎታል — Start ይጫኑ፣ የእርስዎን ቁጥራዊ መለያ ይላክልዎታል።",

    // Common
    "footer.rights": "መብቱ በሕግ የተጠበቀ ነው።",
    "common.loading": "በመጫን ላይ…",
    "common.cancel": "ሰርዝ",
    "common.confirm": "አረጋግጥ",
    "common.close": "ዝጋ",
  },
} as const;

export type TKey = keyof typeof STRINGS.en;
