"use client";

/**
 * The product library, driven by the real catalogue.
 *
 * Replaces a hardcoded six-item array whose L/kg ranges ("2,300–2,700 L/kg")
 * were invented and disagreed with the engine on the very next screen. Every
 * number here now comes from the same pipeline that produces the result page.
 *
 * Rule 3: reuses `.librarySearch`, `.filters`, `.libraryGrid`, `.libraryCard`,
 * `.photo`, `.eff` and `.empty`. Nothing was restyled.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type CatalogueItem } from "../lib/client.ts";
import { useLang } from "../lib/i18n-client.tsx";
import { ProductImage } from "./ProductImage.tsx";

export function LiveExplore({
  query,
  setQuery,
  onPick,
  busy,
}: {
  query: string;
  setQuery: (s: string) => void;
  onPick: (name: string) => void;
  busy: boolean;
}) {
  const { t, n, lang } = useLang();
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [categories, setCategories] = useState<string[]>(["All"]);
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const categoryRef = useRef(category);
  useEffect(() => { categoryRef.current = category; });

  const load = useCallback(async (cat: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.catalogue(lang, cat);
      setItems(data.items);
      setCategories(data.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load the catalogue");
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) load(categoryRef.current); });
    return () => { cancelled = true; };
  }, [lang, load]);

  // Typing filters what is already loaded; Enter runs the full resolver.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.name_en.toLowerCase().includes(q),
    );
  }, [items, query]);

  const pick = (cat: string) => {
    setCategory(cat);
    load(cat);
  };

  return (
    <section className="appPage">
      <div className="pageIntro row">
        <div>
          <span className="overline">PRODUCT LIBRARY</span>
          <h1>Explore water stories</h1>
          <p>{t("explore.count", { count: items.length })}</p>
        </div>
      </div>

      <div className="librarySearch">
        <span>⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && query.trim() && onPick(query)}
          placeholder={t("search.placeholder")}
          aria-label={t("search.button")}
        />
        <button aria-label={t("search.button")} disabled={busy} onClick={() => query.trim() && onPick(query)}>
          ⌕
        </button>
      </div>

      <div className="filters">
        {categories.map((c) => (
          <button key={c} className={category === c ? "active" : ""} onClick={() => pick(c)} disabled={loading}>
            {c}
          </button>
        ))}
      </div>

      {loading && items.length === 0 && (
        <div className="stateBox"><div className="spinner" /><h2>{t("state.loading")}</h2></div>
      )}

      {error && (
        <div className="stateBox">
          <h2>{t("state.error")}</h2>
          <p>{error}</p>
          <button onClick={() => load(category)}>{t("state.retry")}</button>
        </div>
      )}

      <div className="libraryGrid" style={loading ? { opacity: 0.55 } : undefined}>
        {visible.map((item, i) => (
          <div
            className="libraryCard"
            key={item.product_id}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(item.name_en);
              }
            }}
            onClick={() => onPick(item.name_en)}
          >
            {/* The tinted tile stays as the backdrop, so a product with no
                photo yet reads as intentional rather than broken. */}
            <div className={`photo produce${i % 6}`}>
              <ProductImage productId={item.product_id} alt={item.name} />
              <span>{item.name}</span>
            </div>
            <div>
              <small>{item.category.toUpperCase()}</small>
              <h3>{item.name}</h3>
              <p>{t("result.perServing", { grams: n(item.serving_g) })}</p>
              <b>{n(item.total_l)} L</b>
              <div className="eff">
                {/* The bar is the irrigation share — the part that competes with
                    groundwater — not the total. */}
                <span style={{ width: `${Math.round(item.blue_share * 100)}%` }} />
                <small>{t("explore.irrigation", { pct: Math.round(item.blue_share * 100) })}</small>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!loading && visible.length === 0 && (
        <div className="empty">
          <span>⌕</span>
          <h2>{t("search.noResults")}</h2>
          <p>{t("search.tryAgain")}</p>
          <button onClick={() => setQuery("")}>{t("state.retry")}</button>
        </div>
      )}
    </section>
  );
}
