import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Product images must be constrained by their containers, never the reverse.
 *
 * This class of bug shipped twice: a tile classed with only the COLOUR variant
 * ("photo produce0" on Explore, then "mini produce0" on Profile) fell outside
 * the `.produce img` ancestor selectors, so the <img> rendered at natural size
 * — a ~900px wheat photograph sitting on top of the profile page. The fix is
 * two-layered (inline constraint on the img itself, plus a containment rule
 * for every wrapper class), and these tests pin both layers down.
 */
const css = readFileSync("app/globals.css", "utf8");
const productImage = readFileSync("app/components/ProductImage.tsx", "utf8");

/** Every class used as a direct wrapper of <ProductImage> anywhere in the app. */
const WRAPPERS = ["photo", "produce", "riceThumb", "resultPhoto", "mini"];

describe("product image containment", () => {
  it("the image carries its own constraint inline — no ancestor selector to miss", () => {
    for (const decl of ['position: "absolute"', 'width: "100%"', 'height: "100%"', 'objectFit: "cover"']) {
      expect(productImage).toContain(decl);
    }
    expect(productImage).toContain('loading="lazy"');
    // Failure keeps the placeholder tile: the component renders nothing, and
    // the fixed-size wrapper stays — the layout must never collapse or shift.
    expect(productImage).toContain("if (failed) return null");
  });

  it("every wrapper class is in the position:relative + overflow:hidden rule", () => {
    const rule = css.match(/^([^{\n]*)\{position:relative;overflow:hidden\}/m)?.[1] ?? "";
    for (const w of WRAPPERS) {
      expect(rule, `.${w} must contain its image`).toContain(`.${w}`);
    }
  });

  it("no component wraps ProductImage in a colour variant without a base class", () => {
    // "produce0".."produce5" style the tint only; the CONTAINMENT lives on the
    // base classes. A wrapper like `foo produce0` must have `foo` in WRAPPERS.
    const files = [
      "app/components/LiveExplore.tsx",
      "app/components/HomeGrid.tsx",
      "app/components/LiveProfile.tsx",
      "app/components/ConfirmSheet.tsx",
      "app/components/LiveResult.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("<ProductImage")) continue;
      for (const m of src.matchAll(/className=\{?[`"]([\w-]+)[^`"]*produce\$\{/g)) {
        expect(WRAPPERS, `${file}: wrapper "${m[1]}" is outside the containment rule`).toContain(m[1]);
      }
    }
  });
});
