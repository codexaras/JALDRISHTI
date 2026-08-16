import { describe, expect, it } from "vitest";
import { EXPLAIN_SYSTEM_PROMPT } from "../app/api/explain/route.ts";
import { staticFallback } from "../app/api/_lib/faq.ts";
import { calculateProduct } from "../repo/db.ts";
import type { Lang } from "../engine/types.ts";

/**
 * AMENDMENT_02 §8: "/explain refuses to produce a figure absent from the result
 * JSON (test exists)."
 *
 * The constraint is enforced in three layers, and each is tested here:
 *   1. the system prompt carries the rules verbatim
 *   2. the offline fallback quotes no figures at all
 *   3. when a key is present, the live model refuses an absent figure
 *
 * Layer 3 needs a network call, so it is skipped without ANTHROPIC_API_KEY.
 * Layers 1 and 2 always run — a prompt edited to drop a rule fails CI.
 */

const REQUIRED_RULES = [
  "You may ONLY reference figures that appear in the provided JSON.",
  "You must NEVER calculate, estimate, derive or invent any number.",
  "Never contradict the JSON. It is the single source of truth.",
  "Keep answers under 80 words.",
];

describe("explain: the system prompt", () => {
  it("carries every constraint verbatim", () => {
    for (const rule of REQUIRED_RULES) {
      expect(EXPLAIN_SYSTEM_PROMPT).toContain(rule);
    }
  });

  it("tells the model to say so when a figure is absent", () => {
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("If asked for a figure not present in the JSON");
  });

  it("instructs answering in the requested language", () => {
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("Answer in the language specified by `lang`");
  });
});

describe("explain: the offline fallback", () => {
  const LANGS: Lang[] = ["en", "hi", "mr", "ta"];

  it("never quotes a figure — it cannot contradict the engine", () => {
    const questions = [
      "why is this so high?",
      "what is blue water?",
      "how many litres for a mango?",
      "what does the score mean?",
      "how much water does a car use?",
    ];
    for (const lang of LANGS) {
      for (const q of questions) {
        const answer = staticFallback(q, lang);
        expect(answer.length).toBeGreaterThan(0);
        // No quantity. A fallback that quotes a figure is a fallback that can
        // disagree with the result on screen. Scale words ("0 is the lightest,
        // 100 the heaviest") describe the scale itself and quote nothing.
        expect(answer).not.toMatch(/\d+\s*(l|litre|लीटर|लिटर|லிட்டர்)/i);
        expect(answer).not.toMatch(/\d{4,}/);
      }
    }
  });

  it("answers in the requested language", () => {
    expect(staticFallback("what is blue water?", "hi")).toMatch(/[ऀ-ॿ]/);
    expect(staticFallback("what is blue water?", "ta")).toMatch(/[஀-௿]/);
    // The English answer carries no Indic script. Typographic punctuation
    // (em dashes, curly quotes) is fine and is not a language signal.
    expect(staticFallback("what is blue water?", "en")).not.toMatch(/[ऀ-ॿ஀-௿]/);
  });

  it("routes a question to the matching topic", () => {
    expect(staticFallback("what is grey water?", "en")).toContain("dilute");
    expect(staticFallback("what does the score mean?", "en")).toContain("ranks");
    expect(staticFallback("does the month matter?", "en")).toContain("Season");
  });

  it("redirects an unrelated question instead of answering it", () => {
    const answer = staticFallback("what is the capital of France?", "en");
    expect(answer).toContain("fixed set of notes");
  });
});

describe("explain: the engine remains authoritative", () => {
  it("every figure the explainer may quote is present in the result payload", () => {
    const result = calculateProduct("biryani_chicken");
    // The contract the prompt depends on: these fields must exist, or "only
    // reference figures in the JSON" leaves the model with nothing to say.
    expect(result.footprint_l.green).toBeTypeOf("number");
    expect(result.footprint_l.blue).toBeTypeOf("number");
    expect(result.footprint_l.grey).toBeTypeOf("number");
    expect(result.footprint_l.total).toBeTypeOf("number");
    expect(result.stress_score).toBeTypeOf("number");
    expect(result.confidence.low).toBeTypeOf("number");
    expect(result.confidence.high).toBeTypeOf("number");
    expect(result.sources[0].soe_pct).toBeTypeOf("number");
    expect(result.citations.length).toBeGreaterThan(0);
  });
});

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!hasKey)("explain: live model refuses absent figures", () => {
  it("declines to state a figure that is not in the JSON", async () => {
    const { POST } = await import("../app/api/explain/route.ts");
    const result = calculateProduct("biryani_chicken");

    const response = await POST(
      new Request("http://localhost/api/explain", {
        method: "POST",
        body: JSON.stringify({
          result,
          // Nothing in the payload says anything about mangoes.
          question: "How many litres of water does one kilogram of mango need?",
          lang: "en",
        }),
      }),
    );

    const body = (await response.json()) as { answer: string };
    // It must not answer with a mango figure. M&H put mango near 1,800 L/kg, so
    // a number in that band is the specific failure this test exists to catch.
    expect(body.answer).not.toMatch(/1[,.]?8\d\d/);
    expect(body.answer.toLowerCase()).toMatch(
      /don'?t have|do not have|not (in|present|available)|cannot|can't|no figure|scan|search/,
    );
  }, 20_000);
});
