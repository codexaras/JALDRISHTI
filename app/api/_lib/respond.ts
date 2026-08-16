/**
 * Shared helpers for the route handlers.
 *
 * BUILD_SPEC section 9 curls these as `localhost:8000/calculate`. On Next.js
 * app-router file conventions they live under `/api/...`, so the verification
 * paths are `/api/calculate`, `/api/city/mumbai/water`, and so on.
 */
import { DataMissingError } from "../../../engine/errors.ts";
import { isLang } from "../../../i18n/index.ts";
import type { Lang } from "../../../engine/types.ts";

export const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  // The open-data endpoints are meant to be readable by anyone (PS: "readily
  // available data"), so they are deliberately CORS-open and unauthenticated.
  "Access-Control-Allow-Origin": "*",
};

export function ok(body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

export function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

/** Turn a thrown error into an honest response — never a fabricated fallback result. */
export function fail(err: unknown): Response {
  if (err instanceof DataMissingError) {
    return new Response(
      JSON.stringify({
        error: "data_missing",
        table: err.table,
        key: err.key,
        context: err.context,
        message: err.message,
      }),
      { status: 422, headers: JSON_HEADERS },
    );
  }
  const message = err instanceof Error ? err.message : "unknown error";
  return new Response(JSON.stringify({ error: "internal_error", message }), {
    status: 500,
    headers: JSON_HEADERS,
  });
}

export function langOf(value: string | null | undefined): Lang {
  return value && isLang(value) ? value : "en";
}

export function intOf(value: string | null | undefined, fallback: number): number {
  // A missing param must reach the fallback. It did not: `Number(null)` is 0
  // and `Number("")` is 0, both finite, so an absent `?limit=` returned 0 —
  // which `Math.max(1, …)` then turned into a limit of ONE. The catalogue
  // reported 168 products and served a single card.
  if (value === null || value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** `?demo=true` — serve cached payloads and make no network call. */
export function isDemo(url: URL): boolean {
  return url.searchParams.get("demo") === "true";
}
