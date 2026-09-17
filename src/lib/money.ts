/**
 * LUBA money library - spec §7.
 * ALL monetary values are integers in santims (1 ETB = 100 santims).
 * No floats. Ever. (Builder Rule 6)
 */

export const SANTIMS_PER_ETB = 100;

/** Format integer santims → display string, e.g. 1050 → "10.50" */
export function formatSantims(santims: number): string {
  const sign = santims < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(santims));
  const etb = Math.floor(abs / SANTIMS_PER_ETB);
  const rem = abs % SANTIMS_PER_ETB;
  return `${sign}${etb}.${String(rem).padStart(2, "0")}`;
}

/** Format integer santims → display with currency, e.g. 1050 → "10.50 ETB" */
export function formatETB(santims: number): string {
  return `${formatSantims(santims)} ETB`;
}

/** Parse a user-entered ETB string ("10.50") → integer santims, or null if invalid. */
export function parseETBToSantims(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const santims = Number(whole) * SANTIMS_PER_ETB + Number((frac + "00").slice(0, 2));
  return Number.isInteger(santims) ? santims : null;
}

/** All amounts must be positive integers. */
export function isValidAmount(santims: number): boolean {
  return Number.isInteger(santims) && santims > 0;
}

/** Check a bid value conforms to the auction's increment grid anchored at min. */
export function conformsToIncrement(
  bidSantims: number,
  minSantims: number,
  incrementSantims: number,
): boolean {
  if (!isValidAmount(bidSantims)) return false;
  if (incrementSantims <= 0) return true;
  return (bidSantims - minSantims) % incrementSantims === 0;
}
