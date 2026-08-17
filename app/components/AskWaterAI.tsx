"use client";

/**
 * Ask Water AI — AMENDMENT_02 §2.
 *
 * ⚠ The explainer narrates; the engine computes. Every figure the user sees on
 * this screen came from /api/calculate. The model is handed that JSON as the
 * single source of truth and is forbidden from deriving anything from it, so a
 * wrong number cannot enter through this box.
 *
 * On failure or timeout it degrades to a static FAQ that quotes no figures at
 * all — a fallback that cannot contradict the engine even in principle.
 */
import { useState } from "react";
import { api } from "../lib/client.ts";
import { useLang } from "../lib/i18n-client.tsx";
import type { CalculationResult } from "../../engine/types.ts";

const SUGGESTIONS: Record<string, string[]> = {
  en: ["Why is this so high?", "What is blue water?", "What does the score mean?"],
  hi: ["यह इतना ज़्यादा क्यों है?", "नीला पानी क्या है?", "स्कोर का क्या मतलब है?"],
  mr: ["हे इतके जास्त का आहे?", "निळे पाणी म्हणजे काय?", "गुणांचा अर्थ काय?"],
  ta: ["இது ஏன் இவ்வளவு அதிகம்?", "நீல நீர் என்றால் என்ன?", "மதிப்பெண் என்ன சொல்கிறது?"],
};

export function AskWaterAI({ result }: { result: CalculationResult }) {
  const { lang, t } = useLang();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [source, setSource] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(false);
    setAnswer(null);
    try {
      const res = await api.explain(result, text, lang);
      setAnswer(res.answer);
      setSource(res.source);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="askWater">
      <span className="overline">{t("ask.overline")}</span>
      <h3>{t("ask.title")}</h3>

      <div className="askRow">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(question)}
          placeholder={SUGGESTIONS[lang]?.[0] ?? SUGGESTIONS.en[0]}
          aria-label={t("ask.title")}
          disabled={busy}
        />
        <button className="primary" onClick={() => ask(question)} disabled={busy || !question.trim()}>
          {busy ? t("state.loading") : t("ask.button")}
        </button>
      </div>

      <div className="askChips">
        {(SUGGESTIONS[lang] ?? SUGGESTIONS.en).map((s) => (
          <button key={s} onClick={() => { setQuestion(s); ask(s); }} disabled={busy}>
            {s}
          </button>
        ))}
      </div>

      {busy && <p className="askAnswer">{t("state.loading")}</p>}
      {error && <p className="askAnswer">{t("state.error")}</p>}
      {answer && (
        <p className="askAnswer">
          {answer}
          {source === "fallback" && <em> {t("ask.offline")}</em>}
        </p>
      )}

      <small className="askNote">{t("ask.note")}</small>
    </div>
  );
}
