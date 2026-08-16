import type { Equivalence, MessageRef } from "./types.ts";

/**
 * Litres → something a person can picture.
 *
 * PS: "sensitize the people". A number in litres means nothing to someone who
 * has never had to carry it; "nine days of your household's water" does.
 *
 * Picks the **largest** equivalence whose `min_litres` threshold the value
 * clears, so a glass of chai is measured in buckets and a kilogram of rice in
 * household-days rather than in 800 buckets.
 *
 * Returns `{key, params}` — NEVER a translated string (BUILD_SPEC phase 5).
 */
export function humanise(litres: number, equivalences: Equivalence[]): MessageRef {
  const eligible = equivalences
    .filter((e) => litres >= e.min_litres && e.litres_per_unit > 0)
    .sort((a, b) => b.litres_per_unit - a.litres_per_unit);

  // Below every threshold: fall back to the smallest unit so there is always a
  // comparison, rather than showing the user a bare number.
  const chosen =
    eligible[0] ??
    [...equivalences].sort((a, b) => a.litres_per_unit - b.litres_per_unit)[0];

  if (!chosen) {
    // No equivalence data at all — the caller decides whether that is fatal.
    return { key: "result.eq.none", params: {} };
  }

  const count = litres / chosen.litres_per_unit;
  return {
    key: chosen.message_key,
    params: { count: count >= 10 ? Math.round(count) : Math.round(count * 10) / 10 },
  };
}
