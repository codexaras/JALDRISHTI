import { beforeEach, describe, expect, it } from "vitest";
import { resolveBarcode, mapTags, rankToMassFractions, clearBarcodeCache } from "../resolvers/barcode.ts";

/**
 * Open Food Facts failure modes.
 *
 * These exist because of a real bug: every non-OK HTTP response was reported as
 * `not_found`, so a throttled or blocked lookup told the user "this product
 * isn't in the database" — a false statement about our data, made at exactly
 * the moment a live demo hammers the API. The distinction between "we know
 * there is no such product" and "we never found out" has to survive.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Each test gets a fresh barcode so the module-level cache never hides a bug. */
let next = 8900000000000;
const freshEan = () => String(next++);

// The 60-second backoff is deliberately global — one throttle should stop the
// whole app hammering OFF, not just that barcode. That makes these tests
// order-dependent unless the state is cleared between them.
beforeEach(clearBarcodeCache);

describe("barcode: a failed lookup is never reported as a missing product", () => {
  it("treats 429 as throttling, not absence", async () => {
    const r = await resolveBarcode(freshEan(), { fetchImpl: async () => json({}, 429) });
    expect(r.error).toBe("rate_limited");
    expect(r.found).toBe(false);
    expect(r.product_found).toBeFalsy();
  });

  it("treats 403 and 503 as throttling too — OFF uses both", async () => {
    for (const status of [403, 503]) {
      const r = await resolveBarcode(freshEan(), { fetchImpl: async () => json({}, status) });
      expect(r.error, `status ${status}`).toBe("rate_limited");
    }
  });

  it("treats an HTML block page as an upstream failure, not as 'offline'", async () => {
    // The bug that started this: OFF answers a hammered client with HTML, the
    // JSON parse throws, and the old code called that "offline" — when the
    // network was fine and they simply refused.
    const r = await resolveBarcode(freshEan(), {
      fetchImpl: async () => new Response("<!DOCTYPE html><html>blocked</html>", { status: 200 }),
    });
    expect(r.error).toBe("upstream_error");
    expect(r.error).not.toBe("offline");
  });

  it("treats a 500 as an upstream failure, not as a missing product", async () => {
    const r = await resolveBarcode(freshEan(), { fetchImpl: async () => json({}, 500) });
    expect(r.error).toBe("upstream_error");
    expect(r.error).not.toBe("not_found");
  });

  it("reports a genuine miss as not_found", async () => {
    const r = await resolveBarcode(freshEan(), { fetchImpl: async () => json({ status: 0 }) });
    expect(r.error).toBe("not_found");
    expect(r.product_found).toBeFalsy();
  });

  it("separates 'no ingredient list' from 'no such product'", async () => {
    const r = await resolveBarcode(freshEan(), {
      fetchImpl: async () => json({ status: 1, product: { product_name: "Mystery Snack", ingredients_tags: [] } }),
    });
    // OFF has it — that is a different sentence from "we don't have it".
    expect(r.product_found).toBe(true);
    expect(r.found).toBe(false);
    expect(r.error).toBe("no_ingredients");
    expect(r.name).toBe("Mystery Snack");
  });

  it("rejects a too-short code without calling the network", async () => {
    let called = false;
    const r = await resolveBarcode("123", {
      fetchImpl: async () => { called = true; return json({ status: 1 }); },
    });
    expect(called).toBe(false);
    expect(r.error).toBe("not_found");
  });
});

describe("barcode: a successful lookup", () => {
  it("maps declared ingredients to crops and flags the estimate", async () => {
    const ean = freshEan();
    const r = await resolveBarcode(ean, {
      fetchImpl: async () =>
        json({
          status: 1,
          product: {
            product_name: "Test Biscuit",
            brands: "TestCo, Other",
            ingredients_tags: ["en:wheat-flour", "en:sugar", "en:salt"],
          },
        }),
    });

    expect(r.found).toBe(true);
    expect(r.product_found).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.brand).toBe("TestCo");
    expect(r.ingredients.length).toBeGreaterThan(0);
    // Rank-estimated mass fractions are never presented as measured.
    expect(r.estimated).toBe(true);
    expect(r.quality).toBe("medium");
  });

  it("serves the second lookup of the same code from cache", async () => {
    const ean = freshEan();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return json({ status: 1, product: { product_name: "Cached", ingredients_tags: ["en:wheat-flour"] } });
    };
    await resolveBarcode(ean, { fetchImpl });
    const second = await resolveBarcode(ean, { fetchImpl });
    expect(calls).toBe(1);
    expect(second.cached).toBe(true);
  });

  it("excludes salt and additives rather than reporting them as data gaps", () => {
    const { ingredients, unmatched, ignored } = mapTags(["en:wheat-flour", "en:salt", "en:e500"]);
    expect(ingredients.some((i) => i.crop_id === "wheat")).toBe(true);
    // Saying "salt is not in our data" implies a gap where there is none.
    expect(unmatched).not.toContain("en:salt");
    expect(ignored.length).toBeGreaterThan(0);
  });

  it("weights earlier ingredients more heavily and conserves mass", () => {
    const f = rankToMassFractions(4);
    expect(f[0]).toBeGreaterThan(f[3]);
    expect(f.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});
