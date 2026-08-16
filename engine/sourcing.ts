import { DataMissingError } from "./errors.ts";
import { stressFactor } from "./stress.ts";
import type { GwStress, ProductionShare, SourceLine } from "./types.ts";

export const SHARE_TOLERANCE = 0.02;

/**
 * Validate and return a crop's producing states.
 *
 * Shares must sum to 1.0 ± 0.02. A crop whose shares sum to 0.6 would silently
 * under-count its footprint by 40% and still look like a plausible answer —
 * exactly the failure Rule 1 exists to prevent — so this raises rather than
 * normalising. Build-time validation catches it first; this is the runtime net
 * for data edited after the last seed.
 */
export function apportion(cropId: string, shares: ProductionShare[]): ProductionShare[] {
  if (shares.length === 0) {
    throw new DataMissingError("production_share", cropId, "no producing states");
  }
  const sum = shares.reduce((acc, s) => acc + s.share, 0);
  if (Math.abs(sum - 1.0) > SHARE_TOLERANCE) {
    throw new DataMissingError(
      "production_share",
      cropId,
      `shares sum to ${sum.toFixed(4)}, expected 1.0 ±${SHARE_TOLERANCE}`,
    );
  }
  return shares;
}

/**
 * Restrict sourcing to a single state — the `force_state` path.
 *
 * This **replaces** the national apportionment rather than re-weighting it: the
 * question it answers is "what if all of this came from Punjab?", which is how
 * the same crop can produce a different score in a stressed versus a safe
 * state. The returned share is 1.0, so the caller's arithmetic is unchanged.
 */
export function forceState(
  cropId: string,
  shares: ProductionShare[],
  state: string,
): ProductionShare[] {
  const match = shares.find((s) => s.state.toLowerCase() === state.toLowerCase());
  if (!match) {
    throw new DataMissingError("production_share", `${cropId}|${state}`, "crop is not grown there");
  }
  return [{ ...match, share: 1.0 }];
}

/**
 * Split one crop's blue water across the states that actually grow it, and
 * weight each share by that state's groundwater stress.
 *
 * This is the mechanism behind the problem statement's central claim: "the
 * impact depends on where the water is taken from". Two kilograms of rice carry
 * identical litres; the kilogram drawn from over-exploited Punjab carries more
 * *impact* than the one grown on West Bengal's rainfall.
 *
 * Weighting is at STATE level. CGWB district figures are not citeable for this
 * project, so no district number exists to weight by — see data/SOURCES.md S3.
 *
 * Green and grey water are deliberately NOT stress-weighted. Green water is
 * rainfall held in soil — it was never abstracted from an aquifer — and grey is
 * a dilution allowance, not a withdrawal. Only blue water competes with a
 * state's groundwater.
 */
export interface SourcingInput {
  crop_id: string;
  crop_name: string;
  /** Blue litres for this crop across the whole serving. */
  blue_l: number;
  shares: ProductionShare[];
  /**
   * Keyed by STATE — the resolution at which CGWB figures are citeable.
   *
   * This was keyed `district|state`, which broke the moment `gw_stress.district`
   * became the sentinel "STATE_AVERAGE": all 667 sourcing rows name a real
   * district in `rep_district` and matched nothing.
   */
  stressByState: Map<string, GwStress>;
}

export interface SourcingResult {
  lines: SourceLine[];
  /** Stress-weighted blue litres, summed over every producing state. */
  impact_blue_l: number;
}

export function sourceCrop(input: SourcingInput): SourcingResult {
  const { crop_id, crop_name, blue_l, shares, stressByState } = input;

  const lines: SourceLine[] = [];
  let impact = 0;

  for (const share of shares) {
    const stress = stressByState.get(share.state);
    if (!stress) {
      // The caller guarantees this cannot happen — repo/validate.ts fails the
      // build when a producing state is absent from gw_stress.
      throw new Error(`sourcing: no gw_stress row for state "${share.state}" (crop ${crop_id})`);
    }
    const lineBlue = blue_l * share.share;
    const lineImpact = lineBlue * stressFactor(stress.soe_pct);
    impact += lineImpact;

    lines.push({
      crop: crop_id,
      crop_name,
      state: share.state,
      district: stress.district,
      level: stress.level,
      precision: stress.precision,
      band_min: stress.band_min,
      band_max: stress.band_max,
      share: share.share,
      status: stress.category,
      soe_pct: stress.soe_pct,
      blue_l: Math.round(lineBlue),
      impact_blue_l: Math.round(lineImpact),
      lat: share.lat,
      lon: share.lon,
    });
  }

  lines.sort((a, b) => b.impact_blue_l - a.impact_blue_l);
  return { lines, impact_blue_l: impact };
}

/**
 * Fallback when a crop has no `production_share` rows: the blue water is real,
 * but we cannot say where it came from, so it is carried at a stress factor of
 * 1.0 and the caller records a fallback in `lineage.fallbacks_used`.
 */
export function unsourcedCrop(blue_l: number): SourcingResult {
  return { lines: [], impact_blue_l: blue_l };
}
