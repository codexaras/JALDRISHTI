import { decompose } from "./decompose.ts";
import { DataMissingError } from "./errors.ts";
import { humanise } from "./equivalence.ts";
import { addSplits, cropFootprint, roundSplit, ZERO_SPLIT } from "./footprint.ts";
import { score } from "./scoring.ts";
import { seasonForMonth } from "./season.ts";
import { apportion, forceState, sourceCrop, unsourcedCrop } from "./sourcing.ts";
import { suggestSwap, type CropImpact } from "./swap.ts";
import type {
  CalculationResult,
  Confidence,
  Crop,
  CropState,
  Equivalence,
  GwStress,
  Lang,
  ProductIngredient,
  ProductionShare,
  Quality,
  Season,
  SourceLine,
  StressCategory,
  Substitution,
  WaterSplit,
  Wf,
} from "./types.ts";

/**
 * Everything `calculate` needs, passed in by the caller.
 *
 * BUILD_SPEC rule 4: this module performs no I/O, no network, no DB access and
 * no file reads. Every map below is built in `repo/` and handed over. That is
 * what makes the whole calculation testable without a database.
 */
export interface EngineInput {
  product: { product_id: string; name: string; type: string };
  ingredients: ProductIngredient[];
  /** crop_id → producing states. */
  sourcing: Map<string, ProductionShare[]>;
  /** crop_id → crop row (names + national footprint, all values L/kg). */
  footprints: Map<string, Crop>;
  /** `crop|state|season` → state-level footprint override. */
  cropStates: Map<string, CropState>;
  /** `district|state` → groundwater stress. */
  stress: Map<string, GwStress>;
  /** crop_id → ranked substitutes. */
  substitutions: Map<string, Substitution[]>;
  /** season → blue-water multiplier (data/season_factor.csv, see SOURCES.md S6). */
  seasonFactors: Map<Season, number>;
  /** Litres → human comparison thresholds (data/equivalence.csv). */
  equivalences: Equivalence[];
  servingG: number;
  month: number;
  /** Ascending impact litres for every catalogue item, for percentile ranking. */
  catalogDistribution: number[];
  lang: Lang;
  /** Ceiling imposed by how the product was identified (barcode caps at medium). */
  resolverQuality?: Quality;
  /** Source the whole product from one state instead of the national mix. */
  forceState?: string;
}

const QUALITY_ORDER: Record<Quality, number> = { low: 0, medium: 1, high: 2 };

function worseQuality(a: Quality, b: Quality): Quality {
  return QUALITY_ORDER[a] <= QUALITY_ORDER[b] ? a : b;
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

/** The state contributing the largest production share, used to pick a state-level footprint. */
function dominantState(shares: ProductionShare[]): string | null {
  if (shares.length === 0) return null;
  return shares.reduce((a, b) => (b.share > a.share ? b : a)).state;
}

export function calculate(input: EngineInput): CalculationResult {
  const {
    product,
    ingredients,
    sourcing,
    footprints,
    cropStates,
    stress,
    substitutions,
    seasonFactors,
    equivalences,
    servingG,
    month,
    catalogDistribution,
    lang,
    resolverQuality = "high",
    forceState: forcedState,
  } = input;

  if (ingredients.length === 0) {
    throw new DataMissingError("product_ingredient", product.product_id, "no ingredient rows");
  }

  const season = seasonForMonth(month);
  const blueMultiplier = seasonFactors.get(season) ?? 1.0;
  const masses = decompose(ingredients, servingG);

  let footprint: WaterSplit = ZERO_SPLIT;
  let impactBlue = 0;
  const sources: SourceLine[] = [];
  const fallbacks: string[] = [];
  const citations = new Set<string>();
  let dataQuality: Quality = "high";

  const impactByCrop = new Map<string, CropImpact>();

  const excluded: { crop_id: string; name: string }[] = [];

  for (const mass of masses) {
    const crop = footprints.get(mass.crop_id);
    if (!crop) {
      throw new DataMissingError("crop", mass.crop_id, `product ${product.product_id}`);
    }

    // ANIMAL INGREDIENTS CONTRIBUTE NOTHING — and say so.
    //
    // Mekonnen & Hoekstra 2011 covers crops only, so every animal figure in
    // the dataset is uncited. Rule 1 forbids serving an uncited number, and
    // deleting the dish would punish the user for our data gap — so the dish
    // stays, the animal ingredient is excluded from the total, the exclusion
    // is named in the lineage and on the result screen, and confidence drops
    // to low because the served total is knowingly incomplete.
    if (crop.is_animal === 1) {
      excluded.push({ crop_id: mass.crop_id, name: cropName(crop, lang) });
      fallbacks.push(`${mass.crop_id}:animal_excluded`);
      dataQuality = worseQuality(dataQuality, "low");
      continue;
    }
    citations.add(crop.source);

    // BUILD_SPEC phase 2: confidence is "low when any ingredient falls back to
    // a category average". Mekonnen & Hoekstra publish a specific line for most
    // crops, but for several Indian vegetables and spices only an aggregate
    // ("Vegetables, fresh nes", "Spices nes") exists. Those rows carry a
    // `category-avg` tag, and a result built on one says so rather than
    // presenting an aggregate as if it were a measurement of that crop.
    if (crop.source.includes("category-avg")) {
      fallbacks.push(`${mass.crop_id}:category_average`);
      dataQuality = worseQuality(dataQuality, "low");
    }

    const allShares = sourcing.get(mass.crop_id) ?? [];
    const state = dominantState(allShares);

    // State-level footprint if we have one for this crop/state/season, else the
    // national default — recorded, never hidden.
    let wf: Wf = { green: crop.wf_green, blue: crop.wf_blue, grey: crop.wf_grey };
    const stateRow = state ? cropStates.get(`${mass.crop_id}|${state}|${season}`) : undefined;
    if (stateRow) {
      wf = { green: stateRow.wf_green, blue: stateRow.wf_blue, grey: stateRow.wf_grey };
      citations.add(stateRow.source);
    } else {
      fallbacks.push(`${mass.crop_id}:national_default`);
      dataQuality = worseQuality(dataQuality, "medium");

      // Seasonal reallocation between rainfall and irrigation. The published
      // total is conserved exactly — only the green/blue split moves — and the
      // multipliers live in data/season_factor.csv. See SOURCES.md → S6.
      if (blueMultiplier !== 1.0) {
        const shiftedBlue = wf.blue * blueMultiplier;
        wf = {
          green: wf.green + (wf.blue - shiftedBlue),
          blue: shiftedBlue,
          grey: wf.grey,
        };
      }
    }

    const kg = mass.raw_grams / 1000;
    const split = cropFootprint(kg, wf, mass.yield_fraction);
    footprint = addSplits(footprint, split);

    // Sourcing: forced single state, validated national mix, or unsourced.
    let shares: ProductionShare[] = [];
    if (allShares.length > 0) {
      shares = forcedState
        ? forceState(mass.crop_id, allShares, forcedState)
        : apportion(mass.crop_id, allShares);
    }

    let cropImpactBlue: number;
    if (shares.length === 0) {
      // Blue water with no known origin: counted in full, weighted at 1.0.
      cropImpactBlue = unsourcedCrop(split.blue).impact_blue_l;
      fallbacks.push(`${mass.crop_id}:no_production_share`);
      dataQuality = worseQuality(dataQuality, "low");
    } else {
      const result = sourceCrop({
        crop_id: mass.crop_id,
        crop_name: cropName(crop, lang),
        blue_l: split.blue,
        shares,
        stressByState: stress,
      });
      cropImpactBlue = result.impact_blue_l;
      sources.push(...result.lines);

      // AMENDMENT_07 §4: a band midpoint is a reasonable central estimate, not
      // a measurement. Say so in the lineage and cap confidence at medium, so
      // "Why this number?" can disclose it and the screen never presents a
      // midpoint with the authority of Punjab's cited 156.36%.
      for (const line of result.lines) {
        if (line.precision === "band_midpoint") {
          fallbacks.push(`groundwater_band_midpoint:${line.state}`);
          dataQuality = worseQuality(dataQuality, "medium");
        }
      }
    }

    impactBlue += cropImpactBlue;
    impactByCrop.set(mass.crop_id, {
      impact: split.green + split.grey + cropImpactBlue,
      impactBlue: cropImpactBlue,
      kg,
      yieldFraction: mass.yield_fraction,
    });
  }

  // A product whose EVERY ingredient is animal-derived has no citable water at
  // all. Serving "0 L" would be a fabricated footprint wearing a number, so it
  // refuses by name instead. These products are hidden from browsing anyway —
  // this guards the direct-id path.
  if (excluded.length > 0 && excluded.length === masses.length) {
    throw new DataMissingError(
      "crop",
      product.product_id,
      "all ingredients are animal-derived — no citable footprint exists (M&H 2011 covers crops only)",
    );
  }

  if (blueMultiplier !== 1.0 && fallbacks.some((f) => f.endsWith(":national_default"))) {
    fallbacks.push(`season_model_applied:${season}`);
  }
  if (forcedState) fallbacks.push(`force_state:${forcedState}`);

  // SCORE RANKS IMPACT, NEVER TOTAL — and green water is not impact.
  //
  // Green water is rainfall the crop absorbed where it fell. It was never
  // pumped, never diverted, and competes with nobody; a rain-fed crop does not
  // burden an aquifer by growing in the rain. Grey water does count — diluting
  // pollution consumes real freshwater, which is the PS's "non-available water
  // due to pollution" clause.
  //
  // Including green inverted the whole message. Bajra (4,320 L green, 69 L
  // weighted blue) scored 92 while rice (1,838 green, 458 blue) scored 82 — so
  // the score called the water-smart millet *worse*, directly contradicting the
  // swap card sitting beside it on the same screen. swap.ts and /api/compare
  // already ranked on blue for exactly this reason; the score was the last
  // place still ranking rainfall.
  const impactLitres = footprint.grey + impactBlue;

  // Rank the SAME value that goes into the distribution.
  //
  // `catalogDistribution` is built from each product's rounded `impact_l`, but
  // the score was computed from the unrounded figure — so an item was ranked
  // against a ladder measured in different units from itself, and landed a
  // point out wherever that crossed a tie band. Rounding once, here, removes
  // the discrepancy.
  const impactRounded = Math.round(impactLitres);
  const rounded = roundSplit(footprint);

  const quality = worseQuality(dataQuality, resolverQuality);
  const confidence: Confidence = {
    low: Math.round(rounded.total * 0.85),
    high: Math.round(rounded.total * 1.15),
    quality,
  };

  sources.sort((a, b) => b.impact_blue_l - a.impact_blue_l);

  // The status of the state contributing the MOST blue-water impact, not the
  // worst state anywhere in the supply chain. Almost every Indian crop is grown
  // somewhere over-exploited, so "worst outlier" would return over_exploited
  // for every product and tell the user nothing. "Where your water mostly comes
  // from" varies, and is the claim we can defend.
  const status: StressCategory = sources.length ? sources[0].status : "safe";

  const swap = suggestSwap({
    impactByCrop,
    substitutions,
    footprints,
    sourcing,
    stress,
    seasonBlueMultiplier: blueMultiplier,
    lang,
  });

  if (sources.length) citations.add("S3");
  citations.add("S4");
  if (fallbacks.some((f) => f.startsWith("season_model_applied"))) citations.add("S6");

  return {
    product: {
      id: product.product_id,
      name: product.name,
      serving_g: servingG,
      type: product.type,
    },
    footprint_l: rounded,
    impact_l: impactRounded,
    excluded_ingredients: excluded,
    confidence,
    stress_score: score(impactRounded, catalogDistribution),
    status,
    human_equivalent: humanise(rounded.total, equivalences),
    sources: sources.slice(0, 12),
    swap,
    lineage: {
      ingredients: masses.map((m) => ({ crop: m.crop_id, raw_g: round1(m.raw_grams) })),
      season,
      fallbacks_used: fallbacks,
    },
    citations: expandCitations(citations),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Citations ──────────────────────────────────────────────────────────────

const CITATION_TEXT: Record<string, string> = {
  S1: "Mekonnen & Hoekstra, 2011 — Value of Water Research Report 47, UNESCO-IHE",
  S2: "Mekonnen & Hoekstra, 2012 — A global assessment of the water footprint of farm animal products",
  S3: "CGWB — Dynamic Ground Water Resources Assessment of India",
  S4: "Directorate of Economics & Statistics — Agricultural Statistics at a Glance",
  S5: "Processing yield ratios — see data/SOURCES.md",
  S6: "Seasonal irrigation model — Jal Drishti, see data/SOURCES.md (declared model, not a measurement)",
  S7: "Jal Jeevan Mission 55 LPCD norm; ICMR daily intake guidance",
  S8: "Municipal water utility reservoir bulletins (BMC, CMWSSB, MWRD, BWSSB, HMWSSB, DJB)",
};

/** `S1:approx` and `S1+S2` both resolve to their underlying documents. */
function expandCitations(tags: Set<string>): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    for (const part of tag.split("+")) {
      const base = part.split(":")[0].trim();
      const text = CITATION_TEXT[base];
      if (text) out.add(text);
    }
  }
  return [...out].sort();
}
