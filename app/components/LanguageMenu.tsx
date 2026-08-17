"use client";

/**
 * Language switcher — AMENDMENT_11 §2.
 *
 * Replaces a button that CYCLED through the languages: reaching Tamil from
 * English took three clicks, and there was no way to see what the options were
 * without cycling past them. This shows all of them at once.
 *
 * Each language is labelled in its OWN script — "हिंदी", never "Hindi". A person
 * who cannot read the current interface language still has to be able to find
 * theirs, which is the whole point of the control.
 *
 * The list is built from `LANGS` in i18n/index.ts, so adding a language is one
 * entry in that array plus its JSON bundle — no change here.
 */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { LANGS, LANG_LABEL, LANG_SHORT } from "../../i18n/index.ts";
import { useLang } from "../lib/i18n-client.tsx";

export function LanguageMenu() {
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Escape closes and returns focus to the trigger; an outside click just
  // closes. Both are what a menu is expected to do, and neither is free.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Move focus into the menu when it opens, so keyboard users are not stranded
  // on the trigger with an open list they cannot reach.
  useEffect(() => {
    if (open) itemsRef.current[LANGS.indexOf(lang)]?.focus();
  }, [open, lang]);

  const onItemKey = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const last = LANGS.length - 1;
    const next =
      e.key === "ArrowDown" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowUp" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : last;
    itemsRef.current[next]?.focus();
  };

  return (
    <div className="langMenu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="language"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("lang.change")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>अ</span> {LANG_SHORT[lang]}
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div className="langList" role="menu" aria-label={t("lang.change")}>
          {LANGS.map((code, i) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={code === lang}
              ref={(el) => { itemsRef.current[i] = el; }}
              onKeyDown={(e) => onItemKey(e, i)}
              onClick={() => {
                // Applies immediately — no confirm step, no reload. `setLang`
                // notifies the external store and every subscriber re-renders.
                setLang(code);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <i aria-hidden="true">{code === lang && <Check size={15} strokeWidth={2.5} />}</i>
              {/* Native script, always. */}
              <span lang={code}>{LANG_LABEL[code]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
