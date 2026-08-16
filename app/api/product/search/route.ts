import { getProduct } from "../../../../repo/db.ts";
import { resolveText } from "../../../../resolvers/textmatch.ts";
import { intOf, langOf, ok } from "../../_lib/respond.ts";

/**
 * GET /api/product/search?q=&lang=
 *
 * Romanised input matters most — most users type Latin script even in Hindi,
 * Marathi or Tamil — so "bhindi" and "भेंडी" must both reach okra. That is a
 * BUILD_SPEC section 9 check.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const lang = langOf(url.searchParams.get("lang"));
  const limit = Math.min(25, Math.max(1, intOf(url.searchParams.get("limit"), 8)));

  if (!q) return ok([]);

  const results = resolveText(q, lang, limit).map((c) => {
    let serving = 100;
    let type = "";
    try {
      const p = getProduct(c.product_id);
      serving = p.default_serving_g;
      type = p.type;
    } catch {
      /* candidate came from an alias whose product vanished — omit the extras */
    }
    return { ...c, default_serving_g: serving, type };
  });

  return ok(results);
}
