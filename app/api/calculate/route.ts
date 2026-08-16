import { calculateProduct, recordScan } from "../../../repo/db.ts";
import { resolveText } from "../../../resolvers/textmatch.ts";
import { bad, fail, langOf, ok } from "../_lib/respond.ts";
import { loadDemo } from "../_lib/demo.ts";
import type { Lang } from "../../../engine/types.ts";

/**
 * POST /api/calculate — the personal footprint.
 *
 * Two ways in:
 *   { product_id }  the confirmed path the UI always uses (BUILD_SPEC 6a)
 *   { input_type: "name", value } convenience for scripts and the section-9 curls
 *
 * The UI never sends a raw name here — it calls /api/resolve, shows the
 * confirmation screen, and posts back the product_id the user approved.
 */
interface CalculateBody {
  input_type?: "name" | "product_id" | "barcode";
  value?: string;
  product_id?: string;
  serving_g?: number;
  month?: number;
  lang?: string;
  force_state?: string;
  region?: string;
  demo?: boolean;
}

export async function POST(request: Request): Promise<Response> {
  let body: CalculateBody;
  try {
    body = (await request.json()) as CalculateBody;
  } catch {
    return bad("body must be JSON");
  }

  const url = new URL(request.url);
  const lang: Lang = langOf(body.lang ?? url.searchParams.get("lang"));
  const demo = body.demo === true || url.searchParams.get("demo") === "true";

  // Resolve a name to a product id when one was not supplied directly.
  let productId = body.product_id;
  if (!productId) {
    const value = (body.value ?? "").trim();
    if (!value) return bad("provide product_id, or input_type + value");
    const [best] = resolveText(value, lang, 1);
    if (!best) {
      return ok({ error: "not_found", query: value, candidates: [] }, {});
    }
    productId = best.product_id;
  }

  if (demo) {
    const cached = loadDemo(productId);
    if (cached) return ok({ ...cached, demo: true });
    // Not one of the five cached items — fall through and compute locally,
    // which still needs no network because the dataset is bundled.
  }

  try {
    const result = calculateProduct(productId, {
      servingG: body.serving_g,
      month: body.month,
      lang,
      forceState: body.force_state,
    });

    // Region-level only. No identifier of any kind is accepted or stored.
    if (body.region) {
      recordScan(
        {
          product_id: productId,
          region: body.region,
          litres: result.footprint_l.total,
          score: result.stress_score,
        },
        new Date().toISOString(),
        `live_${Math.abs(hash(productId + body.region + result.footprint_l.total))}`,
      );
    }

    return ok(demo ? { ...result, demo: true } : result);
  } catch (err) {
    return fail(err);
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export async function GET(): Promise<Response> {
  return bad("use POST", 405);
}
