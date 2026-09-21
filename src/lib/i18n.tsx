import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * i18n (roadmap: Amharic localization).
 *
 * Language lives in a React Context so toggling re-renders every consumer
 * instantly - no page refresh. The choice persists to localStorage, and
 * <html lang> follows so the Ethiopic typography rules in index.css apply.
 * Amharic copy uses standard Ethiopian e-commerce / fintech vocabulary
 * (ጨረታ, ዋሌት, ተጫራቾች) in the style of Telebirr and Howlow - written
 * natively, never word-for-word. Untranslated keys fall back to English.
 */

export type Lang = "en" | "am";

const STORAGE_KEY = "luba.lang";

type LanguageContextValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey) => string;
};

const enT = (key: TKey) => STRINGS.en[key] ?? key;

// Fallback so useLang never throws, even for a component rendered outside
// the provider (it just reads English and cannot switch).
const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  t: enT,
});

function readStoredLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === "am" ? "am" : "en";
  } catch {
    return "en";
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // private mode - language just won't persist
    }
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);

  const t = useCallback(
    (key: TKey) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key,
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLang(): LanguageContextValue {
  return useContext(LanguageContext);
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
    "hero.title.line3": "submitted.",      "hero.subtitle":
        "Pick the amount nobody else will. The lowest unique bid wins - precision beats spending.",
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
    "auction.notUnique": "That value is already taken - try another.",
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
    "auction.insufficientBalance": "Not enough balance - top up to bid.",
    "auction.views": "views",
    "auction.participants": "participants",
    "auction.insufficientTitle": "Insufficient wallet balance",
    "auction.insufficientNeed": "You need {fee} to place this bid.",
    "auction.insufficientAvailable": "Available",
    "auction.insufficientNeeded": "Needed",
    "auction.insufficientNote":
      "Only the service fee is charged now - your bid of {bid} is paid only if you win.",
    "auction.topUpCta": "Top Up Wallet",
    "auction.topUpToBid": "Top up to bid",

    // Wallet
    "wallet.balance": "Wallet balance",
    "wallet.topUp": "Top up",
    "wallet.promo": "Promo balance",
    "wallet.transactions": "Transaction history",

    // Dashboard
    "dashboard.welcome": "Welcome back",
    "dashboard.myBids": "My bids",

    // Onboarding tour (first dashboard visit only)
    "tour.wallet.title": "Your wallet is your bid fuel",
    "tour.wallet.body":
      "Top up once with Chapa, then place bids instantly - no payment redirects for every bid. Fees come straight from your balance.",
    "tour.bidding.title": "Bid the lowest unique amount",
    "tour.bidding.body":
      "The prize goes to the lowest amount nobody else picked. Use the − / + buttons to fine-tune your amount, then confirm.",
    "tour.alerts.title": "We'll keep you in the loop",
    "tour.alerts.body":
      "Get alerted on Telegram or email before an auction you entered closes - and the moment results are out.",
    "tour.done": "Start bidding",
    "dashboard.watchlist": "Watchlist",
    "dashboard.wins": "Wins",
    "dashboard.profile": "Profile",
    "dashboard.wallet": "Wallet",
    "dashboard.alerts": "Alerts",
    "dashboard.notifications": "Alerts",
    "dashboard.payToWin": "pay your winning bid to claim your prize",
    "dashboard.name": "Display name",
    "dashboard.namePromptTitle": "Enter your display name",
    "dashboard.namePromptBody":
      "This is how you'll appear on leaderboards and winner announcements. You can change it later in your profile.",
    "dashboard.nameMaybeLater": "Maybe later",
    "dashboard.alertsBannerTitle": "Receive auction and outbid alerts",
    "dashboard.alertsBannerBody":
      "Get notified on Telegram and email when bids land, auctions are ending, and you win.",
    "dashboard.alertsBannerCta": "Connect Telegram for instant alerts",
    "dashboard.alertsBannerDismiss": "Dismiss",
    "dashboard.setName": "Set name",

    // Auth
    "auth.title": "Sign in to Luba",
    "auth.subtitle":
      "Choose how you'd like to receive your one-time sign-in code. New here? That's the whole sign-up.",
    "auth.openBotShort": "Open Telegram bot",
    "auth.chooseMethod": "How would you like to sign in?",
    "auth.continueTelegram": "Continue with Telegram",
    "auth.continueTelegramOneTap": "Continue with Telegram",
    "auth.continueTelegramOneTapHint": "One tap in a popup - no code to copy",
    "auth.continueEmail": "Continue with Email",
    "auth.continueSms": "Continue with SMS",
    "auth.verifyCode": "Enter the 6-digit code",
    "auth.verify": "Verify",
    "auth.resend": "Resend code",
    "auth.openBot": "Get your Telegram ID",
    "auth.openBotHint":
      "Opens our Telegram bot - press Start and it replies with your numeric ID to sign in with.",

    // Common
    "footer.rights": "All rights reserved.",
    "footer.terms": "Terms",
    "footer.privacy": "Privacy",
    "footer.responsiblePlay": "Responsible play",
    "common.loading": "Loading…",
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.close": "Close",
    "common.dismiss": "Dismiss",
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
      "ሉባ ሽልማቱን አንድ ጊዜ ብቻ የተገባው ዝቅተኛ የጨረታ ዋጋ ይሸልማል - ብዙ መፈፈዝ እንጂ ስትራቴጂዎ ነው የሚያሸንፈው። የጊዜ ቆጣሪው በአገልጋይ ይቆጣጠራል፣ አሸናፊው በአንድ አይነት ስሌት ይወሰናል፣ እያንዳንዱ ክፍያ ማይቀየር መዝገብ ላይ ይቀመጣል።",
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
    "auction.notUnique": "ያስገቡት ዋጋ ተደግሟል - ሌላ ይምረጡ።",
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
      "የዋሌት ቀሪ ሒሳብዎ አይበቃም - ለመውረስ ዋሌትዎን ይሙሉ።",
    "auction.views": "ተመልክተዋል",
    "auction.participants": "ተጫራቾች",
    "auction.insufficientTitle": "የዋሌት ቀሪ ሒሳብ አልበቃም",
    "auction.insufficientNeed": "ይህን ጨረታ ለማቅረብ {fee} ያስፈልግዎታል።",
    "auction.insufficientAvailable": "ያለዎት",
    "auction.insufficientNeeded": "የሚያስፈልገው",
    "auction.insufficientNote":
      "አሁን የሚቆጠረው የአገልግሎቱ ክፍያ ብቻ ነው - {bid} የሚከፍሉት አሸንፈው ሲወጡ ብቻ።",
    "auction.topUpCta": "ዋሌት ይሙሉ",
    "auction.topUpToBid": "ዋሌት ይሙሉ",

    // Wallet
    "wallet.balance": "የዋሌት ቀሪ ሒሳብ",
    "wallet.topUp": "ዋሌት ይሙሉ",
    "wallet.promo": "የማበረታቻ ሒሳብ",
    "wallet.transactions": "የክፍያ ታሪክ",

    // Dashboard
    "dashboard.welcome": "እንኳን ደህና መጡ",
    "dashboard.notifications": "ማሳወቂያዎች",
    "dashboard.myBids": "የኔ ጨረታዎች",

    // Onboarding tour
    "tour.wallet.title": "ዋሌትዎ የጨረታ ነዳጅዎ ነው",
    "tour.wallet.body":
      "በአንድ ጊዜ ይሙሉ፣ ከዚያ ጨረታዎችዎን ወዲያውኑ ያስገቡ - ለእያንዳንዱ ጨረታ ወደ ክፍያ ገጽ አይዘዋወርም። ክፍያዎች ከቀሪ ሒሳብዎ ይቀንሳሉ።",
    "tour.bidding.title": "ብቸኛውን እና ዝቅተኛውን ዋጋ ይምረጡ",
    "tour.bidding.body":
      "ሽልማቱ ማንም ሰው ያልመረጠው ዝቅተኛ ዋጋ ይሸልማል። − / + አዝራሮችን ተጠቅመው ዋጋዎን ያስተካክሉ።",
    "tour.alerts.title": "መረጃ እንሰጥዎታለን",
    "tour.alerts.body":
      "የገቡት ጨረታዎች ከመዘጋታቸው በፊት በቴሌግራም ወይም በኢሜይል ማሳወቂያ ያገኛሉ።",
    "tour.done": "ጨረታ ጀምር",
    "dashboard.watchlist": "የከተከታተሉዋቸው",
    "dashboard.wins": "ድሎች",
    "dashboard.profile": "መገለጫ",
    "dashboard.wallet": "ዋሌት",
    "dashboard.alerts": "ማሳወቂያዎች",
    "dashboard.payToWin": "የሽንፍታ ክፍያዎን ይክፈሉ - ሽልማትዎን ለማግኘት",
    "dashboard.name": "የሚታይ ስም",
    "dashboard.namePromptTitle": "የሚታይ ስምዎን ያስገቡ",
    "dashboard.namePromptBody":
      "ይህ ስም በጨረታዎች እና በአሸናፊነት ማስታወቂያዎች ላይ ይታያል። በመገለጫዎ ውስጥ በኋላ ማስተካከል ይችላሉ።",
    "dashboard.nameMaybeLater": "እስከዚያው",
    "dashboard.alertsBannerTitle": "የጨረታ ማሳወቂያዎችን ይቀበሉ",
    "dashboard.alertsBannerBody":
      "ጨረታ ሲገባ፣ ጨረታዎች ሲያልቁ እና ስታሸንፍ በቴሌግራም እና በኢሜይል ይነገራሉ።",
    "dashboard.alertsBannerCta": "በቴሌግራም አገናኝ ለአፍጥነት ማሳወቂያ",
    "dashboard.alertsBannerDismiss": "አስወግድ",
    "dashboard.setName": "ስም ያስገቡ",

    // Auth
    "auth.title": "ወደ ሉባ ይግቡ",
    "auth.subtitle":
      "የመግቢያ ኮድዎ የሚላክበትን መንገድ ይምረጡ። አዲስ ከሆኑ - ይሄ ነው ሙሉ ምዝገባው።",
    "auth.openBotShort": "ቴሌግራም ቦት ይክፈቱ",
    "auth.chooseMethod": "በየትኛው መንገድ ይግቡ?",
    "auth.continueTelegram": "በቴሌግራም ይቀጥሉ",
    "auth.continueTelegramOneTap": "በቴሌግራም ይቀጥሉ",
    "auth.continueTelegramOneTapHint": "አንድ ጊዜ ይንኩ - ኮድ መቅዳት አያስፈልግም",
    "auth.continueEmail": "በኢሜይል ይቀጥሉ",
    "auth.continueSms": "በኤስኤምኤስ ይቀጥሉ",
    "auth.verifyCode": "ባለ 6 አሃዝ ማረጋገጫ ኮድ ያስገቡ",
    "auth.verify": "አረጋግጥ",
    "auth.resend": "ኮዱን በድጋሚ ላክ",
    "auth.openBot": "የቴሌግራም መለያዎን ያግኙ",
    "auth.openBotHint":
      "ወደ ቴሌግራም ቦታችን ይወስድዎታል - Start ይጫኑ፣ የእርስዎ ቁጥራዊ መለያ ይላክልዎታል።",

    // Common
    "footer.rights": "መብቱ በሕግ የተጠበቀ ነው።",
    "footer.terms": "ደንቦች እና ግዴታዎች",
    "footer.privacy": "የግላዊነት መመሪያ",
    "footer.responsiblePlay": "በኃላፊነት መጫወት",
    "common.loading": "በመጫን ላይ…",
    "common.cancel": "ሰርዝ",
    "common.confirm": "አረጋግጥ",
    "common.close": "ዝጋ",
    "common.dismiss": "አስወግድ",
  },
} as const;

export type TKey = keyof typeof STRINGS.en;
