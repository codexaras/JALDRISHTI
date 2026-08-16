import type { Season } from "./types.ts";

/**
 * Month (1–12) → Indian cropping season.
 *
 * Kharif  Jun–Oct  (monsoon-sown)
 * Rabi    Nov–Mar  (winter-sown)
 * Zaid    Apr–May  (short summer crop)
 */
export function seasonForMonth(month: number): Season {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month must be an integer 1–12, got ${month}`);
  }
  if (month >= 6 && month <= 10) return "kharif";
  if (month >= 11 || month <= 3) return "rabi";
  return "zaid";
}
