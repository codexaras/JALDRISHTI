/**
 * Vision providers, behind one interface.
 *
 * Same pattern as `SpeechProvider` (BUILD_SPEC phase 5): two implementations so
 * a missing key or a slow API on demo day is a config flag, not a crisis.
 *
 *   VISION_PROVIDER=gemini     Google Gemini — free tier, no card required
 *   VISION_PROVIDER=anthropic  Claude — better reasoning, paid
 *   (unset)                    auto-detect from whichever key is present
 *
 * Both are told to return the same JSON shape, so `vision.ts` neither knows nor
 * cares which one answered.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface DetectedItem {
  name: string;
  est_grams: number;
  confidence: number;
}

/** Raised when the provider is out of quota, so the UI can say which. */
export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

export interface VisionProvider {
  readonly name: string;
  identify(base64Image: string, mediaType: string, signal?: AbortSignal): Promise<DetectedItem[]>;
}

export const SYSTEM_PROMPT = `Identify Indian food items in this image.

Report only what is actually visible. If the image shows no food, return an empty
items array rather than guessing. Prefer the specific Indian name over a generic
category: say "bitter gourd" not "green vegetable", "drumstick" not "pod".
Estimate the visible portion in grams.`;

/**
 * Shared schema so both providers return the identical shape.
 *
 * This is the **Anthropic** dialect: structured outputs *require*
 * `additionalProperties: false` on every object. Gemini's `responseSchema`
 * rejects that key outright with a 400, so `toGeminiSchema()` strips it.
 * One source of truth, two dialects.
 */
const ITEMS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Dish or ingredient name in English" },
          est_grams: { type: "number", description: "Estimated visible portion in grams" },
          confidence: { type: "number", description: "0 to 1" },
        },
        required: ["name", "est_grams", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

/**
 * Gemini speaks an OpenAPI-3.0 subset that has no `additionalProperties` key —
 * sending it returns a 400. Strip it recursively rather than maintaining two
 * hand-written schemas that could drift apart.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (key === "additionalProperties") continue;
      out[key] = toGeminiSchema(value);
    }
    return out;
  }
  return schema;
}

/** Strip markdown fences and locate the JSON object. */
export function parseDefensively(raw: string): DetectedItem[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items
      .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
      .map((i) => ({
        name: String(i.name ?? "").trim(),
        est_grams: Number(i.est_grams) || 0,
        confidence: Number(i.confidence) || 0,
      }))
      .filter((i) => i.name.length > 0);
  } catch {
    return [];
  }
}

// ─── Google Gemini ──────────────────────────────────────────────────────────

/**
 * Tried in order. Free-tier quota is per model, so this is a fallback chain
 * rather than a preference list: when the first is exhausted the next answers.
 * Lite models lead — identifying a vegetable does not need a frontier model,
 * and they are roughly three times faster.
 */
export const DEFAULT_MODEL_CHAIN = [
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-flash-latest",
];

/**
 * Free tier, no card required, and it handles Indian produce names well —
 * the practical default for a hackathon.
 *
 * Unlike Claude Opus 5, Gemini still accepts `temperature`, so the spec's
 * "temperature 0" is honoured literally here.
 */
export class GeminiVisionProvider implements VisionProvider {
  readonly name = "gemini";
  private apiKey: string;
  private chain: string[];
  /** Model that last answered, so a working one is tried first next time. */
  private preferred = 0;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    // Free-tier quota is counted PER MODEL, not per key. When one runs dry the
    // others still answer, so exhausting a model degrades the demo instead of
    // ending it. Lite models lead: same accuracy on a vegetable, ~3x faster,
    // and their quota lasts longer.
    this.chain = model
      ? [model, ...DEFAULT_MODEL_CHAIN.filter((m) => m !== model)]
      : [...DEFAULT_MODEL_CHAIN];
  }

  /** Which model answered last — surfaced for the "Why this number?" panel. */
  get activeModel(): string {
    return this.chain[this.preferred];
  }

  async identify(base64Image: string, mediaType: string, signal?: AbortSignal): Promise<DetectedItem[]> {
    let lastQuotaError: QuotaError | null = null;

    // Start from the model that worked last time, then walk the rest.
    for (let step = 0; step < this.chain.length; step++) {
      const index = (this.preferred + step) % this.chain.length;
      try {
        const items = await this.callModel(this.chain[index], base64Image, mediaType, signal);
        this.preferred = index;
        return items;
      } catch (err) {
        if (err instanceof QuotaError) {
          lastQuotaError = err;
          continue; // this model is dry — try the next
        }
        throw err;
      }
    }
    throw lastQuotaError ?? new Error("gemini: no model available");
  }

  private async callModel(
    model: string,
    base64Image: string,
    mediaType: string,
    signal?: AbortSignal,
  ): Promise<DetectedItem[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mediaType, data: base64Image } },
            { text: "What food is in this image?" },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(ITEMS_SCHEMA),
      },
    });

    // 503 "high demand" is transient and worth retrying. A 429 is NOT — it
    // means the quota is gone, and retrying only spends time before failing
    // over to the next model. Retrying quota errors is what turned a handful
    // of test images into an exhausted daily budget.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(url, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok || res.status !== 503) break;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }

    if (!res || !res.ok) {
      const body = res ? await res.text() : "";
      // A 429 that mentions quota is the daily free-tier cap (20 requests/day),
      // not a momentary rate limit. The user needs different advice for each,
      // so the distinction is carried up rather than flattened to "failed".
      if (res?.status === 429) {
        throw new QuotaError(
          /quota/i.test(body) ? `${model}: daily free-tier quota exhausted` : `${model}: rate limited`,
        );
      }
      throw new Error(`gemini(${model}): ${res ? `${res.status} ${body.slice(0, 160)}` : "no response"}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) return [];

    try {
      const parsed = JSON.parse(text) as { items?: DetectedItem[] };
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      return parseDefensively(text);
    }
  }
}

// ─── Anthropic Claude ───────────────────────────────────────────────────────

/**
 * `temperature` is removed on Claude Opus 5 and returns a 400, so determinism
 * comes from the constrained output schema plus low effort instead.
 */
export class AnthropicVisionProvider implements VisionProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = "claude-opus-5", client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
    this.model = model;
  }

  async identify(base64Image: string, mediaType: string, signal?: AbortSignal): Promise<DetectedItem[]> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        output_config: { effort: "low", format: { type: "json_schema", schema: ITEMS_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType as "image/jpeg" | "image/png" | "image/webp",
                  data: base64Image,
                },
              },
              { type: "text", text: "What food is in this image?" },
            ],
          },
        ],
      },
      { signal },
    );

    // A refusal returns HTTP 200 with an empty content array — reading
    // content[0] without this check would throw.
    if (response.stop_reason === "refusal") return [];

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return [];

    try {
      const parsed = JSON.parse(text.text) as { items?: DetectedItem[] };
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      return parseDefensively(text.text);
    }
  }
}

// ─── Selection ──────────────────────────────────────────────────────────────

export interface VisionEnv {
  VISION_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_MODEL?: string;
  ANTHROPIC_MODEL?: string;
}

/**
 * Pick a provider from whatever is configured. Returns null when nothing is —
 * the scan screen then says so and offers manual search, rather than failing.
 */
export function selectVisionProvider(env: VisionEnv): VisionProvider | null {
  const choice = (env.VISION_PROVIDER ?? "").toLowerCase();
  const gemini = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;

  if (choice === "gemini") {
    return gemini ? new GeminiVisionProvider(gemini, env.GEMINI_MODEL) : null;
  }
  if (choice === "anthropic") {
    return env.ANTHROPIC_API_KEY
      ? new AnthropicVisionProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL)
      : null;
  }

  // Auto: prefer whichever key exists, Gemini first since it is the free tier.
  if (gemini) return new GeminiVisionProvider(gemini, env.GEMINI_MODEL);
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicVisionProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
  }
  return null;
}
