import { describe, expect, it } from "vitest";
import {
  ingredientMatches,
  resolveText,
} from "../resolvers/textmatch.ts";
import {
  allCrops,
  allProducts,
  getCrop,
  productsContaining,
  productName,
  visibleProducts,
} from "../repo/db.ts";

/**
 * Search TIER 4 — ingredient match.
 *
 * Searching a base crop must also surface the dishes and products made from it,
 * without loosening any scope rule: agricultural products only, every tier
 * behind the shared visibility helpers, and no invented number anywhere in the
 * search path.
 */

const visibleIds = new Set(visibleProducts().map((p) => p.product_id));

/** Product ids that must never surface in ANY search tier. */
const ANIMAL_PRODUCTS = ["milk_raw", "paneer_raw", "egg_raw", "chicken_raw", "butter_raw"];
const TEXTILE_PRODUCTS = ["cotton_tshirt", "jeans_pair", "cotton_saree", "jute_bag"];

function allTierIds(query: string): string[] {
  const cascade = resolveText(query, "en", 25).map((c) => c.product_id);
  const tier4 = ingredientMatches(query, "en", 25)?.matches.map((m) => m.product_id) ?? [];
  return [...cascade, ...tier4];
}

describe("tier 4: searching a crop returns products containing it", () => {
  it('searching "rice" returns rice AND biryani, poha, idli', () => {
    expect(resolveText("rice", "en", 1)[0].product_id).toBe("rice_raw");

    const result = ingredientMatches("rice", "en", 25);
    expect(result).not.toBeNull();
    expect(result!.crop.crop_id).toBe("rice");
    const ids = result!.matches.map((m) => m.product_id);
    expect(ids).toContain("biryani_chicken");
    expect(ids).toContain("poha");
    expect(ids).toContain("idli");
    // The crop itself belongs to the cascade, not the "containing" group.
    expect(ids).not.toContain("rice_raw");
  });

  it('searching "wheat" returns wheat AND roti, biscuits', () => {
    expect(resolveText("wheat", "en", 1)[0].product_id).toBe("wheat_raw");

    const ids = ingredientMatches("wheat", "en", 25)!.matches.map((m) => m.product_id);
    expect(ids).toContain("roti");
    expect(ids).toContain("parle_g_biscuit");
    expect(ids).toContain("biscuit_marie");
  });

  it("ingredient matches ranked by crop share in each product", () => {
    for (const q of ["rice", "wheat"]) {
      const matches = ingredientMatches(q, "en", 25)!.matches;
      expect(matches.length).toBeGreaterThan(1);
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].share_pct).toBeGreaterThanOrEqual(matches[i].share_pct);
      }
      // Roti (75% wheat) must outrank dishes where wheat is a minor
      // ingredient, like pav bhaji (20%).
      if (q === "wheat") {
        const ids = matches.map((m) => m.product_id);
        expect(ids.indexOf("roti")).toBeLessThan(ids.indexOf("pav_bhaji"));
      }
    }
  });

  it("a dish query gets no ingredient expansion — the gate is raw crops only", () => {
    expect(ingredientMatches("biryani", "en")).toBeNull();
    expect(ingredientMatches("dal tadka", "en")).toBeNull();
  });
});

describe("scope: agricultural products only, in every tier", () => {
  it("no animal product appears in any search tier", () => {
    for (const q of ["milk", "chicken", "paneer", "egg", "butter", "rice", "wheat", "biryani"]) {
      for (const id of allTierIds(q)) {
        expect(ANIMAL_PRODUCTS, `query "${q}" surfaced ${id}`).not.toContain(id);
        expect(visibleIds, `query "${q}" surfaced hidden ${id}`).toContain(id);
      }
    }
    // An animal crop can never seed tier 4, even by name.
    for (const q of ["milk", "chicken", "egg", "paneer"]) {
      const r = ingredientMatches(q, "en");
      if (r) expect(getCrop(r.crop.crop_id)!.is_animal).toBe(0);
    }
  });

  it("no textile or garment appears in any search tier", () => {
    for (const q of ["tshirt", "t shirt", "jeans", "saree", "jute bag", "cotton"]) {
      for (const id of allTierIds(q)) {
        expect(TEXTILE_PRODUCTS, `query "${q}" surfaced ${id}`).not.toContain(id);
      }
    }
    // Cotton the CROP stays searchable (real Table 3 figures) but is not food,
    // so the second line of defence blocks its ingredient expansion entirely.
    expect(ingredientMatches("cotton", "en")).toBeNull();
    expect(productsContaining("cotton")).toEqual([]);
  });

  it("hidden (is_visible=0) products never appear in any tier", () => {
    const hidden = allProducts()
      .filter((p) => p.is_visible === 0 || p.type === "non_food")
      .map((p) => p.product_id);
    expect(hidden.length).toBeGreaterThan(0);

    // Tier 4 exhaustively: no crop's containing-list may reach a hidden row.
    for (const crop of allCrops()) {
      for (const row of productsContaining(crop.crop_id)) {
        expect(hidden).not.toContain(row.product.product_id);
        expect(visibleIds).toContain(row.product.product_id);
      }
    }
    // And by name: hidden products are unreachable through the cascade.
    for (const q of ["milk", "cotton tshirt", "jeans", "jute bag"]) {
      for (const id of allTierIds(q)) expect(hidden).not.toContain(id);
    }
  });

  it("second line of defence: productsContaining refuses animal and non-food crops", () => {
    for (const crop of allCrops()) {
      if (crop.is_animal !== 0 || crop.is_food !== 1 || crop.is_visible === 0) {
        expect(productsContaining(crop.crop_id), crop.crop_id).toEqual([]);
      }
    }
  });
});

describe("no invented numbers in the search path", () => {
  it("an unmatched term returns suggestions, not an invented footprint", () => {
    const hits = resolveText("zzqqxx", "en", 5);
    // Fuzzy suggestions may exist, but none is confident and none carries a
    // litre figure — search identifies, it never prices.
    for (const h of hits) {
      expect(h.confident).toBe(false);
      expect(h).not.toHaveProperty("litres");
      expect(h).not.toHaveProperty("footprint_l");
      expect(visibleIds).toContain(h.product_id);
    }
    expect(ingredientMatches("zzqqxx", "en")).toBeNull();
  });

  it("unmatched term is never defaulted to the vegetable category", () => {
    // Every id a search can return is a REAL catalogue row — no synthetic
    // "vegetable average" product exists to be defaulted to.
    const real = new Set(allProducts().map((p) => p.product_id));
    for (const q of ["zzqqxx", "frobnicator", "xyzzy food"]) {
      for (const id of allTierIds(q)) expect(real).toContain(id);
      expect(ingredientMatches(q, "en")).toBeNull();
    }
  });

  it("no result renders 0 L — search results carry no litre field at all", () => {
    const rice = ingredientMatches("rice", "en", 25)!;
    for (const m of rice.matches) {
      expect(Object.keys(m).sort()).toEqual(
        ["default_serving_g", "name", "product_id", "share_pct"].sort(),
      );
      // The share badge is hidden below 1% in the UI; the data layer never
      // emits a zero share in the first place.
      expect(m.share_pct).toBeGreaterThan(0);
    }
  });
});

describe("language", () => {
  it("results respect the active language", () => {
    const en = ingredientMatches("rice", "en", 25)!;
    const hi = ingredientMatches("rice", "hi", 25)!;
    expect(hi.matches.map((m) => m.product_id)).toEqual(en.matches.map((m) => m.product_id));

    const products = new Map(visibleProducts().map((p) => [p.product_id, p]));
    for (const m of hi.matches) {
      expect(m.name).toBe(productName(products.get(m.product_id)!, "hi"));
    }
    // The group label's crop name is localised too, and at least one name
    // actually differs from English — the lang parameter is used, not ignored.
    expect(hi.crop.name).toBe("चावल");
    expect(hi.matches.some((m, i) => m.name !== en.matches[i].name)).toBe(true);

    // A Devanagari QUERY reaches the same tier.
    expect(ingredientMatches("चावल", "hi", 25)!.crop.crop_id).toBe("rice");
  });

  it("bhindi and भेंडी still resolve as before", () => {
    expect(resolveText("bhindi", "mr", 1)[0].product_id).toBe("okra_raw");
    expect(resolveText("भेंडी", "mr", 1)[0].product_id).toBe("okra_raw");
    expect(resolveText("vendakkai", "ta", 1)[0].product_id).toBe("okra_raw");
  });
});
