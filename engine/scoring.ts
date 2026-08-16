/**
 * Percentile rank of one impact figure against the catalogue, 0–100.
 *
 * A raw litre count means nothing to someone who has never seen another one.
 * The score answers "compared with everything else you could have eaten, where
 * does this sit?" — 0 is the lightest item in the catalogue, 100 the heaviest.
 *
 * `distribution` must be pre-sorted ascending; the caller builds it once per
 * dataset, not once per request.
 */
export function score(impactLitres: number, distribution: number[]): number {
  if (distribution.length === 0) return 0;
  const below = bisectLeft(distribution, impactLitres);
  const equal = bisectRight(distribution, impactLitres) - below;
  // Midpoint of the tied band, so identical items score identically rather than
  // depending on insertion order.
  const rank = below + equal / 2;
  const pct = Math.round((rank / distribution.length) * 100);
  return Math.min(100, Math.max(0, pct));
}

export function bisectLeft(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function bisectRight(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Litres per person per day used to translate a footprint into something a
 * person can picture. 55 LPCD is the Jal Jeevan Mission's rural domestic supply
 * benchmark — a real national service standard, not an invented yardstick.
 */
export const LPCD_BENCHMARK = 55;

export function householdDays(litres: number): number {
  return Math.max(1, Math.round(litres / LPCD_BENCHMARK));
}
