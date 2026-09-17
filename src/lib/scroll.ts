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
 *  - re-reads the target's position EVERY frame (moving-target anchoring), so
 *    lazy content that changes layout while scrolling can't break the landing;
 *  - respects `scroll-margin-top` already set via Tailwind `scroll-mt-*`
 *    classes — one source of truth for header offsets;
 *  - cancels instantly on wheel/touch/keyboard input: motion must never fight
 *    the user's finger (master doc §24);
 *  - collapses under `prefers-reduced-motion` to an instant, respectful jump;
 *  - a new call cancels the previous animation (rapid tab taps never fight).
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
    window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top - scrollMarginTop(target));
    return;
  }

  const token = ++activeToken;
  const startY = window.scrollY;

  const targetY = (): number =>
    Math.max(
      0,
      startY + target.getBoundingClientRect().top - (opts?.offset ?? scrollMarginTop(target)),
    );

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

  const startTime = performance.now();
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
    const p = Math.min(1, (now - startTime) / duration);
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
