/**
 * Typed fetch wrapper — the only place the UI talks to the API.
 *
 * BUILD_SPEC phase 6: "add a data layer only." Nothing here reaches into a
 * component, and no component builds a URL of its own.
 *
 * AMENDMENT_02 §1: the frontend never fetches regional stress separately.
 * Groundwater weighting happens inside /api/calculate and arrives as
 * `sources[]` on the result.
 */
import type { CalculationResult, Lang } from "../../engine/types.ts";

export interface Candidate {
  product_id: string;
  name: string;
  score: number;
  matched_on: string;
  confident: boolean;
  default_serving_g: number;
  type?: string;
}

export interface ResolveResult {
  input_type: string;
  query?: string;
  confident: boolean;
  /**
   * OPTIONAL — the image path does not return this key at all.
   *
   * It was declared required, so TypeScript vouched for a field the API never
   * sent, and the confirmation sheet crashed on `.length` the first time
   * anyone scanned a photo. For images the candidates live on `items[].candidates`.
   */
  candidates?: Candidate[];
  quality: "high" | "medium" | "low";
  // barcode
  ean?: string;
  found?: boolean;
  /** Open Food Facts had the product, even if we could not map its ingredients. */
  product_found?: boolean;
  name?: string;
  brand?: string;
  estimated_from_ingredient_order?: boolean;
  ingredients?: { crop_id: string; raw_grams_per_100g: number }[];
  unmatched_tags?: string[];
  default_serving_g?: number;
  // vision
  ok?: boolean;
  error?: string;
  items?: { name: string; est_grams: number; confidence: number; candidates: Candidate[] }[];
}

export interface CompareResult {
  items: (CalculationResult & { impact_blue_l: number })[];
  best: string;
  worst: string;
  ranked_by: string;
  ranked_by_note: string;
  saving_vs_worst_l: number;
  axis_max_l: number;
  axis_max_blue_l: number;
}

export interface CityWaterResult {
  city: string;
  reservoirs: { reservoir: string; pct: number; capacity_ml: number; overflowing: number }[];
  overall_pct: number;
  total_capacity_ml: number;
  updated_on: string;
  groundwater: {
    district: string;
    soe_pct: number;
    category: string;
    /** "state" when CGWB publishes this state's own figure, "national" when it stands in. */
    level: "state" | "national" | "district";
  } | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** `?demo=true` in the page URL propagates to every call. */
export function demoActive(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("demo") === "true";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, typeof window === "undefined" ? "http://localhost" : window.location.origin);
  if (demoActive()) url.searchParams.set("demo", "true");

  const res = await fetch(url.toString(), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : `request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

export interface CatalogueItem {
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
  blue_share: number;
  is_food: boolean;
}

export const api = {
  catalogue: (lang: Lang, category?: string, sort = "score") => {
    const p = new URLSearchParams({ lang, sort });
    if (category && category !== "All") p.set("category", category);
    return request<{ count: number; categories: string[]; items: CatalogueItem[] }>(
      `/api/catalogue?${p}`,
    );
  },

  search: (q: string, lang: Lang) =>
    request<Candidate[]>(`/api/product/search?q=${encodeURIComponent(q)}&lang=${lang}`),

  resolve: (payload: {
    input_type: "name" | "barcode" | "image" | "voice";
    value?: string;
    image?: string;
    media_type?: string;
    lang: Lang;
  }) => request<ResolveResult>("/api/resolve", { method: "POST", body: JSON.stringify(payload) }),

  calculate: (payload: {
    product_id: string;
    serving_g?: number;
    month?: number;
    lang: Lang;
    force_state?: string;
    region?: string;
  }) =>
    request<CalculationResult>("/api/calculate", { method: "POST", body: JSON.stringify(payload) }),

  compare: (products: string[], lang: Lang, servingG?: number, month?: number) => {
    const p = new URLSearchParams({ products: products.join(","), lang });
    if (servingG) p.set("serving_g", String(servingG));
    if (month) p.set("month", String(month));
    return request<CompareResult>(`/api/compare?${p}`);
  },

  cityWater: (city: string) => request<CityWaterResult>(`/api/city/${encodeURIComponent(city)}/water`),

  community: (region: string, lang: Lang) =>
    request<{
      region: string;
      scans: number;
      total_litres: number;
      average_litres: number;
      average_score: number;
      top_items: { product_id: string; name: string; scans: number; total_litres: number }[];
      virtual_water_inflow_l: number;
      empty?: boolean;
    }>(`/api/community/aggregate?region=${encodeURIComponent(region)}&lang=${lang}`),

  explain: (result: CalculationResult, question: string, lang: Lang) =>
    request<{ answer: string; source: string; reason?: string }>("/api/explain", {
      method: "POST",
      body: JSON.stringify({ result, question, lang }),
    }),
};
