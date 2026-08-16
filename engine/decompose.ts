import type { ProductIngredient } from "./types.ts";

export interface CropMass {
  crop_id: string;
  raw_grams: number;
  yield_fraction: number;
}

/**
 * Serving → raw ingredient mass per crop.
 *
 *   raw_grams = raw_grams_per_100g × serving_g / 100
 *
 * BUILD_SPEC rule 2.1: `raw_grams_per_100g` is RAW weight. Rice roughly triples
 * when cooked, so a recipe source quoting cooked weight must be converted
 * before it enters /data — otherwise rice dishes come out ~3× too high. The
 * validation script flags any product whose raw grams exceed 200/100g, which is
 * the signature of that mistake.
 */
export function decompose(ingredients: ProductIngredient[], servingG: number): CropMass[] {
  if (servingG < 0) throw new RangeError(`serving_g must be >= 0, got ${servingG}`);

  const byCrop = new Map<string, CropMass>();
  for (const ing of ingredients) {
    const raw = (ing.raw_grams_per_100g * servingG) / 100;
    const existing = byCrop.get(ing.crop_id);
    if (existing) {
      // Same crop listed twice (e.g. flour and semolina): merge, keeping a
      // mass-weighted yield so neither share is silently dropped.
      const totalRaw = existing.raw_grams + raw;
      existing.yield_fraction =
        totalRaw === 0
          ? existing.yield_fraction
          : (existing.raw_grams * existing.yield_fraction + raw * ing.yield_fraction) / totalRaw;
      existing.raw_grams = totalRaw;
    } else {
      byCrop.set(ing.crop_id, {
        crop_id: ing.crop_id,
        raw_grams: raw,
        yield_fraction: ing.yield_fraction,
      });
    }
  }
  return [...byCrop.values()];
}
