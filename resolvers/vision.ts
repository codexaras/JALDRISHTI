/**
 * Image → identified food items.
 *
 * Provider-agnostic: Gemini (free tier) or Claude, selected from whichever key
 * is configured. See `vision-providers.ts`.
 *
 * Two deliberate deviations from BUILD_SPEC phase 4:
 *
 *   1. "temperature 0" is honoured on Gemini, which still accepts it. It is
 *      REMOVED on Claude Opus 5 and returns a 400, so determinism there comes
 *      from a constrained output schema plus low effort instead.
 *   2. Asking a model to "return ONLY valid JSON" is the pre-structured-outputs
 *      workaround. Both providers are given a response schema, so malformed
 *      JSON is not a failure mode we have to prompt our way around. The
 *      defensive parser is still present for truncation and for any future
 *      provider without schema support.
 *
 * Every resolver returns a candidate, never a final answer: the confirmation
 * screen always shows before a calculation runs.
 */
import { resolveText, type Candidate } from "./textmatch.ts";
import { QuotaError, selectVisionProvider, type VisionEnv, type VisionProvider } from "./vision-providers.ts";
import type { Lang } from "../engine/types.ts";

export { parseDefensively } from "./vision-providers.ts";

export interface VisionItem {
  name: string;
  est_grams: number;
  confidence: number;
  /** Catalogue matches for this detected name, best first. */
  candidates: Candidate[];
}

export interface VisionResult {
  ok: boolean;
  items: VisionItem[];
  /** Which provider answered, for the "Why this number?" panel. */
  provider?: string;
  /** Human-readable reason, for the scan screen. */
  detail?: string;
  /** Set when identification could not run — the UI falls back to manual entry. */
  error?: "not_configured" | "refused" | "unreadable" | "failed" | "timeout" | "quota";
}

/** BUILD_SPEC phase 3: every external call has a timeout and a fallback path. */
const TIMEOUT_MS = 20000;

export interface VisionOptions {
  /** Anthropic key, for backwards compatibility with the original signature. */
  apiKey?: string;
  env?: VisionEnv;
  provider?: VisionProvider;
  lang?: Lang;
  timeoutMs?: number;
}

export async function resolveImage(
  base64Image: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  opts: VisionOptions = {},
): Promise<VisionResult> {
  const provider =
    opts.provider ??
    selectVisionProvider(opts.env ?? { ANTHROPIC_API_KEY: opts.apiKey });

  if (!provider) {
    // No key configured — the scan screen offers manual search instead of
    // presenting a dead button.
    return { ok: false, items: [], error: "not_configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);

  let detected;
  try {
    detected = await provider.identify(base64Image, mediaType, controller.signal);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    const outOfQuota = err instanceof QuotaError;
    return {
      ok: false,
      items: [],
      provider: provider.name,
      error: outOfQuota ? "quota" : aborted ? "timeout" : "failed",
      detail: err instanceof Error ? err.message : undefined,
    };
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(detected)) {
    return { ok: false, items: [], provider: provider.name, error: "unreadable" };
  }

  const lang = opts.lang ?? "en";
  const items: VisionItem[] = detected
    .filter((i) => i.name && i.name.trim().length > 0)
    .map((i) => ({
      name: i.name.trim(),
      est_grams: Math.max(0, Math.round(i.est_grams)),
      confidence: Math.min(1, Math.max(0, i.confidence)),
      candidates: resolveText(i.name, lang, 4),
    }));

  return { ok: true, items, provider: provider.name };
}
