/**
 * Learn section content — AMENDMENT_14.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ PROVENANCE: the amendment expects `data/learn_content.json`, human-authored.
 * That file was never supplied — not in the repo, not alongside the amendment.
 * This module is the AGENT-WRITTEN English stand-in, kept in app/ rather than
 * /data on purpose: R2 says /data is human-owned, and putting my prose there
 * would dress it up as yours. Review it, or replace it with the real JSON and
 * point the components at that instead.
 *
 * ⚠ NO NUMBERS LIVE HERE. Amendment §2: a Learn page quoting one figure for
 * rice while the calculator computes another is worse than no Learn page. Every figure is therefore a { cropId, field } reference resolved
 * against the live database at render time — tests/learn.test.ts scans this
 * file and fails if a litre figure ever appears as a literal. The single
 * methodological constant (CGWB's 70% Safe ceiling) is imported from the
 * engine, not retyped.
 *
 * ⚠ TRANSLATIONS: deliberately absent. Amendment §9 — this much educational
 * prose machine-translated "reads noticeably wrong", so non-English languages
 * show this English content with a translated one-line note instead. The
 * untranslated surface is: every string in this file, for hi, mr and ta.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { CGWB_SAFE_THRESHOLD } from "../../engine/stress.ts";

/** A figure resolved live from /api/learn/stats — never a literal. */
export interface StatRef {
  cropId: string;
  field: "green" | "blue" | "grey" | "total";
  /** Template with {value} and {crop}; the number arrives at render time. */
  template: string;
}

export interface GuideStep {
  id: string;
  heading: string;
  body: string;
  stat?: StatRef;
  emphasis?: boolean;
  visual: "droplets" | "rain" | "borewell" | "runoff" | "states" | "formula";
}

/** §3 — six steps, one screen at a time. Steps 3 and 5 carry emphasis. */
export const GUIDE: GuideStep[] = [
  {
    id: "three-colours",
    heading: "Water has three colours here",
    body:
      "Every harvest drinks three kinds of water. Green is rain that soaked into the soil and was drawn up by roots. Blue is water pumped or channelled in — irrigation from rivers, canals and the ground beneath the field. Grey is not drunk at all: it is the clean water needed to dilute the fertiliser and pesticide that wash off. The three tell very different stories, which is why this app never adds them into one number without also showing the split.",
    visual: "droplets",
  },
  {
    id: "green",
    heading: "Green water falls for free",
    body:
      "When the monsoon breaks, rain lands on the field, sinks in, and waits in the soil until roots pull it up. That water was never taken from anyone — no pump ran, no river dropped, no aquifer fell. A crop that lives mostly on green water can carry a large total footprint while asking almost nothing of the water everyone else depends on.",
    stat: { cropId: "rice", field: "green", template: "Rice (paddy) drinks about {value} litres of rainwater per kilogram." },
    visual: "rain",
  },
  {
    id: "blue",
    heading: "Blue water is the water we fight over",
    body:
      "Irrigation water comes from somewhere: a canal fed by a reservoir, or a borewell reaching into the ground. In much of India the borewell wins, and every litre it lifts is a litre the aquifer must recover — or not. This is the water that competes with drinking supplies, and it is the part of a footprint that turns into real scarcity when it is drawn faster than rain refills it.",
    stat: { cropId: "rice", field: "blue", template: "Rice draws about {value} litres of irrigation water per kilogram, on the national mix." },
    emphasis: true,
    visual: "borewell",
  },
  {
    id: "grey",
    heading: "Grey water is a pollution bill",
    body:
      "Fertiliser that the crop does not absorb washes into drains and rivers. Grey water is the volume of clean water it would take to dilute that runoff back to a safe level — a debt measured in litres. It is counted separately and never multiplied by scarcity, because it is an allowance for pollution, not a withdrawal from a well.",
    stat: { cropId: "rice", field: "grey", template: "For rice, that dilution bill is about {value} litres per kilogram." },
    visual: "runoff",
  },
  {
    id: "where",
    heading: "The same crop, a different story by state",
    body:
      "A kilogram of rice grown on Bengal's rain is not the same as a kilogram grown on Punjab's borewells, even though both drank similar litres. The Central Ground Water Board grades every state by how hard its groundwater is being drawn, and this app weights each irrigation litre by that grade. Where the water came from decides what the number means.",
    emphasis: true,
    visual: "states",
  },
  {
    id: "formula",
    heading: "The whole method in one line",
    body:
      `Impact = irrigation litres × max(1, SoE ÷ ${CGWB_SAFE_THRESHOLD}). SoE is the stage of groundwater extraction — how much of a state's annual recharge is already being pumped out. Up to ${CGWB_SAFE_THRESHOLD}% (CGWB's own "Safe" ceiling) a litre counts as a litre; beyond it, every litre counts for more. Rain and the pollution allowance are never scaled — only the water that competes with an aquifer is.`,
    visual: "formula",
  },
];

export interface ArticleSection {
  id: string;
  heading: string;
  body: string;
  /** Section 2 renders the live comparison table; section 3 the split bars. */
  widget?: "compare-table" | "bajra-callout";
}

/** §4 — the journey of a grain of rice. Section 3 is the whole point. */
export const ARTICLE: ArticleSection[] = [
  {
    id: "seed",
    heading: "1 · A seed and a season",
    body:
      "Most Indian rice is sown with the monsoon — the kharif season — precisely so the sky does the heavy lifting. Seedlings stand in flooded paddies, and for weeks much of what they drink is rain held in the soil. Slide the month control on any result screen and you can watch this: the same rice leans on irrigation in a dry rabi month and on rainfall in July, while the total stays exactly where the source data put it.",
  },
  {
    id: "three-colours",
    heading: "2 · Three colours of one harvest",
    body:
      "Set rice beside wheat and bajra and the totals alone tell you almost nothing. The split tells you everything: how much fell as rain, how much was pumped, how much is owed as dilution. These figures are computed by the same engine as the calculator — this table can never disagree with a scan.",
    widget: "compare-table",
  },
  {
    id: "bajra",
    heading: "3 · The bajra paradox",
    body:
      "Here is the sentence this entire app is built to defend: a crop with a BIGGER total footprint can be the water-smart choice. Bajra's total exceeds rice's, because a rain-fed crop with modest yields drinks a lot of sky. But look at the blue bars — the irrigation water, the part that empties aquifers. Bajra asks for a fraction of it. Totals count rain; impact counts pumping. That distinction is why the swap card suggests millets, and why this app scores impact rather than volume.",
    widget: "bajra-callout",
  },
  {
    id: "plate",
    heading: "4 · From paddy to plate",
    body:
      "The grain leaves the field wearing a husk. Milling strips husk and bran away, so the white rice in your bowl weighs less than the paddy that was harvested — and every kilogram of it therefore carries the water of more than a kilogram of paddy. The calculator applies that milling yield from the data, which is why raw rice on the result screen costs more per kilogram than the field figures above. Scan a bag of rice and the whole journey is priced in front of you.",
  },
];

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

/** §5 — three questions. Q3 is the thesis of the product. */
export const QUIZ: QuizQuestion[] = [
  {
    id: "green-def",
    question: "Rain falls on a field and the crop drinks it from the soil. In water-footprint terms, that is…",
    options: ["Blue water", "Green water", "Grey water", "Lost water"],
    answerIndex: 1,
    explanation:
      "Green water is rainfall held in the soil and taken up where it fell. It is real water and it is counted — but it was never pumped, piped or taken from anyone, which is why this app reports it separately from irrigation.",
  },
  {
    id: "rain-aquifer",
    question: "Does that rainwater count against the groundwater of the state where the crop grew?",
    options: [
      "Yes — all water use drains the aquifer",
      "No — it was never withdrawn from the aquifer",
      "Only during the monsoon",
      "Only for rice",
    ],
    answerIndex: 1,
    explanation:
      "Rain that a crop drinks in place puts no pressure on wells or rivers. Only blue water — irrigation — competes with the aquifer, which is why only blue water is multiplied by a state's groundwater stress. Grey water is a dilution allowance and is never scaled either.",
  },
  {
    id: "thesis",
    question: "A millet has a LARGER total water footprint than rice. Can it still be the water-smart choice?",
    options: [
      "No — a smaller total is always better",
      "Yes — if most of its water is rain, its irrigation demand can be far lower",
      "Only if it is grown abroad",
      "Totals are all that matter",
    ],
    answerIndex: 1,
    explanation:
      "This is the single most important idea in JalDrishti. Rain-fed millets like bajra carry big totals because they drink a lot of sky — but they ask for a fraction of the irrigation water that rice does, and irrigation is the part that empties aquifers. Totals measure volume; impact measures what was taken, weighted by how stressed the source is. Open Compare and set rice beside bajra: the total bar and the irrigation bar tell opposite stories, and the irrigation bar is the one an aquifer feels.",
  },
];

export interface MythPair {
  myth: string;
  fact: string;
}

/** §6 — six pairs for the cycling strip. */
export const MYTHS: MythPair[] = [
  {
    myth: "A single footprint number tells the whole story.",
    fact: "Location, rainfall timing, water scarcity, yield and farming practice change what the number means.",
  },
  {
    myth: "The crop with less total water is always the better choice.",
    fact: "Totals count rain. A rain-fed crop can carry a big total while drawing far less irrigation — the water that actually competes with wells.",
  },
  {
    myth: "Grey water means dirty water.",
    fact: "Grey water is clean water — the volume needed to dilute farm runoff back to safe levels. It is a pollution bill, priced in litres.",
  },
  {
    myth: "Efficient irrigation makes a footprint disappear.",
    fact: "Drip and sprinkler systems shrink the blue share, sometimes dramatically — but every irrigated litre still comes from somewhere.",
  },
  {
    myth: "Packaged food has no water story.",
    fact: "Every ingredient on the label was grown somewhere. Scan the barcode and the packet's declared ingredients are priced crop by crop.",
  },
  {
    myth: "If groundwater is 'Safe', there is nothing to think about.",
    fact: "Safe means extraction is still below recharge — a budget being spent within limits, not an infinite supply. The grade can and does change.",
  },
];

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
}

/** §7 — eight terms. Also feeds the tooltips on the result-screen legend. */
export const GLOSSARY: GlossaryTerm[] = [
  {
    id: "green_water",
    term: "Green water",
    definition:
      "Rainfall stored in soil and taken up by the crop where it fell. Never pumped or diverted, so it puts no pressure on rivers or groundwater.",
  },
  {
    id: "blue_water",
    term: "Blue water",
    definition:
      "Irrigation water drawn from rivers, canals or groundwater. The part of a footprint that competes with drinking supplies and empties aquifers.",
  },
  {
    id: "grey_water",
    term: "Grey water",
    definition:
      "The volume of clean water needed to dilute the fertiliser and pesticide that wash off a field back to safe levels. An allowance for pollution, not a withdrawal.",
  },
  {
    id: "water_footprint",
    term: "Water footprint",
    definition:
      "The total freshwater used to produce something, split into green, blue and grey so the parts can be judged separately. Measured in litres per kilogram.",
  },
  {
    id: "virtual_water",
    term: "Virtual water",
    definition:
      "The water embedded in a product when it travels. A city that eats rice grown elsewhere imports that rice's water — consumption it never sees.",
  },
  {
    id: "soe",
    term: "Stage of Extraction (SoE)",
    definition:
      `The Central Ground Water Board's measure of how much of a state's annual groundwater recharge is already being pumped out. Up to ${CGWB_SAFE_THRESHOLD}% is graded Safe; past 100%, more is drawn each year than rain returns.`,
  },
  {
    id: "kharif",
    term: "Kharif",
    definition:
      "The monsoon cropping season, sown roughly June to October. Kharif crops meet much of their demand from rain, so their irrigation share is lower.",
  },
  {
    id: "rabi",
    term: "Rabi",
    definition:
      "The winter cropping season, sown after the monsoon ends. With little rain to draw on, rabi crops lean on irrigation — the same crop costs more blue water.",
  },
];

/** Distinct FAQ answers — the old page repeated one canned answer three times. */
export const FAQ: { q: string; a: string }[] = [
  {
    q: "Does the camera measure water use?",
    a: "No. The camera only identifies the product; the footprint is then computed from published datasets — crop water figures, state sourcing shares and groundwater assessments. Nothing is measured through the lens.",
  },
  {
    q: "Why do estimates show a range?",
    a: "Because honesty requires it. Where the data leans on a fallback — a category average, a rank-estimated recipe, a groundwater band rather than an exact figure — the confidence band widens and the result says so in 'Why this number?'. A single crisp figure would overstate what is actually known.",
  },
  {
    q: "Is a lower footprint always better?",
    a: "Not by itself. A total mixes rain, irrigation and a pollution allowance, and only irrigation competes with anyone. That is why the score ranks stress-weighted irrigation plus the pollution bill — and why a rain-fed millet can beat rice while carrying the larger total.",
  },
];

/**
 * §8 — the spoken version of the hub, for Web Speech. Assembled from content
 * already on screen; duration is computed from this text, never hardcoded.
 */
export function listenScript(): string {
  return [
    "Understanding water footprints, with JalDrishti.",
    GUIDE.map((s) => `${s.heading}. ${s.body}`).join(" "),
    `A common myth: ${MYTHS[0].myth} In fact: ${MYTHS[0].fact}`,
  ].join(" ");
}

/** Spoken-word estimate at a typical Indian-English TTS rate. */
export const SPOKEN_WORDS_PER_MINUTE = 150;

export function estimateListenMinutes(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / SPOKEN_WORDS_PER_MINUTE));
}
