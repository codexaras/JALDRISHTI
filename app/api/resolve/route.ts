import { getProduct, logMissing, productName } from "../../../repo/db.ts";
import { resolveBarcode } from "../../../resolvers/barcode.ts";
import { resolveImage } from "../../../resolvers/vision.ts";
import { resolveText, CONFIDENT_THRESHOLD } from "../../../resolvers/textmatch.ts";
import { bad, fail, isDemo, langOf, ok } from "../_lib/respond.ts";
import { loadDemoBarcode } from "../_lib/demo.ts";
import type { Lang } from "../../../engine/types.ts";

/**
 * POST /api/resolve — identify only. Never calculates.
 *
 * BUILD_SPEC 6a + AMENDMENT_02 §5: every input path routes
 * `resolve → confirmation screen → calculate`. This endpoint feeds the
 * confirmation screen; it returns candidates and a suggested portion, and the
 * human decides. A failed recognition therefore looks like a designed step
 * rather than a crash.
 */
interface ResolveBody {
  input_type: "name" | "barcode" | "image" | "voice";
  value?: string;
  /** base64, for input_type "image". */
  image?: string;
  media_type?: "image/jpeg" | "image/png" | "image/webp";
  lang?: string;
}

export async function POST(request: Request): Promise<Response> {
  // `?demo=true` must make NO network call. The engine already worked offline;
  // these two branches are the ones that reach out, and they are what venue
  // WiFi takes down.
  const demo = isDemo(new URL(request.url));

  let body: ResolveBody;
  try {
    body = (await request.json()) as ResolveBody;
  } catch {
    return bad("body must be JSON");
  }

  const lang: Lang = langOf(body.lang);

  try {
    switch (body.input_type) {
      case "name":
      case "voice": {
        const q = (body.value ?? "").trim();
        if (!q) return bad("value is required");
        const candidates = resolveText(q, lang, 8);
        return ok({
          input_type: body.input_type,
          query: q,
          // Below the threshold we return suggestions, never a guess.
          confident: candidates.length > 0 && candidates[0].score >= CONFIDENT_THRESHOLD,
          candidates: candidates.map((c) => ({
            ...c,
            default_serving_g: safeServing(c.product_id),
          })),
          quality: "high" as const,
        });
      }

      case "barcode": {
        const ean = (body.value ?? "").trim();
        if (!ean) return bad("value is required");

        // Cached REAL Open Food Facts responses, snapshotted by `demo:build`.
        // A barcode outside the snapshot returns an honest miss rather than a
        // network call that would hang on a dead connection.
        const result = demo
          ? (loadDemoBarcode(ean) ?? {
              found: false,
              product_found: false,
              ean,
              name: "",
              brand: undefined,
              ingredients: [],
              unmatched_tags: [],
              quality: "medium" as const,
              estimated: true,
              error: "not_found" as const,
            })
          : await resolveBarcode(ean, { onUnmapped: (e) => logMissing(e) });

        return ok({
          input_type: "barcode",
          ean: result.ean,
          found: result.found,
          // Passed through so the screen can tell "we don't have this product"
          // apart from "the lookup failed". Saying the first when the second
          // happened is a false statement about our data.
          product_found: result.product_found ?? false,
          error: result.error,
          name: result.name,
          brand: result.brand,
          confident: result.found,
          // Mass fractions come from ingredient ORDER, not measurement — the UI
          // must say so, which is why this flag is part of the contract.
          estimated_from_ingredient_order: result.estimated,
          quality: result.quality,
          ingredients: result.ingredients,
          unmatched_tags: result.unmatched_tags,
          candidates: [],
          default_serving_g: 100,
        });
      }

      case "image": {
        if (!body.image) return bad("image (base64) is required");

        // There is no offline vision model, so demo mode says so immediately
        // instead of spending 20 seconds timing out against a dead network —
        // twenty seconds of silence in front of judges. Search and barcode
        // both still work, and the message points at them.
        if (demo) {
          return ok({
            input_type: "image",
            ok: false,
            error: "demo_offline",
            confident: false,
            candidates: [],
            items: [],
            quality: "medium" as const,
          });
        }

        const result = await resolveImage(body.image, body.media_type ?? "image/jpeg", {
          env: {
            VISION_PROVIDER: readEnv("VISION_PROVIDER"),
            GEMINI_API_KEY: readEnv("GEMINI_API_KEY"),
            GOOGLE_API_KEY: readEnv("GOOGLE_API_KEY"),
            ANTHROPIC_API_KEY: readEnv("ANTHROPIC_API_KEY"),
            GEMINI_MODEL: readEnv("GEMINI_MODEL"),
          },
          lang,
        });
        return ok({
          input_type: "image",
          ok: result.ok,
          error: result.error,
          provider: result.provider,
          confident: result.ok && result.items.some((i) => i.confidence >= 0.6),
          // A photo's candidates hang off each detected item, but every other
          // input type returns a top-level `candidates`. Send the empty array
          // so all four branches have one shape — the confirmation sheet used
          // to crash reading `.length` off the key this branch omitted.
          candidates: [],
          items: result.items.map((i) => ({
            ...i,
            candidates: (i.candidates ?? []).map((c) => ({
              ...c,
              default_serving_g: safeServing(c.product_id),
            })),
          })),
          quality: "medium" as const,
        });
      }

      default:
        return bad(`unknown input_type "${String(body.input_type)}"`);
    }
  } catch (err) {
    return fail(err);
  }
}

function safeServing(productId: string): number {
  try {
    return getProduct(productId).default_serving_g;
  } catch {
    return 100;
  }
}

/** Worker-safe env read — `process` is not always defined. */
function readEnv(key: string): string | undefined {
  try {
    return (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[key];
  } catch {
    return undefined;
  }
}

export { productName };
