import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Gavel, Wallet, Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";

/**
 * First-run guided tour (3 steps, ~15 seconds, skippable, shown ONCE).
 *
 * Shown only on the dashboard for users who haven't completed it. Persisted in
 * localStorage ("luba.tourDone") - deliberately not server state: it's pure
 * presentation, per-device, and must never block a returning user on a new
 * device from using the app.
 *
 * Steps teach the three things a new bidder must understand to not lose money
 * or miss auctions: (1) wallet = bid fuel, (2) the bid bar, (3) alerts.
 */

const STORAGE_KEY = "luba.tourDone";

export function isTourDone() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true; // storage blocked → never show
  }
}

export function markTourDone() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function OnboardingTour() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isTourDone()) {
      // Small delay so the dashboard settles first - feels intentional.
      const id = setTimeout(() => setOpen(true), 700);
      return () => clearTimeout(id);
    }
  }, []);

  const finish = () => {
    markTourDone();
    setOpen(false);
  };

  const steps = [
    {
      icon: Wallet,
      title: t("tour.wallet.title"),
      body: t("tour.wallet.body"),
    },
    {
      icon: Gavel,
      title: t("tour.bidding.title"),
      body: t("tour.bidding.body"),
    },
    {
      icon: Bell,
      title: t("tour.alerts.title"),
      body: t("tour.alerts.body"),
    },
  ];
  const current = steps[step];
  const Icon = current.icon;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center sm:pb-4"
          role="dialog"
          aria-modal="true"
          aria-label="Getting started"
          onClick={finish}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-layered-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Progress dots */}
            <div className="mb-4 flex items-center justify-center gap-1.5">
              {steps.map((_, i) => (
                <motion.span
                  key={i}
                  animate={{ scale: i === step ? 1.15 : 1 }}
                  className={
                    i === step
                      ? "h-1.5 w-6 rounded-full bg-primary"
                      : "h-1.5 w-1.5 rounded-full bg-muted-foreground/30"
                  }
                />
              ))}
            </div>

            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center text-center"
            >
              <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Icon className="size-7" />
              </div>
              <h3 className="text-lg font-semibold">{current.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {current.body}
              </p>
            </motion.div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={finish}
                className="text-muted-foreground"
              >
                Skip
              </Button>
              <Button onClick={() => (step < steps.length - 1 ? setStep(step + 1) : finish())}>
                {step < steps.length - 1 ? "Next" : t("tour.done")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
