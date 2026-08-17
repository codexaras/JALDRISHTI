/**
 * Text → product candidates.
 *
 * BUILD_SPEC phase 4: normalise, match exactly on `alias.norm_text`, then fuzzy
 * match. **Below score 70 return suggestions, never a guess.**
 *
 * Fuzzy scoring is implemented here rather than pulled from a package: rapidfuzz
 * is Python-only, and the JS alternatives bundle poorly into a Worker for what
 * amounts to two well-understood string metrics.
 */
import {
  allAliases,
  cropName,
  getCrop,
  getIngredients,
  productsContaining,
  productName,
  visibleProducts,
} from "../repo/db.ts";
import type { Lang, Product } from "../engine/types.ts";

export interface Candidate {
  product_id: string;
  name: string;
  score: number;
  matched_on: string;
  /** True when this is a confident match rather than a suggestion. */
  confident: boolean;
}

export const CONFIDENT_THRESHOLD = 70;

/**
 * Lowercase, trim, collapse whitespace, strip Latin diacritics.
 *
 * The combining range removed here (U+0300–U+036F) covers Latin accents only.
 * Devanagari and Tamil vowel signs live far outside it — stripping those would
 * turn "चावल" into nonsense, so the NFD pass must never be applied blindly.
 */
export function normalise(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .normalize("NFC")
      .toLowerCase()
      // \p{M} is essential, not optional. Devanagari and Tamil vowel signs are
      // combining marks, NOT letters — without \p{M} this strips them and
      // "गोभी" becomes "गभ". Indic matching then only works when both the query
      // and the stored text happen to be mangled the same way, which is true
      // for product names and false for aliases.
      .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Levenshtein distance, iterative with a single row. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length];
}

/** Similarity 0–100 from edit distance. */
export function ratio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 100;
  return Math.round((1 - levenshtein(a, b) / longest) * 100);
}

/**
 * Order-insensitive token similarity, so "biryani chicken" matches
 * "chicken biryani" at full score.
 */
export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  const sorted = (s: Set<string>) => [...s].sort().join(" ");
  return ratio(sorted(ta), sorted(tb));
}

/** Best of the two metrics, plus a prefix bonus for partial typing. */
export function similarity(query: string, target: string): number {
  if (target === query) return 100;
  let best = Math.max(ratio(query, target), tokenSetRatio(query, target));
  if (target.startsWith(query) && query.length >= 3) {
    // "bir" should reach "biryani" while typing; edit distance alone punishes
    // the length gap far too hard for an autocomplete.
    best = Math.max(best, 85 + Math.min(10, query.length));
  } else if (target.includes(query) && query.length >= 4) {
    best = Math.max(best, 80);
  }
  return Math.min(100, best);
}

interface Searchable {
  product_id: string;
  text: string;
  label: string;
  source: string;
}

let indexCache: Searchable[] | null = null;

/**
 * Every way a product can be named: its four canonical names plus every alias.
 * Canonical names come from the product table rather than being duplicated into
 * alias.csv, so adding a language does not mean re-typing the catalogue.
 */
function searchIndex(): Searchable[] {
  if (indexCache) return indexCache;
  const rows: Searchable[] = [];

  for (const p of visibleProducts()) {
    const names: [Lang, string][] = [
      ["en", p.name_en],
      ["hi", p.name_hi],
      ["mr", p.name_mr],
      ["ta", p.name_ta],
    ];
    for (const [lang, name] of names) {
      if (!name) continue;
      rows.push({ product_id: p.product_id, text: normalise(name), label: name, source: `name_${lang}` });
    }
  }
  for (const a of allAliases()) {
    // Re-normalise rather than trusting the CSV column: the file is
    // human-authored, and an alias normalised by hand will not match a query
    // normalised by code.
    rows.push({
      product_id: a.product_id,
      text: normalise(a.norm_text || a.alias_text),
      label: a.alias_text,
      source: `alias_${a.lang}`,
    });
  }

  indexCache = rows;
  return rows;
}

function productsById(): Map<string, Product> {
  return new Map(visibleProducts().map((p) => [p.product_id, p]));
}

/**
 * Resolve free text to ranked candidates.
 *
 * Always returns candidates — the caller shows the confirmation screen. Nothing
 * here decides on the user's behalf; `confident` only marks whether the top hit
 * cleared the threshold.
 */
export function resolveText(query: string, lang: Lang = "en", limit = 8): Candidate[] {
  const q = normalise(query);
  if (q.length === 0) return [];

  const byProduct = new Map<string, { score: number; matched_on: string }>();

  for (const row of searchIndex()) {
    const s = similarity(q, row.text);
    if (s <= 0) continue;
    const existing = byProduct.get(row.product_id);
    if (!existing || s > existing.score) {
      byProduct.set(row.product_id, { score: s, matched_on: row.label });
    }
  }

  const products = productsById();
  return [...byProduct.entries()]
    .flatMap(([product_id, hit]) => {
      const product = products.get(product_id);
      // An alias pointing at a product that no longer exists must drop out of
      // the results, not take the search box down with it. repo/validate.ts
      // fails the build on this, so it should be unreachable — but a resolver
      // that throws mid-keystroke is a worse failure than a missing row.
      if (!product) return [];
      return [{
        product_id,
        name: productName(product, lang),
        score: hit.score,
        matched_on: hit.matched_on,
        confident: hit.score >= CONFIDENT_THRESHOLD,
      }];
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ─── TIER 4: ingredient match ───────────────────────────────────────────────

export interface IngredientMatch {
  product_id: string;
  /** Localised per the active lang, falling back to name_en. */
  name: string;
  /** The crop's share of the product, from raw_grams_per_100g. */
  share_pct: number;
  default_serving_g: number;
}

export interface IngredientMatches {
  crop: { crop_id: string; name: string };
  matches: IngredientMatch[];
}

/**
 * When a query resolves to a base crop, every visible product whose recipe
 * includes that crop — searching "rice" surfaces biryani, poha and idli
 * alongside rice itself.
 *
 * This tier ADDS to the exact → prefix → fuzzy cascade, it never replaces it:
 * `resolveText` still returns the direct candidates, and this returns the
 * "products containing X" group to show beneath them.
 *
 * The gate is deliberate: the top cascade hit must be CONFIDENT and be a
 * `raw_crop` product. "biryani" is a dish, not a crop, so it gets no tier 4;
 * a garbled query below the threshold gets suggestions, never an ingredient
 * expansion built on a guess. Crop-level scope (visible, non-animal, food) is
 * enforced inside `productsContaining` — the shared helper, not a local copy.
 */
export function ingredientMatches(query: string, lang: Lang = "en", limit = 8): IngredientMatches | null {
  const [top] = resolveText(query, lang, 1);
  if (!top || !top.confident) return null;

  const product = productsById().get(top.product_id);
  if (!product || product.type !== "raw_crop") return null;

  // A raw crop product carries exactly one ingredient row — its crop.
  let cropId: string;
  try {
    const rows = getIngredients(product.product_id);
    if (rows.length !== 1) return null;
    cropId = rows[0].crop_id;
  } catch {
    return null;
  }
  const crop = getCrop(cropId);
  if (!crop) return null;

  const matches = productsContaining(cropId)
    // The crop itself is the direct match in the cascade above — repeating it
    // under "products containing" would list rice as containing rice.
    .filter((row) => row.product.product_id !== product.product_id)
    .slice(0, limit)
    .map((row) => ({
      product_id: row.product.product_id,
      name: productName(row.product, lang),
      share_pct: row.raw_grams_per_100g,
      default_serving_g: row.product.default_serving_g,
    }));

  if (matches.length === 0) return null;
  return { crop: { crop_id: cropId, name: cropName(crop, lang) }, matches };
}
