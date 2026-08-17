import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARTICLE,
  FAQ,
  GLOSSARY,
  GUIDE,
  MYTHS,
  QUIZ,
  SPOKEN_WORDS_PER_MINUTE,
  estimateListenMinutes,
  listenScript,
} from "../app/lib/learn-content.ts";
import { GET as learnStats } from "../app/api/learn/stats/route.ts";
import { getCrop, allDistricts } from "../repo/db.ts";

/**
 * AMENDMENT_14 — the Learn section.
 *
 * The first block is the one that matters: a Learn page that states a litre
 * figure the calculator disagrees with is worse than no Learn page (§2), so
 * the content module is SCANNED for numeric water claims. Figures may only
 * arrive at render time, from the same bundle the calculator reads.
 */
describe("AMENDMENT_14: numbers come from the database, not the prose", () => {
  it("the content module hardcodes no litre figure", () => {
    const source = readFileSync("app/lib/learn-content.ts", "utf8");
    // Any 3+ digit number (with or without Indian grouping) followed by a
    // litres unit is a hardcoded water figure — the exact failure §2 bans.
    const litreClaims = source.match(/\d[\d,]{2,}\s*(?:L\b|litres|liters|लीटर|லிட்டர்)/gi) ?? [];
    expect(litreClaims).toEqual([]);
    // And no "per kg" figure sneaks in as e.g. "1,673 L/kg".
    expect(source).not.toMatch(/\d[\d,]{2,}\s*L\s*\/\s*kg/i);
  });

  it("stat references point at crops and fields that exist", () => {
    for (const step of GUIDE) {
      if (!step.stat) continue;
      const crop = getCrop(step.stat.cropId);
      expect(crop, step.stat.cropId).toBeTruthy();
      expect(["green", "blue", "grey", "total"]).toContain(step.stat.field);
      expect(step.stat.template).toContain("{value}");
    }
  });

  it("the stats endpoint returns exactly what crop.csv holds", async () => {
    const res = await learnStats(new Request("http://localhost/api/learn/stats?crops=rice,pearl_millet&states=Punjab"));
    const body = (await res.json()) as {
      crops: Record<string, { green: number; blue: number; grey: number; total: number }>;
      states: Record<string, { soe_pct: number }>;
      missing: string[];
    };
    const rice = getCrop("rice")!;
    expect(body.crops.rice.green).toBe(rice.wf_green);
    expect(body.crops.rice.blue).toBe(rice.wf_blue);
    expect(body.crops.rice.grey).toBe(rice.wf_grey);
    expect(body.crops.rice.total).toBe(rice.wf_green + rice.wf_blue + rice.wf_grey);

    const punjab = allDistricts().find((g) => g.state === "Punjab")!;
    expect(body.states.Punjab.soe_pct).toBe(punjab.soe_pct);
    expect(body.missing).toEqual([]);
  });

  it("an unknown crop or state is reported missing, never approximated", async () => {
    const res = await learnStats(new Request("http://localhost/api/learn/stats?crops=unobtainium&states=Atlantis"));
    const body = (await res.json()) as { crops: object; states: object; missing: string[] };
    expect(body.missing).toContain("crop:unobtainium");
    expect(body.missing).toContain("state:Atlantis");
    expect(Object.keys(body.crops)).toHaveLength(0);
  });
});

describe("AMENDMENT_14: content structure", () => {
  it("guide has six steps with emphasis on steps 3 and 5", () => {
    expect(GUIDE).toHaveLength(6);
    expect(GUIDE[2].emphasis).toBe(true); // blue water / borewell
    expect(GUIDE[4].emphasis).toBe(true); // where it comes from / states
    for (const s of GUIDE) {
      expect(s.heading.length, s.id).toBeGreaterThan(0);
      expect(s.body.length, s.id).toBeGreaterThan(80);
    }
  });

  it("quiz has three questions, each with a full explanation and a valid answer", () => {
    expect(QUIZ).toHaveLength(3);
    for (const q of QUIZ) {
      expect(q.answerIndex).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex).toBeLessThan(q.options.length);
      // The explanation is the point of the quiz — it must carry real content.
      expect(q.explanation.length, q.id).toBeGreaterThan(100);
    }
    // Q3 is the thesis: the bigger-total-can-be-smarter idea.
    expect(QUIZ[2].explanation.toLowerCase()).toContain("irrigation");
  });

  it("six myth pairs and eight glossary terms, as specified", () => {
    expect(MYTHS).toHaveLength(6);
    expect(GLOSSARY).toHaveLength(8);
    const ids = GLOSSARY.map((g) => g.id);
    for (const required of ["green_water", "blue_water", "grey_water", "soe", "kharif", "rabi"]) {
      expect(ids).toContain(required);
    }
  });

  it("article has four sections, with the comparison and callout widgets placed", () => {
    expect(ARTICLE).toHaveLength(4);
    expect(ARTICLE[1].widget).toBe("compare-table");
    expect(ARTICLE[2].widget).toBe("bajra-callout");
  });

  it("the three FAQ answers are distinct — the old page repeated one", () => {
    expect(new Set(FAQ.map((f) => f.a)).size).toBe(FAQ.length);
  });
});

describe("AMENDMENT_14: listen duration is computed, never hardcoded", () => {
  it("derives minutes from word count at the declared speech rate", () => {
    const words = Array.from({ length: SPOKEN_WORDS_PER_MINUTE * 4 }, () => "word").join(" ");
    expect(estimateListenMinutes(words)).toBe(4);
    expect(estimateListenMinutes("just a few words")).toBe(1); // floor of one minute
  });

  it("the hub script is substantial enough to be worth a listen button", () => {
    expect(estimateListenMinutes(listenScript())).toBeGreaterThanOrEqual(2);
  });
});
