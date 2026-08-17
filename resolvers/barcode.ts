/**
 * Barcode → declared ingredient list, via Open Food Facts.
 *
 * AMENDMENT_02 §5: **barcode ships before photo.** A barcode is a globally
 * unique product ID, so this is a lookup rather than a guess, and it returns the
 * manufacturer's *declared* ingredient list — which photo recognition can never
 * give you. That is the difference between "we assumed a biscuit is mostly
 * flour" and "here is the label, and here is what each ingredient cost in
 * water."
 *
 * Food labelling law requires ingredients in descending weight order, so rank
 * carries real information — but only ordinal information. A normalised 1/rank
 * (Zipf) weighting turns that ordering into mass fractions without pretending to
 * know the recipe. `quality` is therefore capped at "medium" and `estimated` is
 * set, so the UI can say so out loud.
 *
 * Unmapped tags are reported, never silently dropped and never guessed (rule 1).
 */
import { offIngredientMap, allCrops } from "../repo/db.ts";
import { DataMissingError } from "../engine/errors.ts";
import type { Quality } from "../engine/types.ts";

export interface BarcodeIngredient {
  crop_id: string;
  raw_grams_per_100g: number;
  yield_fraction: number;
  source: string;
}

export interface BarcodeResult {
  /** True only when we can actually produce a footprint from this product. */
  found: boolean;
  /**
   * True when Open Food Facts HAS the product, regardless of whether we could
   * map its ingredients.
   *
   * Kept separate from `found` because the two failures need different words.
   * "We don't have this product" and "we have it but it lists no ingredients"
   * are different sentences, and collapsing them made the second one
   * unreportable.
   */
  product_found?: boolean;
  ean: string;
  name: string;
  brand?: string;
  ingredients: BarcodeIngredient[];
  unmatched_tags: string[];
  /** Recognised non-crop tags (salt, additives, OFF category labels). */
  ignored_tags?: string[];
  quality: Quality;
  estimated: boolean;
  /** Set when the answer came from cache rather than the network. */
  cached?: boolean;
  /**
   * Why there is no footprint.
   *
   * `not_found` means Open Food Facts genuinely has no such barcode.
   * `upstream_error` means the lookup failed — do NOT tell the user the product
   * is unknown, because we never found out. Conflating the two is how a
   * throttled demo ends up claiming Parle-G isn't in the database.
   */
  error?: "not_found" | "no_ingredients" | "timeout" | "rate_limited" | "upstream_error" | "offline";
}

const OFF_ENDPOINT = "https://world.openfoodfacts.org/api/v2/product";
const TIMEOUT_MS = 5000;

/**
 * Open Food Facts throttles clients it cannot identify, so a descriptive
 * User-Agent is required rather than polite.
 *
 * No contact address: this is an unhosted hackathon prototype making a handful
 * of read-only lookups, and there is no inbox for OFF to write to. If it is ever
 * deployed, add one — that is when a contactable maintainer starts to matter.
 */
const USER_AGENT = "JalDrishti/1.0 (SIH 2026 hackathon prototype; read-only; not deployed)";

/**
 * Response cache.
 *
 * A Worker has no writable disk, so this is per-isolate rather than
 * `data/cache/off/`. It still does the job it exists for: a repeated scan of
 * the same packet during a demo makes no second network call.
 */
const cache = new Map<string, BarcodeResult>();

/** Set after a 429 so we stop hammering a rate-limited API. */
let backoffUntil = 0;

export function clearBarcodeCache() {
  cache.clear();
  backoffUntil = 0;
}

function stripLocale(tag: string): string {
  const idx = tag.indexOf(":"); // OFF tags look like "en:wheat-flour"
  return (idx === -1 ? tag : tag.slice(idx + 1)).toLowerCase().trim();
}

/**
 * Every spelling of a tag worth trying before declaring it unmapped.
 *
 * Open Food Facts is crowd-entered and OCR-assisted, so the same ingredient
 * arrives many ways. A real example from a Lay's packet: the map contains
 * `iodised-salt`, and OFF sent `"lodised salt"` — a lowercase L where an i
 * belongs, and a space where a hyphen belongs. Both were reported to the user
 * as "not in our data", which is a false claim about our own dataset.
 *
 * Ordered cheapest-first; the caller takes the first hit.
 */
export function tagVariants(raw: string): string[] {
  const base = stripLocale(raw)
    .replace(/[\s_]+/g, "-")     // spaces and underscores become hyphens
    .replace(/-+/g, "-")          // collapse runs
    .replace(/^-|-$/g, "");
  if (!base) return [];

  const out = new Set<string>([base]);

  const spellings = (t: string) => {
    const forms = new Set([t]);
    // British ↔ American, both directions.
    for (const [a, b] of [["ised", "ized"], ["isation", "ization"], ["our", "or"], ["ae", "e"]]) {
      for (const f of [...forms]) {
        forms.add(f.replaceAll(a, b));
        forms.add(f.replaceAll(b, a));
      }
    }
    return forms;
  };

  for (const t of spellings(base)) {
    out.add(t);
    // Singular and plural — OFF uses both for the same ingredient.
    if (t.endsWith("es")) out.add(t.slice(0, -2));
    if (t.endsWith("s")) out.add(t.slice(0, -1));
    else out.add(`${t}s`);
    // OCR confuses l with i at the start of a word ("lodised" for "iodised").
    // Last resort, and only where it produces a different string.
    if (t.startsWith("l")) out.add(`i${t.slice(1)}`);
    out.add(t.replace(/(^|-)l/g, "$1i"));
  }

  return [...out].filter(Boolean);
}

/**
 * Zipf weights over ranks, scaled so the ingredients account for 100 g.
 * With n ingredients, ingredient i gets (1/i) / Σ(1/k) of the mass.
 */
export function rankToMassFractions(count: number): number[] {
  const weights = Array.from({ length: count }, (_, i) => 1 / (i + 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

/**
 * Tags that are deliberately not crops: salt and water (no agricultural water
 * footprint), additives and colours (negligible mass), and Open Food Facts'
 * own category tags ("cereal", "dairy", "vegetable") which duplicate the
 * specific ingredient already listed beside them.
 *
 * These are excluded rather than reported missing. Telling the user "salt is
 * not in our data" implies a gap where there is none, and it buries the tags
 * that genuinely are gaps.
 */
export const NON_CROP = "__non_crop__";

export function mapTags(tags: string[]): {
  ingredients: BarcodeIngredient[];
  unmatched: string[];
  /** Recognised, deliberately excluded — shown as context, not as a gap. */
  ignored: string[];
} {
  const map = offIngredientMap();
  const cropIds = new Set(allCrops().map((c) => c.crop_id));
  const unmatched: string[] = [];
  const ignored: string[] = [];
  const matched: { crop_id: string; yield_fraction: number; source: string }[] = [];

  for (const raw of tags) {
    const tag = stripLocale(raw);
    if (!tag) continue;
    // Try every spelling before giving up — see tagVariants.
    let entry = map.get(tag);
    if (!entry) {
      for (const variant of tagVariants(raw)) {
        entry = map.get(variant);
        if (entry) break;
      }
    }

    if (entry?.crop_id === NON_CROP) {
      ignored.push(tag);
    } else if (entry && cropIds.has(entry.crop_id)) {
      // Keep the first (highest-ranked) occurrence of each crop.
      if (!matched.some((m) => m.crop_id === entry.crop_id)) {
        matched.push({
          crop_id: entry.crop_id,
          yield_fraction: entry.yield_fraction,
          source: entry.source,
        });
      }
    } else {
      unmatched.push(tag);
    }
  }

  const fractions = rankToMassFractions(matched.length);
  const ingredients = matched.map((m, i) => ({
    crop_id: m.crop_id,
    raw_grams_per_100g: Math.round(fractions[i] * 100 * 10) / 10,
    yield_fraction: m.yield_fraction,
    source: `OFF:ingredients_tags (rank-estimated) + ${m.source}`,
  }));

  return { ingredients, unmatched, ignored };
}

export interface BarcodeFetchOptions {
  fetchImpl?: typeof fetch;
  /** Called for each unmapped tag so it reaches data/missing.log. */
  onUnmapped?: (err: DataMissingError) => void;
  timeoutMs?: number;
}

export async function resolveBarcode(
  ean: string,
  opts: BarcodeFetchOptions = {},
): Promise<BarcodeResult> {
  const clean = ean.replace(/\D/g, "");
  const base: BarcodeResult = {
    found: false,
    ean: clean,
    name: "",
    ingredients: [],
    unmatched_tags: [],
    quality: "medium",
    estimated: true,
  };
  if (clean.length < 8) return { ...base, error: "not_found" };

  const hit = cache.get(clean);
  if (hit) return { ...hit, cached: true };

  if (Date.now() < backoffUntil) return { ...base, error: "rate_limited" };

  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);

  let json: {
    status?: number;
    product?: { product_name?: string; brands?: string; ingredients_tags?: string[] };
  };
  try {
    const res = await doFetch(
      `${OFF_ENDPOINT}/${clean}.json?fields=product_name,brands,ingredients_tags`,
      { signal: controller.signal, headers: { "User-Agent": USER_AGENT } },
    );
    // Open Food Facts throttles with more than one status. 429 is documented;
    // in practice a hammered client also gets 403 and 503, sometimes as an HTML
    // block page rather than JSON. All three mean "back off", not "no such
    // product".
    if (res.status === 429 || res.status === 403 || res.status === 503) {
      backoffUntil = Date.now() + 60_000;
      return { ...base, error: "rate_limited" };
    }
    // Any other failure is upstream's, not a statement about the product. A 404
    // from this endpoint still returns JSON with status 0, handled below.
    if (!res.ok) return { ...base, error: "upstream_error" };

    // A block page is HTML, so this throws. Reporting that as "offline" would
    // be wrong — we reached them fine, they refused to answer.
    try {
      json = (await res.json()) as typeof json;
    } catch {
      backoffUntil = Date.now() + 60_000;
      return { ...base, error: "upstream_error" };
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ...base, error: aborted ? "timeout" : "offline" };
  } finally {
    clearTimeout(timer);
  }

  if (json.status !== 1 || !json.product) {
    const miss = { ...base, error: "not_found" as const };
    cache.set(clean, miss);
    return miss;
  }

  const tags = json.product.ingredients_tags ?? [];
  const { ingredients, unmatched, ignored } = mapTags(tags);

  // Rule 1: an unmapped ingredient is logged and reported, never guessed at.
  for (const tag of unmatched) {
    opts.onUnmapped?.(new DataMissingError("off_ingredient_map", tag, `ean ${clean}`));
  }

  const result: BarcodeResult = {
    found: ingredients.length > 0,
    // We reached the product either way — only the ingredient mapping failed.
    product_found: true,
    ean: clean,
    name: json.product.product_name?.trim() || "Packaged product",
    brand: json.product.brands?.split(",")[0]?.trim(),
    ingredients,
    unmatched_tags: unmatched,
    ignored_tags: ignored,
    quality: "medium",
    estimated: true,
    error: ingredients.length > 0 ? undefined : "no_ingredients",
  };
  cache.set(clean, result);
  return result;
}
