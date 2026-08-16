import type { StressCategory } from "./types.ts";

/**
 * Groundwater stress multiplier for a district.
 *
 * 70% is CGWB's own "Safe" ceiling for stage of groundwater extraction, which
 * is why it is the denominator. A district at or below Safe never *reduces*
 * impact — the floor is 1.0 — because withdrawing water sustainably does not
 * make the litre disappear. Above Safe, a litre of irrigation water is scored
 * proportionally harder, which is the "where the water came from" half of the
 * problem statement.
 */
export const CGWB_SAFE_THRESHOLD = 70.0;

export function stressFactor(soePct: number): number {
  return Math.max(1.0, soePct / CGWB_SAFE_THRESHOLD);
}

/** CGWB assessment bands. */
export function stressCategory(soePct: number): StressCategory {
  if (soePct > 100) return "over_exploited";
  if (soePct > 90) return "critical";
  if (soePct >= 70) return "semi_critical";
  return "safe";
}

/** Rank used to pick the "worst" contributing district. */
export const CATEGORY_RANK: Record<StressCategory, number> = {
  safe: 0,
  semi_critical: 1,
  critical: 2,
  over_exploited: 3,
};
