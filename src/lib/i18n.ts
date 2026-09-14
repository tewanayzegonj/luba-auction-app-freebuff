import { useCallback, useEffect, useState } from "react";

/**
 * i18n (roadmap: Amharic localization).
 *
 * A typed dictionary and a language hook persisted to localStorage.
 * Amharic copy uses standard Ethiopian e-commerce / fintech vocabulary
 * (ጨረታ, ዋሌት, ተጫራቾች) in the style of Telebirr and Howlow — written
 * natively, never word-for-word. Untranslated keys fall back to English.
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
    "nav.home": "Home",
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
    "auction.timeRemaining": "Time remaining",
    "auction.bidders": "Bidders",
    "auction.bidPlaced": "Bid placed!",
    "auction.notUnique": "That value is already taken — try another.",
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
    "wallet.transactions": "Transaction history",

    // Dashboard
    "dashboard.welcome": "Welcome back",
    "dashboard.myBids": "My bids",
    "dashboard.watchlist": "Watchlist",
    "dashboard.wins": "Wins",
    "dashboard.profile": "Profile",
    "dashboard.wallet": "Wallet",
    "dashboard.alerts": "Alerts",
    "dashboard.payToWin": "pay your winning bid to claim your prize",

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
    "auth.resend": "Resend code",
    "auth.openBot": "Get your Telegram ID",
    "auth.openBotHint":
      "Opens our Telegram bot — press Start and it replies with your numeric ID to sign in with.",

    // Common
    "footer.rights": "All rights reserved.",
    "footer.terms": "Terms",
    "footer.privacy": "Privacy",
    "footer.responsiblePlay": "Responsible play",
    "common.loading": "Loading…",
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.close": "Close",
  },

  am: {
    // Navigation
    "nav.home": "ዋና ገጽ",
    "nav.dashboard": "ዳሽቦርድ",
    "nav.auctions": "ጨረታዎች",
    "nav.howItWorks": "እንዴት እንደሚሰራ",
    "nav.faq": "ጥያቄዎች",
    "nav.signIn": "ይግቡ",
    "nav.signOut": "ይውጡ",
    "nav.getStarted": "ይጀምሩ",
    "nav.language": "ቋንቋ",

    // Hero / landing
    "hero.title.line1": "በሌላው ያልተገባው",
    "hero.title.line2": "ዝቅተኛ",
    "hero.title.line3": "ጨረታ ያሸንፋል።",
    "hero.subtitle":
      "ሉባ ሽልማቱን አንድ ጊዜ ብቻ የተገባው ዝቅተኛ የጨረታ ዋጋ ይሸልማል — ብዙ መፈፈዝ እንጂ ስትራቴጂዎ ነው የሚያሸንፈው። የጊዜ ቆጣሪው በአገልጋይ ይቆጣጠራል፣ አሸናፊው በአንድ አይነት ስሌት ይወሰናል፣ እያንዳንዱ ክፍያ ማይቀየር መዝገብ ላይ ይቀመጣል።",
    "hero.cta": "መለያ ይክፈቱ",
    "hero.ctaSignedIn": "ዳሽቦርድ ይክፈቱ",
    "hero.ctaSecondary": "ስራውን ይመልከቱ",

    // Auction
    "auction.bidNow": "ጨረታ ያቅርቡ",
    "auction.bidFee": "የአገልግሎት ክፍያ",
    "auction.bids": "ጨረታዎች",
    "auction.unique": "ልዩ",
    "auction.totalBids": "የተደረጉ ጨረታዎች",
    "auction.uniqueValues": "ልዩ ዋጋዎች",
    "auction.timeRemaining": "የቀረ ጊዜ",
    "auction.bidders": "ተጫራቾች",
    "auction.bidPlaced": "ጨረታዎ በተሳካ ሁኔታ ገብቷል!",
    "auction.notUnique": "ያስገቡት ዋጋ ተደግሟል — ሌላ ይምረጡ።",
    "auction.confirmTitle": "ጨረታዎን ያረጋግጡ",
    "auction.confirmSubtitle": "ጨረታው ከመቀመጡ በፊት የመጨረሻ ማረጋገጫ።",
    "auction.placing": "ጨረታ በመላክ ላይ",
    "auction.endsIn": "የቀረ ጊዜ",
    "auction.min": "ዝቅተኛ",
    "auction.max": "ከፍተኛ",
    "auction.placeBid": "ጨረታ ያስገቡ",
    "auction.confirmBid": "ጨረታውን ያረጋግጡ",
    "auction.serviceFee": "የአገልግሎት ክፍያ",
    "auction.yourBid": "ያቀረቡት ዋጋ",
    "auction.termsNote":
      "የአገልግሎቱ ክፍያ አሁን ይቆረጣል፤ የማይመለስ ክፍያ ነው። የጨረታዎን ዋጋ የሚከፍሉት ብቻ አሸንፈው ሲወጡ ነው።",
    "auction.termsAck":
      "የአገልግሎቱ ክፍያ የማይመለስ መሆኑን ተረድቻለሁ።",
    "auction.winnerPays": "አሸናፊው የሚከፍለው የሽንፍታ ዋጋውን ብቻ ነው።",
    "auction.bidsLeft": "ለእርስዎ የሚቀሩ ጨረታዎች",
    "auction.insufficientBalance":
      "የዋሌት ቀሪ ሒሳብዎ አይበቃም — ለመውረስ ዋሌትዎን ይሙሉ።",

    // Wallet
    "wallet.balance": "የዋሌት ቀሪ ሒሳብ",
    "wallet.topUp": "ዋሌት ይሙሉ",
    "wallet.promo": "የማበረታቻ ሒሳብ",
    "wallet.transactions": "የክፍያ ታሪክ",

    // Dashboard
    "dashboard.welcome": "እንኳን ደህና መጡ",
    "dashboard.myBids": "የኔ ጨረታዎች",
    "dashboard.watchlist": "የከተከታተሉዋቸው",
    "dashboard.wins": "ድሎች",
    "dashboard.profile": "መገለጫ",
    "dashboard.wallet": "ዋሌት",
    "dashboard.alerts": "ማሳወቂያዎች",
    "dashboard.payToWin": "የሽንፍታ ክፍያዎን ይክፈሉ — ሽልማትዎን ለማግኘት",

    // Auth
    "auth.title": "ወደ ሉባ ይግቡ",
    "auth.subtitle":
      "የመግቢያ ኮድዎ የሚላክበትን መንገድ ይምረጡ። አዲስ ከሆኑ — ይሄ ነው ሙሉ ምዝገባው።",
    "auth.openBotShort": "ቴሌግራም ቦት ይክፈቱ",
    "auth.chooseMethod": "በየትኛው መንገድ ይግቡ?",
    "auth.continueTelegram": "በቴሌግራም ይቀጥሉ",
    "auth.continueEmail": "በኢሜይል ይቀጥሉ",
    "auth.continueSms": "በኤስኤምኤስ ይቀጥሉ",
    "auth.verifyCode": "ባለ 6 አሃዝ ማረጋገጫ ኮድ ያስገቡ",
    "auth.verify": "አረጋግጥ",
    "auth.resend": "ኮዱን በድጋሚ ላክ",
    "auth.openBot": "የቴሌግራም መለያዎን ያግኙ",
    "auth.openBotHint":
      "ወደ ቴሌግራም ቦታችን ይወስድዎታል — Start ይጫኑ፣ የእርስዎ ቁጥራዊ መለያ ይላክልዎታል።",

    // Common
    "footer.rights": "መብቱ በሕግ የተጠበቀ ነው።",
    "footer.terms": "ደንቦች እና ግዴታዎች",
    "footer.privacy": "የግላዊነት መመሪያ",
    "footer.responsiblePlay": "በኃላፊነት መጫወት",
    "common.loading": "በመጫን ላይ…",
    "common.cancel": "ሰርዝ",
    "common.confirm": "አረጋግጥ",
    "common.close": "ዝጋ",
  },
} as const;

export type TKey = keyof typeof STRINGS.en;
