import { describe, expect, it } from "vitest";
import { calculateProduct } from "../repo/db.ts";
import { DEMO_ITEMS } from "../app/api/_lib/demo-items.ts";

/**
 * Golden values for the five locked demo items — the numbers you defend in Q&A.
 *
 * ⚠ VERIFICATION STATUS
 * These are the engine's current output, pinned so that any accidental change
 * to data or arithmetic fails CI loudly rather than silently shifting a number
 * you have already quoted on stage.
 *
 * BUILD_SPEC section 5 asks a **human** to verify each of these against the
 * source documents before the demo. Until someone does, `verified_by` is null
 * and the test below says so. Pinning is not the same as verifying: this file
 * proves the number is *stable*, not that it is *right*.
 *
 * To verify one: open the cited source, check the crop's L/kg figure, work the
 * recipe grams through by hand, and set `verified_by` to your name and the date.
 */

interface Golden {
  product_id: string;
  serving_g: number;
  month: number;
  total: number;
  green: number;
  blue: number;
  grey: number;
  stress_score: number;
  /** Set this once a human has checked it against the source PDFs. */
  verified_by: string | null;
}

/**
 * The litre columns are the real assertion — they come from the source tables
 * and must not move unless the source data does.
 *
 * `stress_score` is different in kind: it is a percentile against the rest of
 * the catalogue, so adding products re-ranks every item without any item's
 * water changing. The last re-pin followed the merge of 60 Table 3 crops
 * (DATA_VERIFICATION_01 item 1b), which added 41 products including some very
 * heavy spices — clove is 61,206 L/kg — pushing everyday food down the ranking.
 * Every litre figure below survived that merge untouched.
 *
 * AMENDMENT_07 moved biryani by one point (52 → 53) when the groundwater data
 * gained real CGWB categories for all 36 states: its rice draws on Uttar
 * Pradesh, which went from the 61% national fallback to semi-critical. The
 * litres did not move, because groundwater weights impact, never volume.
 *
 * The scores then moved again, further, when green water was removed from the
 * ranking basis (`impact_l` is now grey + stress-weighted blue). That reordered
 * the whole catalogue on purpose: a rain-fed crop no longer scores badly for
 * having drunk rain. dal_tadka fell 33 → 16 because pulses are largely
 * rain-fed; cotton rose 83 → 95 because it is heavily irrigated. Every litre
 * figure below is unchanged through both moves — the score ranks impact, the
 * footprint measures volume, and only the first depends on where the water
 * came from.
 *
 * AMENDMENT_08 then moved two more by a point (parle-G 48 → 47, okra 16 → 14)
 * when the ranked value and the distribution were reconciled: the score was
 * computed from an unrounded impact figure while the distribution stored
 * rounded ones, so items landed a point out wherever that crossed a tie band.
 */
const GOLDEN: Golden[] = [
  { product_id: "parle_g_biscuit", serving_g: 100, month: 7, total: 319, green: 253, blue: 35, grey: 31, stress_score: 50, verified_by: null },
  { product_id: "okra_raw", serving_g: 250, month: 7, total: 91, green: 61, blue: 6, grey: 24, stress_score: 18, verified_by: null },
  { product_id: "biryani_chicken", serving_g: 350, month: 7, total: 281, green: 208, blue: 38, grey: 35, stress_score: 52, verified_by: null },
  { product_id: "dal_tadka", serving_g: 200, month: 7, total: 238, green: 209, blue: 9, grey: 20, stress_score: 20, verified_by: null },
  { product_id: "cotton_raw", serving_g: 1000, month: 7, total: 4396, green: 2609, blue: 980, grey: 807, stress_score: 98, verified_by: null },
];

describe("golden: the five locked demo items", () => {
  it("covers exactly the items named in BUILD_SPEC phase 1", () => {
    expect(GOLDEN.map((g) => g.product_id).sort()).toEqual([...DEMO_ITEMS].sort());
  });

  for (const g of GOLDEN) {
    it(`${g.product_id} is stable at ${g.total} L`, () => {
      const r = calculateProduct(g.product_id, { servingG: g.serving_g, month: g.month });

      expect(r.footprint_l.total).toBe(g.total);
      expect(r.footprint_l.green).toBe(g.green);
      expect(r.footprint_l.blue).toBe(g.blue);
      expect(r.footprint_l.grey).toBe(g.grey);
      expect(r.stress_score).toBe(g.stress_score);

      // The invariants hold for the golden items too, not just in the abstract.
      expect(r.footprint_l.green + r.footprint_l.blue + r.footprint_l.grey).toBe(r.footprint_l.total);
      expect(r.citations.length).toBeGreaterThan(0);
      expect(r.confidence.low).toBeLessThan(r.footprint_l.total);
      expect(r.confidence.high).toBeGreaterThan(r.footprint_l.total);
    });
  }

  it("every demo item reports where its water came from", () => {
    for (const g of GOLDEN) {
      const r = calculateProduct(g.product_id, { servingG: g.serving_g, month: g.month });
      expect(r.sources.length).toBeGreaterThan(0);
      expect(r.sources[0].district).toBeTruthy();
      expect(r.sources[0].soe_pct).toBeGreaterThan(0);
    }
  });

  it("every demo item discloses its own weak points", () => {
    for (const g of GOLDEN) {
      const r = calculateProduct(g.product_id, { servingG: g.serving_g, month: g.month });
      // lineage.fallbacks_used is the honesty mechanism — it must never be
      // quietly empty while confidence is below "high".
      if (r.confidence.quality !== "high") {
        expect(r.lineage.fallbacks_used.length).toBeGreaterThan(0);
      }
    }
  });

  it("reports how many golden values a human has actually verified", () => {
    const verified = GOLDEN.filter((g) => g.verified_by !== null);
    if (verified.length < GOLDEN.length) {
      console.warn(
        `\n  ⚠ ${verified.length}/${GOLDEN.length} golden values hand-verified against source documents.` +
          `\n    Pinned ≠ verified. Set verified_by in tests/golden.test.ts once checked.\n`,
      );
    }
    // Not an assertion: an unverified golden value is a Q&A risk, not a broken build.
    expect(GOLDEN.length).toBe(5);
  });
});
