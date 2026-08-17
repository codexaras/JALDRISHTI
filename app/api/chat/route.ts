import { bad, fail, langOf, ok } from "../_lib/respond.ts";
import {
  guardModeA,
  guardModeB,
  retrieve,
  SYSTEM_PROMPT,
  templateAnswer,
  type ResultContext,
} from "../_lib/chat.ts";
import { DEFAULT_MODEL_CHAIN } from "../../../resolvers/vision-providers.ts";
import { t } from "../../../i18n/index.ts";

/**
 * POST /api/chat — JalMitra.
 *
 * Retrieval decides the mode BEFORE Gemini sees anything:
 *
 *   grounded — the database answered; Gemini only rephrases the retrieved
 *              context, a guard checks every number in the reply against that
 *              context, and any failure (guard, timeout, no key, rate limit)
 *              falls back to a template built from the same rows. A question
 *              our data can answer never comes back empty.
 *   general  — nothing retrieved; Gemini explains freely but a second guard
 *              blocks litre figures and groundwater percentages, the two
 *              number types the engine owns.
 */
interface ChatBody {
  question?: string;
  lang?: string;
  context?: ResultContext;
}

const TIMEOUT_MS = 8000;

/** One warning per isolate when running keyless, not one per message. */
let warnedNoKey = false;

function readEnv(key: string): string | undefined {
  try {
    return (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[key];
  } catch {
    return undefined;
  }
}

async function askGemini(question: string, lang: string, context: unknown): Promise<string | null> {
  const apiKey = readEnv("GEMINI_API_KEY") || readEnv("GOOGLE_API_KEY");
  if (!apiKey) return null;
  // The spec reads GEMINI_MODEL_ID; the rest of the app already uses
  // GEMINI_MODEL. Honour both rather than fork the configuration.
  const model = readEnv("GEMINI_MODEL_ID") || readEnv("GEMINI_MODEL") || DEFAULT_MODEL_CHAIN[0];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify({ question, lang, context }) }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 220 },
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  return text || null;
}

const SUGGESTIONS = ["chat.sugg.gw", "chat.sugg.crop", "chat.sugg.concept"];

export async function POST(request: Request): Promise<Response> {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return bad("body must be JSON");
  }

  const question = (body.question ?? "").trim();
  if (!question) return bad("question is required");
  if (question.length > 500) return bad("question is too long");
  const lang = langOf(body.lang);

  try {
    const retrieved = retrieve(question, lang, body.context);

    if (retrieved.mode === "grounded") {
      const grounded = templateAnswer(retrieved, lang);
      let answer = grounded;
      const fluent = await askGemini(question, lang, retrieved.context).catch(() => null);
      // The template IS the answer unless Gemini both responds and passes the
      // guard — a rephrasing that smuggles in a foreign number is discarded.
      if (fluent && guardModeA(fluent, retrieved.context)) answer = fluent;
      return ok({
        answer,
        mode: "grounded",
        intent: retrieved.intent,
        sources: retrieved.sources,
        missing: retrieved.missing,
        suggestions: SUGGESTIONS,
      });
    }

    // General mode — needs the model; the ban on engine-owned figures applies.
    const general = await askGemini(question, lang, {}).catch(() => null);
    if (!general) {
      if (!warnedNoKey && !readEnv("GEMINI_API_KEY") && !readEnv("GOOGLE_API_KEY")) {
        warnedNoKey = true;
        console.warn("JalMitra: GEMINI_API_KEY unset — grounded answers only, general mode disabled");
      }
      return ok({
        answer: t(lang, "chat.unavailable"),
        mode: "general",
        intent: retrieved.intent,
        sources: [],
        missing: [],
        suggestions: SUGGESTIONS,
      });
    }

    const verdict = guardModeB(general);
    return ok({
      // A general answer carrying a litres figure or an extraction percentage
      // is replaced outright — the redirect names where the real number lives.
      answer: verdict.ok ? general : t(lang, "chat.figureRedirect"),
      mode: "general",
      intent: retrieved.intent,
      sources: [],
      missing: [],
      suggestions: SUGGESTIONS,
    });
  } catch (err) {
    return fail(err);
  }
}
