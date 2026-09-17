/**
 * The app's single scroll animation - one feel, everywhere.
 *
 * Why not `scrollIntoView({ behavior: "smooth" })`:
 *  - the browser picks the duration/easing (Chrome ~500ms linear-ish, Safari
 *    instant-ish) so the app feels different per device;
 *  - it scrolls EVERY scrollable ancestor, so nested containers fight it;
 *  - it can't adapt when content above the target loads mid-scroll - with
 *    skeletons swapping to tables, the landing point drifts (the janky stop).
 *
 * This engine:
 *  - animates `window.scrollY` with easeOutQuint (fast departure, long silky
 *    settle - the iOS-feel curve), duration scaled to distance;
 *  - runs frame-ALIGNED (progress counts animation frames, not raw elapsed
 *    ms): on 90/120Hz phones the curve plays at the same speed as 60Hz, and
 *    on a dropped frame the animation slows instead of jumping - perceived
 *    smoothness over stopwatch accuracy;
 *  - re-reads the target's position EVERY frame (moving-target anchoring), so
 *    lazy content that changes layout while scrolling can't break the landing;
 *  - respects `scroll-margin-top` already set via Tailwind `scroll-mt-*`
 *    classes - one source of truth for header offsets;
 *  - cancels instantly on wheel/touch/keyboard input: motion must never fight
 *    the user's finger (master doc §24);
 *  - collapses under `prefers-reduced-motion` to an instant, respectful jump;
 *  - a new call cancels the previous animation (rapid tab taps never fight).
 *
 * Route transitions (fadeNavigate): the other half of "smooth". Pages used to
 * RISE on entrance (y: 10-24px) - every navigation re-staged a vertical move
 * right as you landed, which reads as a jerk, not polish. The canon fix:
 * navigation never moves the page.
 */

let activeToken = 0;

function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

function scrollMarginTop(el: HTMLElement): number {
  const v = getComputedStyle(el).scrollMarginTop;
  const px = parseFloat(v);
  return Number.isFinite(px) ? px : 0;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function smoothScrollTo(
  target: HTMLElement,
  opts?: { offset?: number; duration?: number },
): void {
  if (typeof window === "undefined") return;

  // Reduced motion: honor the OS preference - land immediately, no glide.
  if (prefersReducedMotion()) {
    window.scrollTo(
      0,
      window.scrollY + target.getBoundingClientRect().top - scrollMarginTop(target),
    );
    return;
  }

  const token = ++activeToken;
  const startY = window.scrollY;

  const targetY = (): number =>
    Math.max(
      0,
      startY +
        target.getBoundingClientRect().top -
        (opts?.offset ?? scrollMarginTop(target)),
    );

  // Zero-distance no-op: don't spin a rAF loop (and don't cancel a glide
  // that's already heading somewhere) for a target we're already at.
  if (Math.abs(targetY() - startY) < 1) return;

  const distance = Math.abs(targetY() - startY);
  // Short hops stay snappy; long jumps get room to breathe and settle.
  const duration =
    opts?.duration ?? Math.min(700, Math.max(400, 260 + distance * 0.12));

  const stop = () => {
    window.removeEventListener("wheel", cancel);
    window.removeEventListener("touchstart", cancel);
    window.removeEventListener("keydown", cancel);
  };
  const cancel = () => {
    activeToken++; // any user input owns the viewport from here on
    stop();
  };
  window.addEventListener("wheel", cancel, { passive: true });
  window.addEventListener("touchstart", cancel, { passive: true });
  window.addEventListener("keydown", cancel);

  const start = performance.now();
  const FPS = 60;
  const step = (now: number) => {
    if (token !== activeToken) {
      stop();
      return;
    }
    // Element can unmount mid-flight (tab switched away) - end gracefully.
    if (!target.isConnected) {
      stop();
      return;
    }
    // Frame-aligned progress: counts 60fps-equivalent frames, not raw ms.
    const frame = ((now - start) / 1000) * FPS;
    const totalFrames = (duration / 1000) * FPS;
    const p = Math.min(1, frame / totalFrames);
    const y = startY + (targetY() - startY) * easeOutQuint(p);
    window.scrollTo(0, y);
    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      stop();
    }
  };
  requestAnimationFrame(step);
}

// ─── Route transitions: native View Transitions ──────────────────────────────

/**
 * Navigate through the browser's own crossfade (View Transitions API) instead
 * of an instant swap. Why this replaced the hand-rolled root-opacity fade:
 *
 *  - The old fade went content → BLANK → content: root opacity hit 0 between
 *    the halves, a visible flash on every navigation.
 *  - It relied on timers + double-rAF to swap, reset scroll, and release - on
 *    a slow frame the sequencing drifted and the new page painted at the old
 *    scroll offset for a frame: the persistent navigation jerk.
 *
 * startViewTransition has none of those seams. The browser snapshots the old
 * page, runs the router update INSIDE the transition callback (layout
 * effects - including the scroll-to-top reset - execute while the old
 * snapshot is still on screen, so the reset is structurally invisible),
 * snapshots the new page, and crossfades. The intermediate state that caused
 * the jerk can never be painted, by construction. Browsers without the API
 * fall back to an instant navigation; reduced-motion users get instant too.
 *
 * The animation itself is defined in CSS (`::view-transition-old(root)` /
 * `::view-transition-new(root)` in index.css) - declarative, and it composes
 * with the reduced-motion media query in one place.
 */
export function fadeNavigate(
  navigate: (
    to: string,
    opts?: { replace?: boolean; viewTransition?: boolean },
  ) => void,
  to: string,
  opts?: { replace?: boolean },
): void {
  if (typeof window === "undefined" || prefersReducedMotion()) {
    navigate(to, opts);
    return;
  }
  navigate(to, { ...opts, viewTransition: true });
}

/** Semantic alias used by the tab bar / header call sites - same transition,
 *  one name at call sites that mean "go to this route". */
export const navigateTo = fadeNavigate;

/** Obsolete since the View Transitions migration, kept for the HashScroll
 *  call site. The old root-opacity fade needed a lock because its reset ran
 *  AFTER the new page painted. With view transitions, HashScroll's
 *  useLayoutEffect reset executes INSIDE startViewTransition's update
 *  callback - before the new snapshot is taken - so the reset is invisible
 *  by construction and no lock is needed. Always false. */
export function isNavLocked(): boolean {
  return false;
}
