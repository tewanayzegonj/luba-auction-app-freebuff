import { motion, useReducedMotion } from "framer-motion";

/**
 * Shared, restrained motion primitives so every page animates with the same
 * voice: short durations, no bounce. Consistency is what makes motion feel
 * premium rather than playful.
 *
 * Motion law (from the ui-skills canon + master design doc):
 *  - NAVIGATION NEVER MOVES THE PAGE. PageFade is opacity-only - a rising
 *    page re-stages a vertical move on every navigation, which reads as a
 *    jerk right as the user lands (the "shaky page open" bug). Opacity
 *    crossfades are the two cheapest properties a GPU can animate.
 *  - Small rises (≤12px) belong to CONTENT arriving in view (StaggerItem,
 *    scroll-triggered reveals) - not to route changes.
 *  - Entrances ease-out, ≤350ms; everything respects prefers-reduced-motion
 *    (WCAG 2.2): reduced users get short opacity-only fades.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** Page-level entrance - wrap a page's outermost content element. */
export function PageFade({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0.15 : 0.25, ease: "linear" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Staggered list/grid entrance - child index drives the delay. */
export function Stagger({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: {
            staggerChildren: reduce ? 0 : 0.05,
            delayChildren: reduce ? 0 : delay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      variants={{
        hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 12 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: reduce ? 0.15 : 0.35, ease: EASE },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
