/**
 * Translation lookup.
 *
 * BUILD_SPEC phase 5: **templates only, never translate at runtime.** The API
 * returns `{key, params}`; this renders it. Numbers arrive already computed, so
 * a translation can never change one.
 *
 * Three text classes, three mechanisms:
 *   UI chrome        → these JSON files
 *   Entity names     → DB columns name_en/hi/mr/ta (see repo/db.ts)
 *   Generated text   → ICU-style templates + params, rendered here
 */
import en from "./en.json" with { type: "json" };
import hi from "./hi.json" with { type: "json" };
import mr from "./mr.json" with { type: "json" };
import ta from "./ta.json" with { type: "json" };
import type { Lang, MessageRef } from "../engine/types.ts";

const BUNDLES: Record<Lang, Record<string, string>> = { en, hi, mr, ta };

export const LANGS: Lang[] = ["en", "hi", "mr", "ta"];

/** Native-script label for the language switcher — never a translated one. */
export const LANG_LABEL: Record<Lang, string> = {
  en: "English",
  hi: "हिंदी",
  mr: "मराठी",
  ta: "தமிழ்",
};

/** Short label for the compact header toggle. */
export const LANG_SHORT: Record<Lang, string> = { en: "EN", hi: "हिं", mr: "मरा", ta: "தமி" };

export function isLang(value: string): value is Lang {
  return (LANGS as string[]).includes(value);
}

/**
 * Render a key with params. Falls back to English, then to the key itself —
 * a missing translation shows the English string, never a blank or a crash.
 */
export function t(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  const template = BUNDLES[lang]?.[key] ?? BUNDLES.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Render a `{key, params}` pair straight from the API. */
export function tRef(lang: Lang, ref: MessageRef): string {
  return t(lang, ref.key, ref.params);
}

/**
 * Indian digit grouping (1,24,500).
 *
 * Latin digits deliberately: Devanagari and Tamil numerals confuse more users
 * than they help, and every price tag and water bill in India uses Latin ones.
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(Math.round(value));
}

/**
 * Font stack for the active language.
 *
 * Manrope covers no Devanagari or Tamil — without these the UI renders tofu
 * boxes (□□□) in three of the four languages. This is why the fonts load
 * per-language rather than relying on the base stack.
 */
export const FONT_STACK: Record<Lang, string> = {
  en: "Manrope, system-ui, sans-serif",
  hi: "Manrope, 'Noto Sans Devanagari', system-ui, sans-serif",
  mr: "Manrope, 'Noto Sans Devanagari', system-ui, sans-serif",
  ta: "Manrope, 'Noto Sans Tamil', system-ui, sans-serif",
};
