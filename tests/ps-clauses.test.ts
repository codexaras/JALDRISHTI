import { describe, expect, it } from "vitest";
import { calculateProduct, cityWater, communityAggregate, allCrops, allDistricts } from "../repo/db.ts";
import { humanise } from "../engine/equivalence.ts";
import { apportion, forceState } from "../engine/sourcing.ts";
import { DataMissingError } from "../engine/errors.ts";
import { resolveText } from "../resolvers/textmatch.ts";
import { rankToMassFractions } from "../resolvers/barcode.ts";
import type { ProductionShare } from "../engine/types.ts";

/**
 * One test per clause of the problem statement.
 *
 * BUILD_SPEC section 9 says a failing line here means that clause is NOT
 * covered, whatever the code looks like. These run in CI so the coverage claim
 * is checked continuously rather than the night before.
 */

const share = (state: string, district: string, s: number): ProductionShare => ({
  crop_id: "rice", state, share: s, rep_district: district, lat: 0, lon: 0, source: "S4",
});

describe("PS: 'where the water is taken from'", () => {
  it("same crop, stressed vs safe state, produces a different result", () => {
    const punjab = calculateProduct("rice_raw", { servingG: 200, forceState: "Punjab" });
    const chhattisgarh = calculateProduct("rice_raw", { servingG: 200, forceState: "Chhattisgarh" });

    expect(punjab.impact_l).not.toBe(chhattisgarh.impact_l);
    expect(punjab.impact_l).toBeGreaterThan(chhattisgarh.impact_l);
    expect(punjab.status).toBe("over_exploited");
    expect(chhattisgarh.status).toBe("safe");
  });

  it("force_state replaces the national mix rather than re-weighting it", () => {
    const r = calculateProduct("rice_raw", { forceState: "Punjab" });
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0].share).toBe(1);
    expect(r.lineage.fallbacks_used).toContain("force_state:Punjab");
  });

  it("rejects a state where the crop is not grown", () => {
    expect(() => calculateProduct("rice_raw", { forceState: "Ladakh" })).toThrow(DataMissingError);
  });
});

describe("PS: 'and when'", () => {
  it("month changes blue water", () => {
    const rabi = calculateProduct("rice_raw", { month: 1 });
    const kharif = calculateProduct("rice_raw", { month: 7 });
    expect(rabi.footprint_l.blue).not.toBe(kharif.footprint_l.blue);
    // A dry-season crop leans on irrigation; a monsoon crop does not.
    expect(rabi.footprint_l.blue).toBeGreaterThan(kharif.footprint_l.blue);
  });

  it("conserves the published total across seasons", () => {
    const rabi = calculateProduct("rice_raw", { month: 1 });
    const kharif = calculateProduct("rice_raw", { month: 7 });
    // Equal to within independent rounding of the three components.
    expect(Math.abs(rabi.footprint_l.total - kharif.footprint_l.total)).toBeLessThanOrEqual(2);
  });

  it("records the season model as a fallback so the screen can disclose it", () => {
    const r = calculateProduct("rice_raw", { month: 1 });
    expect(r.lineage.fallbacks_used.some((f) => f.startsWith("season_model_applied"))).toBe(true);
    expect(r.citations.some((c) => c.includes("declared model"))).toBe(true);
  });
});

describe("PS: 'non-available water due to pollution'", () => {
  it("grey water is reported separately and is positive", () => {
    const r = calculateProduct("rice_raw");
    expect(r.footprint_l.grey).toBeGreaterThan(0);
    expect(r.footprint_l.green + r.footprint_l.blue + r.footprint_l.grey).toBe(r.footprint_l.total);
  });

  it("grey water is not stress-weighted — it is a dilution allowance, not a withdrawal", () => {
    const punjab = calculateProduct("rice_raw", { forceState: "Punjab" });
    const wb = calculateProduct("rice_raw", { forceState: "West Bengal" });
    expect(punjab.footprint_l.grey).toBe(wb.footprint_l.grey);
  });
});

describe("PS: 'sensitize the people'", () => {
  it("returns a swap suggestion for a rice dish", () => {
    const r = calculateProduct("biryani_chicken");
    expect(r.swap).not.toBeNull();
    expect(r.swap!.saves_l).toBeGreaterThan(0);
  });

  it("never invents advice — no swap when nothing saves water", () => {
    // Every returned swap must be a genuine saving, across the whole catalogue.
    for (const id of ["milk_raw", "chai", "rice_raw", "bajra_raw"]) {
      const r = calculateProduct(id);
      if (r.swap) expect(r.swap.saves_l).toBeGreaterThan(0);
    }
  });

  it("ranks millets above rice on irrigation water, which is the actionable part", () => {
    const rice = calculateProduct("rice_raw", { servingG: 1000, month: 7 });
    const bajra = calculateProduct("bajra_raw", { servingG: 1000, month: 7 });
    const blueImpact = (r: typeof rice) => r.impact_l - r.footprint_l.grey;

    expect(blueImpact(bajra)).toBeLessThan(blueImpact(rice));
    // ...and the trap this guards against: bajra's TOTAL is larger.
    expect(bajra.footprint_l.total).toBeGreaterThan(rice.footprint_l.total);
  });

  it("produces a human comparison, as a key and params", () => {
    const r = calculateProduct("biryani_chicken");
    expect(r.human_equivalent.key).toMatch(/^result\.eq\./);
    expect(typeof r.human_equivalent.params.count).toBe("number");
  });
});

describe("engine/equivalence", () => {
  const rows = [
    { eq_id: "bucket", litres_per_unit: 15, message_key: "result.eq.buckets", min_litres: 45, source: "S7" },
    { eq_id: "household_days", litres_per_unit: 55, message_key: "result.eq.householdDays", min_litres: 110, source: "S7" },
    { eq_id: "tanker", litres_per_unit: 12000, message_key: "result.eq.tankers", min_litres: 24000, source: "S7" },
  ];

  it("picks the largest unit the value clears", () => {
    expect(humanise(50, rows).key).toBe("result.eq.buckets");
    expect(humanise(600, rows).key).toBe("result.eq.householdDays");
    expect(humanise(50_000, rows).key).toBe("result.eq.tankers");
  });

  it("always gives a comparison, even below every threshold", () => {
    expect(humanise(2, rows).key).toBe("result.eq.buckets");
  });
});

describe("engine/sourcing apportion", () => {
  it("raises rather than normalising when shares do not sum to 1", () => {
    expect(() => apportion("rice", [share("Punjab", "Punjab", 0.6)])).toThrow(DataMissingError);
  });

  it("accepts a sum inside the tolerance", () => {
    expect(apportion("rice", [share("Punjab", "Punjab", 0.99)])).toHaveLength(1);
  });

  it("forceState returns exactly one line at share 1.0", () => {
    const out = forceState("rice", [share("Punjab", "Punjab", 0.3), share("Bihar", "Bihar", 0.7)], "punjab");
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe("Punjab");
    expect(out[0].share).toBe(1);
  });
});

describe("PS: 'items they use in daily life'", () => {
  it("a non-food agricultural product calculates end to end", () => {
    const shirt = calculateProduct("cotton_tshirt");
    expect(shirt.footprint_l.total).toBeGreaterThan(0);
    expect(shirt.sources.length).toBeGreaterThan(0);
  });

  it("cotton and jute are marked as non-food", () => {
    const nonFood = allCrops().filter((c) => c.is_food === 0).map((c) => c.crop_id);
    expect(nonFood).toContain("cotton");
    expect(nonFood).toContain("jute");
  });
});

describe("PS: 'community as well as personal levels'", () => {
  it("Mumbai reports its seven reservoirs", () => {
    const report = cityWater("mumbai");
    expect(report).not.toBeNull();
    expect(report!.reservoirs).toHaveLength(7);
    expect(report!.overall_pct).toBeGreaterThan(0);
  });

  it("community aggregate totals a region without any personal identifier", () => {
    const agg = communityAggregate("Mumbai");
    expect(agg.scans).toBeGreaterThan(0);
    expect(agg.total_litres).toBeGreaterThan(0);
    expect(agg.top_items.length).toBeGreaterThan(0);
    for (const key of Object.keys(agg)) {
      expect(key).not.toMatch(/user|email|phone|device|ip/i);
    }
  });
});

describe("PS: 'local languages / pan India'", () => {
  it("romanised and native-script queries both reach okra", () => {
    expect(resolveText("bhindi", "mr", 1)[0].product_id).toBe("okra_raw");
    expect(resolveText("भेंडी", "mr", 1)[0].product_id).toBe("okra_raw");
    expect(resolveText("vendakkai", "ta", 1)[0].product_id).toBe("okra_raw");
  });

  it("returns suggestions rather than a guess below the threshold", () => {
    const hits = resolveText("zzqqxx", "en", 5);
    expect(hits.every((h) => !h.confident)).toBe(true);
  });

  it("covers every state and union territory", () => {
    expect(new Set(allDistricts().map((d) => d.state)).size).toBe(36);
  });
});

describe("resolvers/barcode", () => {
  it("mass fractions from rank sum to 100 g", () => {
    for (const n of [1, 3, 5, 8]) {
      const sum = rankToMassFractions(n).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it("weights earlier ingredients more heavily, as label law implies", () => {
    const f = rankToMassFractions(4);
    expect(f[0]).toBeGreaterThan(f[1]);
    expect(f[1]).toBeGreaterThan(f[2]);
  });
});

/**
 * AMENDMENT_07 §8 — the acceptance checklist, as executable assertions.
 *
 * The point of the amendment is that a *category* is citeable for all 36 states
 * while a *percentage* is not, and that the two must never be presented alike.
 * These lock that distinction in place.
 */
describe("AMENDMENT_07: complete CGWB coverage", () => {
  it("no state falls back to the retired ~61% national average", () => {
    const leftover = allDistricts().filter((g) => Math.round(g.soe_pct) === 61 || Math.round(g.soe_pct) === 60);
    expect(leftover.map((g) => g.state)).toEqual([]);
  });

  it("every state and UT carries a cited category", () => {
    expect(allDistricts()).toHaveLength(36);
    for (const g of allDistricts()) {
      expect(g.source, g.state).not.toMatch(/NEEDS_SOURCE/);
      expect(["safe", "semi_critical", "critical", "over_exploited"]).toContain(g.category);
    }
  });

  it("Uttar Pradesh is semi-critical, not safe", () => {
    const up = allDistricts().find((g) => g.state === "Uttar Pradesh");
    expect(up?.category).toBe("semi_critical");
  });

  it("the four over-exploited states are exactly those CGWB lists", () => {
    const over = allDistricts().filter((g) => g.category === "over_exploited").map((g) => g.state).sort();
    expect(over).toEqual([
      "Dadra and Nagar Haveli and Daman and Diu",
      "Haryana",
      "Punjab",
      "Rajasthan",
    ]);
  });

  it("a band midpoint never claims a precision it does not have", () => {
    for (const g of allDistricts()) {
      // Its value must sit inside the band it was derived from...
      expect(g.soe_pct, g.state).toBeGreaterThanOrEqual(g.band_min);
      expect(g.soe_pct, g.state).toBeLessThanOrEqual(g.band_max);
      // ...and its citation must admit the band rather than imply a reading.
      if (g.precision === "band_midpoint") expect(g.source.toLowerCase(), g.state).toContain("band");
    }
  });

  it("a band-midpoint source caps confidence at medium and is disclosed", () => {
    // Rice draws on Uttar Pradesh and West Bengal, both categorised only.
    const r = calculateProduct("rice_raw");
    expect(r.sources.some((s) => s.precision === "band_midpoint")).toBe(true);
    expect(r.confidence.quality).not.toBe("high");
    expect(r.lineage.fallbacks_used.some((f) => f.startsWith("groundwater_band_midpoint:"))).toBe(true);
  });

  it("an all-exact sourcing is not capped by this rule", () => {
    // Punjab publishes its own figure, so forcing it removes every midpoint.
    const r = calculateProduct("rice_raw", { forceState: "Punjab" });
    expect(r.sources.every((s) => s.precision === "exact")).toBe(true);
    expect(r.lineage.fallbacks_used.some((f) => f.startsWith("groundwater_band_midpoint:"))).toBe(false);
  });

  it("a rice scan puts Punjab in the red band", () => {
    const punjab = calculateProduct("rice_raw", { forceState: "Punjab" });
    expect(punjab.sources[0].status).toBe("over_exploited");
    expect(punjab.sources[0].soe_pct).toBeCloseTo(156.36, 2);
    expect(punjab.sources[0].precision).toBe("exact");
  });
});
