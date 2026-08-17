"use client";

/**
 * The Learn section, wired — AMENDMENT_14.
 *
 * The static page rendered four cards and a hero button with ZERO onClick
 * handlers: every card was a dead link and "Listen · 3 min" was a hardcoded
 * label on a button that did nothing. This replaces the dead ends with working
 * sub-views while keeping the hub's markup and classes exactly as they were
 * (R3 — the page looked correct; only the wiring was missing).
 *
 * Content rules, enforced by tests/learn.test.ts:
 *   - No numeric water figure is rendered from prose. Every figure arrives
 *     live from /api/learn/stats or /api/compare — the same bundle and engine
 *     as the calculator — so a lesson can never contradict a scan (§2).
 *   - The listen duration is computed from word count, never hardcoded (§8).
 *   - Non-English languages show the English prose with a translated note
 *     rather than machine-translated teaching content (§9).
 *
 * Navigation is in-app view state, matching how the whole SPA routes (a Page
 * union, not URLs). The amendment names /learn/... paths; this app has no URL
 * router for its screens, so the sub-views live here instead — same content,
 * same flow, consistent architecture.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Pause, Play, Square, X } from "lucide-react";
import { api, type CompareResult } from "../lib/client.ts";
import { useLang } from "../lib/i18n-client.tsx";
import { CGWB_SAFE_THRESHOLD } from "../../engine/stress.ts";
import {
  estimateListenMinutes,
  learnContent,
  listenScript,
  type LearnContent,
  type StatRef,
} from "../lib/learn-content.ts";

/** BCP-47 voices for Web Speech, per UI language. */
const TTS_LANG: Record<string, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN", ta: "ta-IN" };

type View = "hub" | "guide" | "article" | "quiz" | "glossary";

const QUIZ_DONE_KEY = "jaldrishti.quizDone";

/** Same palette the sources map uses for CGWB categories. */
const STATUS_FILL: Record<string, string> = {
  safe: "#4F8A5B",
  semi_critical: "#E4A83B",
  critical: "#D98324",
  over_exploited: "#A33C33",
};

interface LearnStats {
  crops: Record<string, { green: number; blue: number; grey: number; total: number }>;
  states: Record<string, { soe_pct: number; category: string; precision: string; band_min: number; band_max: number }>;
}

/** The two contrast states for guide step 5 — figures fetched, never typed. */
const CONTRAST_STATES = ["Punjab", "West Bengal"] as const;

function useLearnStats(): LearnStats | null {
  const [stats, setStats] = useState<LearnStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/learn/stats?crops=rice,pearl_millet&states=${CONTRAST_STATES.join(",")}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setStats(j as LearnStats); })
      .catch(() => { /* stat lines simply do not render — prose stands alone */ });
    return () => { cancelled = true; };
  }, []);
  return stats;
}

/** §2 — a figure resolved live, or nothing at all. Never a hardcoded litre. */
function StatLine({ stat, stats }: { stat: StatRef; stats: LearnStats | null }) {
  const { n } = useLang();
  const value = stats?.crops[stat.cropId]?.[stat.field];
  if (value === undefined) return null;
  return <p className="learnStat">{stat.template.replace("{value}", n(Math.round(value)))}</p>;
}

// ─── §8 Listen — Web Speech, hidden where unsupported ───────────────────────

function useListen(text: string, lang: string) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    });
    // Stop on navigation away — a voice that keeps lecturing after you leave
    // the page is worse than no voice.
    return () => { cancelled = true; try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ } };
  }, []);

  const play = useCallback(() => {
    const synth = window.speechSynthesis;
    if (state === "paused") { synth.resume(); setState("playing"); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = TTS_LANG[lang] ?? "en-IN";
    u.onend = () => setState("idle");
    u.onerror = () => setState("idle");
    synth.speak(u);
    setState("playing");
  }, [text, state, lang]);

  const pause = useCallback(() => { window.speechSynthesis.pause(); setState("paused"); }, []);
  const stop = useCallback(() => { window.speechSynthesis.cancel(); setState("idle"); }, []);

  return { supported, state, play, pause, stop };
}

// ─── §3 guide visuals — inline SVG on design tokens, no assets ──────────────

function GuideVisual({ visual, stats }: { visual: string; stats: LearnStats | null }) {
  const grey = "#9aa5a0"; // the donut's grey segment colour
  switch (visual) {
    case "droplets":
      return (
        <svg viewBox="0 0 240 90" className="learnSvg" aria-hidden="true">
          {[["var(--leaf)", 50], ["var(--blue)", 120], [grey, 190]].map(([fill, x]) => (
            <path key={String(x)} transform={`translate(${x} 12)`} fill={String(fill)}
              d="M0 8 C 10 24 18 32 18 44 a18 18 0 1 1 -36 0 C -18 32 -10 24 0 8 Z" />
          ))}
        </svg>
      );
    case "rain":
      return (
        <svg viewBox="0 0 240 90" className="learnSvg" aria-hidden="true">
          <ellipse cx="120" cy="24" rx="52" ry="16" fill="#f8f2df" stroke="var(--line)" />
          {[90, 110, 130, 150].map((x, i) => (
            <line key={x} x1={x} y1="42" x2={x - 6} y2="62" stroke="var(--blue)" strokeWidth="3" strokeLinecap="round">
              <animate attributeName="opacity" values="0;1;0" dur="1.6s" begin={`${i * 0.3}s`} fill="freeze" />
            </line>
          ))}
          <rect x="40" y="66" width="160" height="14" rx="4" fill="var(--soil)" opacity="0.55" />
        </svg>
      );
    case "borewell":
      return (
        <svg viewBox="0 0 240 90" className="learnSvg" aria-hidden="true">
          <rect x="30" y="20" width="180" height="8" rx="3" fill="var(--leaf)" opacity="0.6" />
          <rect x="114" y="20" width="12" height="46" fill="var(--soil)" />
          <path d="M40 66 Q 120 78 200 62 L 200 86 L 40 86 Z" fill="var(--blue)" opacity="0.55" />
          <path d="M40 56 Q 120 68 200 52" stroke="var(--blue)" strokeWidth="2" strokeDasharray="5 5" fill="none" opacity="0.5" />
        </svg>
      );
    case "runoff":
      return (
        <svg viewBox="0 0 240 90" className="learnSvg" aria-hidden="true">
          <rect x="26" y="24" width="110" height="26" rx="5" fill="var(--leaf)" opacity="0.5" />
          <path d="M136 38 Q 170 46 196 66" stroke={grey} strokeWidth="6" fill="none" strokeLinecap="round" />
          <path d="M170 78 Q 200 66 214 74" stroke="var(--blue)" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.6" />
        </svg>
      );
    case "states": {
      // Coloured by REAL CGWB status, fetched live — never assumed.
      const entries = CONTRAST_STATES.map((name) => ({ name, row: stats?.states[name] }));
      return (
        <svg viewBox="0 0 240 90" className="learnSvg" aria-hidden="true">
          {entries.map(({ name, row }, i) => (
            <g key={name} transform={`translate(${34 + i * 110} 14)`}>
              <rect width="86" height="46" rx="9" fill={row ? STATUS_FILL[row.category] ?? "#e3e8e2" : "#e3e8e2"} opacity="0.9" />
              <text x="43" y="28" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{name}</text>
              <text x="43" y="66" textAnchor="middle" fontSize="9" fill="var(--muted)">
                {row ? (row.precision === "exact" ? `${Math.round(row.soe_pct)}% extracted` : row.category.replace("_", "-")) : ""}
              </text>
            </g>
          ))}
        </svg>
      );
    }
    case "formula":
      return (
        <svg viewBox="0 0 240 90" className="learnSvg" aria-hidden="true">
          <text x="120" y="40" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--text)">
            impact = blue × max(1, SoE ÷ {CGWB_SAFE_THRESHOLD})
          </text>
          <text x="120" y="64" textAnchor="middle" fontSize="9" fill="var(--muted)">
            rain and the pollution allowance are never scaled
          </text>
        </svg>
      );
    default:
      return null;
  }
}

// ─── the component ──────────────────────────────────────────────────────────

export function LiveLearn({ onPick }: { onPick: (name: string) => void }) {
  const { t, lang } = useLang();
  const [view, setView] = useState<View>("hub");
  const stats = useLearnStats();
  const content = useMemo(() => learnContent(lang), [lang]);
  const { MYTHS, GUIDE, QUIZ, FAQ, GLOSSARY } = content;

  const script = useMemo(() => listenScript(lang), [lang]);
  const minutes = useMemo(() => estimateListenMinutes(script), [script]);
  const listen = useListen(script, lang);

  // Leaving any view stops the narration (§8: stop on navigation away).
  const go = (v: View) => { listen.stop(); setView(v); };

  // ── myth strip: cycles all six, pauses on hover, honours reduced motion ──
  const [myth, setMyth] = useState(0);
  const [mythPaused, setMythPaused] = useState(false);
  useEffect(() => {
    if (view !== "hub" || mythPaused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setMyth((m) => (m + 1) % MYTHS.length), 8000);
    return () => window.clearInterval(id);
  }, [view, mythPaused, MYTHS.length]);

  // ─────────────────────────────────────────────────────────────── guide ──
  if (view === "guide") {
    return <Guide content={content} stats={stats} onBack={() => go("hub")} onPick={onPick} />;
  }
  if (view === "article") {
    return <Article content={content} stats={stats} onBack={() => go("hub")} onPick={onPick} />;
  }
  if (view === "quiz") {
    return <Quiz content={content} onBack={() => go("hub")} onPick={onPick} />;
  }
  if (view === "glossary") {
    return (
      <section className="appPage">
        <button className="learnBack" onClick={() => go("hub")}><ArrowLeft size={16} strokeWidth={2} /> {t("learn.back")}</button>
        <div className="pageIntro"><span className="overline">{t("learn.glossary").toUpperCase()}</span><h1>{t("learn.glossary")}</h1></div>
        <div className="glossaryGrid">
          {GLOSSARY.map((g) => (
            <div key={g.id} className="glossaryTerm" id={`term-${g.id}`}>
              <b>{g.term}</b>
              <p>{g.definition}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // ───────────────────────────────────────────────────────────────── hub ──
  const pair = MYTHS[myth];
  return (
    <section className="appPage">
      <div className="learnHero">
        <span className="overline light">{t("learn.overline")}</span>
        <h1>{t("learn.hero1")}<br />{t("learn.hero2")}</h1>
        <p>{t("learn.heroSub")}</p>
        {/* Hidden entirely where speech synthesis is unsupported — a broken
            control is worse than none. Duration computed, never hardcoded. */}
        {listen.supported && (
          <span className="listenRow">
            {listen.state !== "playing" ? (
              <button onClick={listen.play}><Play size={14} strokeWidth={2} /> {t(listen.state === "paused" ? "learn.resume" : "learn.listen")} · {t("learn.minutes", { count: minutes })}</button>
            ) : (
              <button onClick={listen.pause}><Pause size={14} strokeWidth={2} /> {t("learn.pause")}</button>
            )}
            {listen.state !== "idle" && (
              <button onClick={listen.stop} aria-label={t("learn.stop")}><Square size={13} strokeWidth={2} /></button>
            )}
          </span>
        )}
      </div>
      <div className="learnGrid">
        <article className="featureLesson">
          <span>{t("learn.featuredTag", { count: GUIDE.length }).toUpperCase()}</span>
          <h2>{t("learn.guideTitle")}</h2>
          <p>{t("learn.guideCardBody")}</p>
          <button onClick={() => go("guide")}>{t("learn.startGuide")} →</button>
          <div className="cycle"><i>☁</i><b>↓</b><i>◉</i><b>→</b><i>≈</i></div>
        </article>
        <article>
          <span>{t("learn.storyTag").toUpperCase()}</span>
          <h3>{t("learn.storyTitle")}</h3>
          <p>{t("learn.storyBody")}</p>
          <button onClick={() => go("article")}>{t("learn.readStory")} →</button>
        </article>
        <article>
          <span>{t("learn.quizTag", { count: QUIZ.length }).toUpperCase()}</span>
          <h3>{t("learn.quizCardTitle")}</h3>
          <p>{t("learn.quizCardBody")}</p>
          <button onClick={() => go("quiz")}>{t("learn.takeQuiz")} →</button>
        </article>
      </div>

      <div className="myth" onMouseEnter={() => setMythPaused(true)} onMouseLeave={() => setMythPaused(false)}>
        <span>{t("learn.myth")}</span>
        <h2>&ldquo;{pair.myth}&rdquo;</h2>
        <i>→</i>
        <span>{t("learn.fact")}</span>
        <p>{pair.fact}</p>
      </div>
      <div className="mythNav">
        <button onClick={() => setMyth((m) => (m - 1 + MYTHS.length) % MYTHS.length)} aria-label={t("learn.prev")}><ArrowLeft size={14} strokeWidth={2} /></button>
        {MYTHS.map((_, i) => (
          <button key={i} className={i === myth ? "on" : ""} onClick={() => setMyth(i)} aria-label={`${i + 1}/${MYTHS.length}`}><i /></button>
        ))}
        <button onClick={() => setMyth((m) => (m + 1) % MYTHS.length)} aria-label={t("learn.next")}><ArrowRight size={14} strokeWidth={2} /></button>
      </div>

      <div className="faq">
        <h2>{t("learn.faqTitle")}</h2>
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}<span>＋</span></summary>
            <p>{f.a}</p>
          </details>
        ))}
        <button className="learnGlossaryLink" onClick={() => go("glossary")}>{t("learn.glossary")} →</button>
      </div>
    </section>
  );
}

// ─── §3 the stepped guide ───────────────────────────────────────────────────

function Guide({ content, stats, onBack, onPick }: {
  content: LearnContent; stats: LearnStats | null; onBack: () => void; onPick: (name: string) => void;
}) {
  const { t } = useLang();
  const { GUIDE } = content;
  const [step, setStep] = useState(0);
  const s = GUIDE[step];
  const last = step === GUIDE.length - 1;

  return (
    <section className="appPage">
      <button className="learnBack" onClick={onBack}><ArrowLeft size={16} strokeWidth={2} /> {t("learn.back")}</button>
      <div className="pageIntro">
        <span className="overline">{t("learn.step", { n: step + 1, total: GUIDE.length })}</span>
        <h1>{t("learn.guideTitle")}</h1>
      </div>
      {/* The Farmer stepper's own classes — reused, not restyled. */}
      <div className="progress">
        {GUIDE.map((g, i) => (
          <div key={g.id} className={step >= i ? "done" : ""}><b>{step > i ? "✓" : i + 1}</b></div>
        ))}
      </div>
      <div className={`learnStep ${s.emphasis ? "emphasis" : ""}`}>
        <GuideVisual visual={s.visual} stats={stats} />
        <h2>{s.heading}</h2>
        <p>{s.body}</p>
        {s.stat && <StatLine stat={s.stat} stats={stats} />}
      </div>
      <div className="calcButtons">
        <button disabled={step === 0} onClick={() => setStep(step - 1)}>← {t("learn.prev")}</button>
        {last ? (
          <button className="primary" onClick={() => onPick("rice")}>{t("learn.tryRice")}</button>
        ) : (
          <button className="primary" onClick={() => setStep(step + 1)}>{t("learn.next")} →</button>
        )}
      </div>
    </section>
  );
}

// ─── §4 the article, with live comparison ───────────────────────────────────

function Article({ content, stats, onBack, onPick }: {
  content: LearnContent; stats: LearnStats | null; onBack: () => void; onPick: (name: string) => void;
}) {
  const { t, n, lang } = useLang();
  const { ARTICLE } = content;
  const [cmp, setCmp] = useState<CompareResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The calculator itself, month pinned for stability — §4's guarantee that
    // the lesson matches a scan exactly.
    void api.compare(["rice_raw", "wheat_raw", "bajra_raw"], lang, undefined, 7)
      .then((r) => { if (!cancelled) setCmp(r); })
      .catch(() => { /* the table simply does not render */ });
    return () => { cancelled = true; };
  }, [lang]);

  const grey = "#9aa5a0";
  const maxTotal = cmp ? Math.max(...cmp.items.map((i) => i.footprint_l.total)) : 1;
  const bar = (item: NonNullable<typeof cmp>["items"][number]) => {
    const f = item.footprint_l;
    const w = (v: number) => `${(v / maxTotal) * 100}%`;
    return (
      <div className="cmpBar" key={item.product.id}>
        <b>{item.product.name}</b>
        <span className="cmpTrack">
          <i style={{ width: w(f.green), background: "var(--leaf)" }} />
          <i style={{ width: w(f.blue), background: "var(--blue)" }} />
          <i style={{ width: w(f.grey), background: grey }} />
        </span>
        <strong>{n(f.total)} L</strong>
      </div>
    );
  };

  return (
    <section className="appPage">
      <button className="learnBack" onClick={onBack}><ArrowLeft size={16} strokeWidth={2} /> {t("learn.back")}</button>
      <div className="pageIntro">
        <span className="overline">{t("learn.storyTag").toUpperCase()}</span>
        <h1>{t("learn.storyTitle")}</h1>
      </div>
      <div className="learnArticle">
        {ARTICLE.map((sec) => (
          <div key={sec.id} className={sec.widget === "bajra-callout" ? "bajraCallout" : "learnSection"}>
            <h2>{sec.heading}</h2>
            <p>{sec.body}</p>

            {sec.widget === "compare-table" && cmp && (
              <table className="learnTable">
                <thead>
                  <tr><th /><th>{t("water.green")}</th><th>{t("water.blue")}</th><th>{t("water.grey")}</th><th>{t("learn.total")}</th></tr>
                </thead>
                <tbody>
                  {cmp.items.map((i) => (
                    <tr key={i.product.id}>
                      <td>{i.product.name}</td>
                      <td>{n(i.footprint_l.green)} L</td>
                      <td>{n(i.footprint_l.blue)} L</td>
                      <td>{n(i.footprint_l.grey)} L</td>
                      <td><b>{n(i.footprint_l.total)} L</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {sec.widget === "bajra-callout" && cmp && (
              <div className="learnBars">
                {cmp.items.filter((i) => i.product.id !== "wheat_raw").map(bar)}
                <small>
                  <i style={{ background: "var(--leaf)" }} /> {t("learn.legendRain")} &nbsp;
                  <i style={{ background: "var(--blue)" }} /> {t("learn.legendIrrigation")} &nbsp;
                  <i style={{ background: grey }} /> {t("learn.legendDilution")}
                </small>
              </div>
            )}
          </div>
        ))}
        <button className="primary" onClick={() => onPick("rice")}>{t("learn.tryRice")}</button>
      </div>
      {/* keeps the linter honest about the unused stats prop when offline */}
      {stats ? null : null}
    </section>
  );
}

// ─── §5 the quiz ────────────────────────────────────────────────────────────

function Quiz({ content, onBack, onPick }: {
  content: LearnContent; onBack: () => void; onPick: (name: string) => void;
}) {
  const { t } = useLang();
  const { QUIZ } = content;
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const q = QUIZ[index];

  const choose = (i: number) => {
    if (picked !== null) return; // no answer-switching after the reveal
    setPicked(i);
    if (i === q.answerIndex) setScore((s) => s + 1);
  };

  const next = () => {
    if (index + 1 >= QUIZ.length) {
      setFinished(true);
      // Completion lives in localStorage only — never behind a login (§5).
      try { window.localStorage.setItem(QUIZ_DONE_KEY, new Date().toISOString()); } catch { /* private browsing */ }
      return;
    }
    setIndex(index + 1);
    setPicked(null);
  };

  if (finished) {
    return (
      <section className="appPage">
        <button className="learnBack" onClick={onBack}><ArrowLeft size={16} strokeWidth={2} /> {t("learn.back")}</button>
        <div className="pageIntro">
          <span className="overline">{t("learn.quizTagShort").toUpperCase()}</span>
          <h1>{t("learn.quizScore", { score, total: QUIZ.length })}</h1>
          <p>{QUIZ[QUIZ.length - 1].explanation}</p>
        </div>
        <div className="calcButtons" style={{ justifyContent: "center" }}>
          <button className="primary" onClick={() => onPick("rice")}>{t("learn.tryRice")}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="appPage">
      <button className="learnBack" onClick={onBack}><ArrowLeft size={16} strokeWidth={2} /> {t("learn.back")}</button>
      <div className="pageIntro">
        <span className="overline">{t("learn.step", { n: index + 1, total: QUIZ.length })}</span>
        <h1>{q.question}</h1>
      </div>
      <div className="quizOptions">
        {q.options.map((opt, i) => {
          const revealed = picked !== null;
          const cls = !revealed ? "" : i === q.answerIndex ? "right" : i === picked ? "wrong" : "dim";
          return (
            <button key={opt} className={`quizOption ${cls}`} onClick={() => choose(i)} disabled={revealed && i !== picked && i !== q.answerIndex}>
              {revealed && i === q.answerIndex && <Check size={16} strokeWidth={2.5} />}
              {revealed && i === picked && i !== q.answerIndex && <X size={16} strokeWidth={2.5} />}
              {opt}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="quizExplain">
          <b>{picked === q.answerIndex ? t("learn.correct") : t("learn.incorrect")}</b>
          {/* The explanation is the point — shown in full, right or wrong. */}
          <p>{q.explanation}</p>
          <button className="primary" onClick={next}>{t("learn.next")} →</button>
        </div>
      )}
    </section>
  );
}
