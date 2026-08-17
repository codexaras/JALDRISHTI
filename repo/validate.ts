/**
 * Data validation — BUILD_SPEC phase 1.
 *
 * Fails loudly. Run in CI and before every demo:  npm run data:validate
 *
 * These checks exist because each one corresponds to a way the dataset can be
 * wrong while still looking plausible — which is the failure mode rule 1 is
 * written to prevent.
 */
import { buildBundle } from "./seed.ts";
import type { Bundle } from "../engine/types.ts";

const errors: string[] = [];
const warnings: string[] = [];

const fail = (msg: string) => errors.push(msg);
const warn = (msg: string) => warnings.push(msg);

function checkProductionShares(b: Bundle) {
  const byCrop = new Map<string, number>();
  for (const row of b.production_share) {
    byCrop.set(row.crop_id, (byCrop.get(row.crop_id) ?? 0) + row.share);
  }
  for (const [crop, sum] of byCrop) {
    if (Math.abs(sum - 1.0) > 0.02) {
      fail(`production_share: shares for "${crop}" sum to ${sum.toFixed(4)}, expected 1.0 ±0.02`);
    }
  }
}

function checkIngredientCrops(b: Bundle) {
  const crops = new Set(b.crop.map((c) => c.crop_id));
  for (const ing of b.product_ingredient) {
    if (!crops.has(ing.crop_id)) {
      fail(`product_ingredient: crop_id "${ing.crop_id}" (product "${ing.product_id}") is not in crop.csv`);
    }
  }
}

/**
 * Every producing state must have a groundwater row, or `sourceCrop` throws at
 * request time.
 *
 * Joined on STATE, not on rep_district: `gw_stress.district` is the sentinel
 * "STATE_AVERAGE", while `production_share.rep_district` names a real district.
 * Keying on the pair matched nothing and would have failed all 667 rows.
 */
function checkProducingStates(b: Bundle) {
  const states = new Set(b.gw_stress.map((g) => g.state));
  for (const ps of b.production_share) {
    if (!states.has(ps.state)) {
      fail(`production_share: state "${ps.state}" (crop "${ps.crop_id}") has no row in gw_stress.csv`);
    }
  }
}

function checkFootprintValues(b: Bundle) {
  for (const c of b.crop) {
    for (const k of ["wf_green", "wf_blue", "wf_grey"] as const) {
      if (c[k] < 0) fail(`crop: "${c.crop_id}" has negative ${k} (${c[k]})`);
    }
    const total = c.wf_green + c.wf_blue + c.wf_grey;
    if (total <= 0) fail(`crop: "${c.crop_id}" has a zero total footprint`);
  }
  for (const cs of b.crop_state) {
    const total = cs.wf_green + cs.wf_blue + cs.wf_grey;
    if (total <= 0) fail(`crop_state: "${cs.crop_id}/${cs.state}/${cs.season}" has a zero total footprint`);
  }
}

/** Rule 2.1 — a raw-weight sum this high almost always means cooked weight leaked in. */
function checkCookedWeightError(b: Bundle) {
  const byProduct = new Map<string, number>();
  for (const ing of b.product_ingredient) {
    byProduct.set(ing.product_id, (byProduct.get(ing.product_id) ?? 0) + ing.raw_grams_per_100g);
  }
  for (const [product, sum] of byProduct) {
    if (sum > 200) {
      fail(
        `product_ingredient: "${product}" raw grams sum to ${sum}/100g — over 200 suggests a cooked-weight error (rule 2.1)`,
      );
    }
  }
}

function checkReferentialIntegrity(b: Bundle) {
  const crops = new Set(b.crop.map((c) => c.crop_id));
  const products = new Set(b.product.map((p) => p.product_id));

  for (const p of b.product) {
    if (!b.product_ingredient.some((i) => i.product_id === p.product_id)) {
      fail(`product: "${p.product_id}" has no rows in product_ingredient — it can never be calculated`);
    }
    if (p.default_serving_g <= 0) fail(`product: "${p.product_id}" has a non-positive serving size`);
  }
  for (const a of b.alias) {
    if (!products.has(a.product_id)) fail(`alias: "${a.alias_text}" points at unknown product "${a.product_id}"`);
    if (a.norm_text !== a.norm_text.trim().toLowerCase()) {
      fail(`alias: norm_text "${a.norm_text}" is not normalised (must be lowercase and trimmed)`);
    }
  }
  for (const s of b.substitution) {
    if (!crops.has(s.from_crop)) fail(`substitution: unknown from_crop "${s.from_crop}"`);
    if (!crops.has(s.to_crop)) fail(`substitution: unknown to_crop "${s.to_crop}"`);
  }
  for (const cs of b.crop_state) {
    if (!crops.has(cs.crop_id)) fail(`crop_state: unknown crop_id "${cs.crop_id}"`);
  }
  for (const ps of b.production_share) {
    if (!crops.has(ps.crop_id)) fail(`production_share: unknown crop_id "${ps.crop_id}"`);
  }
  for (const y of b.yield) {
    if (!crops.has(y.from_crop)) fail(`yield: unknown from_crop "${y.from_crop}"`);
  }
}

function checkDuplicates(b: Bundle) {
  const seen = <T,>(rows: T[], key: (r: T) => string, table: string) => {
    const set = new Set<string>();
    for (const r of rows) {
      const k = key(r);
      if (set.has(k)) fail(`${table}: duplicate key "${k}"`);
      set.add(k);
    }
  };
  seen(b.crop, (c) => c.crop_id, "crop");
  seen(b.product, (p) => p.product_id, "product");
  seen(b.gw_stress, (g) => g.state, "gw_stress");
  seen(b.crop_state, (c) => `${c.crop_id}|${c.state}|${c.season}`, "crop_state");
  seen(b.product_ingredient, (i) => `${i.product_id}|${i.crop_id}`, "product_ingredient");
}

function checkYields(b: Bundle) {
  for (const ing of b.product_ingredient) {
    if (ing.yield_fraction <= 0 || ing.yield_fraction > 1) {
      fail(
        `product_ingredient: "${ing.product_id}/${ing.crop_id}" yield_fraction ${ing.yield_fraction} must be in (0, 1]`,
      );
    }
  }
  for (const y of b.yield) {
    if (y.yield_fraction <= 0 || y.yield_fraction > 1) {
      fail(`yield: "${y.process_id}" yield_fraction ${y.yield_fraction} must be in (0, 1]`);
    }
  }
}

function checkNoUncitedDistricts(b: Bundle) {
  for (const g of b.gw_stress) {
    if (g.level === "district" && g.source.includes("NEEDS_SOURCE")) {
      fail(`gw_stress: "${g.district}" is district-level with no citation — CGWB district figures are not citeable here`);
    }
    // A state-resolution row must carry the sentinel. If someone types a real
    // district name in without a citation, `level` flips to "district" and the
    // rule above catches it — this catches the reverse mistake.
    if (g.level === "state" && g.district !== "STATE_AVERAGE") {
      fail(`gw_stress: "${g.state}" is state-resolution but its district column reads "${g.district}" — expected STATE_AVERAGE`);
    }
  }
}

/**
 * Precision must stay honest.
 *
 * AMENDMENT_07: CGWB publishes a category for all 36 states/UTs but a
 * percentage for only seven. `precision` records which — and the whole point is
 * that a band midpoint is never displayed as a measurement. Two ways that rots:
 * a midpoint gets relabelled "exact" (so the UI prints a decimal nobody
 * published), or a value drifts outside the band its category implies.
 */
function checkSoePrecision(b: Bundle) {
  for (const g of b.gw_stress) {
    if (g.precision !== "exact" && g.precision !== "band_midpoint") {
      fail(`gw_stress: "${g.state}" has precision "${g.precision}" — expected "exact" or "band_midpoint"`);
    }
    if (g.band_min >= g.band_max) {
      fail(`gw_stress: "${g.state}" band ${g.band_min}-${g.band_max} is not a range`);
    }
    if (g.soe_pct < g.band_min || g.soe_pct > g.band_max) {
      fail(`gw_stress: "${g.state}" is ${g.soe_pct}% but its band is ${g.band_min}-${g.band_max}`);
    }
    if (g.precision === "band_midpoint" && !g.source.toLowerCase().includes("band")) {
      fail(`gw_stress: "${g.state}" is a band midpoint but its source does not say so — the citation must not imply a measurement`);
    }
    if (g.assessment_year < 2020 || g.assessment_year > 2026) {
      fail(`gw_stress: "${g.state}" assessment_year ${g.assessment_year} is out of range`);
    }
  }

  // AMENDMENT_07 §8: the 61% national fallback must be gone everywhere.
  const leftover = b.gw_stress.filter((g) => Math.round(g.soe_pct) === 61 || Math.round(g.soe_pct) === 60);
  if (leftover.length) {
    fail(`gw_stress: ${leftover.length} row(s) still sit at the retired ~61% national average: ${leftover.map((g) => g.state).join(", ")}`);
  }
}

/**
 * Every crop tagged ":table2-category" must match a published Table 2 row
 * exactly.
 *
 * This is the check that stops a category average drifting back into a
 * reconstructed number. If someone nudges a value to make a demo item look
 * better, the row no longer equals any published average and the build fails.
 */
function checkCategoryAverages(b: Bundle) {
  for (const a of b.category_average) {
    const sum = a.wf_green + a.wf_blue + a.wf_grey;
    // Table 2 rounds each component independently, so the three parts need not
    // add to the published total exactly — five of the fourteen rows are out by
    // 1 L/kg. That is the paper's rounding, not a transcription error, so the
    // published numbers stay as printed. Anything beyond 1 is a real typo.
    if (Math.abs(sum - a.wf_total) > 1) {
      fail(`category_average: "${a.category_id}" components sum to ${sum} but wf_total says ${a.wf_total}`);
    }
  }

  const published = new Set(b.category_average.map((a) => `${a.wf_green}|${a.wf_blue}|${a.wf_grey}`));
  for (const c of b.crop) {
    if (!c.source.includes("table2-category")) continue;
    const key = `${c.wf_green}|${c.wf_blue}|${c.wf_grey}`;
    if (!published.has(key)) {
      fail(
        `crop: "${c.crop_id}" is tagged table2-category but ${c.wf_green}/${c.wf_blue}/${c.wf_grey} ` +
          `matches no row in category_average.csv — a category average must be the published one, not a nearby number`,
      );
    }
  }
}

function checkStressCategories(b: Bundle) {
  // CGWB bands: Safe <70, Semi-Critical 70–90, Critical 90–100, Over-Exploited >100.
  const band = (soe: number) =>
    soe > 100 ? "over_exploited" : soe > 90 ? "critical" : soe >= 70 ? "semi_critical" : "safe";
  for (const g of b.gw_stress) {
    if (g.category !== band(g.soe_pct)) {
      fail(
        `gw_stress: "${g.district}" is ${g.soe_pct}% (CGWB band "${band(g.soe_pct)}") but labelled "${g.category}"`,
      );
    }
  }
}

/** All 28 states + 8 union territories. "Pan India usage" is checkable, so we check it. */
const STATES_AND_UTS = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh",
  "Lakshadweep", "Puducherry",
];

/** The five demo items are locked by name in BUILD_SPEC phase 1. */
const DEMO_ITEMS = ["parle_g_biscuit", "okra_raw", "biryani_chicken", "dal_tadka", "cotton_raw"];

function checkPanIndia(b: Bundle) {
  const covered = new Set(b.gw_stress.map((g) => g.state));
  const missing = STATES_AND_UTS.filter((s) => !covered.has(s));
  if (missing.length) {
    fail(`gw_stress: no district for ${missing.length} state/UT — not pan-India: ${missing.join(", ")}`);
  }
  const unknown = [...covered].filter((s) => !STATES_AND_UTS.includes(s));
  if (unknown.length) fail(`gw_stress: unrecognised state/UT name(s): ${unknown.join(", ")}`);
}

function checkDailyLifeCoverage(b: Bundle) {
  // PS bullet b: "items they use in daily life" — non-food agricultural products.
  const nonFoodCrops = b.crop.filter((c) => c.is_food === 0).map((c) => c.crop_id);
  for (const required of ["cotton", "jute"]) {
    if (!nonFoodCrops.includes(required)) {
      fail(`crop: "${required}" must exist with is_food = 0 (daily-life clause)`);
    }
  }
  const products = new Set(b.product.map((p) => p.product_id));
  for (const required of ["cotton_tshirt", "jeans_pair"]) {
    if (!products.has(required)) fail(`product: "${required}" missing (daily-life clause)`);
  }
}

/**
 * A hidden product must not be one the build depends on.
 *
 * `is_visible = 0` removes a row from browsing, so hiding a locked demo item or
 * a daily-life product would silently amputate a problem-statement clause while
 * every test still passed on direct-id lookups.
 */
function checkVisibility(b: Bundle) {
  // Browsable = is_visible AND not a manufactured non-food good — the same
  // rule repo/db.ts applies. Garments are expected hidden now (crops in,
  // textiles out); the demo items must remain browsable.
  const hidden = new Set(
    b.product.filter((p) => p.is_visible === 0 || p.type === "non_food").map((p) => p.product_id),
  );
  for (const id of DEMO_ITEMS) {
    if (hidden.has(id)) {
      fail(`product: "${id}" is a locked demo item but is not browsable`);
    }
  }
  // Cotton and jute are CROPS — grown, harvested, unambiguously agricultural.
  // Only manufactured garments would ever be out of scope, and they are kept.
  for (const cropId of ["cotton", "jute"]) {
    if (!b.crop.some((c) => c.crop_id === cropId)) {
      fail(`crop: "${cropId}" must remain — it is an agricultural crop, not a manufactured good`);
    }
  }
  warn(`visibility: ${hidden.size} product(s) hidden from browsing: ${[...hidden].join(", ") || "none"}`);
}

function checkDemoItems(b: Bundle) {
  const products = new Set(b.product.map((p) => p.product_id));
  const withIngredients = new Set(b.product_ingredient.map((i) => i.product_id));
  for (const id of DEMO_ITEMS) {
    if (!products.has(id)) fail(`product: locked demo item "${id}" is missing`);
    else if (!withIngredients.has(id)) fail(`product_ingredient: demo item "${id}" has no ingredient rows`);
  }
}

function checkNewTables(b: Bundle) {
  const crops = new Set(b.crop.map((c) => c.crop_id));

  for (const m of b.off_ingredient_map) {
    // "__non_crop__" marks a tag we recognise and deliberately exclude — salt,
    // water, additives, and Open Food Facts' own category labels.
    if (m.crop_id !== "__non_crop__" && !crops.has(m.crop_id)) {
      fail(`off_ingredient_map: "${m.off_tag}" maps to unknown crop "${m.crop_id}"`);
    }
    if (m.yield_fraction <= 0 || m.yield_fraction > 1) {
      fail(`off_ingredient_map: "${m.off_tag}" yield_fraction ${m.yield_fraction} must be in (0, 1]`);
    }
  }

  for (const season of ["kharif", "rabi", "zaid"]) {
    if (!b.season_factor.some((s) => s.season === season)) {
      fail(`season_factor: missing row for "${season}" — month would not change the result`);
    }
  }
  for (const s of b.season_factor) {
    if (s.blue_multiplier <= 0) fail(`season_factor: "${s.season}" multiplier must be > 0`);
  }
  // If every season shared a multiplier the "and when" clause would silently fail.
  const multipliers = new Set(b.season_factor.map((s) => s.blue_multiplier));
  if (multipliers.size < 2) {
    fail("season_factor: all multipliers are identical — month cannot change the result");
  }

  if (b.equivalence.length === 0) fail("equivalence: no rows — human_equivalent cannot be produced");
  for (const e of b.equivalence) {
    if (e.litres_per_unit <= 0) fail(`equivalence: "${e.eq_id}" litres_per_unit must be > 0`);
    if (!e.message_key.startsWith("result.eq.")) {
      fail(`equivalence: "${e.eq_id}" message_key should start with "result.eq."`);
    }
  }

  // BUILD_SPEC section 9 checks Mumbai returns 7 reservoirs.
  const mumbai = b.city_water.filter((c) => c.city === "Mumbai");
  if (mumbai.length !== 7) {
    fail(`city_water: Mumbai has ${mumbai.length} reservoirs, verification expects 7`);
  }
  const gwStates = new Set(b.gw_stress.map((g) => g.state));
  for (const c of b.city_water) {
    if (c.pct < 0 || c.pct > 100) fail(`city_water: "${c.city}/${c.reservoir}" pct ${c.pct} out of range`);
    if (c.capacity_ml <= 0) fail(`city_water: "${c.city}/${c.reservoir}" capacity must be > 0`);
    // Without a resolvable state the city's groundwater panel silently shows
    // nothing — which is how it broke once already.
    if (!gwStates.has(c.state)) {
      fail(`city_water: "${c.city}" is in state "${c.state}", which has no gw_stress row`);
    }
  }

  const productIds = new Set(b.product.map((p) => p.product_id));
  for (const s of b.scan_log) {
    if (!productIds.has(s.product_id)) fail(`scan_log: unknown product "${s.product_id}"`);
    // Privacy invariant: the schema must never grow a personal identifier.
    for (const banned of ["user", "email", "phone", "name", "device", "ip"]) {
      if (Object.keys(s).some((k) => k.toLowerCase().includes(banned))) {
        fail(`scan_log: column matching "${banned}" is not permitted — region only`);
      }
    }
  }
}

/**
 * Rows carrying NEEDS_SOURCE have no citation at all. Distinct from ":approx",
 * which has a value someone should check — these have nothing to check against.
 */
function reportUnsourced(b: Bundle) {
  const unsourced = [
    ...b.crop.filter((c) => c.source.includes("NEEDS_SOURCE")).map((c) => `crop/${c.crop_id}`),
    ...b.gw_stress.filter((g) => g.source.includes("NEEDS_SOURCE")).map((g) => `gw_stress/${g.state}`),
  ];
  if (unsourced.length) {
    warn(`${unsourced.length} rows are NEEDS_SOURCE — no citation exists yet:`);
    warn(`  ${unsourced.join(", ")}`);
  }
  const exact = b.gw_stress.filter((g) => g.precision === "exact");
  const band = b.gw_stress.filter((g) => g.precision === "band_midpoint");
  warn(
    `groundwater: ${b.gw_stress.length}/${b.gw_stress.length} states/UTs have a cited CGWB category. ` +
      `${exact.length} publish an exact percentage (${exact.map((g) => g.state).join(", ")}); ` +
      `${band.length} carry a band midpoint and are shown as a band, never as a decimal.`,
  );

  const byTag = (tag: string) => b.crop.filter((c) => c.source.includes(tag)).length;
  warn(
    `crops: ${byTag(":table3")} cite Table 3 individually, ${byTag(":table2-category")} use a published ` +
      `Table 2 category average, ${byTag(":approx")} are still :approx, ${byTag("NEEDS_SOURCE")} are unsourced.`,
  );
}

/** Not fatal, but every one of these is a number you can be challenged on. */
function reportUnverified(b: Bundle) {
  const tagged = [
    ...b.crop.filter((c) => c.source.includes(":approx")).map((c) => `crop/${c.crop_id}`),
    ...b.gw_stress.filter((g) => g.source.includes(":approx")).map((g) => `gw_stress/${g.district}`),
    ...b.yield.filter((y) => y.source.includes(":approx")).map((y) => `yield/${y.process_id}`),
  ];
  if (tagged.length) {
    warn(`${tagged.length} rows tagged ":approx" need human verification before the demo:`);
    warn(`  ${tagged.join(", ")}`);
  }
  const proxied = b.gw_stress.filter((g) => g.source.includes("state-proxy")).length;
  if (proxied) warn(`${proxied} gw_stress districts use a state-level figure as a district proxy.`);
}

function main() {
  const b = buildBundle();

  checkProductionShares(b);
  checkIngredientCrops(b);
  checkProducingStates(b);
  checkFootprintValues(b);
  checkCookedWeightError(b);
  checkReferentialIntegrity(b);
  checkDuplicates(b);
  checkYields(b);
  checkStressCategories(b);
  checkNoUncitedDistricts(b);
  checkSoePrecision(b);
  checkCategoryAverages(b);
  checkPanIndia(b);
  checkDailyLifeCoverage(b);
  checkDemoItems(b);
  checkVisibility(b);
  checkNewTables(b);
  reportUnverified(b);
  reportUnsourced(b);

  for (const w of warnings) console.warn(`  warn  ${w}`);

  if (errors.length) {
    console.error(`\n✗ ${errors.length} validation error(s):\n`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log(
    `\n✓ data valid — ${b.crop.length} crops, ${b.product.length} products, ` +
      `${b.production_share.length} sourcing rows, ${b.gw_stress.length} districts`,
  );
}

main();
