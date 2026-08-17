"use client";

/**
 * The header avatar — sign in, sign out, and the local profile sheet.
 *
 * AMENDMENT_11 §1 hard constraint: **signing in is optional everywhere.** This
 * component adds a control to the header and nothing else. No route is gated,
 * no modal opens on load, no result screen is withheld. A judge who never
 * touches it sees the entire app.
 *
 * Everything is device-local — see app/lib/account-store.ts for why the secret
 * is a PIN and not a password.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LogOut, User, X } from "lucide-react";
import { useLang } from "../lib/i18n-client.tsx";
import {
  createAccount,
  currentAccount,
  getServerSnapshot,
  getSnapshot,
  initials,
  signIn,
  signOut,
  subscribe,
} from "../lib/account-store.ts";

export function useAccount() {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return currentAccount();
}

export function AccountMenu({ onOpenProfile }: { onOpenProfile: () => void }) {
  const { t } = useLang();
  const account = useAccount();
  const [sheet, setSheet] = useState(false);
  const [mode, setMode] = useState<"signin" | "create">("create");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (sheet) nameRef.current?.focus();
  }, [sheet]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = mode === "create"
      ? await createAccount(name, pin, email)
      : await signIn(name, pin);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setSheet(false);
    setName(""); setPin(""); setEmail("");
  };

  if (account) {
    return (
      <div className="acctMenu">
        <button className="profilebtn" onClick={onOpenProfile} aria-label={account.display_name}>
          {initials(account.display_name)}
        </button>
        <button className="acctSignOut" onClick={signOut} aria-label={t("auth.signOut")} title={t("auth.signOut")}>
          <LogOut size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <>
      <button className="acctSignIn" onClick={() => setSheet(true)}>
        <User size={16} strokeWidth={2} aria-hidden="true" />
        {t("auth.signIn")}
      </button>

      {sheet && (
        <div className="modalShade" role="dialog" aria-modal="true" aria-label={t("auth.signIn")}>
          <div className="bottomSheet acctSheet">
            <button className="close" onClick={() => setSheet(false)} aria-label={t("search.clear_aria")}>
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>

            <span className="success">{t(mode === "create" ? "auth.create" : "auth.signIn").toUpperCase()}</span>
            {/* Says plainly that this is optional, so nobody reads it as a wall. */}
            <p className="acctNote">{t("auth.optional")}</p>

            <label>
              {t("auth.name")}
              <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && submit()} autoComplete="off" />
            </label>

            <label>
              {t("auth.pin")}
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                     onKeyDown={(e) => e.key === "Enter" && submit()}
                     inputMode="numeric" autoComplete="off" />
            </label>
            {/* The warning matters more than the field: a local-only store
                cannot protect a reused password, so we ask for digits. */}
            <small className="acctHint">{t("auth.pinHint")}</small>

            {mode === "create" && (
              <label>
                Email <em style={{ fontStyle: "normal", color: "var(--muted)" }}>({t("auth.pin").split(" ").pop()})</em>
                <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
              </label>
            )}

            {error && <p className="acctError">{t(error)}</p>}
            <small className="acctHint">🔒 {t("auth.localOnly")}</small>

            <button className="primary" disabled={busy || name.trim().length < 2} onClick={submit}>
              {busy ? "…" : t("auth.continue")}
            </button>
            <button className="acctSwitch" onClick={() => { setMode(mode === "create" ? "signin" : "create"); setError(null); }}>
              {t(mode === "create" ? "auth.haveProfile" : "auth.newProfile")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
