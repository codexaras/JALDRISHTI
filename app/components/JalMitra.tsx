"use client";

/**
 * JalMitra — the floating chat.
 *
 * Bottom-right launcher, panel anchored above it. Conversation lives in
 * component state only: no database, no history, nothing persisted.
 *
 * The mode of every answer is VISIBLE, not cosmetic. A grounded answer shows
 * its citation line; a general answer carries the muted "not from our dataset"
 * label. A judge can see at a glance which sentences are backed by data and
 * which are the model talking — that distinction is the whole design.
 */
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { useLang } from "../lib/i18n-client.tsx";
import type { CalculationResult } from "../../engine/types.ts";

interface ChatMessage {
  role: "user" | "bot";
  text: string;
  mode?: "grounded" | "general";
  sources?: string[];
}

interface ChatResponse {
  answer: string;
  mode: "grounded" | "general";
  sources: string[];
  missing: string[];
  suggestions: string[];
}

/** 10 questions per session — enough to explore, hard to abuse. */
const SESSION_LIMIT = 10;

/** Only these fields of the on-screen result ever leave the client. */
function resultContext(result: CalculationResult | null) {
  if (!result) return undefined;
  return {
    product_name: result.product.name,
    serving_g: result.product.serving_g,
    total_l: result.footprint_l.total,
    green_l: result.footprint_l.green,
    blue_l: result.footprint_l.blue,
    grey_l: result.footprint_l.grey,
    stress_score: result.stress_score,
    top_state: result.sources[0]?.state,
    top_status: result.sources[0]?.status,
    fallbacks: result.lineage.fallbacks_used,
  };
}

export function JalMitra({ result }: { result: CalculationResult | null }) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(0);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Escape closes and hands focus back to the launcher.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        launcherRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Keep the newest message in view.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy]);

  const limited = asked >= SESSION_LIMIT;

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy || limited) return;
    setDraft("");
    setAsked((n) => n + 1);
    setMessages((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, lang, context: resultContext(result) }),
      });
      const body = (await res.json()) as ChatResponse & { error?: string };
      setMessages((m) => [
        ...m,
        res.ok
          ? { role: "bot", text: body.answer, mode: body.mode, sources: body.sources }
          : { role: "bot", text: body.error ?? t("state.error"), mode: "general", sources: [] },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "bot", text: t("chat.unavailable"), mode: "general", sources: [] }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="jmLauncher"
        onClick={() => setOpen((v) => !v)}
        aria-label="JalMitra"
        aria-expanded={open}
      >
        <MessageCircle size={26} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div className="jmPanel" role="dialog" aria-label="JalMitra">
          <header className="jmHead">
            <b>JalMitra</b>
            <button onClick={() => { setOpen(false); launcherRef.current?.focus(); }} aria-label={t("search.clear_aria")}>
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </header>

          <div className="jmLog" ref={logRef}>
            <div className="jmMsg bot">
              <p>{t("chat.greeting")}</p>
            </div>

            {messages.length === 0 && (
              <div className="jmChips">
                {["chat.sugg.gw", "chat.sugg.crop", "chat.sugg.concept"].map((key) => (
                  <button key={key} onClick={() => void send(t(key))}>{t(key)}</button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`jmMsg ${m.role}`}>
                <p>{m.text}</p>
                {/* The mode, made visible. Grounded → the citation; general →
                    the honest label that this is the model, not the dataset. */}
                {m.role === "bot" && m.mode === "grounded" && (m.sources?.length ?? 0) > 0 && (
                  <small className="jmSource">{m.sources!.join(" · ")}</small>
                )}
                {m.role === "bot" && m.mode === "general" && (
                  <small className="jmGeneral">{t("chat.generalLabel")}</small>
                )}
              </div>
            ))}

            {busy && (
              <div className="jmMsg bot"><p className="jmTyping"><i /><i /><i /></p></div>
            )}
            {limited && <p className="jmLimit">{t("chat.limit")}</p>}
          </div>

          <form
            className="jmInput"
            onSubmit={(e) => { e.preventDefault(); void send(draft); }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              disabled={limited}
              maxLength={500}
            />
            <button type="submit" disabled={busy || limited || !draft.trim()} aria-label={t("chat.send")}>
              <Send size={17} strokeWidth={2} aria-hidden="true" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
