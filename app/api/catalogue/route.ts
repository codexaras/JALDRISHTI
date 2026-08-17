import { visibleProducts, calculateProduct, getCrop, getIngredients, productName } from "../../../repo/db.ts";
import { fail, intOf, langOf, ok } from "../_lib/respond.ts";

/**
 * GET /api/catalogue?lang=&category=&limit=
 *
 * Every product with its **computed** footprint, for the browse grids.
 *
 * These screens previously rendered a hardcoded six-item array with invented
 * ranges ("2,300–2,700 L/kg"). Those numbers came from nowhere and disagreed
 * with the engine on the very next screen. Browsing and calculating now read
 * from the same source.
 */
interface CatalogueItem {
  product_id: string;
  name: string;
  name_en: string;
  category: string;
  type: string;
  serving_g: number;
  total_l: number;
  green_l: number;
  blue_l: number;
  grey_l: number;
  stress_score: number;
  confidence: string;
  /** Share of the total that is irrigation water — what the efficiency bar shows. */
  blue_share: number;
  is_food: boolean;
}

/**
 * Broad groups for the filter row, from the crops a product is made of.
 *
 * Grouped by the heaviest NON-ANIMAL ingredient. The old rule returned "Animal"
 * whenever any ingredient was animal, so a splash of milk filed masala chai,
 * Parle-G and aloo paratha under "Animal" — 14 dishes in a category that should
 * describe what the food mostly is. Animal products themselves are hidden
 * (is_visible = 0), so nothing purely animal reaches this function at all.
 *
 * Display only. No footprint depends on it.
 */
const GROUPS: Record<string, string> = {
  cereal: "Cereals",
  pulse: "Pulses",
  vegetable: "Vegetables",
  fruit: "Fruits",
  oilseed: "Oilseeds",
  nut: "Nuts",
  spice: "Spices",
  beverage: "Beverages",
  sugar: "Sugar",
  fibre: "Non-food",
};

function groupOf(productId: string): string {
  try {
    const ingredients = getIngredients(productId);
    if (ingredients.length === 0) return "Other";

    // A garment is a garment whatever else is in it.
    if (ingredients.some((i) => getCrop(i.crop_id)?.category === "fibre")) return "Non-food";

    const ranked = ingredients
      .filter((i) => getCrop(i.crop_id)?.category !== "animal")
      .sort((a, b) => b.raw_grams_per_100g - a.raw_grams_per_100g);
    if (ranked.length === 0) return "Other";

    const category = getCrop(ranked[0].crop_id)?.category ?? "Other";
    return GROUPS[category] ?? "Other";
  } catch {
    return "Other";
  }
}

let cache: CatalogueItem[] | null = null;

function buildCatalogue(lang: ReturnType<typeof langOf>): CatalogueItem[] {
  const items: CatalogueItem[] = [];
  for (const product of visibleProducts()) {
    try {
      // Month pinned so the grid does not reshuffle as the season changes.
      const r = calculateProduct(product.product_id, { lang, month: 7 });
      items.push({
        product_id: product.product_id,
        name: productName(product, lang),
        name_en: product.name_en,
        category: groupOf(product.product_id),
        type: product.type,
        serving_g: r.product.serving_g,
        total_l: r.footprint_l.total,
        green_l: r.footprint_l.green,
        blue_l: r.footprint_l.blue,
        grey_l: r.footprint_l.grey,
        stress_score: r.stress_score,
        confidence: r.confidence.quality,
        blue_share: r.footprint_l.total ? r.footprint_l.blue / r.footprint_l.total : 0,
        is_food: product.type !== "non_food",
      });
    } catch {
      // A product that cannot be calculated is omitted rather than shown with a
      // blank or zero figure.
    }
  }
  return items;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lang = langOf(url.searchParams.get("lang"));
  const category = (url.searchParams.get("category") ?? "").trim();
  const limit = Math.min(200, Math.max(1, intOf(url.searchParams.get("limit"), 200)));
  const sort = url.searchParams.get("sort") ?? "score";

  try {
    // Cache only the English pass; other languages differ just by name.
    let items = lang === "en" ? (cache ??= buildCatalogue("en")) : buildCatalogue(lang);

    if (category && category !== "All") {
      items = items.filter((i) => i.category === category);
    }

    const sorted = [...items].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "lightest"
          ? a.stress_score - b.stress_score
          : b.stress_score - a.stress_score,
    );

    return ok({
      count: sorted.length,
      categories: ["All", ...[...new Set(items.map((i) => i.category))].sort()],
      items: sorted.slice(0, limit),
    });
  } catch (err) {
    return fail(err);
  }
}
