import bundle from "../../../../data/generated/bundle.json" with { type: "json" };
import type { Bundle } from "../../../../engine/types.ts";

/**
 * GET /api/v1/export.csv — the whole dataset, downloadable.
 *
 * PS: "readily available data of water footprints". A JSON endpoint serves
 * developers; a CSV serves the researcher, the journalist and the officer with
 * a spreadsheet, which is most of the people who would actually use this.
 *
 * `?table=` selects one table; omitted, it returns the crop table with its
 * groundwater context joined in — the sheet people actually want.
 */
const db = bundle as unknown as Bundle;

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
}

const TABLES: Record<string, () => Record<string, unknown>[]> = {
  crop: () => db.crop as unknown as Record<string, unknown>[],
  production_share: () => db.production_share as unknown as Record<string, unknown>[],
  gw_stress: () => db.gw_stress as unknown as Record<string, unknown>[],
  product: () => db.product as unknown as Record<string, unknown>[],
  product_ingredient: () => db.product_ingredient as unknown as Record<string, unknown>[],
  substitution: () => db.substitution as unknown as Record<string, unknown>[],
  city_water: () => db.city_water as unknown as Record<string, unknown>[],
  equivalence: () => db.equivalence as unknown as Record<string, unknown>[],
  season_factor: () => db.season_factor as unknown as Record<string, unknown>[],
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const table = (url.searchParams.get("table") ?? "").trim();

  let rows: Record<string, unknown>[];
  let filename: string;

  if (table && TABLES[table]) {
    rows = TABLES[table]();
    filename = `jaldrishti_${table}.csv`;
  } else if (table) {
    return new Response(`unknown table "${table}". Available: ${Object.keys(TABLES).join(", ")}\n`, {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } else {
    // Default sheet: every crop, with the states that grow it and the
    // groundwater status of each representative district.
    const stress = new Map(db.gw_stress.map((g) => [`${g.district}|${g.state}`, g]));
    rows = db.production_share.map((s) => {
      const crop = db.crop.find((c) => c.crop_id === s.crop_id);
      const gw = stress.get(`${s.rep_district}|${s.state}`);
      return {
        crop_id: s.crop_id,
        crop_name_en: crop?.name_en ?? "",
        category: crop?.category ?? "",
        is_food: crop?.is_food ?? "",
        wf_green_l_per_kg: crop?.wf_green ?? "",
        wf_blue_l_per_kg: crop?.wf_blue ?? "",
        wf_grey_l_per_kg: crop?.wf_grey ?? "",
        state: s.state,
        production_share: s.share,
        representative_district: s.rep_district,
        lat: s.lat,
        lon: s.lon,
        gw_stage_of_extraction_pct: gw?.soe_pct ?? "",
        gw_category: gw?.category ?? "",
        source: crop?.source ?? "",
      };
    });
    filename = "jaldrishti_footprints.csv";
  }

  const header = [
    "# Jal Drishti open water-footprint dataset",
    "# All footprint columns are litres per kilogram (L/kg), equal to m3/tonne.",
    "# Sources: Mekonnen & Hoekstra 2011/2012; CGWB Dynamic Ground Water Resources Assessment;",
    "#          Agricultural Statistics at a Glance. See data/SOURCES.md for per-row tags.",
    `# Generated ${db.built_at}`,
  ].join("\n");

  return new Response(`${header}\n${toCsv(rows)}\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}
