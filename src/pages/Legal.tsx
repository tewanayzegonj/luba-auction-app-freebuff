import { SiteFooter, SiteHeader } from "@/components/luba";
import { Link } from "react-router";

/**
 * Legal pages (spec §54, responsible-play section of the roadmap).
 * One component, three documents — content lives in code because it is
 * versioned with the product and must never drift from behavior.
 */

type Doc = "terms" | "privacy" | "responsible-play";

const META: Record<Doc, { title: string; updated: string }> = {
  terms: { title: "Terms & Conditions", updated: "September 2026" },
  privacy: { title: "Privacy Policy", updated: "September 2026" },
  "responsible-play": { title: "Responsible Play", updated: "September 2026" },
};

export default function Legal({ doc }: { doc: Doc }) {
  const meta = META[doc];

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Legal
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
          {meta.title}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated {meta.updated}
        </p>

        <div className="mt-8 space-y-8 text-sm leading-7 text-muted-foreground">
          {doc === "terms" && <Terms />}
          {doc === "privacy" && <Privacy />}
          {doc === "responsible-play" && <ResponsiblePlay />}
        </div>

        <p className="mt-12 rounded-xl border border-border bg-card/60 p-4 text-xs leading-6">
          Questions about this document? Contact support through the in-app
          notifications or our official Telegram bot. By continuing to use Luba
          you accept the version published on this page.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-semibold text-foreground">{children}</h2>
  );
}

function Terms() {
  return (
    <>
      <section className="space-y-3">
        <H>1. The service</H>
        <p>
          Luba operates lowest-unique-bid auctions. In each auction, the
          participant whose bid amount is the lowest amount submitted exactly
          once wins. The lowest numerical bid does not necessarily win — the
          lowest unique bid wins.
        </p>
        <p>
          Each accepted bid costs the bid service fee displayed on the auction
          page. The bid value itself is not deducted from your wallet when you
          bid. If you win, you pay the winning bid amount (plus applicable
          taxes and fees where stated) before the prize is fulfilled.
        </p>
      </section>
      <section className="space-y-3">
        <H>2. Eligibility</H>
        <p>
          You must be at least 18 years old and legally able to enter binding
          contracts under Ethiopian law. One person may hold one account.
          Accounts that fail identity verification, use automated bidding, or
          engage in coordinated manipulation may be suspended and their wins
          voided.
        </p>
      </section>
      <section className="space-y-3">
        <H>3. Bids and fees</H>
        <p>
          Bid service fees are charged at the moment a bid is accepted and are
          non-refundable, except when an auction is cancelled by Luba — in that
          case all fees for that auction are refunded to participants' wallets.
          Bids are accepted exactly once or not at all; duplicate submissions
          are rejected by idempotency controls.
        </p>
      </section>
      <section className="space-y-3">
        <H>4. Winner determination</H>
        <p>
          Winners are resolved deterministically by a server-side algorithm
          over accepted bids only: the lowest bid value submitted by exactly
          one participant wins. No randomness and no client input affect the
          result. After settlement, the complete bid history of the auction is
          published so any participant can verify the outcome.
        </p>
      </section>
      <section className="space-y-3">
        <H>5. Prizes and payment</H>
        <p>
          Winners are notified and given a payment deadline shown on their
          dashboard. If payment is not completed by the deadline, the claim may
          be forfeited and handled under the auction's no-winner policy. Prizes
          are fulfilled after payment verification and, where required,
          identity verification.
        </p>
      </section>
      <section className="space-y-3">
        <H>6. Changes</H>
        <p>
          We may update these terms as the product evolves. Material changes
          are announced in-app before they take effect. These terms are a
          product document; the final legal classification of the service,
          licensing, and tax treatment are governed by the applicable laws of
          Ethiopia and supersede anything written here in case of conflict.
        </p>
      </section>
    </>
  );
}

function Privacy() {
  return (
    <>
      <section className="space-y-3">
        <H>What we collect</H>
        <p>
          Account data: your email address, optional name, and any sign-in
          methods you link (Telegram chat ID, phone number). Identity
          documents, only if you choose to verify your identity for prize
          claims. Transactional records: every deposit, bid fee, refund, and
          winner payment — retained as part of an append-only financial ledger.
        </p>
      </section>
      <section className="space-y-3">
        <H>How we use it</H>
        <p>
          To operate your account and wallet, to run auctions and settle
          winners deterministically, to deliver notifications you have opted
          into (in-app, Telegram, SMS where enabled), to prevent fraud and
          abuse, and to meet accounting and legal obligations. We do not sell
          personal data.
        </p>
      </section>
      <section className="space-y-3">
        <H>Security</H>
        <p>
          Money movement is recorded in a double-entry ledger where every
          transaction must balance, and every sensitive administrative action
          is written to an audit log. Confirmation links we send you are
          single-use, expire in 15 minutes, and are stored only as hashes.
          Payment webhooks are verified with cryptographic signatures.
        </p>
      </section>
      <section className="space-y-3">
        <H>Your choices</H>
        <p>
          You can link or unlink sign-in methods at any time from your
          profile, choose which notification types you receive per channel, set
          your own deposit limits, or temporarily exclude yourself from bidding
          entirely. You can request account closure through support; financial
          records are retained as required by law.
        </p>
      </section>
    </>
  );
}

function ResponsiblePlay() {
  return (
    <>
      <section className="space-y-3">
        <H>Bidding should stay fun</H>
        <p>
          A lowest-unique-bid auction is a game of strategy and luck. Bid fees
          are spent for the chance to win — they are not an investment. Only
          bid with money you can afford to lose.
        </p>
      </section>
      <section className="space-y-3">
        <H>Tools we give you</H>
        <p>
          <strong className="text-foreground">Deposit cap.</strong> Set a
          maximum amount you can top up per rolling 24 hours, from your
          dashboard. Raising a cap takes effect after a 24-hour cooling period;
          lowering it is immediate. This limit cannot be lifted by anyone —
          including support.
        </p>
        <p>
          <strong className="text-foreground">Self-exclusion.</strong> Exclude
          yourself from bidding for a fixed period (24 hours, 7 days, 30 days,
          or 6 months). While excluded you cannot bid, scheduled bids will not
          execute, and top-ups are blocked. Exclusion cannot be ended early.
        </p>
        <p>
          <strong className="text-foreground">Notifications on your terms.</strong>{" "}
          Every alert type can be switched off per channel in your profile, so
          the platform never pushes you toward more play than you want.
        </p>
      </section>
      <section className="space-y-3">
        <H>Need help?</H>
        <p>
          If bidding stops feeling like a game, stop and talk to someone you
          trust. Support can help you apply stricter limits or close your
          account, and will never encourage you to keep playing.
        </p>
      </section>
    </>
  );
}
