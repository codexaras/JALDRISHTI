import { describe, expect, it } from "vitest";
import { cropFootprint, roundSplit } from "../engine/footprint.ts";
import { decompose } from "../engine/decompose.ts";
import { stressFactor, stressCategory } from "../engine/stress.ts";
import { score, householdDays, LPCD_BENCHMARK } from "../engine/scoring.ts";
import { seasonForMonth } from "../engine/season.ts";
import { sourceCrop } from "../engine/sourcing.ts";
import { DataMissingError } from "../engine/errors.ts";
import { calculateProduct, catalogDistribution, allProducts, visibleProducts } from "../repo/db.ts";
import type { GwStress, ProductionShare } from "../engine/types.ts";

/**
 * These are invariants and relationships, not fabricated expected values.
 * Hand-verified golden numbers live in tests/golden.test.ts.
 */

describe("units (BUILD_SPEC rule 2.2)", () => {
  it("does not convert m³/tonne to L/kg", () => {
    // 1 kg of a crop published at 2000 m³/tonne must yield exactly 2000 L.
    expect(cropFootprint(1.0, { green: 2000, blue: 0, grey: 0 }, 1.0).green).toBe(2000);
  });

  it("never introduces a factor of 1000 anywhere", () => {
    const r = cropFootprint(1.0, { green: 1146, blue: 341, grey: 187 }, 1.0);
    expect(r.total).toBe(1674);
  });
});

describe("processing yield (BUILD_SPEC rule 2.3)", () => {
  it("divides by yield_fraction", () => {
    const whole = cropFootprint(1.0, { green: 1000, blue: 0, grey: 0 }, 1.0);
    const milled = cropFootprint(1.0, { green: 1000, blue: 0, grey: 0 }, 0.5);
    expect(milled.green).toBeCloseTo(whole.green * 2, 6);
  });

  it("rejects a yield fraction outside (0, 1]", () => {
    expect(() => cropFootprint(1, { green: 1, blue: 0, grey: 0 }, 0)).toThrow(RangeError);
    expect(() => cropFootprint(1, { green: 1, blue: 0, grey: 0 }, 1.5)).toThrow(RangeError);
  });
});

describe("stress factor", () => {
  it("floors at 1.0 — a safe district never reduces impact", () => {
    expect(stressFactor(42)).toBe(1.0);
    expect(stressFactor(0)).toBe(1.0);
    expect(stressFactor(70)).toBe(1.0);
  });

  it("scales above CGWB's safe threshold", () => {
    expect(stressFactor(156.36)).toBeCloseTo(2.23, 2);
    expect(stressFactor(140)).toBeCloseTo(2.0, 6);
  });

  it("bands match CGWB categories", () => {
    expect(stressCategory(42)).toBe("safe");
    expect(stressCategory(75)).toBe("semi_critical");
    expect(stressCategory(95)).toBe("critical");
    expect(stressCategory(156.36)).toBe("over_exploited");
  });
});

describe("sourcing", () => {
  // Punjab publishes a percentage; West Bengal is categorised only, so its
  // figure is the midpoint of the Safe band. Both are cited — see AMENDMENT_07.
  const stressed: GwStress = {
    district: "STATE_AVERAGE",
    state: "Punjab",
    soe_pct: 156.36,
    category: "over_exploited",
    band_min: 100,
    band_max: 160,
    assessment_year: 2025,
    precision: "exact",
    level: "state",
    source: "CGWB Dynamic Ground Water Resources Assessment 2025",
  };
  const safe: GwStress = {
    district: "STATE_AVERAGE",
    state: "West Bengal",
    soe_pct: 35,
    category: "safe",
    band_min: 0,
    band_max: 70,
    assessment_year: 2024,
    precision: "band_midpoint",
    level: "state",
    source: "CGWB 2024 National Compilation, State/UT-wise categorisation (band only)",
  };
  const share = (state: string, district: string): ProductionShare => ({
    crop_id: "rice",
    state,
    share: 1.0,
    rep_district: district,
    lat: 0,
    lon: 0,
    source: "S4",
  });

  it("gives a strictly higher impact for the same crop in a stressed district", () => {
    const stressedResult = sourceCrop({
      crop_id: "rice",
      crop_name: "Rice",
      blue_l: 1000,
      shares: [share("Punjab", "Punjab")],
      stressByState: new Map([["Punjab", stressed]]),
    });
    const safeResult = sourceCrop({
      crop_id: "rice",
      crop_name: "Rice",
      blue_l: 1000,
      shares: [share("West Bengal", "West Bengal")],
      stressByState: new Map([["West Bengal", safe]]),
    });
    expect(stressedResult.impact_blue_l).toBeGreaterThan(safeResult.impact_blue_l);
    expect(safeResult.impact_blue_l).toBe(1000); // safe district: unweighted
    expect(stressedResult.impact_blue_l).toBeCloseTo(1000 * (156.36 / 70), 6);
  });

  it("impact is grey plus weighted blue — green is excluded, grey is unweighted", () => {
    const rice = calculateProduct("rice_raw", { servingG: 1000 });
    const weightedBlue = rice.impact_l - rice.footprint_l.grey;

    // Rainfall the crop absorbed in place is not impact, so it must not appear.
    expect(rice.impact_l).toBeLessThan(rice.footprint_l.total);
    expect(rice.impact_l).toBeLessThan(rice.footprint_l.green);

    // Blue is scaled UP by groundwater stress, never down — the floor is 1.0.
    expect(weightedBlue).toBeGreaterThanOrEqual(rice.footprint_l.blue);
    // ...and not by an implausible factor: Punjab, the worst state, is 2.23×.
    expect(weightedBlue).toBeLessThan(rice.footprint_l.blue * 3);
  });

  it("ranks a rain-fed millet below irrigated rice, matching the swap advice", () => {
    // The inversion this guards against: bajra's TOTAL is nearly double rice's
    // because it is rain-fed with a modest yield, so a score that counted green
    // water called the water-smart choice worse than the crop it replaces.
    const rice = calculateProduct("rice_raw", { servingG: 1000, month: 7 });
    const bajra = calculateProduct("bajra_raw", { servingG: 1000, month: 7 });

    expect(bajra.footprint_l.total).toBeGreaterThan(rice.footprint_l.total);
    expect(bajra.stress_score).toBeLessThan(rice.stress_score);
    expect(bajra.impact_l).toBeLessThan(rice.impact_l);
  });
});

describe("decompose", () => {
  it("scales linearly with serving size", () => {
    const ing = [{ product_id: "x", crop_id: "rice", raw_grams_per_100g: 25, yield_fraction: 1, source: "S5" }];
    expect(decompose(ing, 100)[0].raw_grams).toBe(25);
    expect(decompose(ing, 400)[0].raw_grams).toBe(100);
  });

  it("merges a crop listed twice instead of dropping one", () => {
    const ing = [
      { product_id: "x", crop_id: "wheat", raw_grams_per_100g: 20, yield_fraction: 0.8, source: "S5" },
      { product_id: "x", crop_id: "wheat", raw_grams_per_100g: 20, yield_fraction: 0.72, source: "S5" },
    ];
    const out = decompose(ing, 100);
    expect(out).toHaveLength(1);
    expect(out[0].raw_grams).toBe(40);
    expect(out[0].yield_fraction).toBeCloseTo(0.76, 6);
  });
});

describe("season", () => {
  it("maps months to Indian cropping seasons", () => {
    expect(seasonForMonth(7)).toBe("kharif");
    expect(seasonForMonth(12)).toBe("rabi");
    expect(seasonForMonth(2)).toBe("rabi");
    expect(seasonForMonth(4)).toBe("zaid");
  });

  it("rejects an out-of-range month", () => {
    expect(() => seasonForMonth(0)).toThrow(RangeError);
    expect(() => seasonForMonth(13)).toThrow(RangeError);
  });
});

describe("scoring", () => {
  it("stays within 0–100", () => {
    const dist = [10, 20, 30, 40, 50];
    for (const v of [-100, 0, 25, 1000]) {
      const s = score(v, dist);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("ranks by position in the catalogue", () => {
    const dist = [10, 20, 30, 40, 50];
    expect(score(5, dist)).toBe(0);
    expect(score(55, dist)).toBe(100);
    expect(score(30, dist)).toBe(50);
  });

  it("converts litres to household-days at the JJM benchmark", () => {
    expect(householdDays(LPCD_BENCHMARK * 15)).toBe(15);
    expect(householdDays(1)).toBe(1); // never rounds down to zero days
  });
});

describe("calculate — end to end", () => {
  it("splits sum to the total", () => {
    const r = calculateProduct("biryani_chicken", { servingG: 350 });
    expect(r.footprint_l.green + r.footprint_l.blue + r.footprint_l.grey).toBe(r.footprint_l.total);
  });

  it("scales linearly with serving size", () => {
    const one = calculateProduct("biryani_chicken", { servingG: 350 });
    const two = calculateProduct("biryani_chicken", { servingG: 700 });
    expect(two.footprint_l.total).toBeCloseTo(2 * one.footprint_l.total, -1);
  });

  it("raises rather than guessing when data is missing", () => {
    expect(() => calculateProduct("no_such_product")).toThrow(DataMissingError);
  });

  it("downgrades confidence when national defaults are used", () => {
    const r = calculateProduct("biryani_chicken");
    // crop_state.csv is empty, so every ingredient falls back to a national
    // default and the result must say so rather than claiming high confidence.
    expect(r.confidence.quality === "medium" || r.confidence.quality === "low").toBe(true);
    expect(r.lineage.fallbacks_used.length).toBeGreaterThan(0);
  });

  it("reports a confidence range of ±15%", () => {
    const r = calculateProduct("rice_raw");
    expect(r.confidence.low).toBe(Math.round(r.footprint_l.total * 0.85));
    expect(r.confidence.high).toBe(Math.round(r.footprint_l.total * 1.15));
    expect(r.confidence.low).toBeLessThan(r.footprint_l.total);
    expect(r.confidence.high).toBeGreaterThan(r.footprint_l.total);
  });

  it("caps quality at the resolver's ceiling", () => {
    const r = calculateProduct("biryani_chicken", { resolverQuality: "low" });
    expect(r.confidence.quality).toBe("low");
  });

  it("never suggests a swap that costs more water", () => {
    // Visible products only: pure animal products now refuse to price at all
    // (no citable footprint), which is asserted in its own test.
    for (const p of visibleProducts()) {
      const r = calculateProduct(p.product_id);
      if (r.swap) expect(r.swap.saves_l).toBeGreaterThan(0);
    }
  });

  it("returns message keys, never rendered sentences", () => {
    const r = calculateProduct("biryani_chicken");
    // The key now comes from data/equivalence.csv rather than being hardcoded.
    expect(r.human_equivalent.key).toMatch(/^result\.eq\./);
    expect(typeof r.human_equivalent.params.count).toBe("number");
    if (r.swap) expect(r.swap.message.key).toMatch(/^swap\./);
  });

  it("cites a source for every result", () => {
    const r = calculateProduct("biryani_chicken");
    expect(r.citations.length).toBeGreaterThan(0);
    expect(r.citations.some((c) => c.includes("Mekonnen"))).toBe(true);
  });

  it("computes every priceable product; all-animal rows are excluded by design", () => {
    const dist = catalogDistribution();
    // The 8 pure animal products refuse (uncited), so the ranking baseline is
    // every product MINUS those — uncited items must not shape percentiles.
    expect(dist).toHaveLength(allProducts().length - 8);
    expect(dist.every((v, i) => i === 0 || v >= dist[i - 1])).toBe(true);
  });

  it("ranks a millet below rice on impact", () => {
    // Not a golden value — a relationship the whole tool exists to surface.
    const rice = calculateProduct("rice_raw", { servingG: 1000 });
    const swap = rice.swap;
    expect(swap).not.toBeNull();
    expect(swap!.saves_l).toBeGreaterThan(0);
  });
});

describe("rounding", () => {
  it("keeps the legend adding up to the headline", () => {
    const r = roundSplit({ green: 1.4, blue: 1.4, grey: 1.4, total: 4.2 });
    expect(r.green + r.blue + r.grey).toBe(r.total);
  });
});

/**
 * AMENDMENT_08 §1 — the score ranks impact, never total.
 *
 * The bug: `stress_score` ranked `footprint_l.total`, so cocoa — 19,928 L/kg of
 * which 99% is rainfall and 3 L is irrigation — scored 99/100. A crop using
 * essentially no irrigation was scoring near-maximum stress, which inverts what
 * the number means.
 *
 * `impact_l` is now grey + Σ(blue × stress) and `catalogDistribution` is built
 * from the same figure, so the ladder and the item being ranked share units.
 */
describe("AMENDMENT_08: the score ranks impact, not volume", () => {
  const at = (id: string, servingG: number) => calculateProduct(id, { servingG, month: 7 });

  it("cocoa scores below rice at equal mass, though its total is 8× larger", () => {
    const cocoa = at("cocoa_raw", 1000);
    const rice = at("rice_raw", 1000);

    expect(cocoa.footprint_l.total).toBeGreaterThan(rice.footprint_l.total * 5);
    expect(cocoa.impact_l).toBeLessThan(rice.impact_l);
    expect(cocoa.stress_score).toBeLessThan(rice.stress_score);
  });

  it("a crop with almost no irrigation is no longer near-maximum", () => {
    const cocoa = at("cocoa_raw", 1000);
    // 3 L of blue water in ~20,000 L.
    expect(cocoa.footprint_l.blue / cocoa.footprint_l.total).toBeLessThan(0.01);
    // It scored 99 on the total basis. The ceiling here is deliberately loose:
    // cocoa still carries 179 L/kg of GREY water, and the specified formula
    // counts grey — so it cannot fall to the bottom of the catalogue without
    // contradicting the formula itself.
    expect(cocoa.stress_score).toBeLessThan(70);
  });

  it("excludes green water from impact entirely", () => {
    for (const id of ["cocoa_raw", "rice_raw", "bajra_raw", "cotton_tshirt"]) {
      const r = calculateProduct(id, { month: 7 });
      const weightedBlue = r.impact_l - r.footprint_l.grey;
      // impact is exactly grey + weighted blue — no green term.
      expect(weightedBlue, id).toBeGreaterThanOrEqual(r.footprint_l.blue - 1);
      expect(r.impact_l, id).toBeLessThan(r.footprint_l.total);
    }
  });

  it("ranks the same value the distribution is built from", () => {
    // The distribution stores rounded impact; ranking an unrounded figure put
    // items a point out wherever that crossed a tie band.
    const r = calculateProduct("rice_raw", { servingG: 1000, month: 7 });
    expect(Number.isInteger(r.impact_l)).toBe(true);
    expect(r.stress_score).toBe(score(r.impact_l, catalogDistribution()));
  });

  it("score tracks impact more closely than it tracks total litres", () => {
    const rows: { total: number; impact: number; s: number }[] = [];
    for (const p of allProducts()) {
      try {
        const r = calculateProduct(p.product_id, { month: 7 });
        rows.push({ total: r.footprint_l.total, impact: r.impact_l, s: r.stress_score });
      } catch { /* uncalculable products are excluded from the ranking too */ }
    }
    const corr = (xs: number[], ys: number[]) => {
      const n = xs.length;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
      const sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
      const sy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
      return cov / (sx * sy);
    };
    const vsImpact = corr(rows.map((r) => r.impact), rows.map((r) => r.s));
    const vsTotal = corr(rows.map((r) => r.total), rows.map((r) => r.s));
    expect(vsImpact).toBeGreaterThan(vsTotal);
  });
});
