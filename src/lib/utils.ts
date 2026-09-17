import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** First-name + last-initial masking for public winner displays. The ledger
 *  is public, so winners are credited without exposing full names. Shared by
 *  the landing settlement record and the Winners page - one masking rule. */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return `${parts[0].slice(0, 2)}***`;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
