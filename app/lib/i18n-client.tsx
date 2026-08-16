"use client";

/**
 * Language switching for the client.
 *
 * BUILD_SPEC phase 5: no user-facing string is translated at runtime. `t()`
 * renders a pre-authored template; the API returns `{key, params}` and the
 * numbers inside are already computed, so a translation can never change one.
 *
 * The active language lives in an external store (`lang-store.ts`) rather than
 * component state, so the value is read correctly on first paint instead of
 * flashing English and then correcting itself.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { formatNumber, LANG_SHORT, t as translate, tRef } from "../../i18n/index.ts";
import {
  getServerSnapshot,
  getSnapshot,
  nextLanguage,
  setLanguage,
  subscribe,
} from "./lang-store.ts";
import type { Lang, MessageRef } from "../../engine/types.ts";

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  cycle: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  tRef: (ref: MessageRef) => string;
  n: (value: number) => string;
  short: string;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setLang = useCallback((l: Lang) => setLanguage(l), []);
  const cycle = useCallback(() => setLanguage(nextLanguage(getSnapshot())), []);

  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      setLang,
      cycle,
      t: (key, params) => translate(lang, key, params),
      tRef: (ref) => tRef(lang, ref),
      n: formatNumber,
      short: LANG_SHORT[lang],
    }),
    [lang, setLang, cycle],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside <LangProvider>");
  return ctx;
}
