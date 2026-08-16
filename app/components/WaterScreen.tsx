"use client";

/**
 * City Water Clock + community aggregate — the PS's "community as well as
 * personal levels" clause, made visible.
 *
 * A personal footprint is abstract until you can see the reservoir it is drawn
 * from. This screen puts the two side by side: what the city has stored, and
 * what the region has been consuming.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type CityWaterResult } from "../lib/client.ts";
import { useLang } from "../lib/i18n-client.tsx";

const CITIES = ["Mumbai", "Chennai", "Pune", "Bengaluru", "Hyderabad", "Delhi"];

interface Community {
  region: string;
  scans: number;
  total_litres: number;
  average_litres: number;
  average_score: number;
  top_items: { product_id: string; name: string; scans: number; total_litres: number }[];
  virtual_water_inflow_l: number;
  empty?: boolean;
}

export function WaterScreen() {
  const { t, n, lang } = useLang();
  const [city, setCity] = useState("Mumbai");
  const [water, setWater] = useState<CityWaterResult | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target: string) => {
    setBusy(true);
    setError(null);
    try {
      const [w, c] = await Promise.all([
        api.cityWater(target),
        api.community(target, lang).catch(() => null),
      ]);
      setWater(w);
      setCommunity(c as Community | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load city water");
    } finally {
      setBusy(false);
    }
  }, [lang]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) load(city); });
    return () => { cancelled = true; };
  }, [city, load]);

  return (
    <section className="appPage">
      <div className="pageIntro">
        <span className="overline">{t("water.title").toUpperCase()}</span>
        <h1>{t("water.heading")}</h1>
        <p>{t("water.sub")}</p>
      </div>

      <div className="filters">
        {CITIES.map((c) => (
          <button key={c} className={c === city ? "active" : ""} onClick={() => setCity(c)} disabled={busy}>
            {c}
          </button>
        ))}
      </div>

      {busy && !water && (
        <div className="stateBox"><div className="spinner" /><h2>{t("state.loading")}</h2></div>
      )}

      {error && (
        <div className="stateBox">
          <h2>{t("state.error")}</h2>
          <p>{error}</p>
          <button onClick={() => load(city)}>{t("state.retry")}</button>
        </div>
      )}

      {water && (
        <>
          <div className="clockCard">
            <div className="clockDial">
              {/* The ring is the city's combined live storage against capacity. */}
              <div
                className="clockRing"
                style={{
                  background: `conic-gradient(var(--blue) 0 ${water.overall_pct}%, #e4eae6 ${water.overall_pct}% 100%)`,
                }}
              >
                <div>
                  <b>{water.overall_pct}%</b>
                  <span>{t("water.stored")}</span>
                </div>
              </div>
            </div>

            <div className="clockFacts">
              <h2>{water.city}</h2>
              <p>
                {t("water.capacity", {
                  stored: n(Math.round(water.total_capacity_ml * (water.overall_pct / 100))),
                  total: n(water.total_capacity_ml),
                })}
              </p>
              {water.groundwater && (
                <p className="clockGw">
                  {water.groundwater.district} ·{" "}
                  {t("result.extracted", { pct: Math.round(water.groundwater.soe_pct) })} ·{" "}
                  {t(`status.${water.groundwater.category}`)}
                  <em
                    className="levelTag"
                    title={
                      water.groundwater.level === "national"
                        ? t("result.nationalAverageNote")
                        : undefined
                    }
                  >
                    {" "}
                    {t(
                      water.groundwater.level === "national"
                        ? "result.nationalAverage"
                        : "result.stateAverage",
                    )}
                  </em>
                </p>
              )}
              <small>{t("water.asOf", { date: water.updated_on })}</small>
            </div>
          </div>

          <div className="reservoirGrid">
            {water.reservoirs.map((r) => (
              <div key={r.reservoir} className={`reservoir ${r.overflowing ? "overflowing" : ""}`}>
                <div className="resBar">
                  <i style={{ height: `${Math.min(100, r.pct)}%` }} />
                </div>
                <b>{r.reservoir}</b>
                <strong>{r.pct}%</strong>
                <small>{n(r.capacity_ml)} ML</small>
                {r.overflowing === 1 && <em>{t("water.overflowing")}</em>}
              </div>
            ))}
          </div>

          {community && !community.empty && (
            <div className="communityCard">
              <span className="overline">{t("community.title").toUpperCase()}</span>
              <h2>{t("community.heading", { region: community.region })}</h2>

              <div className="communityStats">
                <div>
                  <b>{n(community.total_litres)}</b>
                  <span>{t("community.totalLitres")}</span>
                </div>
                <div>
                  <b>{n(community.average_litres)}</b>
                  <span>{t("community.perScan")}</span>
                </div>
                <div>
                  <b>{n(community.virtual_water_inflow_l)}</b>
                  <span>{t("community.inflow")}</span>
                </div>
                <div>
                  <b>{community.scans}</b>
                  <span>{t("community.scans")}</span>
                </div>
              </div>

              <h3>{t("community.topItems")}</h3>
              {community.top_items.map((item) => {
                const width = community.top_items[0]?.total_litres
                  ? (item.total_litres / community.top_items[0].total_litres) * 100
                  : 0;
                return (
                  <div className="cmpBar" key={item.product_id}>
                    <b>{item.name}</b>
                    <span className="cmpTrack">
                      <i className="b" style={{ width: `${width}%` }} />
                    </span>
                    <strong>{n(item.total_litres)} L</strong>
                  </div>
                );
              })}

              <p className="cmpNote">{t("community.inflowNote")}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
