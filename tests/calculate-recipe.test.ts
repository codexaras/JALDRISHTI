import { describe, expect, it } from "vitest";
import { calculateProduct, calculateRecipe } from "../repo/db.ts";
import { tagVariants, mapTags } from "../resolvers/barcode.ts";
import { DEMO_ITEMS } from "../app/api/_lib/demo-items.ts";

/**
 * The dead "Confirm & calculate" button.
 *
 * A barcode resolves to an ingredient LIST, not a catalogue product — there are
 * millions of packets and 168 catalogue rows. The confirmation sheet had no
 * `product_id` to submit, so its button rendered permanently disabled: the
 * click produced no result, no error and no spinner, because no handler ever
 * ran. Diagnosing it as a 500 was a red herring; nothing threw.
 */
const lays = [
  { product_id: "scanned", crop_id: "potato", raw_grams_per_100g: 40.8, yield_fraction: 1, source: "OFF" },
  { product_id: "scanned", crop_id: "sunflower", raw_grams_per_100g: 20.4, yield_fraction: 0.4, source: "OFF" },
  { product_id: "scanned", crop_id: "sugarcane", raw_grams_per_100g: 13.6, yield_fraction: 0.11, source: "OFF" },
];

describe("scanned packets calculate without a catalogue product", () => {
  it("returns a complete result for a Lays-style ingredient list", () => {
    const r = calculateRecipe({ name: "Lays american cream onion", ingredients: lays }, { servingG: 100 });
    expect(r.footprint_l.total).toBeGreaterThan(0);
    expect(r.footprint_l.green + r.footprint_l.blue + r.footprint_l.grey).toBe(r.footprint_l.total);
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.product.name).toBe("Lays american cream onion");
  });

  it("never claims high confidence — mass fractions are rank-estimated", () => {
    const r = calculateRecipe({ name: "x", ingredients: lays }, { servingG: 100 });
    expect(r.confidence.quality).not.toBe("high");
  });

  it("throws a NAMED error when no ingredient is a known crop", () => {
    // The route turns this into a structured 422, never a bare 500.
    expect(() =>
      calculateRecipe({
        name: "mystery",
        ingredients: [{ product_id: "s", crop_id: "unobtainium", raw_grams_per_100g: 100, yield_fraction: 1, source: "OFF" }],
      }),
    ).toThrow(/product_ingredient|Missing/);
  });

  it("scales with serving size like any other calculation", () => {
    const a = calculateRecipe({ name: "x", ingredients: lays }, { servingG: 100 });
    const b = calculateRecipe({ name: "x", ingredients: lays }, { servingG: 200 });
    expect(b.footprint_l.total).toBeGreaterThan(a.footprint_l.total * 1.8);
  });

  it("every locked demo item still returns a complete result", () => {
    for (const id of DEMO_ITEMS) {
      const r = calculateProduct(id);
      expect(r.footprint_l.total, id).toBeGreaterThan(0);
      expect(r.sources.length, id).toBeGreaterThan(0);
    }
  });
});

describe("ingredient tag normalisation", () => {
  it("resolves both spellings of iodised salt", () => {
    for (const tag of ["en:iodised-salt", "en:iodized-salt"]) {
      const { ingredients, unmatched } = mapTags([tag, "en:potato"]);
      expect(unmatched, tag).not.toContain("iodised-salt");
      expect(unmatched, tag).not.toContain("iodized-salt");
      expect(ingredients.some((i) => i.crop_id === "potato"), tag).toBe(true);
    }
  });

  it("handles the space-for-hyphen and OCR forms OFF actually sends", () => {
    // Real payload from a Lay's packet: a space, and a lowercase L for an i.
    const { unmatched } = mapTags(["en:lodised salt"]);
    expect(unmatched).not.toContain("lodised salt");
  });

  it("generates British, American, singular and plural spellings", () => {
    const v = tagVariants("en:Flavouring Agents");
    expect(v).toContain("flavouring-agents");
    expect(v).toContain("flavoring-agents");
    expect(v.some((x) => x === "flavouring-agent")).toBe(true);
  });

  it("never returns an empty string as a variant", () => {
    for (const raw of ["en:", "", "   ", "en:---"]) {
      expect(tagVariants(raw).every((v) => v.length > 0)).toBe(true);
    }
  });
});
