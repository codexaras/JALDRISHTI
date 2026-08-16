"use client";

/**
 * The result screen, rendered from a real /api/calculate payload.
 *
 * Rule 3: every class here already existed (.resultPage, .resultHero, .donut,
 * .legend, .influence, .factorGrid, .benchmark, .resultActions, .source,
 * .disclaimer). Only the numbers inside them changed, from hardcoded literals
 * to engine output. Layout, colours and spacing are untouched.
 *
 * AMENDMENT_02 §1: the places shown are `result.sources[]` — the specific
 * states that produced *this* number. Nothing here fetches regional data.
 * Figures are STATE averages and are labelled as such; no district figure is
 * citeable, so none is displayed.
 */
import { useMemo, useState } from "react";
import { useLang } from "../lib/i18n-client.tsx";
import { SeasonSlider } from "./SeasonSlider.tsx";
import { AskWaterAI } from "./AskWaterAI.tsx";
import { SourcesMap } from "./SourcesMap.tsx";
import { ProductImage } from "./ProductImage.tsx";
import { soeLabel, soeNote } from "../lib/soe.ts";
import type { CalculationResult } from "../../engine/types.ts";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function LiveResult({
  result,
  month,
  onMonthChange,
  onCompare,
  reloading,
}: {
  result: CalculationResult;
  month: number;
  onMonthChange: (m: number) => void;
  onCompare: () => void;
  reloading?: boolean;
}) {
  const { t, tRef, n } = useLang();
  const [showWhy, setShowWhy] = useState(false);

  const f = result.footprint_l;

  // The donut is a conic-gradient; feeding it real percentages keeps the chart
  // and the legend telling the same story.
  const { pct, donutStyle } = useMemo(() => {
    const share = (v: number) => (f.total ? Math.round((v / f.total) * 100) : 0);
    const g = share(f.green);
    const b = g + share(f.blue);
    return {
      pct: share,
      donutStyle: {
        background: `conic-gradient(var(--leaf) 0 ${g}%, var(--blue) ${g}% ${b}%, #9aa5a0 ${b}%)`,
      },
    };
  }, [f.green, f.blue, f.total]);

  const top = result.sources[0];

  return (
    <section className="resultPage">
      <div className="resultHero">
        <div className="breadcrumb">
          {t("nav.home")} / {result.product.name} / <b>{t("result.total")}</b>
        </div>

        <div className="resultIdentity">
          <div className="resultPhoto">
            <ProductImage productId={result.product.id} alt={result.product.name} />
            <span>{result.product.name.slice(0, 12).toUpperCase()}</span>
          </div>
          <div>
            <span className="overline light">{t("result.total").toUpperCase()}</span>
            <h1>{result.product.name}</h1>
            <p>
              {t("result.perServing", { grams: n(result.product.serving_g) })} ·{" "}
              {result.lineage.season} · {MONTHS[month - 1]}
            </p>
            <span className="confidence">● {t(`confidence.${result.confidence.quality}`)}</span>
          </div>
        </div>

        <div className="total">
          <small>{t("result.total").toUpperCase()}</small>
          <strong>{n(f.total)}</strong>
          <span>{t("result.litres")}</span>
          <p>{t("result.range", { low: n(result.confidence.low), high: n(result.confidence.high) })}</p>
        </div>
      </div>

      <div className="resultContent" style={reloading ? { opacity: 0.55, transition: "opacity .2s" } : undefined}>
        <div className="chartCard">
          <div className="donut" style={donutStyle}>
            <div>
              <b>{n(f.total)}</b>
              <span>
                {t("result.litres")} / {n(result.product.serving_g)} g
              </span>
            </div>
          </div>
          <div className="legend">
            <div>
              <i className="g" />
              <span>
                <b>{t("water.green")}</b>
                <small>{t("water.green.sub")}</small>
              </span>
              <strong>
                {n(f.green)} L <em>{pct(f.green)}%</em>
              </strong>
            </div>
            <div>
              <i className="b" />
              <span>
                <b>{t("water.blue")}</b>
                <small>{t("water.blue.sub")}</small>
              </span>
              <strong>
                {n(f.blue)} L <em>{pct(f.blue)}%</em>
              </strong>
            </div>
            <div>
              <i className="y" />
              <span>
                <b>{t("water.grey")}</b>
                <small>{t("water.grey.sub")}</small>
              </span>
              <strong>
                {n(f.grey)} L <em>{pct(f.grey)}%</em>
              </strong>
            </div>
          </div>
        </div>

        <div className="influence">
          <span className="overline">{t("result.sources").toUpperCase()}</span>
          <h2>{tRef(result.human_equivalent)}</h2>

          <div className="factorGrid">
            <div>
              <span>⌖</span>
              <small>TOP SOURCE</small>
              <b>{top ? top.state : "—"}</b>
            </div>
            <div>
              <span>≈</span>
              <small>GROUNDWATER</small>
              <b>{top ? t(`status.${top.status}`) : "—"}</b>
            </div>
            <div>
              <span>↗</span>
              <small>{t("result.score").toUpperCase()}</small>
              <b>{t("result.scoreOf", { score: result.stress_score })}</b>
            </div>
            <div>
              <span>☂</span>
              <small>SEASON</small>
              <b>{result.lineage.season}</b>
            </div>
          </div>

          {/* Sources as a TEXT LIST — AMENDMENT_02 §6 puts the map after MVP. */}
          <div className="sourceList">
            {result.sources.slice(0, 6).map((s) => (
              <div key={`${s.crop}-${s.state}`} className={`sourceRow ${s.status}`}>
                <div>
                  <b>
                    {s.state}
                    {/* The resolution badge — "state average" today, and
                        "district" automatically the day district data lands. */}
                    <em className="levelTag"> {t(`result.${s.level}Average`)}</em>
                  </b>
                  <small title={soeNote(t, s.precision)}>
                    {/* An exact figure prints its percentage; a band midpoint
                        prints the BAND. Printing "35%" for a state CGWB only
                        categorised would invent a measurement. */}
                    {s.crop_name} · {Math.round(s.share * 100)}% of supply · {soeLabel(t, s)}
                    {s.precision === "exact" && ` · ${t(`status.${s.status}`)}`}
                  </small>
                </div>
                <strong>
                  {n(s.impact_blue_l)} L
                  {s.impact_blue_l !== s.blue_l && <em> (from {n(s.blue_l)} L)</em>}
                </strong>
              </div>
            ))}
            {result.sources.length > 0 && (
              <p className="sourceNote">{top && t(`status.explain.${top.status}`)}</p>
            )}
          </div>

          {result.swap && (
            <div className="benchmark">
              <span>↓</span>
              <div>
                <b>{tRef(result.swap.message)}</b>
                <p>
                  {t("result.swap")} — saves about {n(result.swap.saves_l)} L of irrigation water at
                  this portion.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* The same sources[] as the list above, drawn on India. */}
        {result.sources.length > 0 && (
          <div className="mapCard">
            <SourcesMap sources={result.sources} />
          </div>
        )}

        {/* AMENDMENT_02 §4 — the "and when" clause, as a slider. */}
        <div className="seasonCard">
          <SeasonSlider month={month} onChange={onMonthChange} busy={reloading} />
        </div>

        <div className="resultActions">
          <button onClick={onCompare} className="primary">
            ⇆ {t("nav.compare")}
          </button>
          <button className="secondary" onClick={() => setShowWhy((v) => !v)}>
            ? {t("result.why")}
          </button>
        </div>

        {showWhy && (
          <div className="whyCard">
            <span className="overline">{t("result.why").toUpperCase()}</span>
            <h3>What this number rests on</h3>
            <ul>
              {result.lineage.ingredients.map((i) => (
                <li key={i.crop}>
                  <b>{i.crop}</b> — {n(i.raw_g)} g raw
                </li>
              ))}
            </ul>
            <p className="fallbackNote">
              <b>Where this estimate is weakest:</b>{" "}
              {result.lineage.fallbacks_used.length
                ? result.lineage.fallbacks_used.join(" · ")
                : "no fallbacks used"}
            </p>
            <p className="fallbackNote">
              {result.confidence.quality !== "high" && t(`confidence.explain.${result.confidence.quality}`)}
            </p>
          </div>
        )}

        {/* AMENDMENT_02 §2 — the explainer narrates, it never computes. */}
        <div className="askCard">
          <AskWaterAI result={result} />
        </div>

        <div className="source">
          <div>
            <span className="overline">SOURCE &amp; METHOD</span>
            <h3>{result.citations[0] ?? "—"}</h3>
            {result.citations.slice(1).map((c) => (
              <p key={c}>{c}</p>
            ))}
          </div>
        </div>

        <p className="disclaimer">
          <b>About this estimate:</b> {t("disclaimer")}
        </p>
      </div>
    </section>
  );
}
