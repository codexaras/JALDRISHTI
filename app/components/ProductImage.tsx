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
    <img
      src={`/img/products/${productId}.jpg`}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
