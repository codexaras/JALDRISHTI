"use client";

/**
 * The confirmation screen — mandatory on every input path.
 *
 * BUILD_SPEC 6a + AMENDMENT_02 §5: `resolve → CONFIRM → calculate`. No input
 * path calls /calculate directly. This handles recognition error, solves
 * portion estimation by asking the human instead of guessing, and means a
 * failed recognition during a live demo reads as a designed step rather than a
 * crash.
 *
 * Rule 3: reuses the existing bottom-sheet classes (.modalShade, .bottomSheet,
 * .detected, .matches, .segments, .sheetActions). No component was restyled.
 */
import { useState } from "react";
import { useLang } from "../lib/i18n-client.tsx";
import { ProductImage } from "./ProductImage.tsx";
import type { Candidate, ResolveResult } from "../lib/client.ts";

export interface Confirmed {
  product_id: string;
  name: string;
  serving_g: number;
  force_state?: string;
  month?: number;
  /**
   * A scanned packet's declared ingredients, when there is no catalogue product.
   *
   * A barcode resolves to an ingredient list, not a product_id — there are
   * millions of packets and 168 catalogue rows. Without this the Confirm button
   * had nothing to submit, so it stayed disabled and the click did nothing at
   * all: no error, no spinner, because no handler ever ran.
   */
  ingredients?: { crop_id: string; raw_grams_per_100g: number; yield_fraction: number; source: string }[];
}

const STATES = [
  "", "Punjab", "Haryana", "Uttar Pradesh", "Madhya Pradesh", "Maharashtra", "Karnataka",
  "Tamil Nadu", "West Bengal", "Bihar", "Gujarat", "Rajasthan", "Chhattisgarh", "Telangana",
  "Andhra Pradesh", "Odisha", "Kerala", "Assam",
];

export function ConfirmSheet({
  resolved,
  onConfirm,
  onCancel,
  busy,
}: {
  resolved: ResolveResult;
  onConfirm: (c: Confirmed) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { t } = useLang();

  // Barcode returns a product name but no catalogue candidates; photo returns
  // one candidate list per detected item; the image path omits `candidates`
  // entirely. Flatten whichever shape arrived into one list — and never assume
  // the key is present, because for photos it is not.
  const candidates: Candidate[] =
    resolved.candidates && resolved.candidates.length > 0
      ? resolved.candidates
      : (resolved.items ?? []).flatMap((i) => i.candidates ?? []);

  const [selected, setSelected] = useState<string>(candidates[0]?.product_id ?? "");
  const [serving, setServing] = useState<number>(
    resolved.items?.[0]?.est_grams ||
      candidates[0]?.default_serving_g ||
      resolved.default_serving_g ||
      100,
  );
  const [state, setState] = useState("");

  /**
   * The unit is a DISPLAY choice only. `serving` is always grams, because that
   * is what the engine takes — converting at the boundary rather than storing
   * kilograms means a unit switch can never round the mass away.
   *
   * Defaults to kg for whole-kilogram servings (raw crops are 1000 g), where
   * "1 kg" reads better than "1000 grams".
   */
  const [unit, setUnit] = useState<"g" | "kg">(() => {
    const initial = resolved.items?.[0]?.est_grams || candidates[0]?.default_serving_g || resolved.default_serving_g || 100;
    return initial >= 1000 ? "kg" : "g";
  });

  // Trailing zeros trimmed: 0.25 not 0.250, 1 not 1.000.
  const shown = unit === "kg" ? Number((serving / 1000).toFixed(3)) : serving;

  const chosen = candidates.find((c) => c.product_id === selected);

  // A scanned packet is confirmable through its ingredients even with no
  // catalogue match — that is the whole point of reading the label.
  const scanned = (resolved.ingredients?.length ?? 0) > 0;
  const canConfirm = (Boolean(selected) || scanned) && serving > 0 && !busy;

  return (
    <div className="modalShade" role="dialog" aria-modal="true" aria-label={t("scan.detected")}>
      <div className="bottomSheet">
        <button className="close" onClick={onCancel} aria-label="Close">×</button>

        <span className="success">
          {resolved.confident ? `✓ ${t("scan.detected").toUpperCase()}` : `? ${t("search.suggestions").toUpperCase()}`}
        </span>

        <div className="detected">
          <div className="riceThumb">
            {/* Keyed on the selection: picking a different candidate from the
                "did you mean" list must swap the photo, and without a key React
                keeps the old <img> (and its failed state) mounted. */}
            {chosen && (
              <ProductImage key={chosen.product_id} productId={chosen.product_id} alt={chosen.name} />
            )}
            <span>{(chosen?.name ?? resolved.name ?? "?").slice(0, 1)}</span>
          </div>
          <div>
            <h2>{chosen?.name ?? resolved.name ?? t("search.noResults")}</h2>
            <p>
              {resolved.brand ? `${resolved.brand} · ` : ""}
              {resolved.ean ? `EAN ${resolved.ean}` : (chosen?.matched_on ?? "")}
            </p>
            {chosen && <b>{chosen.score}% match</b>}
          </div>
        </div>

        {/* Same rule for the camera: a photo that identified nothing must say
            why, and offer the way forward. An empty sheet with a bare "no
            results" is a dead end the user has to guess their way out of. */}
        {resolved.input_type === "image" && candidates.length === 0 && (
          <div className="matches">
            <small>{t(`vision.${resolved.error ?? "none"}.title`).toUpperCase()}</small>
            <span>{t(`vision.${resolved.error ?? "none"}.body`)}</span>
          </div>
        )}

        {/* A failed barcode lookup must say WHICH failure it was.
            "We don't have this product" and "we couldn't reach the database"
            are different facts, and only one of them is about the product.
            Reporting a throttle as "not found" is a false claim about our data. */}
        {resolved.input_type === "barcode" && !resolved.found && resolved.error && (
          <div className="matches">
            <small>{t(`barcode.${resolved.error}.title`).toUpperCase()}</small>
            <span>{t(`barcode.${resolved.error}.body`)}</span>
          </div>
        )}

        {/* Barcode fractions come from ingredient ORDER, not measurement.
            Saying so is the difference between an estimate and a claim. */}
        {resolved.estimated_from_ingredient_order && (
          <div className="matches">
            <small>ESTIMATED FROM THE LABEL</small>
            <span>
              Ingredient amounts are inferred from their order on the packet, which is listed by
              descending weight. Treat this as an estimate.
            </span>
            {(resolved.unmatched_tags?.length ?? 0) > 0 && (
              <span>
                Not in our data: <b>{resolved.unmatched_tags!.slice(0, 4).join(", ")}</b>
              </span>
            )}
          </div>
        )}

        {candidates.length > 1 && (
          <div className="matches">
            <small>{t("search.suggestions").toUpperCase()}</small>
            {candidates.slice(0, 5).map((c) => (
              <button
                type="button"
                key={c.product_id}
                onClick={() => {
                  setSelected(c.product_id);
                  setServing(c.default_serving_g);
                }}
                aria-pressed={c.product_id === selected}
                style={{
                  border: 0,
                  background: "none",
                  padding: 4,
                  textAlign: "left",
                  fontWeight: c.product_id === selected ? 700 : 400,
                }}
              >
                {c.name} <b>{c.score}%</b>
              </button>
            ))}
          </div>
        )}

        <label>
          {t("confirm.quantity")}
          <div className="inputGroup">
            <input
              type="number"
              min={unit === "kg" ? 0.01 : 1}
              step={unit === "kg" ? 0.05 : 10}
              value={shown}
              onChange={(e) => {
                const typed = Number(e.target.value) || 0;
                const grams = unit === "kg" ? typed * 1000 : typed;
                setServing(Math.max(1, Math.round(grams)));
              }}
              aria-label={t("confirm.quantity")}
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as "g" | "kg")}
              aria-label={t("confirm.quantity")}
            >
              {/* Switching unit converts the display, never the mass. */}
              <option value="g">{t("unit.grams")}</option>
              <option value="kg">{t("unit.kg")}</option>
            </select>
          </div>
        </label>

        <label>
          {t("confirm.location")}
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All of India (national mix)</option>
            {STATES.filter(Boolean).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <div className="sheetActions">
          <button className="secondary" onClick={onCancel}>
            {t("confirm.rescan")}
          </button>
          <button
            className="primary"
            disabled={!canConfirm}
            onClick={() =>
              onConfirm({
                product_id: selected,
                name: chosen?.name ?? resolved.name ?? "",
                serving_g: serving,
                force_state: state || undefined,
                // Only when there is no catalogue product to price instead.
                ingredients: !selected && scanned ? resolved.ingredients : undefined,
              })
            }
          >
            {busy ? t("state.loading") : `${t("confirm.calculate")} →`}
          </button>
        </div>
      </div>
    </div>
  );
}
