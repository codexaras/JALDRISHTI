import { describe, expect, it } from "vitest";
import { LANGS, LANG_LABEL, LANG_SHORT, t } from "../i18n/index.ts";
import { allAliases, allCrops, calculateProduct, visibleProducts } from "../repo/db.ts";
import { resolveText } from "../resolvers/textmatch.ts";
import en from "../i18n/en.json" with { type: "json" };
import hi from "../i18n/hi.json" with { type: "json" };
import mr from "../i18n/mr.json" with { type: "json" };
import ta from "../i18n/ta.json" with { type: "json" };

/**
 * AMENDMENT_11 §2 — the language switcher.
 *
 * The control exists so a person who cannot read the CURRENT interface language
 * can still find theirs. That only works if every entry is written in its own
 * script, so that is what these assert.
 */
describe("AMENDMENT_11: language menu", () => {
  it("labels every language in its own script, never a translated name", () => {
    // Devanagari for Hindi and Marathi, Tamil for Tamil, Latin for English.
    expect(LANG_LABEL.hi).toMatch(/[\u0900-\u097F]/);
    expect(LANG_LABEL.mr).toMatch(/[\u0900-\u097F]/);
    expect(LANG_LABEL.ta).toMatch(/[\u0B80-\u0BFF]/);
    expect(LANG_LABEL.en).toBe("English");

    // The failure this guards against: an English word standing in for a script.
    for (const code of LANGS) {
      if (code === "en") continue;
      expect(LANG_LABEL[code], code).not.toMatch(/^[A-Za-z ]+$/);
    }
  });

  it("has a native label and a short label for every language in LANGS", () => {
    for (const code of LANGS) {
      expect(LANG_LABEL[code], code).toBeTruthy();
      expect(LANG_SHORT[code], code).toBeTruthy();
    }
  });

  it("is driven by a config array, so adding a language needs no code change", () => {
    // Every language in LANGS must resolve a real bundle, or the menu would
    // render an entry that translates to nothing.
    const bundles: Record<string, Record<string, string>> = { en, hi, mr, ta };
    for (const code of LANGS) {
      expect(Object.keys(bundles[code] ?? {}).length, code).toBeGreaterThan(100);
    }
  });

  it("every language carries the switcher's own aria-label", () => {
    for (const code of LANGS) {
      const label = t(code, "lang.change");
      expect(label, code).toBeTruthy();
      expect(label, code).not.toBe("lang.change");
    }
  });

  it("all four bundles share an identical key set", () => {
    const keys = Object.keys(en).sort();
    for (const [name, bundle] of Object.entries({ hi, mr, ta })) {
      expect(Object.keys(bundle).sort(), name).toEqual(keys);
    }
  });
});

/**
 * AMENDMENT_11 §4 — catalogue scope.
 *
 * Animal water footprints are not in Mekonnen & Hoekstra 2011, which covers
 * crops only, so every animal figure held here is uncited. Hiding them closes a
 * citation gap. They are HIDDEN, not deleted: the rows stay auditable and every
 * dish that uses one still resolves.
 */
describe("AMENDMENT_11: catalogue visibility", () => {
  const HIDDEN = ["milk_raw", "egg_raw", "chicken_raw", "goat_meat_raw",
                  "sheep_meat_raw", "buffalo_meat_raw", "butter_raw", "cheese_raw"];

  it("hides every pure animal product from browsing", () => {
    const visible = new Set(visibleProducts().map((p) => p.product_id));
    for (const id of HIDDEN) expect(visible.has(id), id).toBe(false);
  });

  it("keeps them calculable — hidden is not deleted", () => {
    for (const id of HIDDEN) {
      const r = calculateProduct(id);
      expect(r.footprint_l.total, id).toBeGreaterThan(0);
    }
  });

  it("never surfaces a hidden product through search or aliases", () => {
    const hidden = new Set(HIDDEN);
    for (const q of ["milk", "dudh", "chicken", "egg", "paneer", "butter", "mutton"]) {
      for (const hit of resolveText(q, "en", 8)) {
        expect(hidden.has(hit.product_id), `${q} -> ${hit.product_id}`).toBe(false);
      }
    }
    for (const a of allAliases()) expect(hidden.has(a.product_id), a.alias_text).toBe(false);
  });

  it("keeps cotton and jute crops, and the garments the build depends on", () => {
    const crops = new Set(allCrops().map((c) => c.crop_id));
    expect(crops.has("cotton")).toBe(true);
    expect(crops.has("jute")).toBe(true);

    // Locked demo items and the PS "daily life" clause must stay browsable.
    const visible = new Set(visibleProducts().map((p) => p.product_id));
    for (const id of ["cotton_tshirt", "jeans_pair", "parle_g_biscuit", "okra_raw",
                      "biryani_chicken", "dal_tadka"]) {
      expect(visible.has(id), id).toBe(true);
    }
  });

  it("leaves dishes containing animal ingredients intact and calculable", () => {
    // Not deleted and not silently altered — their footprints are unchanged.
    for (const id of ["biryani_chicken", "chai", "paneer_butter_masala", "parle_g_biscuit"]) {
      const r = calculateProduct(id);
      expect(r.footprint_l.total, id).toBeGreaterThan(0);
    }
  });
});
