import { allProducts, calculateProduct } from "../../../repo/db.ts";
import { resolveText } from "../../../resolvers/textmatch.ts";
import { bad, fail, intOf, langOf, ok } from "../_lib/respond.ts";
import type { CalculationResult } from "../../../engine/types.ts";

/**
 * GET /api/compare?products=rice,bajra,jowar&serving_g=200&month=8
 *
 * AMENDMENT_02 §3. Seeing rice, bajra and jowar side by side is far more
 * persuasive than one line of advice, and "sensitize the people" is the PS's
 * stated goal.
 *
 * No new calculation logic — the same pipeline, once per product.
 */
const MAX_PRODUCTS = 4;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("products") ?? "").trim();
  if (!raw) return bad("products is required, e.g. ?products=rice,bajra,jowar");

  const lang = langOf(url.searchParams.get("lang"));
  const servingG = url.searchParams.get("serving_g");
  const month = url.searchParams.get("month");

  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_PRODUCTS);

  if (names.length < 2) return bad("provide at least 2 products to compare");

  try {
    const items: CalculationResult[] = [];
    const unresolved: string[] = [];
    const knownIds = new Set(allProducts().map((p) => p.product_id));

    for (const name of names) {
      // An exact product_id wins before any fuzzy matching.
      //
      // The compare screen is seeded with `pending.product_id`, so this path is
      // the common one — and without the exact check the id goes through the
      // text resolver, where "rice_raw" scored as "rajma chawal" and the screen
      // silently compared two products nobody asked for.
      let productId: string | undefined = knownIds.has(name) ? name : undefined;
      if (!productId) {
        const [match] = resolveText(name, lang, 1);
        productId = match?.product_id;
      }
      if (!productId) {
        unresolved.push(name);
        continue;
      }
      items.push(
        calculateProduct(productId, {
          servingG: servingG ? intOf(servingG, 0) || undefined : undefined,
          month: month ? intOf(month, 0) || undefined : undefined,
          lang,
        }),
      );
    }

    if (items.length < 2) {
      return bad(`could not resolve enough products. Unresolved: ${unresolved.join(", ")}`);
    }

    // "Best" ranks on stress-weighted BLUE water, not total footprint — the
    // same basis engine/swap.ts uses, and for the same reason.
    //
    // Ranking on the total would make this screen contradict the swap card
    // sitting next to it: rice has a smaller total than bajra (millets are
    // rain-fed with modest yields, so their green water is large), but bajra
    // draws a fraction of the irrigation water. Total says "rice is better",
    // blue says "bajra is better", and only one of those is about the water
    // that competes with a district's aquifer.
    // `impact_l` is grey + stress-weighted blue (green excluded at source),
    // so the irrigation component is one subtraction away.
    const blueImpact = (r: CalculationResult) => r.impact_l - r.footprint_l.grey;

    const sorted = [...items].sort((a, b) => blueImpact(a) - blueImpact(b));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    return ok({
      items: items.map((i) => ({
        ...i,
        // Surfaced so the frontend can plot the bar that decides the ranking.
        impact_blue_l: Math.round(blueImpact(i)),
      })),
      best: best.product.id,
      worst: worst.product.id,
      ranked_by: "impact_blue_l",
      ranked_by_note:
        "Ranked on stress-weighted irrigation (blue) water, not total footprint. Green water is rainfall the crop would have received anyway; only blue water competes with groundwater.",
      saving_vs_worst_l: Math.round(blueImpact(worst) - blueImpact(best)),
      saving_vs_worst_total_l: Math.round(worst.footprint_l.total - best.footprint_l.total),
      unresolved,
      // Shared Y-axis maxima so the frontend's bars are visually comparable.
      axis_max_l: Math.max(...items.map((i) => i.footprint_l.total)),
      axis_max_blue_l: Math.max(...items.map((i) => blueImpact(i))),
    });
  } catch (err) {
    return fail(err);
  }
}
