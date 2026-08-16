import Anthropic from "@anthropic-ai/sdk";
import { bad, ok } from "../_lib/respond.ts";
import { staticFallback } from "../_lib/faq.ts";
import type { Lang } from "../../../engine/types.ts";
import { langOf } from "../_lib/respond.ts";

/**
 * POST /api/explain — "Ask Water AI".
 *
 * AMENDMENT_02 §2. Handles the long tail of questions no fixed UI can answer:
 * "why is rice high?", "what is blue water?", "explain in Hindi".
 *
 * ⚠ THE CHATBOT EXPLAINS, IT NEVER COMPUTES.
 *
 * An unconstrained chatbot will confidently state a wrong water footprint, and
 * that one wrong number destroys the credibility of the entire engine behind
 * it. The engine is authoritative; this is a narrator. The constraint is
 * enforced in three places: the system prompt below, a low token ceiling, and
 * `tests/explain.test.ts`, which asserts that a question about an absent figure
 * returns a refusal rather than a number.
 */

/** Reproduced verbatim from AMENDMENT_02 §2. Do not paraphrase. */
export const EXPLAIN_SYSTEM_PROMPT = `You explain water footprint results. You are given a JSON result object.

RULES:
- You may ONLY reference figures that appear in the provided JSON.
- You must NEVER calculate, estimate, derive or invent any number.
- If asked for a figure not present in the JSON, say you do not have that
  figure and suggest what the user can scan or search to get it.
- Never contradict the JSON. It is the single source of truth.
- Answer in the language specified by \`lang\`.
- Keep answers under 80 words. Plain language, no jargon.
- If asked something unrelated to water footprints, redirect briefly.`;

const MODEL = "claude-opus-5";
const TIMEOUT_MS = 8000;

/** Crude per-isolate rate limit — enough to stop a runaway client. */
const RATE_LIMIT_PER_MINUTE = 20;
const hits: number[] = [];

function rateLimited(): boolean {
  const now = Date.now();
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= RATE_LIMIT_PER_MINUTE) return true;
  hits.push(now);
  return false;
}

interface ExplainBody {
  result?: unknown;
  question?: string;
  lang?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: ExplainBody;
  try {
    body = (await request.json()) as ExplainBody;
  } catch {
    return bad("body must be JSON");
  }

  const question = (body.question ?? "").trim();
  if (!question) return bad("question is required");
  if (!body.result) return bad("result (a /api/calculate payload) is required");

  const lang: Lang = langOf(body.lang);

  if (rateLimited()) {
    return ok({ answer: staticFallback(question, lang), source: "fallback", reason: "rate_limited" });
  }

  const apiKey = readEnv("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return ok({ answer: staticFallback(question, lang), source: "fallback", reason: "not_configured" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 400,
        system: EXPLAIN_SYSTEM_PROMPT,
        // Short factual narration — no need to spend thinking tokens.
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: `lang: ${lang}

RESULT JSON (the single source of truth):
${JSON.stringify(body.result)}

QUESTION: ${question}`,
          },
        ],
      },
      { signal: controller.signal },
    );

    // A refusal returns HTTP 200 with an empty content array — reading
    // content[0] without this check would throw.
    if (response.stop_reason === "refusal") {
      return ok({ answer: staticFallback(question, lang), source: "fallback", reason: "refused" });
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return ok({ answer: staticFallback(question, lang), source: "fallback", reason: "empty" });
    }

    return ok({ answer: text.text.trim(), source: "model", lang });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return ok({
      answer: staticFallback(question, lang),
      source: "fallback",
      reason: aborted ? "timeout" : "error",
    });
  } finally {
    clearTimeout(timer);
  }
}

function readEnv(key: string): string | undefined {
  try {
    return (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[key];
  } catch {
    return undefined;
  }
}
