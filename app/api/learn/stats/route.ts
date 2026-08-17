import { allDistricts, getCrop } from "../../../../repo/db.ts";
import { bad, ok } from "../../_lib/respond.ts";

/**
 * GET /api/learn/stats?crops=rice,pearl_millet&states=Punjab,West%20Bengal
 *
 * Live figures for the Learn section — AMENDMENT_14 §2.
 *
 * The Learn pages carry NO numeric literals. Every figure they show is fetched
 * here, straight from the same bundle the calculator reads, so a lesson can
 * never drift out of agreement with a scan. A crop or state that is not in the
 * data is reported missing rather than approximated (R1).
 *
 * Values are the published crop figures in L/kg (== m³/tonne, no conversion),
 * exactly as crop.csv holds them.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cropIds = (url.searchParams.get("crops") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const stateNames = (url.searchParams.get("states") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (cropIds.length === 0 && stateNames.length === 0) {
    return bad("provide ?crops= and/or ?states=");
  }

  const crops: Record<string, { green: number; blue: number; grey: number; total: number; source: string }> = {};
  const missing: string[] = [];

  for (const id of cropIds) {
    const crop = getCrop(id);
    if (!crop) {
      missing.push(`crop:${id}`);
      continue;
    }
    crops[id] = {
      green: crop.wf_green,
      blue: crop.wf_blue,
      grey: crop.wf_grey,
      total: crop.wf_green + crop.wf_blue + crop.wf_grey,
      source: crop.source,
    };
  }

  const byState = new Map(allDistricts().map((g) => [g.state.toLowerCase(), g]));
  const states: Record<
    string,
    { soe_pct: number; category: string; precision: string; band_min: number; band_max: number; source: string }
  > = {};
  for (const name of stateNames) {
    const g = byState.get(name.toLowerCase());
    if (!g) {
      missing.push(`state:${name}`);
      continue;
    }
    states[g.state] = {
      soe_pct: g.soe_pct,
      category: g.category,
      precision: g.precision,
      band_min: g.band_min,
      band_max: g.band_max,
      source: g.source,
    };
  }

  return ok({ crops, states, missing });
}
