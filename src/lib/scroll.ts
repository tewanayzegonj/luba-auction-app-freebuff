/**
 * The app's single scroll animation — one feel, everywhere.
 *
 * Why not `scrollIntoView({ behavior: "smooth" })`:
 *  - the browser picks the duration/easing (Chrome ~500ms linear-ish, Safari
 *    instant-ish) so the app feels different per device;
 *  - it scrolls EVERY scrollable ancestor, so nested containers fight it;
 *  - it can't adapt when content above the target loads mid-scroll — with
 *    skeletons swapping to tables, the landing point drifts (the janky stop).
 *
 * This engine:
 *  - animates `window.scrollY` with easeOutQuint (fast departure, long silky
 *    settle — the iOS-feel curve), duration scaled to distance;
 *  - runs frame-ALIGNED (progress counts animation frames, not raw elapsed
 *    ms): on 90/120Hz phones the curve plays at the same speed as 60Hz, and
 *    on a dropped frame the animation slows instead of jumping — perceived
 *    smoothness over stopwatch accuracy;
 *  - re-reads the target's position EVERY frame (moving-target anchoring), so
 *    lazy content that changes layout while scrolling can't break the landing;
 *  - respects `scroll-margin-top` already set via Tailwind `scroll-mt-*`
 *    classes — one source of truth for header offsets;
 *  - cancels instantly on wheel/touch/keyboard input: motion must never fight
 *    the user's finger (master doc §24);
 *  - collapses under `prefers-reduced-motion` to an instant, respectful jump;
 *  - a new call cancels the previous animation (rapid tab taps never fight).
 *
 * Route transitions (fadeNavigate): the other half of "smooth". Pages used to
 * RISE on entrance (y: 10–24px) — every navigation re-staged a vertical move
 * right as you landed, which reads as a jerk, not polish. The canon fix:
 * navigation never moves the page. The old view fades out (130ms), the router
 * swaps underneath while scrolled to top, the new view fades in (140ms).
 * Opacity only — the two cheapest properties a GPU can animate.
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

  // Reduced motion: honor the OS preference — land immediately, no glide.
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
    // Element can unmount mid-flight (tab switched away) — end gracefully.
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

// ─── Route crossfade ─────────────────────────────────────────────────────────

/** Milliseconds for the out/in halves of the route crossfade. Kept just under
 *  the 150ms "instant" ceiling so navigation never feels gated behind motion. */
const FADE_OUT_MS = 130;
const FADE_IN_MS = 140;

/** The root element the router renders into (index.html `<div id="root">`). */
function routeRoot(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.getElementById("root");
}

/** True while a navigation crossfade is holding the scroll position. */
let navLock = false;

/**
 * Navigate with a crossfade instead of an instant swap (and instead of the
 * old page-rise entrance). Locks the viewport during the swap so the new
 * page can never paint at the previous scroll offset.
 *
 * Falls back to a plain `navigate(to)` when motion is reduced or the root
 * element isn't mounted yet — correctness never depends on the effect.
 */
export function fadeNavigate(
  navigate: (to: string, opts?: { replace?: boolean }) => void,
  to: string,
  opts?: { replace?: boolean },
): void {
  const root = routeRoot();

  if (
    typeof window === "undefined" ||
    prefersReducedMotion() ||
    !root
  ) {
    navigate(to, opts);
    return;
  }

  navLock = true;
  root.style.transition = `opacity ${FADE_OUT_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  root.style.opacity = "0";

  // Hash targets (/#auctions) position via HashScroll's section glide after
  // the swap — resetting to top here would fight it mid-flight.
  const hasHash = to.includes("#") && !to.endsWith("#");

  window.setTimeout(() => {
    navigate(to, opts);
    // The router swaps synchronously with navigate(); one double-rAF lands
    // us after the new page's first paint, then we release the lock and
    // fade the new view in from a clean, top-anchored state.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!hasHash) window.scrollTo(0, 0);
        root.style.transition = `opacity ${FADE_IN_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        root.style.opacity = "1";
        navLock = false;
        // Drop the inline transition once done so theme switches and other
        // opacity work aren't haunted by a lingering transition rule.
        window.setTimeout(() => {
          if (root.style.opacity === "1") {
            root.style.transition = "";
          }
        }, FADE_IN_MS + 60);
      });
    });
  }, FADE_OUT_MS);
}

/** Called by the router-sync component: while a crossfade holds the viewport,
 *  external scroll resets (react-router hashes, browser restore) must not
 *  yank the page mid-fade. */
export function isNavLocked(): boolean {
  return navLock;
}

/** App-wide crossfade navigation — the single entry point every internal
 *  navigation that isn't a `<Link>` goes through, so route changes share
 *  one motion voice: fade out 130ms → swap at top → fade in 140ms.
 *  Browser back/forward keeps instant native behavior (the expected
 *  mental model for history motion). */
export function navigateTo(
  navigate: (to: string, opts?: { replace?: boolean }) => void,
  to: string,
  opts?: { replace?: boolean },
): void {
  fadeNavigate(navigate, to, opts);
}
