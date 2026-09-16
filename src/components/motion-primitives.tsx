import { motion, useReducedMotion } from "framer-motion";

/**
 * Shared, restrained motion primitives so every page animates with the same
 * voice: small rises, short durations, no bounce. Consistency is what makes
 * motion feel premium rather than playful.
 *
 * All primitives respect `prefers-reduced-motion` (WCAG 2.2 / master design
 * doc): users with the OS preference get a short opacity-only fade — no
 * vertical movement, no staggered reveals.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** Page-level entrance — wrap a page's outermost content element. */
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
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0.15 : 0.35, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Staggered list/grid entrance — child index drives the delay. */
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
