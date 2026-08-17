/**
 * Learn section content — AMENDMENT_14.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ PROVENANCE: the amendment expects `data/learn_content.json`, human-authored.
 * That file was never supplied, so the prose is AGENT-WRITTEN — originally in
 * English only (§9), now translated into hi/mr/ta by the same agent on explicit
 * instruction. All of it still deserves a native speaker's review.
 *
 * The TEXT lives in i18n/{en,hi,mr,ta}.json under `learn.*` — the same bundles
 * as every other string, so tests/language.test.ts guards that the four key
 * sets match AND that the non-English values are really in their own script.
 * This module holds only the SHAPE: ids, stat references, widget placement,
 * answer indexes. `learnContent(lang)` resolves shape + text together.
 *
 * ⚠ NO NUMBERS LIVE IN THE PROSE. Amendment §2: a Learn page quoting one figure
 * for rice while the calculator computes another is worse than no Learn page.
 * Every figure is a { cropId, field } reference resolved against the live
 * database at render time — tests/learn.test.ts scans this file AND the four
 * i18n bundles' learn.* values, and fails if a litre figure ever appears as a
 * literal. The single methodological constant (CGWB's Safe ceiling) is
 * imported from the engine and interpolated as {threshold}, never retyped.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { t } from "../../i18n/index.ts";
import type { Lang } from "../../engine/types.ts";
import { CGWB_SAFE_THRESHOLD } from "../../engine/stress.ts";

/** Params every learn key may interpolate. */
const PARAMS = { threshold: CGWB_SAFE_THRESHOLD };

/** A figure resolved live from /api/learn/stats — never a literal. */
export interface StatRef {
  cropId: string;
  field: "green" | "blue" | "grey" | "total";
  /** Template with {value}; the number arrives at render time. */
  template: string;
}

export interface GuideStep {
  id: string;
  heading: string;
  body: string;
  stat?: StatRef;
  emphasis?: boolean;
  visual: "droplets" | "rain" | "borewell" | "runoff" | "states" | "formula";
}

export interface ArticleSection {
  id: string;
  heading: string;
  body: string;
  widget?: "compare-table" | "bajra-callout";
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface MythPair {
  myth: string;
  fact: string;
}

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
}

// ─── shape only — key prefixes into i18n, plus everything non-textual ───────

const GUIDE_META = [
  { id: "three-colours", k: "g1", visual: "droplets" },
  { id: "green", k: "g2", visual: "rain", stat: { cropId: "rice", field: "green" } },
  { id: "blue", k: "g3", visual: "borewell", emphasis: true, stat: { cropId: "rice", field: "blue" } },
  { id: "grey", k: "g4", visual: "runoff", stat: { cropId: "rice", field: "grey" } },
  { id: "where", k: "g5", visual: "states", emphasis: true },
  { id: "formula", k: "g6", visual: "formula" },
] as const;

const ARTICLE_META = [
  { id: "seed", k: "a1" },
  { id: "three-colours", k: "a2", widget: "compare-table" },
  { id: "bajra", k: "a3", widget: "bajra-callout" },
  { id: "plate", k: "a4" },
] as const;

/** §5 — three questions; the correct option index is data, not text. */
const QUIZ_META = [
  { id: "green-def", k: "q1", answerIndex: 1 },
  { id: "rain-aquifer", k: "q2", answerIndex: 1 },
  { id: "thesis", k: "q3", answerIndex: 1 },
] as const;

const GLOSSARY_IDS = [
  ["green_water", "gl1"], ["blue_water", "gl2"], ["grey_water", "gl3"],
  ["water_footprint", "gl4"], ["virtual_water", "gl5"], ["soe", "gl6"],
  ["kharif", "gl7"], ["rabi", "gl8"],
] as const;

export interface LearnContent {
  GUIDE: GuideStep[];
  ARTICLE: ArticleSection[];
  QUIZ: QuizQuestion[];
  MYTHS: MythPair[];
  GLOSSARY: GlossaryTerm[];
  FAQ: { q: string; a: string }[];
}

/** Shape + text, resolved for one language. */
export function learnContent(lang: Lang): LearnContent {
  const tr = (k: string) => t(lang, `learn.${k}`, PARAMS);
  return {
    GUIDE: GUIDE_META.map((m) => ({
      id: m.id,
      heading: tr(`${m.k}.h`),
      body: tr(`${m.k}.b`),
      stat: "stat" in m ? { ...m.stat, template: tr(`${m.k}.stat`) } : undefined,
      emphasis: "emphasis" in m ? m.emphasis : undefined,
      visual: m.visual,
    })),
    ARTICLE: ARTICLE_META.map((m) => ({
      id: m.id,
      heading: tr(`${m.k}.h`),
      body: tr(`${m.k}.b`),
      widget: "widget" in m ? m.widget : undefined,
    })),
    QUIZ: QUIZ_META.map((m) => ({
      id: m.id,
      question: tr(`${m.k}.q`),
      options: [1, 2, 3, 4].map((i) => tr(`${m.k}.o${i}`)),
      answerIndex: m.answerIndex,
      explanation: tr(`${m.k}.x`),
    })),
    MYTHS: [1, 2, 3, 4, 5, 6].map((i) => ({ myth: tr(`m${i}.myth`), fact: tr(`m${i}.fact`) })),
    GLOSSARY: GLOSSARY_IDS.map(([id, k]) => ({ id, term: tr(`${k}.term`), definition: tr(`${k}.def`) })),
    FAQ: [1, 2, 3].map((i) => ({ q: tr(`f${i}.q`), a: tr(`f${i}.a`) })),
  };
}

/**
 * §8 — the spoken version of the hub, for Web Speech. Assembled from content
 * already on screen; duration is computed from this text, never hardcoded.
 */
export function listenScript(lang: Lang = "en"): string {
  const c = learnContent(lang);
  return [
    t(lang, "learn.listenIntro"),
    c.GUIDE.map((s) => `${s.heading}. ${s.body}`).join(" "),
    `${t(lang, "learn.mythWord")}: ${c.MYTHS[0].myth} ${t(lang, "learn.factWord")}: ${c.MYTHS[0].fact}`,
  ].join(" ");
}

/** Spoken-word estimate at a typical Indian-language TTS rate. */
export const SPOKEN_WORDS_PER_MINUTE = 150;

export function estimateListenMinutes(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / SPOKEN_WORDS_PER_MINUTE));
}
