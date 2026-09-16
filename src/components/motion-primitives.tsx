import { motion } from "framer-motion";

/**
 * Shared, restrained motion primitives so every page animates with the same
 * voice: small rises, short durations, no bounce. Consistency is what makes
 * motion feel premium rather than playful.
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
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
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
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.05, delayChildren: delay } },
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
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
