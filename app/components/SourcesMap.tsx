"use client";

/**
 * India map of `result.sources[]` — AMENDMENT_02 §1 and §6 item 3.
 *
 * This is **not a reference atlas of Indian agriculture**. Every state shaded
 * here contributed to *this* number: the shade is its groundwater status, the
 * opacity its share of supply. Nothing is fetched — the map draws the sources
 * array that `/api/calculate` already returned, because the stress weighting
 * happened inside the engine before the number came back.
 *
 * Figures are state averages and are labelled as such; no district figure is
 * citeable, so none is drawn.
 */
import { useMemo, useState } from "react";
import India from "@svg-maps/india";
import { useLang } from "../lib/i18n-client.tsx";
import { soeLabel, soeNote, type SoeFigure } from "../lib/soe.ts";
import type { SourceLine, StressCategory } from "../../engine/types.ts";

const STATUS_FILL: Record<StressCategory, string> = {
  safe: "#4F8A5B",
  semi_critical: "#E4A83B",
  critical: "#D98324",
  over_exploited: "#A33C33",
};

/**
 * The bundled map predates the 2019 reorganisation: Ladakh is absent, and Dadra
 * and Nagar Haveli / Daman and Diu are still two shapes. Map our names onto its
 * ids so a state is never silently left unshaded.
 */
const NAME_ALIASES: Record<string, string[]> = {
  "Dadra and Nagar Haveli and Daman and Diu": ["Dadra and Nagar Haveli", "Daman and Diu"],
  // Ladakh has no shape on this map; its share is folded into J&K so the
  // contribution is still visible rather than vanishing.
  Ladakh: ["Jammu and Kashmir"],
};

interface MapLocation {
  id: string;
  name: string;
  path: string;
}

export function SourcesMap({ sources }: { sources: SourceLine[] }) {
  const { t, n } = useLang();
  const [hovered, setHovered] = useState<string | null>(null);

  // state name -> combined contribution, so a state growing two ingredients of
  // the same dish appears once with its total.
  const byState = useMemo(() => {
    // Shaped as a SoeFigure so `soeLabel` can render it directly and the map
    // cannot describe a figure differently from the source list beside it.
    type Entry = SoeFigure & {
      impact: number;
      share: number;
      level: SourceLine["level"];
      crops: Set<string>;
    };
    const map = new Map<string, Entry>();

    for (const s of sources) {
      for (const name of NAME_ALIASES[s.state] ?? [s.state]) {
        const cur: Entry = map.get(name) ?? {
          impact: 0,
          share: 0,
          status: s.status,
          soe_pct: s.soe_pct,
          precision: s.precision,
          band_min: s.band_min,
          band_max: s.band_max,
          level: s.level,
          crops: new Set<string>(),
        };
        cur.impact += s.impact_blue_l;
        cur.share += s.share;
        cur.crops.add(s.crop_name);
        // Keep the worst status when a state supplies several ingredients.
        if (s.soe_pct > cur.soe_pct) {
          cur.soe_pct = s.soe_pct;
          cur.status = s.status;
          cur.precision = s.precision;
          cur.band_min = s.band_min;
          cur.band_max = s.band_max;
          cur.level = s.level;
        }
        map.set(name, cur);
      }
    }
    return map;
  }, [sources]);

  const maxImpact = Math.max(1, ...[...byState.values()].map((v) => v.impact));
  const locations = India.locations as unknown as MapLocation[];
  const active = hovered ? byState.get(hovered) : null;

  return (
    <div className="sourcesMap">
      <div className="mapHead">
        <span className="overline">{t("map.title").toUpperCase()}</span>
        <small>{t("map.subtitle")}</small>
      </div>

      <div className="mapCanvas">
        <svg viewBox={India.viewBox} role="img" aria-label={t("map.title")}>
          {locations.map((location) => {
            const hit = byState.get(location.name);
            const isActive = hovered === location.name;
            return (
              <path
                key={location.id}
                d={location.path}
                className={`mapState ${hit ? "contributes" : ""} ${isActive ? "active" : ""}`}
                // AMENDMENT_07 §5 — HUE CARRIES GROUNDWATER STATUS AND NOTHING
                // ELSE. This previously also varied opacity by share of supply,
                // so a big contributor in a safe state rendered darker than a
                // small one in an over-exploited state, and a viewer reading
                // "darker = worse" read it exactly backwards.
                //
                // Share of supply now rides a separate channel: border weight
                // below, plus the figure in the panel.
                fill={hit ? STATUS_FILL[hit.status] : "#e3e8e2"}
                fillOpacity={hit ? 0.92 : 1}
                stroke={hit ? "#123324" : "#cbd5cd"}
                strokeWidth={hit ? 0.4 + 2.2 * (hit.impact / maxImpact) : 0.3}
                onMouseEnter={() => hit && setHovered(location.name)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => hit && setHovered(location.name)}
                onBlur={() => setHovered(null)}
                tabIndex={hit ? 0 : -1}
              >
                {hit && (
                  <title>
                    {location.name} — {Math.round(hit.share * 100)}% of supply, {soeLabel(t, hit)}
                  </title>
                )}
              </path>
            );
          })}
        </svg>

        <div className="mapPanel">
          {active && hovered ? (
            <>
              <b>{hovered}</b>
              <em className="levelTag">{t(`result.${active.level}Average`)}</em>
              <p title={soeNote(t, active.precision)}>
                {[...active.crops].join(", ")}
                <br />
                {Math.round(active.share * 100)}% {t("map.ofSupply")}
                <br />
                {soeLabel(t, active)}
              </p>
              <strong>{n(Math.round(active.impact))} L</strong>
            </>
          ) : (
            <>
              <b>{byState.size}</b>
              <p>{t("map.statesContributing")}</p>
              <small>{t("map.hover")}</small>
            </>
          )}
        </div>
      </div>

      <div className="mapLegend">
        {(["safe", "semi_critical", "critical", "over_exploited"] as StressCategory[]).map((s) => (
          <span key={s}>
            <i style={{ background: STATUS_FILL[s] }} />
            {t(`status.${s}`)}
          </span>
        ))}
      </div>
      <small className="mapNote">{t("map.note")}</small>
    </div>
  );
}
