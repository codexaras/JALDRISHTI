import { bad, langOf, ok } from "../../../_lib/respond.ts";
import { bridgeStore, getLive, type CaptureType } from "../../../_lib/bridge-store.ts";
import { resolveImage } from "../../../../../resolvers/vision.ts";
import { resolveBarcode } from "../../../../../resolvers/barcode.ts";
import { getProduct, isVisible, logMissing } from "../../../../../repo/db.ts";

/**
 * POST /api/bridge/:id/push — the phone sends its capture.
 *
 * Recognition runs HERE, server-side, the moment the capture lands. By the time
 * the laptop's next poll comes round (1.5 s), the candidates are already
 * waiting, so the photo appears to jump onto the screen already identified.
 * Doing it on the poll instead would stall the UI for the length of a vision
 * call while the spinner sat on "connected".
 */
function readEnv(key: string): string | undefined {
  try {
    return (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[key];
  } catch {
    return undefined;
  }
}

function safeServing(productId: string): number {
  try {
    return getProduct(productId).default_serving_g;
  } catch {
    return 100;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = getLive(id);
  if (!session) return bad("session not found", 404);
  if (session.status === "expired") return bad("session expired", 410);

  let body: { type?: CaptureType; value?: string; media_type?: string; lang?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("body must be JSON");
  }

  const type = body.type;
  const value = (body.value ?? "").trim();
  if (type !== "image" && type !== "barcode") return bad("type must be image or barcode");
  if (!value) return bad("value is required");

  const lang = langOf(body.lang);
  bridgeStore.put({ ...session, status: "processing", capture_type: type, payload: value });

  let candidates: unknown;
  try {
    if (type === "barcode") {
      // The phone decoded this itself — 13 characters instead of a 200 KB
      // photo of a barcode, and far more reliable than re-reading an image.
      const r = await resolveBarcode(value, { onUnmapped: (e) => logMissing(e) });
      candidates = {
        input_type: "barcode",
        ean: r.ean,
        found: r.found,
        product_found: r.product_found ?? false,
        error: r.error,
        name: r.name,
        brand: r.brand,
        confident: r.found,
        estimated_from_ingredient_order: r.estimated,
        quality: r.quality,
        ingredients: r.ingredients,
        unmatched_tags: r.unmatched_tags,
        candidates: [],
        default_serving_g: 100,
      };
    } else {
      const r = await resolveImage(value, (body.media_type as "image/jpeg") ?? "image/jpeg", {
        env: {
          VISION_PROVIDER: readEnv("VISION_PROVIDER"),
          GEMINI_API_KEY: readEnv("GEMINI_API_KEY"),
          GOOGLE_API_KEY: readEnv("GOOGLE_API_KEY"),
          ANTHROPIC_API_KEY: readEnv("ANTHROPIC_API_KEY"),
          GEMINI_MODEL: readEnv("GEMINI_MODEL"),
        },
        lang,
      });

      // A match on an out-of-scope product must say so rather than vanish —
      // silence reads as "the camera failed", which is a different problem.
      const items = r.items.map((i) => ({
        ...i,
        candidates: (i.candidates ?? [])
          .filter((c) => isVisible(c.product_id))
          .map((c) => ({ ...c, default_serving_g: safeServing(c.product_id) })),
      }));
      const droppedAll = r.items.length > 0 && items.every((i) => i.candidates.length === 0);

      candidates = {
        input_type: "image",
        ok: r.ok,
        error: droppedAll ? "out_of_scope" : r.error,
        provider: r.provider,
        confident: r.ok && items.some((i) => i.confidence >= 0.6 && i.candidates.length > 0),
        candidates: [],
        items,
        quality: "medium" as const,
      };
    }
  } catch (err) {
    bridgeStore.put({ ...session, status: "connected" });
    return bad(err instanceof Error ? err.message : "recognition failed", 500);
  }

  bridgeStore.put({
    ...session,
    status: "ready",
    capture_type: type,
    payload: value,
    candidates: JSON.stringify(candidates),
  });

  return ok({ status: "ready" });
}
