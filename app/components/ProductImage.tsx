"use client";

/**
 * The photograph inside a product tile.
 *
 * Not every product has one — images come from `data/product_image.csv` and are
 * downloaded separately — so this must degrade to the existing tinted tile
 * rather than to a broken-image icon. On error it renders NOTHING, which is
 * what lets the CSS `:has(img)` rules tell a tile with a photo apart from one
 * without. Hiding the <img> with `display:none` would keep it in the DOM and
 * `:has(img)` would still match, leaving the tile blank.
 *
 * Rule 3: no existing class is restyled. The tile, its blob and its letter are
 * untouched — the photo simply covers them when one exists.
 */
import { useState } from "react";

export function ProductImage({ productId, alt }: { productId: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    // Plain <img> on purpose — see the rule note in eslint.config.mjs.
    //
    // The containment styles are INLINE, not left to ancestor selectors. This
    // bug has now happened twice: a tile classed with only the colour variant
    // ("photo produce0" on Explore, then "mini produce0" on Profile) missed
    // the `.produce img` rules entirely, so the image rendered at natural
    // size — a ~900px wheat photo sitting on top of the page. Carrying the
    // constraint on the element itself means a wrapper only ever needs
    // position:relative + overflow:hidden, and tests/product-image.test.ts
    // asserts every wrapper class has exactly that.
    <img
      src={`/img/products/${productId}.jpg`}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
      }}
    />
  );
}
