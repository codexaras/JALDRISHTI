/**
 * Data access. BUILD_SPEC rule 4: all of it lives here, none of it in `engine/`.
 *
 * The dataset is imported as a build-time bundle rather than queried over the
 * wire, so a request does zero I/O. That is also what lets demo mode work with
 * the venue WiFi unplugged.
 */
import bundle from "../data/generated/bundle.json" with { type: "json" };
import { DataMissingError } from "../engine/errors.ts";
import { calculate, type EngineInput } from "../engine/pipeline.ts";
import { stressCategory } from "../engine/stress.ts";
import type {
  Bundle,
  CalculationResult,
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
  Quality,
  ScanLog,
  Season,
  Substitution,
} from "../engine/types.ts";

const db = bundle as unknown as Bundle;

// ─── Indexes, built once per isolate ────────────────────────────────────────

function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

const cropById = new Map<string, Crop>(db.crop.map((c) => [c.crop_id, c]));
const productById = new Map<string, Product>(db.product.map((p) => [p.product_id, p]));
const ingredientsByProduct = groupBy<ProductIngredient, string>(db.product_ingredient, (i) => i.product_id);
const sharesByCrop = groupBy<ProductionShare, string>(db.production_share, (s) => s.crop_id);
const substitutionsByCrop = groupBy<Substitution, string>(db.substitution, (s) => s.from_crop);
// Keyed by state: CGWB figures are citeable at state resolution, and
// gw_stress.district is the sentinel "STATE_AVERAGE".
const stressByState = new Map<string, GwStress>(db.gw_stress.map((g) => [g.state, g]));
const cropStateByKey = new Map<string, CropState>(
  db.crop_state.map((c) => [`${c.crop_id}|${c.state}|${c.season}`, c]),
);
const seasonFactors = new Map<Season, number>(
  db.season_factor.map((s) => [s.season, s.blue_multiplier]),
);
const offTagToCrop = new Map<string, OffIngredientMap>(
  db.off_ingredient_map.map((m) => [m.off_tag, m]),
);

export const LANGS: Lang[] = ["en", "hi", "mr", "ta"];

export function productName(p: Product, lang: Lang): string {
  const byLang: Record<Lang, string> = {
    en: p.name_en,
    hi: p.name_hi,
    mr: p.name_mr,
    ta: p.name_ta,
  };
  return byLang[lang] || p.name_en;
}

export function cropName(c: Crop, lang: Lang): string {
  const byLang: Record<Lang, string> = {
    en: c.name_en,
    hi: c.name_hi,
    mr: c.name_mr,
    ta: c.name_ta,
  };
  return byLang[lang] || c.name_en;
}

// ─── missing.log sink ───────────────────────────────────────────────────────

/**
 * A Worker cannot append to a file, so misses are collected in memory and
 * exposed on `/api/health`. In Node (`npm run data:validate`, tests) the sink is
 * swapped for one that writes `data/missing.log`.
 */
const misses: string[] = [];
let sink: (line: string) => void = (line) => {
  misses.push(line);
};

export function setMissingSink(fn: (line: string) => void) {
  sink = fn;
}
export function recordedMisses(): string[] {
  return [...misses];
}
export function logMissing(err: DataMissingError, when = new Date().toISOString()) {
  sink(err.toLogLine(when));
}

// ─── Lookups ────────────────────────────────────────────────────────────────

export function getProduct(productId: string): Product {
  const p = productById.get(productId);
  if (!p) {
    const err = new DataMissingError("product", productId);
    logMissing(err);
    throw err;
  }
  return p;
}

export function getIngredients(productId: string): ProductIngredient[] {
  const rows = ingredientsByProduct.get(productId);
  if (!rows || rows.length === 0) {
    const err = new DataMissingError("product_ingredient", productId);
    logMissing(err);
    throw err;
  }
  return rows;
}

/**
 * Products for BROWSING — the one place visibility is decided.
 *
 * AMENDMENT_11 §4: "One shared query helper — do not filter in six places
 * independently." Search, autocomplete, Explore, Compare and the alias index
 * all route through this, so a row can never be hidden from one surface and
 * still appear in another.
 *
 * `allProducts` remains the unfiltered set for validation and for anything that
 * legitimately needs every row.
 */
export function visibleProducts(): Product[] {
  return db.product.filter((p) => p.is_visible !== 0);
}

export function isVisible(productId: string): boolean {
  return productById.get(productId)?.is_visible !== 0;
}

export function allProducts(): Product[] {
  return db.product;
}
export function allCrops(): Crop[] {
  return db.crop;
}
/** Aliases for hidden products are dropped, or search would reach them anyway. */
export function allAliases() {
  return db.alias.filter((a) => isVisible(a.product_id));
}
export function allDistricts(): GwStress[] {
  return db.gw_stress;
}
export function getCrop(cropId: string): Crop | undefined {
  return cropById.get(cropId);
}
export function builtAt(): string {
  return db.built_at;
}

export function offIngredientMap(): Map<string, OffIngredientMap> {
  return offTagToCrop;
}
export function equivalences(): Equivalence[] {
  return db.equivalence;
}

/**
 * Groundwater status for a place name, for the "where does my water come from"
 * panel.
 *
 * `gw_stress` is keyed by STATE — no citeable district figure exists — so a
 * city name matches nothing here. Callers holding a city must pass its state;
 * `cityWater` does that through the `state` column on `city_water.csv`.
 */
export function districtWater(name: string): GwStress | null {
  const needle = name.trim().toLowerCase();
  return (
    db.gw_stress.find((g) => g.state.toLowerCase() === needle) ??
    db.gw_stress.find((g) => g.district.toLowerCase() === needle) ??
    null
  );
}

export interface CityWaterReport {
  city: string;
  reservoirs: CityWater[];
  total_capacity_ml: number;
  total_stored_ml: number;
  overall_pct: number;
  updated_on: string;
  groundwater: GwStress | null;
}

/** PS: "community as well as personal levels". Reservoir storage for a city. */
export function cityWater(city: string): CityWaterReport | null {
  const needle = city.trim().toLowerCase();
  const reservoirs = db.city_water.filter((c) => c.city.toLowerCase() === needle);
  if (reservoirs.length === 0) return null;

  const total_capacity_ml = reservoirs.reduce((a, r) => a + r.capacity_ml, 0);
  const total_stored_ml = reservoirs.reduce((a, r) => a + (r.capacity_ml * r.pct) / 100, 0);

  return {
    city: reservoirs[0].city,
    reservoirs,
    total_capacity_ml: Math.round(total_capacity_ml),
    total_stored_ml: Math.round(total_stored_ml),
    overall_pct: total_capacity_ml ? Math.round((total_stored_ml / total_capacity_ml) * 1000) / 10 : 0,
    updated_on: reservoirs[0].updated_on,
    // Joined on the city's STATE, not its name — Mumbai has no groundwater row
    // of its own and never will, since district figures are not citeable.
    groundwater: districtWater(reservoirs[0].state),
  };
}

export function cities(): string[] {
  return [...new Set(db.city_water.map((c) => c.city))].sort();
}

// ─── Community aggregate ────────────────────────────────────────────────────

/**
 * Scans recorded during this isolate's lifetime, appended to the seeded log.
 *
 * A Worker has no writable disk, so live scans accumulate in memory and reset
 * on redeploy. The seeded rows in `scan_log.csv` mean the community screen is
 * never empty on a cold start. **Region only — no personal identifiers, ever.**
 */
const liveScans: ScanLog[] = [];

export function recordScan(entry: Omit<ScanLog, "scan_id" | "ts">, ts: string, id: string) {
  liveScans.push({ ...entry, scan_id: id, ts });
}

export interface CommunityAggregate {
  region: string;
  scans: number;
  total_litres: number;
  average_litres: number;
  average_score: number;
  top_items: { product_id: string; name: string; scans: number; total_litres: number }[];
  /** Litres embedded in produce grown outside this region — "virtual water inflow". */
  virtual_water_inflow_l: number;
}

export function communityAggregate(region: string, lang: Lang = "en"): CommunityAggregate {
  const needle = region.trim().toLowerCase();
  const rows = [...db.scan_log, ...liveScans].filter((s) => s.region.toLowerCase() === needle);

  const total_litres = rows.reduce((a, s) => a + s.litres, 0);
  const byProduct = new Map<string, { scans: number; total_litres: number }>();
  for (const s of rows) {
    const cur = byProduct.get(s.product_id) ?? { scans: 0, total_litres: 0 };
    cur.scans += 1;
    cur.total_litres += s.litres;
    byProduct.set(s.product_id, cur);
  }

  const top_items = [...byProduct.entries()]
    .map(([product_id, v]) => {
      const p = productById.get(product_id);
      return { product_id, name: p ? productName(p, lang) : product_id, ...v };
    })
    .sort((a, b) => b.total_litres - a.total_litres)
    .slice(0, 5);

  // Virtual water inflow: the share of each scan's footprint sourced from
  // states other than the consuming region's own.
  let inflow = 0;
  for (const s of rows) {
    try {
      const result = calculateProduct(s.product_id, { lang });
      const outside = result.sources
        .filter((src) => !src.state.toLowerCase().includes(needle) && !needle.includes(src.state.toLowerCase()))
        .reduce((a, src) => a + src.share, 0);
      inflow += s.litres * Math.min(1, outside);
    } catch {
      // A product that cannot be calculated is skipped rather than counted at zero.
    }
  }

  return {
    region: rows[0]?.region ?? region,
    scans: rows.length,
    total_litres: Math.round(total_litres),
    average_litres: rows.length ? Math.round(total_litres / rows.length) : 0,
    average_score: rows.length ? Math.round(rows.reduce((a, s) => a + s.score, 0) / rows.length) : 0,
    top_items,
    virtual_water_inflow_l: Math.round(inflow),
  };
}

export function regions(): string[] {
  return [...new Set([...db.scan_log, ...liveScans].map((s) => s.region))].sort();
}

export { stressCategory };

// ─── Engine wiring ──────────────────────────────────────────────────────────

export interface CalcOptions {
  servingG?: number;
  month?: number;
  lang?: Lang;
  resolverQuality?: Quality;
  /** Source the whole product from one state instead of the national mix. */
  forceState?: string;
  /** Skip percentile ranking — used while building the distribution itself. */
  skipDistribution?: boolean;
}

function engineInput(productId: string, opts: CalcOptions): EngineInput {
  const product = getProduct(productId);
  const ingredients = getIngredients(productId);
  const cropIds = new Set(ingredients.map((i) => i.crop_id));

  const sourcing = new Map<string, ProductionShare[]>();
  const footprints = new Map<string, Crop>();
  for (const cropId of cropIds) {
    const shares = sharesByCrop.get(cropId);
    if (shares) sourcing.set(cropId, shares);
    const crop = cropById.get(cropId);
    if (crop) footprints.set(cropId, crop);
  }

  // Substitute crops must also be priceable, so pull their rows in too.
  const substitutions = new Map<string, Substitution[]>();
  for (const cropId of cropIds) {
    const subs = substitutionsByCrop.get(cropId);
    if (!subs) continue;
    substitutions.set(cropId, subs);
    for (const sub of subs) {
      const target = cropById.get(sub.to_crop);
      if (target) footprints.set(sub.to_crop, target);
      const targetShares = sharesByCrop.get(sub.to_crop);
      if (targetShares) sourcing.set(sub.to_crop, targetShares);
    }
  }

  return {
    product: { product_id: product.product_id, name: productName(product, opts.lang ?? "en"), type: product.type },
    ingredients,
    sourcing,
    footprints,
    cropStates: cropStateByKey,
    stress: stressByState,
    substitutions,
    seasonFactors,
    equivalences: db.equivalence,
    servingG: opts.servingG ?? product.default_serving_g,
    month: opts.month ?? new Date().getUTCMonth() + 1,
    catalogDistribution: opts.skipDistribution ? [] : catalogDistribution(),
    lang: opts.lang ?? "en",
    resolverQuality: opts.resolverQuality,
    forceState: opts.forceState,
  };
}

let distributionCache: number[] | null = null;

/**
 * Impact litres for every catalogue item at its default serving, sorted
 * ascending. Built once per isolate; `score()` bisects it.
 *
 * Items whose data is incomplete are skipped rather than defaulted — a product
 * that cannot be calculated must not shift everyone else's percentile.
 */
export function catalogDistribution(): number[] {
  if (distributionCache) return distributionCache;
  const impacts: number[] = [];
  for (const product of db.product) {
    try {
      // Month is pinned so the ranking baseline is stable — otherwise every
      // product's percentile would drift as the real-world season changed.
      const result = calculate(engineInput(product.product_id, { skipDistribution: true, month: 7 }));
      impacts.push(result.impact_l);
    } catch (err) {
      if (err instanceof DataMissingError) {
        logMissing(err);
        continue;
      }
      throw err;
    }
  }
  impacts.sort((a, b) => a - b);
  distributionCache = impacts;
  return impacts;
}

/**
 * Calculate an AD-HOC recipe — a scanned packet, not a catalogue product.
 *
 * A barcode resolves to the manufacturer's declared ingredient list, and that
 * product does not exist in our catalogue by design: there are millions of
 * packets and 168 rows. Previously the confirmation sheet had no `product_id`
 * to send, so its Confirm button sat permanently disabled and the click did
 * nothing at all — no error, no spinner, because no handler ever ran.
 *
 * This runs the SAME engine over the supplied ingredients. Nothing about the
 * arithmetic differs; only where the recipe came from. Mass fractions from a
 * barcode are rank-estimated, so callers pass `resolverQuality: "medium"` and
 * the result says so.
 */
export function calculateRecipe(
  recipe: { name: string; ingredients: ProductIngredient[] },
  opts: CalcOptions = {},
): CalculationResult {
  const ingredients = recipe.ingredients.filter((i) => cropById.has(i.crop_id));
  if (ingredients.length === 0) {
    const err = new DataMissingError("product_ingredient", recipe.name, "no known crops in this recipe");
    logMissing(err);
    throw err;
  }

  const cropIds = new Set(ingredients.map((i) => i.crop_id));
  const sourcing = new Map<string, ProductionShare[]>();
  const footprints = new Map<string, Crop>();
  for (const cropId of cropIds) {
    const shares = sharesByCrop.get(cropId);
    if (shares) sourcing.set(cropId, shares);
    const crop = cropById.get(cropId);
    if (crop) footprints.set(cropId, crop);
  }

  const substitutions = new Map<string, Substitution[]>();
  for (const cropId of cropIds) {
    const subs = substitutionsByCrop.get(cropId);
    if (!subs) continue;
    substitutions.set(cropId, subs);
    for (const sub of subs) {
      const target = cropById.get(sub.to_crop);
      if (target) footprints.set(sub.to_crop, target);
      const targetShares = sharesByCrop.get(sub.to_crop);
      if (targetShares) sourcing.set(sub.to_crop, targetShares);
    }
  }

  return calculate({
    product: { product_id: `scanned:${recipe.name}`, name: recipe.name, type: "packaged" },
    ingredients,
    sourcing,
    footprints,
    cropStates: cropStateByKey,
    stress: stressByState,
    substitutions,
    seasonFactors,
    equivalences: db.equivalence,
    servingG: opts.servingG ?? 100,
    month: opts.month ?? new Date().getUTCMonth() + 1,
    catalogDistribution: catalogDistribution(),
    lang: opts.lang ?? "en",
    // Rank-estimated fractions are never "high" confidence.
    resolverQuality: opts.resolverQuality ?? "medium",
    forceState: opts.forceState,
  });
}

export function calculateProduct(productId: string, opts: CalcOptions = {}): CalculationResult {
  return calculate(engineInput(productId, opts));
}
