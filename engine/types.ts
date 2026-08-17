/**
 * Shared data shapes for Jal Drishti.
 *
 * These mirror the SQL schema in BUILD_SPEC section 4 one-for-one. The engine
 * consumes them as plain objects — it never queries for them (rule 4).
 */

export type Lang = "en" | "hi" | "mr" | "ta";
export type Season = "kharif" | "rabi" | "zaid";
export type Quality = "high" | "medium" | "low";

/** CGWB groundwater extraction categories. */
export type StressCategory = "safe" | "semi_critical" | "critical" | "over_exploited";

/**
 * Display grouping only — no calculation reads this field.
 *
 * BUILD_SPEC enumerates cereal|pulse|vegetable|fruit|oilseed|animal|fibre|
 * beverage. `sugar` was added for sugarcane, then `spice` and `nut` because
 * Mekonnen & Hoekstra publish both as their own Table 2 categories — and
 * because filing clove under "vegetable" put a 61,206 L/kg spice at the top of
 * the vegetable browse.
 */
export type Category =
  | "cereal"
  | "pulse"
  | "vegetable"
  | "fruit"
  | "oilseed"
  | "nut"
  | "spice"
  | "animal"
  | "fibre"
  | "beverage"
  | "sugar";

export interface Crop {
  crop_id: string;
  name_en: string;
  name_hi: string;
  name_mr: string;
  name_ta: string;
  category: Category;
  /** L/kg — identical to m³/tonne. DO NOT CONVERT (rule 2.2). */
  wf_green: number;
  /** L/kg — identical to m³/tonne. DO NOT CONVERT (rule 2.2). */
  wf_blue: number;
  /** L/kg — identical to m³/tonne. DO NOT CONVERT (rule 2.2). */
  wf_grey: number;
  is_animal: number;
  /** 0 for non-food agricultural products (cotton, jute). */
  is_food: number;
  source: string;
}

/** Seasonal blue-water multiplier. See data/SOURCES.md → S6 (a declared model). */
export interface SeasonFactor {
  season: Season;
  blue_multiplier: number;
  note: string;
  source: string;
}

export interface Equivalence {
  eq_id: string;
  litres_per_unit: number;
  message_key: string;
  min_litres: number;
  source: string;
}

export interface CityWater {
  city: string;
  /**
   * The state the city sits in, so the screen can show its groundwater status.
   * `gw_stress` is keyed by state — no citeable city or district figure exists —
   * so without this column a city can never be joined to an aquifer.
   */
  state: string;
  reservoir: string;
  pct: number;
  capacity_ml: number;
  overflowing: number;
  updated_on: string;
  source: string;
}

/** Region only. No personal identifiers, ever. */
export interface ScanLog {
  scan_id: string;
  product_id: string;
  region: string;
  litres: number;
  score: number;
  ts: string;
}

export interface OffIngredientMap {
  off_tag: string;
  crop_id: string;
  yield_fraction: number;
  source: string;
}

export interface CropState {
  crop_id: string;
  state: string;
  season: Season;
  wf_green: number;
  wf_blue: number;
  wf_grey: number;
  source: string;
}

export interface ProductionShare {
  crop_id: string;
  state: string;
  share: number;
  rep_district: string;
  lat: number;
  lon: number;
  source: string;
}

/**
 * How the percentage was arrived at — NOT how confident we are in the category.
 *
 * CGWB's 2024 National Compilation lists every state and UT by band
 * (>100 / 90–100 / 70–90 / ≤70) but publishes a single percentage for only a
 * handful. So the *category* is citeable for all 36; the *number* is measured
 * for 7 and a band midpoint for 29.
 *
 * These must never be displayed the same way. Printing "35% extracted" for a
 * band-midpoint state claims a measurement that does not exist — the band
 * descriptor ("Safe — under 70% extracted") is the honest rendering.
 */
export type SoePrecision = "exact" | "band_midpoint";

export interface GwStress {
  /**
   * The sentinel "STATE_AVERAGE", or a district name once district data exists.
   *
   * CGWB district figures are not citeable for this project, so today every row
   * carries the sentinel — which is why `level` derives from this column rather
   * than being stored separately.
   */
  district: string;
  state: string;
  soe_pct: number;
  category: StressCategory;
  /** Inclusive lower edge of the CGWB band this state falls in. */
  band_min: number;
  /** Upper edge of the band. 160 stands for "no ceiling" on over-exploited. */
  band_max: number;
  assessment_year: number;
  precision: SoePrecision;
  /**
   * Resolution of the figure, derived from `district`. The badge reads
   * "state average" today and will read "district" the moment a district row
   * is added, with no UI change.
   */
  level: "state" | "district";
  source: string;
}

export interface Product {
  product_id: string;
  name_en: string;
  name_hi: string;
  name_mr: string;
  name_ta: string;
  type: "raw_crop" | "cooked_dish" | "packaged" | "non_food";
  default_serving_g: number;
  /**
   * 0 hides the product from BROWSING — search, autocomplete, Explore, Compare
   * and aliases — without removing it. AMENDMENT_11 §4.
   *
   * Hidden, not deleted, for two reasons. The row stays auditable, and the
   * product remains calculable by id, so a dish that uses it still resolves and
   * nothing that already links to it breaks.
   *
   * Used for animal products: Mekonnen & Hoekstra 2011 covers CROPS only, so
   * every animal figure we hold is uncited. Hiding them closes a citation gap,
   * which is why it is a data-integrity fix and not merely a scope one.
   */
  is_visible: number;
  source: string;
}

export interface ProductIngredient {
  product_id: string;
  crop_id: string;
  raw_grams_per_100g: number;
  yield_fraction: number;
  source: string;
}

export interface Alias {
  alias_text: string;
  norm_text: string;
  lang: Lang;
  product_id: string;
}

export interface Substitution {
  from_crop: string;
  to_crop: string;
  message_key: string;
  rank: number;
}

export interface YieldRow {
  process_id: string;
  from_crop: string;
  to_label: string;
  yield_fraction: number;
  source: string;
}

/** The complete read-only dataset, produced by `repo/seed.ts`. */
/**
 * Mekonnen & Hoekstra 2011 Table 2 — the paper's own published category
 * averages.
 *
 * A crop the paper does not break out individually (urad, moong, karela) uses
 * the published average for its category rather than a reconstructed value.
 * That is a citeable methodological choice: "the source doesn't list urad, so
 * we use its published pulse average and flag confidence as medium."
 */
export interface CategoryAverage {
  category_id: string;
  label_en: string;
  wf_green: number;
  wf_blue: number;
  wf_grey: number;
  wf_total: number;
  source: string;
}

export interface Bundle {
  crop: Crop[];
  category_average: CategoryAverage[];
  crop_state: CropState[];
  production_share: ProductionShare[];
  gw_stress: GwStress[];
  product: Product[];
  product_ingredient: ProductIngredient[];
  alias: Alias[];
  substitution: Substitution[];
  yield: YieldRow[];
  season_factor: SeasonFactor[];
  equivalence: Equivalence[];
  city_water: CityWater[];
  scan_log: ScanLog[];
  off_ingredient_map: OffIngredientMap[];
  built_at: string;
}

// ─── Engine input/output ────────────────────────────────────────────────────

/** Green/blue/grey litres, plus their total. */
export interface WaterSplit {
  green: number;
  blue: number;
  grey: number;
  total: number;
}

/** A crop's footprint per kg, in L/kg (== m³/tonne, rule 2.2). */
export interface Wf {
  green: number;
  blue: number;
  grey: number;
}

/** One sourcing location contributing to a crop's supply. */
export interface SourceLine {
  crop: string;
  crop_name: string;
  state: string;
  /** "STATE_AVERAGE" today — see GwStress.district. */
  district: string;
  /** So the UI can label the figure honestly, e.g. "Punjab (state average)". */
  level: "state" | "district";
  /** Whether `soe_pct` is measured or a band midpoint. Drives how it is shown. */
  precision: SoePrecision;
  band_min: number;
  band_max: number;
  share: number;
  status: StressCategory;
  soe_pct: number;
  blue_l: number;
  impact_blue_l: number;
  lat: number;
  lon: number;
}

export interface Confidence {
  low: number;
  high: number;
  quality: Quality;
}

/** A translatable sentence: never a rendered string (BUILD_SPEC phase 5). */
export interface MessageRef {
  key: string;
  params: Record<string, string | number>;
}

export interface SwapSuggestion {
  from: string;
  to: string;
  saves_l: number;
  message: MessageRef;
}

export interface Lineage {
  ingredients: { crop: string; raw_g: number }[];
  season: Season;
  fallbacks_used: string[];
}

export interface CalculationResult {
  product: {
    id: string;
    name: string;
    serving_g: number;
    type: string;
  };
  footprint_l: WaterSplit;
  /**
   * Stress-weighted litres: grey + Σ(blue × state stress factor).
   *
   * **Green water is deliberately excluded.** This ranks *impact*, not volume:
   * rainfall a crop absorbed in place competes with nothing, so counting it
   * scored rain-fed millets as worse than irrigated rice. Grey stays in —
   * diluting pollution consumes real freshwater.
   *
   * Not in the BUILD_SPEC response shape, but it is what `stress_score` ranks
   * and what "Why this number?" explains, so it is returned rather than
   * recomputed by every caller.
   */
  impact_l: number;
  confidence: Confidence;
  stress_score: number;
  status: StressCategory;
  human_equivalent: MessageRef;
  sources: SourceLine[];
  swap: SwapSuggestion | null;
  lineage: Lineage;
  citations: string[];
}
