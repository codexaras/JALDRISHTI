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
const COOKIE_KEY = "jaldrishti_lang";
const SERVER_SNAPSHOT: Lang = "en";

/**
 * A cookie, not just localStorage — AMENDMENT_11 §2.
 *
 * localStorage is invisible to the server, so the first paint is always English
 * and only corrects after hydration. A cookie travels with the request, which
 * is what lets the server render the right language later. Both are written:
 * the cookie is the source of truth, localStorage stays as a fallback for
 * anyone whose browser blocks cookies.
 *
 * A signed-in user's `preferred_lang` would take precedence over both, once
 * accounts exist.
 */
function readCookie(): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie.split("; ").find((row) => row.startsWith(`${COOKIE_KEY}=`));
  return hit ? decodeURIComponent(hit.slice(COOKIE_KEY.length + 1)) : null;
}

function writeCookie(lang: Lang): void {
  if (typeof document === "undefined") return;
  // A year, path-wide, lax so it survives normal navigation without riding
  // along on cross-site requests.
  document.cookie = `${COOKIE_KEY}=${lang}; path=/; max-age=31536000; samesite=lax`;
}

let current: Lang | null = null;
const listeners = new Set<() => void>();

function read(): Lang {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;

  const fromCookie = readCookie();
  if (fromCookie && (LANGS as string[]).includes(fromCookie)) return fromCookie as Lang;

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
  if (current === null) {
    current = read();
    // The stored language must reach `<html lang>` on FIRST paint too, not only
    // when someone changes it — otherwise a returning Hindi user gets the Latin
    // font stack until they touch the switcher.
    if (typeof document !== "undefined") document.documentElement.lang = current;
  }
  return current;
}

export function getServerSnapshot(): Lang {
  return SERVER_SNAPSHOT;
}

export function setLanguage(lang: Lang): void {
  if (current === lang) return;
  current = lang;
  writeCookie(lang);
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
