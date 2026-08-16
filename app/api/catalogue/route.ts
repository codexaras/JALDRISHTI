import { allProducts, calculateProduct, getCrop, getIngredients, productName } from "../../../repo/db.ts";
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

/** Broad groups for the filter row, derived from the crops a product is made of. */
function groupOf(productId: string): string {
  try {
    const ingredients = getIngredients(productId);
    const categories = ingredients
      .map((i) => getCrop(i.crop_id)?.category)
      .filter((c) => Boolean(c)) as string[];
    if (categories.length === 0) return "Other";

    if (categories.includes("fibre")) return "Non-food";
    if (categories.includes("animal")) return "Animal";
    // The heaviest ingredient decides the group for a mixed dish.
    const primary = ingredients
      .slice()
      .sort((a, b) => b.raw_grams_per_100g - a.raw_grams_per_100g)[0];
    const category: string = getCrop(primary.crop_id)?.category ?? "Other";
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
      animal: "Animal",
      fibre: "Non-food",
    };
    return GROUPS[category] ?? "Other";
  } catch {
    return "Other";
  }
}

let cache: CatalogueItem[] | null = null;

function buildCatalogue(lang: ReturnType<typeof langOf>): CatalogueItem[] {
  const items: CatalogueItem[] = [];
  for (const product of allProducts()) {
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
