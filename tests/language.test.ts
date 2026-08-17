import { describe, expect, it } from "vitest";
import { LANGS, LANG_LABEL, LANG_SHORT, t } from "../i18n/index.ts";
import { allAliases, allCrops, calculateProduct, visibleProducts } from "../repo/db.ts";
import { resolveText } from "../resolvers/textmatch.ts";
import { DEMO_ITEMS } from "../app/api/_lib/demo-items.ts";
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
 * The identical-key-set test above cannot catch English COPIED into hi/mr/ta —
 * the keys match, the values are wrong. This guard does: every value in a
 * non-English bundle must actually be written in that bundle's script.
 *
 * A value is exempt only when it contains no Latin letter run of 4+ characters
 * once `{placeholder}` tokens are stripped — that covers numbers, symbols,
 * punctuation-only strings and short codes ("EAN", "L", "…") without exempting
 * real English sentences. Genuine named exceptions go in the ALLOWLIST, never
 * inline in the test.
 */
describe("translation guard: values are in the right script, not copied English", () => {
  /**
   * Keys whose value is legitimately Latin in every language. Add here with a
   * reason, never by weakening the test:
   * - chat.tmpl.gwBand: the value is entirely `{placeholder}`s plus "CGWB",
   *   the source body's proper name (Central Ground Water Board) — an acronym
   *   cited as-is in every language, like "ISRO" or "NASA".
   */
  const ALLOWLIST: string[] = ["chat.tmpl.gwBand"];

  const DEVANAGARI = /[ऀ-ॿ]/;
  const TAMIL = /[஀-௿]/;
  // 4+ consecutive Latin letters = real English words are present.
  const LATIN_RUN = /[A-Za-z]{4,}/;

  /** `{name}`-style interpolation slots are key syntax, not English prose. */
  const withoutPlaceholders = (value: string) => value.replace(/\{\w+\}/g, "");

  const BUNDLES: [string, Record<string, string>, RegExp][] = [
    ["hi", hi, DEVANAGARI],
    ["mr", mr, DEVANAGARI],
    ["ta", ta, TAMIL],
  ];

  for (const [lang, bundle, script] of BUNDLES) {
    it(`every ${lang}.json value is translated into its own script`, () => {
      const todo: string[] = [];
      for (const [key, value] of Object.entries(bundle)) {
        if (ALLOWLIST.includes(key)) continue;
        const stripped = withoutPlaceholders(value);
        if (!LATIN_RUN.test(stripped)) continue; // symbols/numbers/short codes
        if (!script.test(stripped)) todo.push(key);
      }
      expect(
        todo,
        `${lang}.json has English (or untranslated) values at:\n  ${todo.join("\n  ")}\n`,
      ).toEqual([]);
    });
  }
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

  it("refuses to price a pure animal product rather than serving zero", () => {
    // Hidden is not deleted — the rows remain — but an all-animal product has
    // no citable water at all, and "0 L" would be a fabricated footprint.
    for (const id of HIDDEN) {
      expect(() => calculateProduct(id), id).toThrow(/animal-derived|Missing/);
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

  it("crops in, textiles out: cotton and jute crops stay, garments hide", () => {
    const crops = new Set(allCrops().map((c) => c.crop_id));
    expect(crops.has("cotton")).toBe(true);
    expect(crops.has("jute")).toBe(true);

    const visible = new Set(visibleProducts().map((p) => p.product_id));
    // The crop products remain browsable and calculable…
    for (const id of ["cotton_raw", "jute_raw", "parle_g_biscuit", "okra_raw",
                      "biryani_chicken", "dal_tadka"]) {
      expect(visible.has(id), id).toBe(true);
    }
    // …while every manufactured textile is out of the problem statement's scope.
    for (const id of ["cotton_tshirt", "jeans_pair", "cotton_saree", "jute_bag"]) {
      expect(visible.has(id), id).toBe(false);
      // Hidden, not deleted: still calculable by direct id.
      expect(calculateProduct(id).footprint_l.total, id).toBeGreaterThan(0);
    }
  });

  it("dishes keep working with animal ingredients excluded, named and disclosed", () => {
    for (const id of ["biryani_chicken", "chai", "paneer_butter_masala", "parle_g_biscuit"]) {
      const r = calculateProduct(id);
      expect(r.footprint_l.total, id).toBeGreaterThan(0);
      // The exclusion is named in the lineage AND surfaced for the screen…
      expect(r.excluded_ingredients.length, id).toBeGreaterThan(0);
      expect(r.lineage.fallbacks_used.some((f) => f.endsWith(":animal_excluded")), id).toBe(true);
      // …and the served total is honestly marked low-confidence.
      expect(r.confidence.quality, id).toBe("low");
    }
  });

  it("biryani excludes the chicken from its total, not just its label", () => {
    const r = calculateProduct("biryani_chicken", { servingG: 350, month: 7 });
    expect(r.excluded_ingredients.map((e) => e.crop_id).sort()).toEqual(["chicken_meat", "milk"]);
    // The rice/vegetable water alone — far below the old animal-inclusive 601.
    expect(r.footprint_l.total).toBeLessThan(400);
  });

  it("the demo snapshot list contains only browsable products", () => {
    const visible = new Set(visibleProducts().map((p) => p.product_id));
    for (const id of DEMO_ITEMS) expect(visible.has(id), id).toBe(true);
    expect([...DEMO_ITEMS]).not.toContain("cotton_tshirt");
  });
});
