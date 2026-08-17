/**
 * CSV → bundle.json + seed.sql
 *
 * BUILD_SPEC phase 1 specifies SQLite. This app deploys as a Cloudflare Worker,
 * where the equivalent store is D1 — so this script emits BOTH:
 *
 *   data/generated/bundle.json  the dataset the Worker imports directly
 *   data/generated/seed.sql     the same rows as SQL, against the spec's schema
 *
 * The Worker reads the bundle (no I/O at request time, works offline, which is
 * also what makes demo mode reliable). `seed.sql` keeps the D1/SQLite path open
 * and lets anyone diff the data in a familiar form.
 *
 * Run: npm run data:seed
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseCsv, num, numOr, type Row } from "./csv.ts";
import type {
  Alias,
  Bundle,
  Category,
  CategoryAverage,
  CityWater,
  Crop,
  CropState,
  Equivalence,
  GwStress,
  Lang,
  OffIngredientMap,
  Product,
  ProductIngredient,
  ProductionShare,
  ScanLog,
  Season,
  SeasonFactor,
  StressCategory,
  Substitution,
  YieldRow,
} from "../engine/types.ts";

const DATA_DIR = join(process.cwd(), "data");
const OUT_DIR = join(DATA_DIR, "generated");

function read(file: string): Row[] {
  return parseCsv(readFileSync(join(DATA_DIR, file), "utf8"));
}

function at(file: string, i: number) {
  return `${file} row ${i + 2}`;
}

export function buildBundle(): Bundle {
  const crop: Crop[] = read("crop.csv").map((r, i) => ({
    crop_id: r.crop_id,
    name_en: r.name_en,
    name_hi: r.name_hi,
    name_mr: r.name_mr,
    name_ta: r.name_ta,
    category: r.category as Category,
    // L/kg — identical to m³/tonne. Read straight across, no conversion (rule 2.2).
    wf_green: num(r, "wf_green", "crop.csv", at("crop.csv", i)),
    wf_blue: num(r, "wf_blue", "crop.csv", at("crop.csv", i)),
    wf_grey: num(r, "wf_grey", "crop.csv", at("crop.csv", i)),
    is_animal: numOr(r, "is_animal", 0),
    is_food: numOr(r, "is_food", 1),
    // Animal crops default hidden: their figures are uncited (M&H 2011 covers
    // crops only). Derived so /data stays human-owned — an explicit is_visible
    // column in the CSV overrides this either way.
    is_visible: numOr(r, "is_visible", numOr(r, "is_animal", 0) === 1 ? 0 : 1),
    source: r.source,
  }));

  // Table 2 of the same paper. Crops it does not break out individually cite a
  // row here instead of a reconstructed number — see validate.ts, which checks
  // that every ":table2-category" crop actually matches one of these rows.
  const category_average: CategoryAverage[] = read("category_average.csv").map((r, i) => ({
    category_id: r.category_id,
    label_en: r.label_en,
    wf_green: num(r, "wf_green", "category_average.csv", at("category_average.csv", i)),
    wf_blue: num(r, "wf_blue", "category_average.csv", at("category_average.csv", i)),
    wf_grey: num(r, "wf_grey", "category_average.csv", at("category_average.csv", i)),
    wf_total: num(r, "wf_total", "category_average.csv", at("category_average.csv", i)),
    source: r.source,
  }));

  const crop_state: CropState[] = read("crop_state.csv").map((r, i) => ({
    crop_id: r.crop_id,
    state: r.state,
    season: r.season as Season,
    wf_green: num(r, "wf_green", "crop_state.csv", at("crop_state.csv", i)),
    wf_blue: num(r, "wf_blue", "crop_state.csv", at("crop_state.csv", i)),
    wf_grey: num(r, "wf_grey", "crop_state.csv", at("crop_state.csv", i)),
    source: r.source,
  }));

  const production_share: ProductionShare[] = read("production_share.csv").map((r, i) => ({
    crop_id: r.crop_id,
    state: r.state,
    share: num(r, "share", "production_share.csv", at("production_share.csv", i)),
    rep_district: r.rep_district,
    lat: num(r, "lat", "production_share.csv", at("production_share.csv", i)),
    lon: num(r, "lon", "production_share.csv", at("production_share.csv", i)),
    source: r.source,
  }));

  const gw_stress: GwStress[] = read("gw_stress.csv").map((r, i) => ({
    district: r.district,
    state: r.state,
    soe_pct: num(r, "soe_pct", "gw_stress.csv", at("gw_stress.csv", i)),
    category: r.category as StressCategory,
    band_min: num(r, "band_min", "gw_stress.csv", at("gw_stress.csv", i)),
    band_max: num(r, "band_max", "gw_stress.csv", at("gw_stress.csv", i)),
    assessment_year: num(r, "assessment_year", "gw_stress.csv", at("gw_stress.csv", i)),
    precision: r.precision === "exact" ? "exact" : "band_midpoint",
    // Derived, not stored: the sentinel is what says "no district figure here".
    level: r.district === "STATE_AVERAGE" ? "state" : "district",
    source: r.source,
  }));

  const product: Product[] = read("product.csv").map((r, i) => ({
    product_id: r.product_id,
    name_en: r.name_en,
    name_hi: r.name_hi,
    name_mr: r.name_mr,
    name_ta: r.name_ta,
    type: r.type as Product["type"],
    default_serving_g: num(r, "default_serving_g", "product.csv", at("product.csv", i)),
    // Absent column means visible — adding the flag must not hide everything.
    is_visible: numOr(r, "is_visible", 1),
    source: r.source,
  }));

  const product_ingredient: ProductIngredient[] = read("product_ingredient.csv").map((r, i) => ({
    product_id: r.product_id,
    crop_id: r.crop_id,
    raw_grams_per_100g: num(
      r,
      "raw_grams_per_100g",
      "product_ingredient.csv",
      at("product_ingredient.csv", i),
    ),
    yield_fraction: numOr(r, "yield_fraction", 1.0),
    source: r.source,
  }));

  const alias: Alias[] = read("alias.csv").map((r) => ({
    alias_text: r.alias_text,
    norm_text: r.norm_text,
    lang: r.lang as Lang,
    product_id: r.product_id,
  }));

  const substitution: Substitution[] = read("substitution.csv").map((r, i) => ({
    from_crop: r.from_crop,
    to_crop: r.to_crop,
    message_key: r.message_key,
    rank: num(r, "rank", "substitution.csv", at("substitution.csv", i)),
  }));

  const yieldRows: YieldRow[] = read("yield.csv").map((r, i) => ({
    process_id: r.process_id,
    from_crop: r.from_crop,
    to_label: r.to_label,
    yield_fraction: num(r, "yield_fraction", "yield.csv", at("yield.csv", i)),
    source: r.source,
  }));

  const season_factor: SeasonFactor[] = read("season_factor.csv").map((r, i) => ({
    season: r.season as Season,
    blue_multiplier: num(r, "blue_multiplier", "season_factor.csv", at("season_factor.csv", i)),
    note: r.note,
    source: r.source,
  }));

  const equivalence: Equivalence[] = read("equivalence.csv").map((r, i) => ({
    eq_id: r.eq_id,
    litres_per_unit: num(r, "litres_per_unit", "equivalence.csv", at("equivalence.csv", i)),
    message_key: r.message_key,
    min_litres: num(r, "min_litres", "equivalence.csv", at("equivalence.csv", i)),
    source: r.source,
  }));

  const city_water: CityWater[] = read("city_water.csv").map((r, i) => ({
    city: r.city,
    state: r.state,
    reservoir: r.reservoir,
    pct: num(r, "pct", "city_water.csv", at("city_water.csv", i)),
    capacity_ml: num(r, "capacity_ml", "city_water.csv", at("city_water.csv", i)),
    overflowing: numOr(r, "overflowing", 0),
    updated_on: r.updated_on,
    source: r.source,
  }));

  const scan_log: ScanLog[] = read("scan_log.csv").map((r, i) => ({
    scan_id: r.scan_id,
    product_id: r.product_id,
    region: r.region,
    litres: num(r, "litres", "scan_log.csv", at("scan_log.csv", i)),
    score: num(r, "score", "scan_log.csv", at("scan_log.csv", i)),
    ts: r.ts,
  }));

  const off_ingredient_map: OffIngredientMap[] = read("off_ingredient_map.csv").map((r, i) => ({
    off_tag: r.off_tag,
    crop_id: r.crop_id,
    yield_fraction: num(
      r,
      "yield_fraction",
      "off_ingredient_map.csv",
      at("off_ingredient_map.csv", i),
    ),
    source: r.source,
  }));

  return {
    crop,
    category_average,
    crop_state,
    production_share,
    gw_stress,
    product,
    product_ingredient,
    alias,
    substitution,
    yield: yieldRows,
    season_factor,
    equivalence,
    city_water,
    scan_log,
    off_ingredient_map,
    built_at: new Date().toISOString(),
  };
}

// ─── SQL emitter (spec schema, verbatim) ────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS crop (
  crop_id TEXT PRIMARY KEY, name_en TEXT, name_hi TEXT, name_mr TEXT, name_ta TEXT,
  category TEXT,                    -- cereal|pulse|vegetable|fruit|oilseed|animal|fibre|beverage|sugar
  wf_green REAL,                    -- L/kg  (== m³/tonne, DO NOT CONVERT)
  wf_blue  REAL,                    -- L/kg
  wf_grey  REAL,                    -- L/kg
  is_animal INTEGER DEFAULT 0,
  is_food INTEGER DEFAULT 1         -- 0 for cotton, jute etc.
);
CREATE TABLE IF NOT EXISTS crop_state (
  crop_id TEXT, state TEXT, season TEXT, wf_green REAL, wf_blue REAL, wf_grey REAL,
  PRIMARY KEY (crop_id, state, season)
);
CREATE TABLE IF NOT EXISTS production_share (
  crop_id TEXT, state TEXT, share REAL, rep_district TEXT, lat REAL, lon REAL
);
CREATE TABLE IF NOT EXISTS gw_stress (
  district TEXT,                    -- holds the STATE name; no citeable district figure exists
  state TEXT, soe_pct REAL, category TEXT,
  level TEXT DEFAULT 'state',       -- 'state' | 'district'
  PRIMARY KEY (district, state)
);
CREATE TABLE IF NOT EXISTS product (
  product_id TEXT PRIMARY KEY, name_en TEXT, name_hi TEXT, name_mr TEXT, name_ta TEXT,
  type TEXT, default_serving_g REAL
);
CREATE TABLE IF NOT EXISTS product_ingredient (
  product_id TEXT, crop_id TEXT, raw_grams_per_100g REAL, yield_fraction REAL DEFAULT 1.0
);
CREATE TABLE IF NOT EXISTS alias (
  alias_text TEXT, norm_text TEXT, lang TEXT, product_id TEXT
);
CREATE TABLE IF NOT EXISTS substitution (
  from_crop TEXT, to_crop TEXT, message_key TEXT, rank INTEGER
);
CREATE TABLE IF NOT EXISTS city_water (
  city TEXT, reservoir TEXT, pct REAL, capacity_ml REAL,
  overflowing INTEGER DEFAULT 0, updated_on TEXT,
  PRIMARY KEY (city, reservoir)
);
CREATE TABLE IF NOT EXISTS equivalence (
  eq_id TEXT PRIMARY KEY, litres_per_unit REAL, message_key TEXT, min_litres REAL
);
CREATE TABLE IF NOT EXISTS scan_log (              -- powers /community/aggregate
  scan_id TEXT PRIMARY KEY, product_id TEXT, region TEXT,
  litres REAL, score INTEGER, ts TEXT
);                                   -- region only. NO personal identifiers, ever.
CREATE TABLE IF NOT EXISTS season_factor (
  season TEXT PRIMARY KEY, blue_multiplier REAL, note TEXT
);
CREATE TABLE IF NOT EXISTS off_ingredient_map (
  off_tag TEXT PRIMARY KEY, crop_id TEXT, yield_fraction REAL DEFAULT 1.0
);
CREATE INDEX IF NOT EXISTS idx_alias_norm ON alias(norm_text);
CREATE INDEX IF NOT EXISTS idx_prodingr ON product_ingredient(product_id);
`.trim();

const q = (v: string | number) =>
  typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

function insert<T extends object>(table: string, cols: string[], rows: T[]): string {
  if (rows.length === 0) return `-- ${table}: no rows\n`;
  const values = rows
    .map((r) => `  (${cols.map((c) => q((r as Record<string, unknown>)[c] as string | number)).join(", ")})`)
    .join(",\n");
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES\n${values};\n`;
}

export function buildSql(b: Bundle): string {
  return [
    "-- Generated by repo/seed.ts. Do not edit; edit /data/*.csv and re-run.",
    SCHEMA,
    "",
    insert(
      "crop",
      ["crop_id", "name_en", "name_hi", "name_mr", "name_ta", "category", "wf_green", "wf_blue", "wf_grey", "is_animal", "is_food"],
      b.crop,
    ),
    insert("crop_state", ["crop_id", "state", "season", "wf_green", "wf_blue", "wf_grey"], b.crop_state),
    insert("production_share", ["crop_id", "state", "share", "rep_district", "lat", "lon"], b.production_share),
    insert("gw_stress", ["district", "state", "soe_pct", "category", "level"], b.gw_stress),
    insert(
      "product",
      ["product_id", "name_en", "name_hi", "name_mr", "name_ta", "type", "default_serving_g"],
      b.product,
    ),
    insert("product_ingredient", ["product_id", "crop_id", "raw_grams_per_100g", "yield_fraction"], b.product_ingredient),
    insert("alias", ["alias_text", "norm_text", "lang", "product_id"], b.alias),
    insert("substitution", ["from_crop", "to_crop", "message_key", "rank"], b.substitution),
    insert("city_water", ["city", "reservoir", "pct", "capacity_ml", "overflowing", "updated_on"], b.city_water),
    insert("equivalence", ["eq_id", "litres_per_unit", "message_key", "min_litres"], b.equivalence),
    insert("scan_log", ["scan_id", "product_id", "region", "litres", "score", "ts"], b.scan_log),
    insert("season_factor", ["season", "blue_multiplier", "note"], b.season_factor),
    insert("off_ingredient_map", ["off_tag", "crop_id", "yield_fraction"], b.off_ingredient_map),
  ].join("\n");
}

function main() {
  const bundle = buildBundle();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "bundle.json"), JSON.stringify(bundle, null, 0), "utf8");
  writeFileSync(join(OUT_DIR, "seed.sql"), buildSql(bundle), "utf8");

  const counts = Object.entries(bundle)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
    .join("  ");
  console.log(`seeded  ${counts}`);
  console.log(`wrote   data/generated/bundle.json`);
  console.log(`wrote   data/generated/seed.sql`);
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, "/")) main();
else if (process.argv[1]?.endsWith("seed.ts")) main();
