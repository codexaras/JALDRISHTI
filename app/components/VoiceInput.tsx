"use client";

/**
 * Voice input — the browser-native half of the SpeechProvider pair.
 *
 * BUILD_SPEC phase 5 asks for two implementations so "a slow Bhashini on demo
 * day is a config flag, not a crisis". `resolvers/speech.ts` holds the server
 * side (Bhashini); this is the zero-setup path that needs no key and no
 * network round trip, and it speaks Hindi, Marathi and Tamil natively.
 *
 * The result still goes through /api/resolve and the confirmation screen — a
 * misheard word becomes a candidate list, not a wrong answer.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic } from "lucide-react";
import { useLang } from "../lib/i18n-client.tsx";
import type { Lang } from "../../engine/types.ts";

const BCP47: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN", ta: "ta-IN" };

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((e: {
        resultIndex?: number;
        results: {
          length: number;
          [k: number]: { isFinal?: boolean; [k: number]: { transcript: string } };
        };
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): RecognitionCtor | undefined {
  const w = globalThis as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const NEVER_CHANGES = () => () => {};

export function VoiceInput({
  onResult,
  onInterim,
  compact = false,
}: {
  /** Final transcript — the caller searches with it. */
  onResult: (text: string) => void;
  /** Partial transcript, emitted while the person is still talking. */
  onInterim?: (text: string) => void;
  /** Icon-only, for inside the search field (AMENDMENT_10). */
  compact?: boolean;
}) {
  const { lang, t } = useLang();
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // Feature detection is a browser capability, not component state. Reading it
  // through useSyncExternalStore keeps the server and client snapshots explicit
  // instead of rendering "supported" and correcting it in an effect.
  const supported = useSyncExternalStore(
    NEVER_CHANGES,
    () => Boolean(ctor()),
    () => false,
  );

  useEffect(() => () => recRef.current?.stop(), []);

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = ctor();
    if (!Ctor) return;

    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = BCP47[lang];
    // Interim results let the words appear in the search box as they are
    // spoken, so the person can see they were heard correctly before anything
    // is searched. Without it the box stays empty and the app feels deaf.
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = false;

    let finalText = "";

    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const alt = e.results[i]?.[0]?.transcript ?? "";
        if (e.results[i]?.isFinal) finalText += alt;
        else interim += alt;
      }
      const shown = (finalText + interim).trim();
      if (shown) onInterim?.(shown);
    };

    rec.onerror = () => setListening(false);

    // Speech ended. Hand the final transcript up so the caller can search —
    // one search when they stop talking, not one per interim word.
    rec.onend = () => {
      setListening(false);
      const text = finalText.trim();
      if (text) onResult(text);
    };

    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  // Hidden rather than shown-broken when the browser has no speech support.
  if (!supported) return null;

  if (compact) {
    return (
      <button
        type="button"
        className={`searchIconBtn ${listening ? "listening" : ""}`}
        onClick={toggle}
        aria-label={t("search.voice_aria")}
        title={listening ? t("search.listening") : t("search.voice_aria")}
        aria-pressed={listening}
      >
        <Mic size={20} strokeWidth={2} aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="scanSearch"
      onClick={toggle}
      aria-label={t("search.voice")}
      aria-pressed={listening}
      style={listening ? { background: "var(--green)", color: "#fff", borderColor: "var(--green)" } : undefined}
    >
      <Mic size={16} strokeWidth={2} aria-hidden="true" />
      <b>{listening ? "…" : t("search.voice")}</b>
    </button>
  );
}
