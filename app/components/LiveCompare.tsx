"use client";

/**
 * Compare screen — AMENDMENT_02 §3.
 *
 * Seeing rice, bajra and jowar next to each other is far more persuasive than
 * one line of advice, and "sensitize the people" is the PS's stated goal.
 *
 * Bars share one axis so they are visually comparable, and the ranking is by
 * **irrigation water**, matching the swap card. Ranking by total would put rice
 * ahead of bajra and contradict the advice on the previous screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CompareResult } from "../lib/client.ts";
import { useLang } from "../lib/i18n-client.tsx";

// Labels are i18n keys — resolved at render so the chips follow the switcher.
const PRESETS = [
  { label: "compare.preset.millets", items: ["rice", "bajra", "jowar"] },
  { label: "compare.preset.proteins", items: ["chicken", "mutton", "paneer", "chana"] },
  { label: "compare.preset.breakfast", items: ["idli", "poha", "upma"] },
  { label: "compare.preset.everyday", items: ["chai", "roti", "dal tadka"] },
];

export function LiveCompare({
  seed,
  servingG,
  month,
}: {
  seed?: string;
  servingG?: number;
  month: number;
}) {
  const { t, n, lang } = useLang();
  const [items, setItems] = useState<string[]>(seed ? [seed, "bajra"] : PRESETS[0].items);
  const [data, setData] = useState<CompareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; });

  const load = useCallback(async (list: string[]) => {
    setBusy(true); setError(null);
    try {
      setData(await api.compare(list, lang, servingG, month));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("state.generic"));
    } finally { setBusy(false); }
  }, [lang, servingG, month]);

  // Refetch when the language or month changes. `items` and `load` are
  // intentionally omitted: preset changes call load() directly, and including
  // them would refetch twice on every click.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) load(itemsRef.current); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, month]);

  return (
    <section className="appPage">
      <div className="pageIntro">
        <span className="overline">{t("compare.overline")}</span>
        <h1>{t("compare.title")}</h1>
        <p>{servingG ? t("compare.normalisedTo", { grams: n(servingG) }) : t("compare.normalisedDefault")}</p>
      </div>

      <div className="filters">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className={p.items.join() === items.join() ? "active" : ""}
            onClick={() => { setItems(p.items); load(p.items); }}
            disabled={busy}
          >
            {t(p.label)}
          </button>
        ))}
      </div>

      {busy && !data && (
        <div className="stateBox"><div className="spinner" /><h2>{t("state.loading")}</h2></div>
      )}

      {error && (
        <div className="stateBox">
          <h2>{t("state.error")}</h2>
          <p>{error}</p>
          <button onClick={() => load(items)}>{t("state.retry")}</button>
        </div>
      )}

      {data && (
        <div className="comparisonChart" style={busy ? { opacity: 0.55 } : undefined}>
          <h2>{t("compare.chartTitle")}</h2>
          {data.items.map((i) => {
            const pctOf = (v: number) => (data.axis_max_l ? (v / data.axis_max_l) * 100 : 0);
            return (
              <div className="cmpBar" key={i.product.id}>
                <b>
                  {i.product.name}
                  {i.product.id === data.best && <span className="cmpBest"> ✓ {t("compare.lightest").toUpperCase()}</span>}
                </b>
                <span className="cmpTrack">
                  <i className="g" style={{ width: `${pctOf(i.footprint_l.green)}%` }} />
                  <i className="b" style={{ width: `${pctOf(i.footprint_l.blue)}%` }} />
                  <i className="y" style={{ width: `${pctOf(i.footprint_l.grey)}%` }} />
                </span>
                <strong>{n(i.impact_blue_l)} L</strong>
              </div>
            );
          })}

          <div className="cmpNote">
            <b>{t("compare.rankedBy")}</b> {data.ranked_by_note}{" "}
            {t("compare.switching", {
              from: data.items.find((i) => i.product.id === data.worst)?.product.name ?? "—",
              to: data.items.find((i) => i.product.id === data.best)?.product.name ?? "—",
              litres: n(data.saving_vs_worst_l),
            })}
          </div>

          <small>{t("compare.axisNote")}</small>
        </div>
      )}
    </section>
  );
}
