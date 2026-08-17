"use client";

/**
 * Jan–Dec season slider — AMENDMENT_02 §4.
 *
 * This is the PS's "and when" clause made visible: drag from July to January
 * and watch blue water climb as the crop stops getting rain for free.
 * Debounced 300ms so a drag is one refetch, not twelve.
 */
import { useEffect, useRef, useState } from "react";
import { useLang } from "../lib/i18n-client.tsx";

function seasonOf(month: number): "kharif" | "rabi" | "zaid" {
  if (month >= 6 && month <= 10) return "kharif";
  if (month >= 11 || month <= 3) return "rabi";
  return "zaid";
}

export function SeasonSlider({
  month,
  onChange,
  busy,
}: {
  month: number;
  onChange: (m: number) => void;
  busy?: boolean;
}) {
  // The thumb must move on every drag frame, but the parent only learns the new
  // month after the debounce. Holding the in-flight value alongside the month it
  // was dragged from lets the slider stay responsive without an effect that
  // copies a prop into state on every render.
  const { t } = useLang();
  const months = Array.from({ length: 12 }, (_, i) => t(`month.${i + 1}`));
  const [draft, setDraft] = useState<{ value: number; from: number } | null>(null);
  const local = draft && draft.from === month ? draft.value : month;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handle = (value: number) => {
    setDraft({ value, from: month });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(value), 300);
  };

  const season = seasonOf(local);

  return (
    <div className="seasonSlider">
      <div className="seasonHead">
        <span className="overline">{t("season.when").toUpperCase()}</span>
        <b>
          {months[local - 1]} · <em>{t(`season.${season}`)}</em>
        </b>
      </div>
      <input
        type="range"
        min={1}
        max={12}
        step={1}
        value={local}
        onChange={(e) => handle(Number(e.target.value))}
        aria-label={t("season.monthAria")}
        className={`seasonRange ${season}`}
        disabled={busy}
      />
      <div className="seasonScale">
        {months.map((m, i) => (
          <span key={m} className={i + 1 === local ? "on" : ""}>
            {m[0]}
          </span>
        ))}
      </div>
      <small>{t("season.note")}</small>
    </div>
  );
}
