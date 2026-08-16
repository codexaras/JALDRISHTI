import { cropFootprint } from "./footprint.ts";
import { sourceCrop } from "./sourcing.ts";
import type {
  Crop,
  GwStress,
  Lang,
  ProductionShare,
  Substitution,
  SwapSuggestion,
  Wf,
} from "./types.ts";

/**
 * PS: "sensitize the people". This is the behaviour-change mechanism — the one
 * place the tool stops describing and starts advising.
 */

export interface CropImpact {
  /** green + grey + stress-weighted blue, for this crop's share of the serving. */
  impact: number;
  /** Stress-weighted blue only — the part a swap can actually relieve. */
  impactBlue: number;
  kg: number;
  yieldFraction: number;
}

export interface SwapInput {
  impactByCrop: Map<string, CropImpact>;
  substitutions: Map<string, Substitution[]>;
  footprints: Map<string, Crop>;
  sourcing: Map<string, ProductionShare[]>;
  stress: Map<string, GwStress>;
  /** Season multiplier already resolved by the caller, so this stays pure. */
  seasonBlueMultiplier: number;
  lang: Lang;
}

function cropName(crop: Crop, lang: Lang): string {
  const byLang: Record<Lang, string> = {
    en: crop.name_en,
    hi: crop.name_hi,
    mr: crop.name_mr,
    ta: crop.name_ta,
  };
  return byLang[lang] || crop.name_en;
}

/**
 * Find the single change that would relieve the most pressure on stressed
 * groundwater: take the ingredient carrying the largest blue-water impact and
 * price its ranked substitutes at the same raw mass.
 *
 * The comparison is **stress-weighted blue water, not total footprint**, and
 * that distinction decides whether the feature works at all. Millets carry a
 * larger *total* footprint than rice — they are rain-fed with modest yields, so
 * their green water is high — yet they draw a fraction of the irrigation water.
 * Ranking on the total suppresses every millet suggestion in the dataset,
 * including the `rice → bajra` example BUILD_SPEC itself uses, and gets the
 * policy exactly backwards. Green water is rainfall the crop would have
 * received anyway; only blue water competes with a district's aquifer.
 *
 * Returns `null` if no substitution exists or the saving is <= 0 —
 * **never invent advice.**
 */
export function suggestSwap(input: SwapInput): SwapSuggestion | null {
  const { impactByCrop, substitutions, footprints, sourcing, stress, seasonBlueMultiplier, lang } =
    input;

  const ranked = [...impactByCrop.entries()].sort((a, b) => b[1].impactBlue - a[1].impactBlue);

  for (const [cropId, current] of ranked) {
    const options = (substitutions.get(cropId) ?? []).slice().sort((a, b) => a.rank - b.rank);

    for (const option of options) {
      const target = footprints.get(option.to_crop);
      if (!target) continue;

      const wf: Wf = {
        green: target.wf_green,
        blue: target.wf_blue * seasonBlueMultiplier,
        grey: target.wf_grey,
      };
      const targetSplit = cropFootprint(current.kg, wf, current.yieldFraction);

      const shares = sourcing.get(option.to_crop) ?? [];
      const targetImpactBlue =
        shares.length === 0
          ? targetSplit.blue
          : sourceCrop({
              crop_id: option.to_crop,
              crop_name: target.name_en,
              blue_l: targetSplit.blue,
              shares,
              stressByState: stress,
            }).impact_blue_l;

      const saves = current.impactBlue - targetImpactBlue;
      if (saves <= 0) continue;

      const times =
        targetImpactBlue > 0 ? Math.max(2, Math.round(current.impactBlue / targetImpactBlue)) : 2;

      return {
        from: cropId,
        to: option.to_crop,
        saves_l: Math.round(saves),
        message: {
          key: option.message_key,
          params: {
            times,
            from: cropName(footprints.get(cropId)!, lang),
            to: cropName(target, lang),
          },
        },
      };
    }
  }
  return null;
}
