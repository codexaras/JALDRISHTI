/**
 * JalMitra — retrieval, guards and grounded templates.
 *
 * Architecture: RETRIEVE → GROUND → ANSWER, never ASK → ANSWER. The question is
 * mined for entities FIRST, the database is queried for exactly those rows, and
 * only then does a model see anything. Two modes fall out:
 *
 *   grounded  — our data answered. Gemini may only rephrase the retrieved
 *               context; a guard verifies every number in the reply exists in
 *               that context, and falls back to a template if not.
 *   general   — nothing retrieved. Gemini may explain concepts freely, but a
 *               second guard blocks the two number types our engine owns:
 *               water footprints in litres and groundwater percentages. One
 *               invented figure beside a cited one is two answers in one app.
 *
 * Everything in this file is deterministic and network-free, which is what
 * makes the whole design testable without a model in the loop — and what lets
 * the chatbot keep answering grounded questions when Gemini is down.
 */
import {
  allDistricts,
  cropVisible,
  getCrop,
  getIngredients,
  cropName,
  productName,
  visibleProducts,
} from "../../../repo/db.ts";
import { resolveText } from "../../../resolvers/textmatch.ts";
import { GLOSSARY } from "../../lib/learn-content.ts";
import { t } from "../../../i18n/index.ts";
import type { Crop, GwStress, Lang } from "../../../engine/types.ts";

export type ChatIntent =
  | "groundwater"
  | "worst_state"
  | "footprint"
  | "comparison"
  | "concept"
  | "sources"
  | "result"
  | "unknown";

export type ChatMode = "grounded" | "general";

export interface CropContext {
  crop_id: string;
  name: string;
  green_l_per_kg: number;
  blue_l_per_kg: number;
  grey_l_per_kg: number;
  total_l_per_kg: number;
  source: string;
}

export interface StateContext {
  state: string;
  soe_pct: number;
  category: string;
  precision: string;
  band_min: number;
  band_max: number;
  assessment_year: number;
  source: string;
}

/** Whitelisted fields of the on-screen result — never the raw payload. */
export interface ResultContext {
  product_name: string;
  serving_g: number;
  total_l: number;
  green_l: number;
  blue_l: number;
  grey_l: number;
  stress_score: number;
  top_state?: string;
  top_status?: string;
  fallbacks: string[];
}

export interface ChatContext {
  crops?: CropContext[];
  states?: StateContext[];
  concepts?: { term: string; definition: string }[];
  citations?: string[];
  worst?: StateContext[];
  result?: ResultContext;
}

export interface Retrieved {
  intent: ChatIntent;
  mode: ChatMode;
  context: ChatContext;
  /** Human-readable citation labels for the UI's source line. */
  sources: string[];
  /** Entities asked about that our data does not hold (partial matches). */
  missing: string[];
}

// ─── source labels ──────────────────────────────────────────────────────────

/** The actual citations behind the data — mirrors data/SOURCES.md. */
export const CITATIONS = [
  "Mekonnen & Hoekstra 2011, Value of Water Report 47 (crop water footprints)",
  "CGWB Dynamic Ground Water Resources Assessment 2024–25 (groundwater)",
  "Directorate of Economics & Statistics (state production shares)",
  "Open Food Facts (packaged ingredient lists)",
];

export function sourceLabel(tag: string): string {
  if (/CGWB/i.test(tag) || tag.startsWith("S3")) return "CGWB 2024–25";
  if (tag.startsWith("S1")) return "Mekonnen & Hoekstra 2011";
  if (tag.startsWith("S2")) return "NEEDS_SOURCE";
  return tag;
}

// ─── entity extraction ──────────────────────────────────────────────────────

/** Common variants that don't literally match a gw_stress state name. */
const STATE_VARIANTS: Record<string, string> = {
  bengal: "West Bengal", kashmir: "Jammu and Kashmir", orissa: "Odisha",
  pondicherry: "Puducherry", tamilnadu: "Tamil Nadu", chattisgarh: "Chhattisgarh",
  पंजाब: "Punjab", राजस्थान: "Rajasthan", हरियाणा: "Haryana", दिल्ली: "Delhi",
  महाराष्ट्र: "Maharashtra", बंगाल: "West Bengal", कर्नाटक: "Karnataka",
  "तमिलनाडु": "Tamil Nadu", "उत्तर प्रदेश": "Uttar Pradesh", "பஞ்சாப்": "Punjab",
  "தமிழ்நாடு": "Tamil Nadu", "தமிழ்நாட்டில்": "Tamil Nadu",
};

/** Glossary aliases so "नीला पानी क्या है" still hits the blue-water entry. */
const CONCEPT_VARIANTS: Record<string, string> = {
  "blue water": "blue_water", "green water": "green_water", "grey water": "grey_water",
  "gray water": "grey_water", "water footprint": "water_footprint",
  "virtual water": "virtual_water", "stage of extraction": "soe", "soe": "soe",
  kharif: "kharif", rabi: "rabi",
  "नीला पानी": "blue_water", "हरा पानी": "green_water", "धूसर पानी": "grey_water",
  "निळे पाणी": "blue_water", "हिरवे पाणी": "green_water",
  "நீல நீர்": "blue_water", "பச்சை நீர்": "green_water",
};

/** Words that must never become a crop lookup ("water" would hit watermelon…). */
const STOPWORDS = new Set([
  "the","a","an","is","are","was","how","much","many","what","which","why","does",
  "do","need","needs","use","uses","water","level","levels","in","of","for","to",
  "and","or","vs","versus","compare","comparison","with","instead","about","tell",
  "me","my","this","that","it","state","states","groundwater","footprint","litre",
  "litres","liters","per","kg","kilogram","high","low","worst","best","highest",
  "पानी","कितना","क्या","में","का","की","के","है","चाहिए","किती","पाणी","आहे",
  "தண்ணீர்","எவ்வளவு","என்ன",
]);

export function findStates(question: string): GwStress[] {
  const q = question.toLowerCase();
  const hits = new Map<string, GwStress>();
  for (const row of allDistricts()) {
    if (q.includes(row.state.toLowerCase())) hits.set(row.state, row);
  }
  for (const [variant, state] of Object.entries(STATE_VARIANTS)) {
    if (q.includes(variant.toLowerCase())) {
      const row = allDistricts().find((g) => g.state === state);
      if (row) hits.set(row.state, row);
    }
  }
  return [...hits.values()];
}

export function findCrops(question: string, lang: Lang): { productId: string; crops: Crop[]; name: string }[] {
  const tokens = question
    .replace(/[?.,!；;:'"()]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()));

  const found = new Map<string, { productId: string; crops: Crop[]; name: string }>();
  const products = new Map(visibleProducts().map((p) => [p.product_id, p]));

  for (const token of tokens) {
    if (found.size >= 3) break;
    const [hit] = resolveText(token, lang, 1);
    if (!hit?.confident) continue;
    if (found.has(hit.product_id)) continue;
    const product = products.get(hit.product_id);
    if (!product) continue;
    let ingredients: { crop_id: string }[] = [];
    try { ingredients = getIngredients(hit.product_id); } catch { continue; }
    // Animal crops never reach a chat context — their figures are uncited,
    // and a grounded answer built on one would launder the gap.
    const crops = ingredients
      .map((i) => getCrop(i.crop_id))
      .filter((c): c is Crop => Boolean(c) && cropVisible(c!.crop_id))
      .slice(0, 3);
    if (crops.length === 0) continue;
    found.set(hit.product_id, { productId: hit.product_id, crops, name: productName(product, lang) });
  }
  return [...found.values()];
}

export function findConcepts(question: string): { term: string; definition: string }[] {
  const q = question.toLowerCase();
  const ids = new Set<string>();
  for (const [phrase, id] of Object.entries(CONCEPT_VARIANTS)) {
    if (q.includes(phrase.toLowerCase())) ids.add(id);
  }
  return GLOSSARY.filter((g) => ids.has(g.id)).map((g) => ({ term: g.term, definition: g.definition }));
}

// ─── retrieval ──────────────────────────────────────────────────────────────

const GW_WORDS = /groundwater|ground water|aquifer|extraction|water table|भूजल|भूगर्भ|पाणी पातळी|நிலத்தடி/i;
const WORST_WORDS = /worst|highest|most (?:stressed|extracted|depleted)|सबसे (?:खराब|ज़्यादा)|सर्वात वाईट/i;
const SOURCE_WORDS = /source|citation|cite|data (?:from|come)|where.*data|references?|स्रोत|कहाँ से|संदर्भ/i;
const COMPARE_WORDS = /compare|versus|\bvs\.?\b|difference between|instead of|तुलना|बनाम|ऐवजी|ஒப்பிடு/i;
const RESULT_WORDS = /\bthis\b|\bit\b|यह|हे|இது|why.*high|why.*score|इतना/i;

const toStateCtx = (g: GwStress): StateContext => ({
  state: g.state,
  soe_pct: g.soe_pct,
  category: g.category,
  precision: g.precision,
  band_min: g.band_min,
  band_max: g.band_max,
  assessment_year: g.assessment_year,
  source: sourceLabel(g.source),
});

const toCropCtx = (crop: Crop, lang: Lang): CropContext => ({
  crop_id: crop.crop_id,
  name: cropName(crop, lang),
  green_l_per_kg: crop.wf_green,
  blue_l_per_kg: crop.wf_blue,
  grey_l_per_kg: crop.wf_grey,
  total_l_per_kg: crop.wf_green + crop.wf_blue + crop.wf_grey,
  source: sourceLabel(crop.source),
});

export function retrieve(question: string, lang: Lang, result?: ResultContext): Retrieved {
  const states = findStates(question);
  const cropsFound = findCrops(question, lang);
  const concepts = findConcepts(question);
  const missing: string[] = [];

  // Sources — the citation list, no figures involved.
  if (SOURCE_WORDS.test(question)) {
    return { intent: "sources", mode: "grounded", context: { citations: CITATIONS }, sources: CITATIONS, missing };
  }

  // "Which state is worst?" — sorted gw_stress, top rows.
  if (WORST_WORDS.test(question) && GW_WORDS.test(question)) {
    const worst = [...allDistricts()].sort((a, b) => b.soe_pct - a.soe_pct).slice(0, 3).map(toStateCtx);
    return { intent: "worst_state", mode: "grounded", context: { worst }, sources: ["CGWB 2024–25"], missing };
  }

  // Comparison — capture both comparanda so an unknown one is named, not lost.
  if (COMPARE_WORDS.test(question) || cropsFound.length >= 2) {
    if (cropsFound.length >= 1) {
      const m = question.match(/(?:compare|between)?\s*(.+?)\s+(?:and|vs\.?|versus|with|instead of|या|आणि)\s+(.+)/i);
      if (m && cropsFound.length === 1) {
        // One side resolved, the other did not — say which is which (partial).
        const resolvedName = cropsFound[0].name.toLowerCase();
        for (const side of [m[1], m[2]]) {
          const clean = side.replace(/[?.]/g, "").trim();
          const words = clean.split(/\s+/).filter((w) => !STOPWORDS.has(w.toLowerCase()));
          const isResolved = words.some((w) => resolvedName.includes(w.toLowerCase()) ||
            resolveText(w, lang, 1)[0]?.product_id === cropsFound[0].productId);
          if (!isResolved && words.length > 0) missing.push(words.join(" "));
        }
      }
      const crops = cropsFound.flatMap((f) => f.crops.map((c) => toCropCtx(c, lang)));
      return {
        intent: "comparison",
        mode: "grounded",
        context: { crops },
        sources: [...new Set(crops.map((c) => c.source))],
        missing,
      };
    }
  }

  // Groundwater for named states.
  if (states.length > 0 && (GW_WORDS.test(question) || cropsFound.length === 0)) {
    const ctx = states.map(toStateCtx);
    return { intent: "groundwater", mode: "grounded", context: { states: ctx }, sources: ["CGWB 2024–25"], missing };
  }

  // Crop footprint.
  if (cropsFound.length > 0) {
    const crops = cropsFound.flatMap((f) => f.crops.map((c) => toCropCtx(c, lang)));
    return {
      intent: "footprint",
      mode: "grounded",
      context: { crops },
      sources: [...new Set(crops.map((c) => c.source))],
      missing,
    };
  }

  // Concept from the glossary.
  if (concepts.length > 0) {
    return { intent: "concept", mode: "grounded", context: { concepts }, sources: ["Jal Drishti glossary"], missing };
  }

  // "Why is this high?" against the on-screen result.
  if (result && RESULT_WORDS.test(question)) {
    return { intent: "result", mode: "grounded", context: { result }, sources: ["This calculation"], missing };
  }

  // Nothing retrieved — the model may speak generally, under the number ban.
  return { intent: "unknown", mode: "general", context: {}, sources: [], missing };
}

// ─── guards ─────────────────────────────────────────────────────────────────

const numberTokens = (text: string): number[] =>
  (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => Number(s.replace(/,/g, ""))).filter((v) => Number.isFinite(v));

/** Every number the context could legitimately put in an answer. */
export function contextNumbers(ctx: ChatContext): Set<number> {
  const out = new Set<number>();
  const add = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      out.add(v);
      out.add(Math.round(v));
    } else if (typeof v === "string") {
      for (const n of numberTokens(v)) out.add(n);
    } else if (Array.isArray(v)) {
      v.forEach(add);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(add);
    }
  };
  add(ctx);
  return out;
}

/**
 * Grounded answers may contain ONLY numbers present in the retrieved context.
 * Small prose numerals ("the three colours") and years pass; anything that
 * looks like a figure must be traceable. On failure the caller falls back to
 * the template — the user still gets a correct answer, just less fluent.
 */
export function guardModeA(answer: string, ctx: ChatContext): boolean {
  const allowed = contextNumbers(ctx);
  for (const n of numberTokens(answer)) {
    if (n <= 15) continue;                       // prose numerals, list positions
    if (n >= 1990 && n <= 2035) continue;        // years in citations
    if (n === 70) continue;                      // CGWB's published Safe ceiling
    if (allowed.has(n) || allowed.has(Math.round(n))) continue;
    return false;
  }
  return true;
}

const LITRES_FIGURE = /\d[\d,]*(?:\.\d+)?\s*(?:l\b|litres?|liters?|लीटर|लिटर|லிட்டர்)/i;
const PERCENT_FIGURE = /\d[\d,]*(?:\.\d+)?\s*(?:%|percent|per\s*cent|प्रतिशत|टक्के|சதவீதம்)/i;

/**
 * The one restriction that matters: a general answer must never state a water
 * footprint in litres or a groundwater percentage. Those two number types are
 * what the engine produces from cited sources — an invented one beside a cited
 * one is two answers in one app with no defensible explanation.
 */
export function guardModeB(answer: string): { ok: boolean; violation?: "litres" | "percent" } {
  if (LITRES_FIGURE.test(answer)) return { ok: false, violation: "litres" };
  if (PERCENT_FIGURE.test(answer)) return { ok: false, violation: "percent" };
  return { ok: true };
}

// ─── grounded templates — the no-Gemini path ────────────────────────────────

/** Band description for a band_midpoint state, reusing the result screen's keys. */
function bandText(lang: Lang, s: StateContext): string {
  const status = t(lang, `status.${s.category}`);
  if (s.category === "over_exploited") return t(lang, "result.bandOver", { status, min: s.band_min });
  if (s.band_min === 0) return t(lang, "result.bandUnder", { status, max: s.band_max });
  return t(lang, "result.bandRange", { status, min: s.band_min, max: s.band_max });
}

/**
 * A correct answer straight from the retrieved rows, no model involved. This
 * is what ships when Gemini is unavailable, times out, or fails the guard —
 * grounded questions must never come back empty-handed.
 */
export function templateAnswer(r: Retrieved, lang: Lang): string {
  const parts: string[] = [];

  if (r.context.states?.length) {
    for (const s of r.context.states) {
      parts.push(
        s.precision === "exact"
          ? t(lang, "chat.tmpl.gwExact", { state: s.state, pct: s.soe_pct, category: t(lang, `status.${s.category}`), year: s.assessment_year })
          : t(lang, "chat.tmpl.gwBand", { state: s.state, band: bandText(lang, s), year: s.assessment_year }),
      );
    }
  }

  if (r.context.worst?.length) {
    const w = r.context.worst[0];
    parts.push(t(lang, "chat.tmpl.worst", { state: w.state, pct: w.soe_pct, category: t(lang, `status.${w.category}`) }));
  }

  if (r.context.crops?.length) {
    for (const c of r.context.crops.slice(0, 3)) {
      parts.push(
        t(lang, "chat.tmpl.crop", {
          name: c.name, green: c.green_l_per_kg, blue: c.blue_l_per_kg,
          grey: c.grey_l_per_kg, total: c.total_l_per_kg,
        }),
      );
    }
    if (r.intent === "comparison" && r.context.crops.length >= 2) {
      parts.push(t(lang, "chat.tmpl.compareNote"));
    }
  }

  if (r.context.concepts?.length) {
    for (const c of r.context.concepts) parts.push(`${c.term}: ${c.definition}`);
  }

  if (r.context.citations?.length) {
    parts.push(`${t(lang, "chat.tmpl.sourcesIntro")} ${r.context.citations.join("; ")}.`);
  }

  if (r.context.result) {
    const x = r.context.result;
    parts.push(
      t(lang, "chat.tmpl.result", {
        name: x.product_name, total: x.total_l, green: x.green_l, blue: x.blue_l,
        grey: x.grey_l, score: x.stress_score,
      }),
    );
  }

  if (r.missing.length) {
    parts.push(t(lang, "chat.tmpl.partial", { missing: r.missing.join(", ") }));
  }

  return parts.join(" ");
}

// ─── the system prompt, verbatim from the spec ──────────────────────────────

export const SYSTEM_PROMPT = `You are JalMitra, a helper inside the Jal Drishti water footprint app.

You are given a JSON context object containing data retrieved from our database.

WHEN THE CONTEXT HAS DATA:
- Answer ONLY using figures present in the context.
- NEVER use your own knowledge about that crop, state or product.
- NEVER calculate, estimate, derive, round or invent any number.
- Never contradict the context. It is the single source of truth.
- Mention the source when the context provides one.
- If a value is marked precision "band_midpoint", state the band
  (e.g. "Safe, under 70% extracted") rather than quoting a decimal.

WHEN THE CONTEXT IS EMPTY:
- You may answer from your general knowledge about water, agriculture, food
  and the environment. Explain concepts, processes and practices freely.
- NEVER state a specific water footprint in litres, or a groundwater
  extraction percentage for any region. Those come only from our database.
- If the question needs such a figure, explain the concept and tell the user
  to search for the exact number in the app.
- Be honest about uncertainty. Do not present opinion as fact.
- Stay on topic. For unrelated questions, redirect briefly.

ALWAYS:
- Answer in the language given by \`lang\`.
- Under 80 words. Plain language. No jargon. No markdown formatting.`;
