"use client";

/**
 * The home page's quick-pick grid, from the real catalogue.
 *
 * Previously a hardcoded six-item array with invented L/kg ranges. Every number
 * here now comes from the same pipeline as the result screen.
 *
 * The heading asks "What's on your plate?", so the grid answers with plates:
 * dishes at the portion someone actually eats. Sampling the catalogue by score
 * instead put clove — 61,206 L/kg, a pinch at a time — in the first slot, which
 * is a true number and a useless answer to that question.
 */
import { useEffect, useState } from "react";
import { api, type CatalogueItem } from "../lib/client.ts";
import { useLang } from "../lib/i18n-client.tsx";
import { ProductImage } from "./ProductImage.tsx";

/**
 * Everyday items, in the order they read best: a staple, a dal, a rice dish, a
 * drink, a paneer dish, and one non-food product — the PS's "items they use in
 * daily life" clause, which is easy to forget is part of the brief.
 *
 * A curated running order, not curated data: each id is looked up in the
 * catalogue and dropped if it is missing, so this can never invent a product.
 */
const EVERYDAY = [
  "roti",
  "dal_tadka",
  "biryani_chicken",
  "chai",
  "paneer_butter_masala",
  "cotton_tshirt",
];

export function HomeGrid({ onPick }: { onPick: (name: string) => void }) {
  const { t, n, lang } = useLang();
  const [items, setItems] = useState<CatalogueItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api
      .catalogue(lang, "All", "score")
      .then((d) => {
        if (cancelled) return;
        const byId = new Map(d.items.map((i) => [i.product_id, i]));
        const picked = EVERYDAY.map((id) => byId.get(id)).filter(Boolean) as CatalogueItem[];

        // Top up from across the score range if a curated id has gone missing,
        // so the grid is never short and never silently empty.
        if (picked.length < 6) {
          const chosen = new Set(picked.map((i) => i.product_id));
          const rest = d.items.filter((i) => !chosen.has(i.product_id));
          const stride = Math.max(1, Math.floor(rest.length / 6));
          for (let idx = 0; idx < rest.length && picked.length < 6; idx += stride) {
            picked.push(rest[idx]);
          }
        }
        setItems(picked.slice(0, 6));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [lang]);

  if (items.length === 0) return <div className="productGrid" aria-hidden="true" />;

  return (
    <div className="productGrid">
      {items.map((item, i) => (
        <button className="productCard" key={item.product_id} onClick={() => onPick(item.name_en)}>
          <div className={`produce produce${i % 6}`}>
            <ProductImage productId={item.product_id} alt={item.name} />
            <span>{item.name.slice(0, 1)}</span>
          </div>
          <div>
            <b>{item.name}</b>
            <small>{n(item.total_l)} L · {t("result.perServing", { grams: n(item.serving_g) })}</small>
          </div>
          <span className="arrow">↗</span>
        </button>
      ))}
    </div>
  );
}
