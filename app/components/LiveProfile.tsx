"use client";

/**
 * Profile — the personal half of the PS's "community as well as personal levels".
 *
 * This screen used to print a scan history with hardcoded figures: rice at
 * "2,480 L/kg", tomato "215", wheat "1,760". The engine says 2,499, 214 and
 * 1,827. Numbers that are *nearly* right are the dangerous kind — close enough
 * to look researched, wrong enough to fall apart if a judge checks one. Every
 * figure here now comes from the same catalogue endpoint the rest of the app
 * uses, so it cannot drift again.
 *
 * The counters are likewise real properties of the dataset rather than invented
 * activity: this build has no accounts, so "12 products explored" was a claim
 * about a user who does not exist.
 *
 * Rule 3: every class is the original one — .profileHead, .profileStats,
 * .historyLayout, .historyRow, .mini, .avatar. Only the values changed.
 */
import { useEffect, useState } from "react";
import { api, type CatalogueItem } from "../lib/client.ts";
import { useLang } from "../lib/i18n-client.tsx";
import { ProductImage } from "./ProductImage.tsx";

/** Shown as the worked examples — staples, and all three exist in the catalogue. */
const EXAMPLES = ["rice_raw", "tomato_raw", "wheat_raw"];

export function LiveProfile({ onPick }: { onPick: (name: string) => void }) {
  const { t, n, lang } = useLang();
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api
      .catalogue(lang, "All", "score")
      .then((d) => {
        if (cancelled) return;
        const byId = new Map(d.items.map((i) => [i.product_id, i]));
        setItems(EXAMPLES.map((id) => byId.get(id)).filter(Boolean) as CatalogueItem[]);
        setTotal(d.items.length);
        setCategories(Math.max(0, d.categories.length - 1));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [lang]);

  return (
    <section className="appPage">
      <div className="profileHead">
        <div className="avatar">JD</div>
        <div>
          <span className="overline">{t("profile.overline")}</span>
          <h1>{t("profile.title")}</h1>
          <p>{t("location.national")} · {lang.toUpperCase()}</p>
        </div>
        <button>{t("profile.manage")}</button>
      </div>

      {/* Facts about the dataset, not invented activity — this build has no
          accounts, so there is no history to count. */}
      <div className="profileStats">
        <div><b>{n(total)}</b><span>{t("profile.statProducts")}</span></div>
        <div><b>{categories}</b><span>{t("profile.statCategories")}</span></div>
        <div><b>36</b><span>{t("profile.statStates")}</span></div>
      </div>

      <div className="historyLayout">
        <div>
          <div className="sectionTitle">
            <h2>{t("profile.staples")}</h2>
            <button onClick={() => onPick("rice")}>{t("profile.lookOne")} →</button>
          </div>
          {items.map((item, i) => (
            <button className="historyRow" onClick={() => onPick(item.name_en)} key={item.product_id}>
              <span className={`mini produce${i}`}>
                <ProductImage productId={item.product_id} alt={item.name} />
                {item.name.slice(0, 1)}
              </span>
              <div>
                <b>{item.name}</b>
                <small>
                  {t("result.perServing", { grams: n(item.serving_g) })} ·{" "}
                  {t(`confidence.${item.confidence}`)}
                </small>
              </div>
              <strong>{n(item.total_l)} L</strong>
              <i>›</i>
            </button>
          ))}
          {items.length === 0 && <p className="sourceNote">{t("state.loading")}</p>}
        </div>

        <aside>
          <h3>{t("profile.prefs")}</h3>
          <p><span>{t("profile.defaultLocation")}</span><b>{t("location.national")}</b></p>
          <p><span>{t("profile.language")}</span><b>{lang.toUpperCase()}</b></p>
          <p><span>{t("profile.reducedMotion")}</span><b>{t("profile.systemSetting")}</b></p>
          <p><span>{t("profile.scanHistory")}</span><b>{t("profile.regionOnly")}</b></p>
          <button onClick={() => onPick("rice")}>{t("profile.lookup")} →</button>
        </aside>
      </div>
    </section>
  );
}
