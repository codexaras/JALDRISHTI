/**
 * The active language, as an external store.
 *
 * The obvious approach — `useState("en")` plus an effect that reads
 * localStorage — sets state during an effect on every mount and makes the first
 * paint flash English before switching. `useSyncExternalStore` is the tool
 * built for this: it reads the real value on the client and a stable "en" on
 * the server, so hydration matches and there is no cascading render.
 */
import { LANGS } from "../../i18n/index.ts";
import type { Lang } from "../../engine/types.ts";

const STORAGE_KEY = "jaldrishti.lang";
const SERVER_SNAPSHOT: Lang = "en";

let current: Lang | null = null;
const listeners = new Set<() => void>();

function read(): Lang {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && (LANGS as string[]).includes(saved)) return saved as Lang;
  } catch {
    /* private browsing — fall through to the default */
  }
  return SERVER_SNAPSHOT;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Must return a cached value — a fresh read each call would loop forever. */
export function getSnapshot(): Lang {
  if (current === null) current = read();
  return current;
}

export function getServerSnapshot(): Lang {
  return SERVER_SNAPSHOT;
}

export function setLanguage(lang: Lang): void {
  if (current === lang) return;
  current = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* the language still works this session, it just will not persist */
  }
  // `<html lang>` drives the Devanagari/Tamil font stacks in globals.css.
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  for (const listener of listeners) listener();
}

export function nextLanguage(from: Lang): Lang {
  return LANGS[(LANGS.indexOf(from) + 1) % LANGS.length];
}
