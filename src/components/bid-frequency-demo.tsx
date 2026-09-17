import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";

/**
 * The rule, played. Four bids arrive over ~7s; the duplicate on 1.00 kills
 * it, and 2.00 - lowest *unique* - wins. This is LUBA's ownable brand
 * moment: a template has no hero like this because no template has this
 * game rule.
 *
 * Motion rules (skill §24): tiny 150ms transitions, one-shot per event, a
 * calm breathing loop ONLY on the live indicator, and everything gated
 * behind useReducedMotion - reduced-motion users get the completed state
 * instantly, no timers run at all.
 */

type RowState = "idle" | "arriving" | "dup" | "winner";

const SCRIPT: Array<{
  v: string;
  state: RowState;
  note: string;
  /** Delay (ms) after mount when this event lands. */
  at: number;
}> = [
  { v: "1.00", state: "arriving", note: "First bid in", at: 400 },
  { v: "2.00", state: "arriving", note: "A quiet amount…", at: 1700 },
  { v: "3.00", state: "arriving", note: "Two more join the board", at: 3000 },
  { v: "4.00", state: "arriving", note: "Last call", at: 4300 },
  { v: "1.00", state: "dup", note: "Someone matched 1.00 - it's dead", at: 5600 },
  { v: "2.00", state: "winner", note: "Lowest unique bid - won", at: 6900 },
];

const FINAL_NOTE =
  "2.00 wins - lowest and unique. After close, every auction publishes its full bid math so you can verify the result yourself.";

const ROWS = ["1.00", "2.00", "3.00", "4.00"] as const;

export function BidFrequencyDemo() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(() => (reduced ? SCRIPT.length : 0));

  useEffect(() => {
    if (reduced) {
      setStep(SCRIPT.length);
      return;
    }
    const ids = SCRIPT.map((ev) =>
      window.setTimeout(() => setStep(SCRIPT.indexOf(ev) + 1), ev.at),
    );
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [reduced]);

  const landed = SCRIPT.slice(0, step);
  const last = landed[landed.length - 1];
  const settled = step >= SCRIPT.length;

  const rows = ROWS.map((v) => {
    const events = landed.filter((e) => e.v === v);
    const placed = events.filter((e) => e.state === "arriving").length;
    const isDup = events.some((e) => e.state === "dup");
    const isWinner = events.some((e) => e.state === "winner");
    return { v, placed, isDup, isWinner, visible: events.length > 0 };
  });

  return (
    <div
      aria-label="Animated demonstration: four bids arrive, the lowest unique one wins"
      className="relative rounded-2xl border border-border bg-card p-5 shadow-layered-lg"
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          How winning works
        </span>
        {/* The only looping motion on the page's hero: the live dot's calm
            breathe - then it stops when the demo settles. */}
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium " +
            (settled
              ? "bg-primary/10 text-primary"
              : "bg-secondary/70 text-muted-foreground")
          }
        >
          <span className="relative flex size-1.5">
            {settled && !reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
            )}
            <span
              className={
                "relative inline-flex size-1.5 rounded-full " +
                (settled ? "bg-primary" : "bg-muted-foreground")
              }
            />
          </span>
          {settled ? "Settled" : "Live demo"}
        </span>
      </div>

      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        Four bids come in. The lowest amount chosen by{" "}
        <span className="font-medium text-foreground">exactly one person</span>{" "}
        wins - not simply the lowest number.
      </p>

      <div className="mt-4 space-y-1.5" aria-hidden>
        {rows.map((r) => (
          <motion.div
            key={r.v}
            initial={false}
            animate={
              r.visible
                ? { opacity: 1, y: 0 }
                : { opacity: 0.25, y: 6 }
            }
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className={
              "flex h-9 items-center justify-between rounded-lg px-3 text-xs font-semibold tabular-nums " +
              (r.isWinner
                ? "bg-primary text-primary-foreground shadow-layered"
                : r.isDup
                  ? "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
                  : r.visible
                    ? "bg-secondary/60 text-foreground ring-1 ring-inset ring-foreground/10"
                    : "bg-secondary/40 text-muted-foreground/50")
            }
          >
            <span className="font-display text-[13px]">{r.v} ETB</span>
            <span
              className={
                "text-[10px] font-medium uppercase tracking-wider " +
                (r.isWinner
                  ? "text-primary-foreground/90"
                  : r.isDup
                    ? "text-rose-700 dark:text-rose-300"
                    : r.visible
                      ? "text-muted-foreground"
                      : "text-muted-foreground/40")
              }
            >
              {r.isWinner
                ? "★ lowest unique - winner"
                : r.isDup
                  ? "×2 - not unique"
                  : r.visible
                    ? r.placed > 1
                      ? `×${r.placed} placed`
                      : "placed"
                    : "-"}
            </span>
          </motion.div>
        ))}
      </div>

      {/* Narration line: what just happened, in one sentence. */}
      <div className="mt-3 flex min-h-5 items-start gap-2 border-t border-border/70 pt-3">
        <Trophy className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-xs leading-5 text-muted-foreground" aria-live="polite">
          {settled ? FINAL_NOTE : (last?.note ?? "Watch four bids arrive…")}
        </p>
      </div>
    </div>
  );
}
