import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Scroll-aware wrapper for a Radix TabsList that overflows on phones.
 *
 * Why not the old always-on gradient: a permanent right-edge fade paints over
 * the LAST TAB even when fully scrolled — it reads as a cut-off, broken tab.
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
    // Tabs can mount late / re-render with different labels (i18n) — re-measure.
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
      {/* Left affordance — only when content is hidden to the left. The
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
            className="absolute inset-y-0 left-0 z-10 flex w-11 items-center justify-start bg-gradient-to-r from-background via-background/80 to-transparent pl-0.5 text-muted-foreground active:text-foreground md:hidden"
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

      {/* Right affordance — disappears once the last tab is fully visible. */}
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
            className="absolute inset-y-0 right-0 z-10 flex w-11 items-center justify-end bg-gradient-to-l from-background via-background/80 to-transparent pr-0.5 text-muted-foreground active:text-foreground md:hidden"
          >
            <ChevronRight className="size-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
