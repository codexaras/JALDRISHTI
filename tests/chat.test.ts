import { describe, expect, it } from "vitest";
import {
  contextNumbers,
  guardModeA,
  guardModeB,
  retrieve,
  templateAnswer,
} from "../app/api/_lib/chat.ts";
import { POST as chatRoute } from "../app/api/chat/route.ts";
import { allDistricts, getCrop } from "../repo/db.ts";

/**
 * JalMitra — retrieval, guards and the keyless fallback.
 *
 * Everything here runs without a network or a model: the design puts every
 * correctness property in deterministic code so it can be tested, and so the
 * chatbot keeps answering grounded questions when Gemini is down. Vitest has
 * no GEMINI_API_KEY, which makes the route tests the fallback tests.
 */
const ask = (question: string, lang = "en") =>
  chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, lang }),
  })).then((r) => r.json() as Promise<{ answer: string; mode: string; sources: string[]; missing: string[] }>);

describe("JalMitra: routing", () => {
  it("a question our data can answer always uses grounded mode, never general", () => {
    for (const q of [
      "How much water does rice need?",
      "What is the groundwater level in Punjab?",
      "What is blue water?",
      "Where is your data from?",
      "Which state has the worst groundwater?",
    ]) {
      expect(retrieve(q, "en").mode, q).toBe("grounded");
    }
  });

  it("a question with no matching entity falls to general mode", () => {
    for (const q of ["What is drip irrigation?", "Why does India have a water crisis?", "How do aquifers recharge?"]) {
      expect(retrieve(q, "en").mode, q).toBe("general");
    }
  });

  it("bhindi and भेंडी both resolve inside a question", () => {
    for (const q of ["How much water does bhindi need?", "भेंडी को कितना पानी चाहिए?"]) {
      const r = retrieve(q, q.startsWith("भ") ? "hi" : "en");
      expect(r.mode, q).toBe("grounded");
      expect(r.context.crops?.some((c) => c.crop_id === "okra"), q).toBe(true);
    }
  });

  it("a partial comparison grounds the known crop and names the unknown one", () => {
    const r = retrieve("compare rice and quinoa", "en");
    expect(r.mode).toBe("grounded");
    expect(r.context.crops?.some((c) => c.crop_id === "rice")).toBe(true);
    expect(r.missing.join(" ").toLowerCase()).toContain("quinoa");
  });
});

describe("JalMitra: grounded answers carry only retrieved numbers", () => {
  it("context retrieved for rice rejects an answer holding a wheat figure", () => {
    const r = retrieve("How much water does rice need?", "en");
    const wheat = getCrop("wheat")!;
    // The exact failure the guard exists for: the model reaching for its own
    // knowledge of a crop nobody retrieved.
    const smuggled = `Rice needs water, and wheat uses about ${wheat.wf_green + wheat.wf_blue + wheat.wf_grey} litres per kg.`;
    expect(guardModeA(smuggled, r.context)).toBe(false);
    // The template built from the same context contains rice figures only.
    const template = templateAnswer(r, "en");
    expect(template).toContain(String(getCrop("rice")!.wf_green));
    expect(template).not.toContain(String(wheat.wf_green));
  });

  it("accepts an answer whose numbers all come from the context", () => {
    const r = retrieve("How much water does rice need?", "en");
    const rice = getCrop("rice")!;
    expect(guardModeA(`Rice takes ${rice.wf_blue} litres of irrigation per kg.`, r.context)).toBe(true);
    expect(contextNumbers(r.context).has(rice.wf_blue)).toBe(true);
  });

  it("the Punjab groundwater answer matches gw_stress.csv exactly", () => {
    const punjab = allDistricts().find((g) => g.state === "Punjab")!;
    const r = retrieve("What is the groundwater level in Punjab?", "en");
    expect(r.context.states?.[0].soe_pct).toBe(punjab.soe_pct);
    const answer = templateAnswer(r, "en");
    expect(answer).toContain(String(punjab.soe_pct));
    expect(answer).toContain("CGWB");
  });

  it("a band_midpoint state gets its band, never the midpoint decimal", () => {
    const wb = allDistricts().find((g) => g.state === "West Bengal")!;
    expect(wb.precision).toBe("band_midpoint");
    const r = retrieve("What is the groundwater level in West Bengal?", "en");
    const answer = templateAnswer(r, "en");
    // The stored midpoint must not be quoted as though it were measured.
    expect(answer).not.toContain(`${wb.soe_pct}%`);
    expect(answer.toLowerCase()).toContain("under");
  });
});

describe("JalMitra: the general-mode number ban", () => {
  it("blocks a litres-per-kg figure", () => {
    expect(guardModeB("Wheat uses about 1,800 litres per kg.").ok).toBe(false);
    expect(guardModeB("A cotton shirt takes 2700 L of water.").ok).toBe(false);
    expect(guardModeB("गेहूँ को लगभग 1800 लीटर चाहिए").ok).toBe(false);
  });

  it("blocks a groundwater percentage", () => {
    expect(guardModeB("Karnataka extracts around 70% of its groundwater.").ok).toBe(false);
    expect(guardModeB("Extraction is roughly 85 percent there.").ok).toBe(false);
  });

  it("allows figure-free explanations", () => {
    for (const good of [
      "Drip irrigation delivers water to the roots, so far less is lost to evaporation than flood irrigation.",
      "Kharif crops are sown with the monsoon and rely mainly on rain.",
      "Groundwater recharges when rainfall percolates through soil.",
    ]) {
      expect(guardModeB(good).ok, good).toBe(true);
    }
  });
});

describe("JalMitra: keyless operation (Gemini unavailable)", () => {
  it("still answers a grounded question, with figures and sources", async () => {
    const body = await ask("How much water does rice need?");
    expect(body.mode).toBe("grounded");
    expect(body.answer).toContain(String(getCrop("rice")!.wf_green));
    expect(body.sources.length).toBeGreaterThan(0);
  });

  it("labels a general question as general and says the service is needed", async () => {
    const body = await ask("What is drip irrigation?");
    expect(body.mode).toBe("general");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.sources).toHaveLength(0);
  });

  it("answers in the requested language", async () => {
    const body = await ask("चावल को कितना पानी चाहिए?", "hi");
    expect(body.mode).toBe("grounded");
    expect(body.answer).toMatch(/[\u0900-\u097F]/);
  });
});
