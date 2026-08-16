import type { WaterSplit, Wf } from "./types.ts";

/**
 * Water footprint of `kg` of a crop.
 *
 * BUILD_SPEC rule 2.2 — `wf` values are m³/tonne, which is numerically
 * identical to L/kg (1 m³ = 1000 L, 1 tonne = 1000 kg). They are used as-is.
 * **No multiply or divide by 1000 belongs anywhere in this file.**
 *
 * BUILD_SPEC rule 2.3 — where the product uses a processed derivative (atta
 * from wheat, oil from seed, sugar from cane), divide by `yieldFraction`. Only
 * part of the crop survives processing, so the whole crop's water is carried by
 * a smaller mass. This is why edible oils have such large footprints.
 */
export function cropFootprint(kg: number, wf: Wf, yieldFraction: number): WaterSplit {
  if (yieldFraction <= 0 || yieldFraction > 1) {
    throw new RangeError(`yield_fraction must be in (0, 1], got ${yieldFraction}`);
  }
  const green = (kg * wf.green) / yieldFraction;
  const blue = (kg * wf.blue) / yieldFraction;
  const grey = (kg * wf.grey) / yieldFraction;
  return { green, blue, grey, total: green + blue + grey };
}

export function addSplits(a: WaterSplit, b: WaterSplit): WaterSplit {
  return {
    green: a.green + b.green,
    blue: a.blue + b.blue,
    grey: a.grey + b.grey,
    total: a.total + b.total,
  };
}

export const ZERO_SPLIT: WaterSplit = { green: 0, blue: 0, grey: 0, total: 0 };

export function roundSplit(s: WaterSplit): WaterSplit {
  const green = Math.round(s.green);
  const blue = Math.round(s.blue);
  const grey = Math.round(s.grey);
  // Total is the rounded sum of parts, never a separately rounded total, so the
  // legend on the result screen always adds up to the headline number.
  return { green, blue, grey, total: green + blue + grey };
}
