"use client";

/**
 * Local accounts and search history — AMENDMENT_11 §1, stored on this device only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * This is a LOCAL PROFILE, not authentication. There is no server: the app
 * reads a build-time bundle and has no datastore, so there is nothing to
 * authenticate *against*. Everything here lives in this browser.
 *
 * That is why the sign-in secret is a 4–6 digit PIN and never a password.
 * Anything stored client-side can be read by any script or extension on the
 * device, and people reuse passwords — a "password" field on a local-only form
 * invites someone to type their real one into a place that cannot protect it.
 * A PIN is honest about what it does: it stops a casual look on a shared
 * laptop, and nothing more. The UI says so in those words.
 *
 * The PIN is still run through PBKDF2-SHA256 with a per-account random salt and
 * 150k iterations, and only the digest is stored. Not because it makes the
 * store secure, but because the PIN should not be readable even by someone
 * poking at localStorage.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HARD CONSTRAINT (§1): signing in is OPTIONAL EVERYWHERE.
 *
 * Nothing gates on it. No wall, no modal on load, no locked result screen.
 * Signing in adds saved history and a remembered language; that is all. Every
 * feature works exactly the same signed out, and anonymous scans still record
 * to the community aggregate.
 */
import type { Lang } from "../../engine/types.ts";

const ACCOUNTS_KEY = "jaldrishti.accounts";
const SESSION_KEY = "jaldrishti.session";
const HISTORY_LIMIT = 50;

export interface HistoryEntry {
  product_id: string;
  name: string;
  litres: number;
  score: number;
  /** ISO timestamp — the only time value stored. */
  at: string;
}

export interface Account {
  id: string;
  display_name: string;
  /** Optional. Used only as a label; nothing is ever sent anywhere. */
  email?: string;
  /** PBKDF2-SHA256 digest, base64. Absent when the profile has no PIN. */
  pin_hash?: string;
  /** Random per-account salt, base64. */
  pin_salt?: string;
  preferred_lang?: Lang;
  created_at: string;
  history: HistoryEntry[];
}

type State = { accounts: Account[]; currentId: string | null };

const listeners = new Set<() => void>();
let cache: State | null = null;

const EMPTY: State = { accounts: [], currentId: null };

function load(): State {
  if (typeof window === "undefined") return EMPTY;
  try {
    const accounts = JSON.parse(window.localStorage.getItem(ACCOUNTS_KEY) ?? "[]") as Account[];
    const currentId = window.localStorage.getItem(SESSION_KEY);
    // A session pointing at a deleted profile must not strand the UI signed in.
    const valid = currentId && accounts.some((a) => a.id === currentId) ? currentId : null;
    return { accounts: Array.isArray(accounts) ? accounts : [], currentId: valid };
  } catch {
    return EMPTY;
  }
}

function persist(state: State): void {
  cache = state;
  try {
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(state.accounts));
    if (state.currentId) window.localStorage.setItem(SESSION_KEY, state.currentId);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private browsing — the profile works for this session only */
  }
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): State {
  if (cache === null) cache = load();
  return cache;
}

/** Signed out on the server, always — there is no session to read there. */
export function getServerSnapshot(): State {
  return EMPTY;
}

export function currentAccount(): Account | null {
  const { accounts, currentId } = getSnapshot();
  return accounts.find((a) => a.id === currentId) ?? null;
}

// ─── PIN hashing ────────────────────────────────────────────────────────────

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function hashPin(pin: string, saltB64: string): Promise<string> {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 150_000, hash: "SHA-256" },
    key,
    256,
  );
  return b64(bits);
}

function newSalt(): string {
  return b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

// ─── Account actions ────────────────────────────────────────────────────────

export const PIN_PATTERN = /^\d{4,6}$/;

export type AuthResult = { ok: true; account: Account } | { ok: false; error: string };

export async function createAccount(
  displayName: string,
  pin: string,
  email?: string,
): Promise<AuthResult> {
  const name = displayName.trim();
  if (name.length < 2) return { ok: false, error: "auth.err.name" };
  if (pin && !PIN_PATTERN.test(pin)) return { ok: false, error: "auth.err.pin" };

  const state = getSnapshot();
  if (state.accounts.some((a) => a.display_name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: "auth.err.exists" };
  }

  const salt = pin ? newSalt() : undefined;
  const account: Account = {
    id: crypto.randomUUID(),
    display_name: name,
    email: email?.trim() || undefined,
    pin_salt: salt,
    pin_hash: salt ? await hashPin(pin, salt) : undefined,
    created_at: new Date().toISOString(),
    history: [],
  };

  persist({ accounts: [...state.accounts, account], currentId: account.id });
  return { ok: true, account };
}

export async function signIn(displayName: string, pin: string): Promise<AuthResult> {
  const state = getSnapshot();
  const account = state.accounts.find(
    (a) => a.display_name.toLowerCase() === displayName.trim().toLowerCase(),
  );

  // One generic failure for both "no such profile" and "wrong PIN" — naming
  // which one is wrong tells an onlooker which profiles exist.
  const generic: AuthResult = { ok: false, error: "auth.err.invalid" };
  if (!account) return generic;

  if (account.pin_hash && account.pin_salt) {
    if (!pin) return generic;
    const digest = await hashPin(pin, account.pin_salt);
    if (digest !== account.pin_hash) return generic;
  }

  persist({ ...state, currentId: account.id });
  return { ok: true, account };
}

export function signOut(): void {
  persist({ ...getSnapshot(), currentId: null });
}

export function deleteAccount(id: string): void {
  const state = getSnapshot();
  persist({
    accounts: state.accounts.filter((a) => a.id !== id),
    currentId: state.currentId === id ? null : state.currentId,
  });
}

/**
 * Record a lookup against the signed-in profile.
 *
 * A no-op when signed out — which is the point: browsing anonymously must leave
 * nothing behind. The community aggregate still counts the scan, because that
 * is region-only and carries no identity.
 */
export function recordSearch(entry: HistoryEntry): void {
  const state = getSnapshot();
  const account = state.accounts.find((a) => a.id === state.currentId);
  if (!account) return;

  // Same product twice in a row is one entry, most recent first, capped.
  const history = [entry, ...account.history.filter((h) => h.product_id !== entry.product_id)]
    .slice(0, HISTORY_LIMIT);

  persist({
    accounts: state.accounts.map((a) => (a.id === account.id ? { ...a, history } : a)),
    currentId: state.currentId,
  });
}

export function clearHistory(): void {
  const state = getSnapshot();
  if (!state.currentId) return;
  persist({
    accounts: state.accounts.map((a) => (a.id === state.currentId ? { ...a, history: [] } : a)),
    currentId: state.currentId,
  });
}

export function setPreferredLang(lang: Lang): void {
  const state = getSnapshot();
  if (!state.currentId) return;
  persist({
    accounts: state.accounts.map((a) => (a.id === state.currentId ? { ...a, preferred_lang: lang } : a)),
    currentId: state.currentId,
  });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
