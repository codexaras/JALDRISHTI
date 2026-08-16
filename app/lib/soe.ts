/**
 * How to render a stage-of-extraction figure honestly.
 *
 * AMENDMENT_07 §3. CGWB publishes a *category* for all 36 states and UTs but a
 * *percentage* for only seven. Where we hold a band midpoint, printing "35% of
 * groundwater extracted" claims a measurement that does not exist — so the band
 * itself is shown instead:
 *
 *     exact          →  "156% of groundwater extracted"
 *     band_midpoint  →  "Safe — under 70% extracted"
 *
 * One function, used by the result list, the map panel and the city screen, so
 * the three cannot drift apart and start describing the same number differently.
 */
import type { SoePrecision, StressCategory } from "../../engine/types.ts";

export interface SoeFigure {
  soe_pct: number;
  precision: SoePrecision;
  band_min: number;
  band_max: number;
  status: StressCategory;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function soeLabel(t: Translate, f: SoeFigure): string {
  if (f.precision === "exact") {
    return t("result.extracted", { pct: Math.round(f.soe_pct) });
  }

  const status = t(`status.${f.status}`);
  // The open-ended top band: CGWB's ">100%" has no published ceiling, so the
  // 160 in the data is a plotting bound, not a claim about the maximum.
  if (f.status === "over_exploited") return t("result.bandOver", { status, min: f.band_min });
  if (f.band_min === 0) return t("result.bandUnder", { status, max: f.band_max });
  return t("result.bandRange", { status, min: f.band_min, max: f.band_max });
}

/** Tooltip explaining why a band is shown rather than a number. */
export function soeNote(t: Translate, precision: SoePrecision): string | undefined {
  return precision === "band_midpoint" ? t("result.bandNote") : undefined;
}
