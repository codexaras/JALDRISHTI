import { allCrops, getCrop } from "../../../../repo/db.ts";
import { bad, langOf, ok } from "../../_lib/respond.ts";
import bundle from "../../../../data/generated/bundle.json" with { type: "json" };
import type { Bundle, Season } from "../../../../engine/types.ts";

/**
 * GET /api/v1/footprint?crop=&state=&season=
 *
 * PS: "readily available data of water footprints". Public, documented, no
 * auth, CORS-open. This is the clause that asks for the data to be *available*,
 * not merely displayed inside one app.
 */
const db = bundle as unknown as Bundle;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cropId = (url.searchParams.get("crop") ?? "").trim().toLowerCase();
  const state = (url.searchParams.get("state") ?? "").trim();
  const seasonParam = (url.searchParams.get("season") ?? "").trim().toLowerCase();
  const lang = langOf(url.searchParams.get("lang"));

  if (!cropId) {
    return ok({
      usage: "GET /api/v1/footprint?crop=rice&state=Punjab&season=kharif",
      units: "All footprint values are litres per kilogram (L/kg), equal to m³/tonne.",
      licence: "Derived from public sources; see citations on each response.",
      crops: allCrops().map((c) => ({
        crop_id: c.crop_id,
        name_en: c.name_en,
        category: c.category,
        is_food: c.is_food === 1,
      })),
    });
  }

  const crop = getCrop(cropId);
  if (!crop) return bad(`unknown crop "${cropId}"`, 404);

  const season: Season | null =
    seasonParam === "kharif" || seasonParam === "rabi" || seasonParam === "zaid"
      ? (seasonParam as Season)
      : null;

  const shares = db.production_share.filter((s) => s.crop_id === cropId);
  const scoped = state
    ? shares.filter((s) => s.state.toLowerCase() === state.toLowerCase())
    : shares;

  if (state && scoped.length === 0) {
    return bad(`"${cropId}" has no recorded production in "${state}"`, 404);
  }

  const stressByState = new Map(db.gw_stress.map((g) => [g.state, g]));
  const factor = season
    ? (db.season_factor.find((s) => s.season === season)?.blue_multiplier ?? 1)
    : 1;

  // The published total is conserved; only the green/blue split moves (S6).
  const blue = crop.wf_blue * factor;
  const green = crop.wf_green + (crop.wf_blue - blue);

  return ok({
    crop: {
      crop_id: crop.crop_id,
      name: { en: crop.name_en, hi: crop.name_hi, mr: crop.name_mr, ta: crop.name_ta },
      display_name: { en: crop.name_en, hi: crop.name_hi, mr: crop.name_mr, ta: crop.name_ta }[lang],
      category: crop.category,
      is_food: crop.is_food === 1,
      is_animal: crop.is_animal === 1,
    },
    units: "L/kg (== m³/tonne)",
    season: season ?? "annual",
    season_note: season
      ? "Seasonal green/blue reallocation applied; total is unchanged. See data/SOURCES.md S6."
      : "National annual average, no seasonal reallocation applied.",
    footprint_l_per_kg: {
      green: Math.round(green),
      blue: Math.round(blue),
      grey: crop.wf_grey,
      total: Math.round(green + blue + crop.wf_grey),
    },
    production: scoped
      .map((s) => {
        const stress = stressByState.get(s.state);
        return {
          state: s.state,
          share: s.share,
          representative_district: s.rep_district,
          lat: s.lat,
          lon: s.lon,
          groundwater_stage_of_extraction_pct: stress?.soe_pct ?? null,
          groundwater_category: stress?.category ?? null,
        };
      })
      .sort((a, b) => b.share - a.share),
    citations: [
      "Mekonnen & Hoekstra, 2011 — Value of Water Research Report 47, UNESCO-IHE",
      "Mekonnen & Hoekstra, 2012 — Water footprint of farm animal products",
      "CGWB — Dynamic Ground Water Resources Assessment of India",
      "Directorate of Economics & Statistics — Agricultural Statistics at a Glance",
    ],
    source_tag: crop.source,
  });
}
