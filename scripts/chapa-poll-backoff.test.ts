/**
 * Unit tests for the Chapa return-verify polling backoff schedule.
 *
 * Source of truth: DELAYS_MS in confirmChapaReturn (src/pages/Dashboard.tsx),
 * extracted here so the schedule is tested independently of the React layer.
 *
 * Run: bun scripts/chapa-poll-backoff.test.ts
 */

import { describe, expect, test } from "bun:test";

// Mirrors DELAYS_MS in src/pages/Dashboard.tsx — keep in sync.
function nextChapaPollDelayMs(pollCount: number): number | null {
  const DELAYS_MS = [0, 2000, 4000, 6000, 8000] as const;
  return pollCount < DELAYS_MS.length ? DELAYS_MS[pollCount]! : null;
}

describe("chapa return-verify poll backoff", () => {
  test("performs exactly 5 polls, then stops", () => {
    const delays: number[] = [];
    for (let i = 0; ; i++) {
      const d = nextChapaPollDelayMs(i);
      if (d === null) break;
      delays.push(d);
    }
    expect(delays).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(delays.length).toBe(5);
  });

  test("null after the last poll — never an infinite loop", () => {
    expect(nextChapaPollDelayMs(4)).toBe(8000);
    expect(nextChapaPollDelayMs(5)).toBeNull();
    expect(nextChapaPollDelayMs(999)).toBeNull();
  });

  test("never schedules a negative delay", () => {
    for (let i = 0; i < 10; i++) {
      const d = nextChapaPollDelayMs(i);
      if (d !== null) expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  test("total wait before giving up stays under 30s", () => {
    let total = 0;
    for (let i = 0; ; i++) {
      const d = nextChapaPollDelayMs(i);
      if (d === null) break;
      total += d;
    }
    expect(total).toBeLessThan(30_000);
  });
});
