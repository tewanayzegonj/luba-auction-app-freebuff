import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Scroll-aware wrapper for a Radix TabsList that overflows on phones.
 *
 * Why not the old always-on gradient: a permanent right-edge fade paints over
 * the LAST TAB even when fully scrolled - it reads as a cut-off, broken tab.
 * The premium pattern (iOS segmented controls, Material tabs): each edge gets
 * a fade + chevron ONLY while that direction actually has hidden content,
 * driven by the strip's real scroll position.
 *
 * Also locks vertical panning (overflow-x-auto alone lets touch scroll the
 * triggers up/down inside the bar) and hides the scrollbar completely.
 */
export function ScrollableTabs({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    // 1px tolerance so "fully scrolled" doesn't flicker on subpixel values.
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Tabs can mount late / re-render with different labels (i18n) - re-measure.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const nudge = (dir: 1 | -1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.6), behavior: "smooth" });
  };

  return (
    <div className={cn("relative", className)}>
      {/* Left affordance - only when content is hidden to the left. The
          WHOLE fade strip is the tap target (Material/iOS pattern); no
          floating circle, which read as a broken blob over the tabs. */}
      <AnimatePresence>
        {canLeft && (
          <motion.button
            type="button"
            aria-label="Scroll tabs left"
            onClick={() => nudge(-1)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-y-0 left-0 z-10 flex w-7 items-center justify-start bg-gradient-to-r from-background/90 via-background/40 to-transparent pl-0.5 text-muted-foreground/80 active:text-foreground md:hidden"
          >
            <ChevronLeft className="size-4" />
          </motion.button>
        )}
      </AnimatePresence>

      <div
        ref={stripRef}
        className="flex w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>

      {/* Right affordance - disappears once the last tab is fully visible. */}
      <AnimatePresence>
        {canRight && (
          <motion.button
            type="button"
            aria-label="Scroll tabs right"
            onClick={() => nudge(1)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-y-0 right-0 z-10 flex w-7 items-center justify-end bg-gradient-to-l from-background/90 via-background/40 to-transparent pr-0.5 text-muted-foreground/80 active:text-foreground md:hidden"
          >
            <ChevronRight className="size-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Keep the ACTIVE tab fully visible inside its ScrollableTabs strip.
 * Section navigation (bottom bar → `?tab=`) can activate a trigger the user
 * can't currently see; without this, a phone user lands on a hidden tab.
 *
 * Self-contained: renders nothing, watches Radix's own data-state flips, and
 * adjusts with manual `scrollLeft` math - `scrollIntoView` would also scroll
 * the WINDOW (every scrollable ancestor), yanking the page vertically.
 *
 * Usage: `<ActiveTabScroll />` right after `</TabsList>` inside
 * `<ScrollableTabs>`.
 */
export function ActiveTabScroll() {
  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let animFrame = 0;
    // While a smooth scroll is in flight, ignore scroll-position noise so
    // attribute/child mutations don't fight the animation (the "snap back
    // to tab 1" bug when the user picks a trailing tab).
    let until = 0;
    const busy = () => performance.now() < until;

    // Reads current geometry and, if the active trigger sits outside the
    // viewport, scrolls it into view. Returns true when an adjustment fired.
    const sync = (): boolean => {
      const trigger = document.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]',
      );
      // The scroll strip is TabsList's wrapper (ScrollableTabs' inner div);
      // TabsList itself is the pill and has no overflow of its own.
      const strip = trigger?.closest('[data-slot="tabs-list"]')
        ?.parentElement as HTMLElement | null;
      if (!trigger || !strip || strip.scrollWidth <= strip.clientWidth) {
        return false;
      }

      const tLeft = trigger.offsetLeft;
      const tRight = tLeft + trigger.offsetWidth;
      const viewLeft = strip.scrollLeft;
      const viewRight = viewLeft + strip.clientWidth;

      if (tLeft < viewLeft) {
        strip.scrollTo({ left: tLeft, behavior: "smooth" });
        return true;
      }
      if (tRight > viewRight) {
        strip.scrollTo({ left: tRight - strip.clientWidth, behavior: "smooth" });
        return true;
      }
      return false;
    };

    const adjust = () => {
      if (busy()) return;
      if (sync()) {
        // Suppress our own listeners while the smooth scroll runs; a final
        // sync after settle catches subpixel rounding left by the animation.
        until = performance.now() + 500;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          until = 0;
          sync();
        }, 520);
      }
    };

    // Mount-time sync: the Tabs tree may have mounted ALREADY scrolled past
    // (Dashboard remounts via key={initialTab} when ?tab= changes - new nodes
    // are born active, so no data-state *change* ever fires). Call once
    // immediately, then again after layout/fonts settle.
    if (sync()) {
      until = performance.now() + 500;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        until = 0;
        sync();
      }, 520);
    }
    animFrame = requestAnimationFrame(adjust);

    // Future activations (clicks, ?tab= on the same mount): Radix flips
    // data-state on triggers. Scoped to the strip - NOT document.body-wide,
    // which made every unrelated attribute mutation re-run the measurement.
    const stripEl = document
      .querySelector('[data-slot="tabs-trigger"][data-state="active"]')
      ?.closest('[data-slot="tabs-list"]')?.parentElement;
    const mo = new MutationObserver(adjust);
    if (stripEl) {
      mo.observe(stripEl, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
    }
    return () => {
      cancelAnimationFrame(animFrame);
      clearTimeout(settleTimer);
      mo.disconnect();
    };
  }, []);

  return null;
}
