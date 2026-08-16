/**
 * Speech, behind an interface.
 *
 * BUILD_SPEC phase 5: implement both providers so a slow Bhashini on demo day
 * is a config flag, not a crisis. `SPEECH_PROVIDER=web` switches to the
 * browser-native path, which needs no network and no credentials.
 */
import type { Lang } from "../engine/types.ts";

export interface SpeechProvider {
  readonly name: string;
  /** Speech → text. */
  stt(audio: ArrayBuffer, lang: Lang): Promise<string>;
  /** Text → speech (audio bytes). */
  tts(text: string, lang: Lang): Promise<ArrayBuffer>;
}

/** Bhashini language codes for the four languages we ship. */
const BHASHINI_LANG: Record<Lang, string> = { en: "en", hi: "hi", mr: "mr", ta: "ta" };

const PIPELINE_CONFIG_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline";

interface BhashiniConfig {
  userId: string;
  ulcaApiKey: string;
  pipelineId: string;
  inferenceApiKey?: string;
}

interface CachedService {
  serviceId: string;
  endpoint: string;
  authKey: string;
  authValue: string;
}

/**
 * Bhashini — India's national language stack.
 *
 * The `serviceId` is resolved from `getModelsPipeline` **once at startup** and
 * cached. Calling it per request adds a full round trip to every utterance and
 * is the first thing that falls over on venue WiFi.
 */
export class BhashiniProvider implements SpeechProvider {
  readonly name = "bhashini";
  private config: BhashiniConfig;
  private sttCache = new Map<Lang, CachedService>();
  private ttsCache = new Map<Lang, CachedService>();
  private fetchImpl: typeof fetch;

  constructor(config: BhashiniConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  /** Resolve and cache the pipeline config. Call once at startup. */
  async warm(langs: Lang[] = ["en", "hi", "mr", "ta"]): Promise<void> {
    await Promise.all(
      langs.map(async (lang) => {
        try {
          await this.service("asr", lang);
          await this.service("tts", lang);
        } catch {
          // A language that fails to warm falls back to the Web Speech provider
          // at call time rather than blocking startup.
        }
      }),
    );
  }

  private async service(task: "asr" | "tts", lang: Lang): Promise<CachedService> {
    const cache = task === "asr" ? this.sttCache : this.ttsCache;
    const cached = cache.get(lang);
    if (cached) return cached;

    const code = BHASHINI_LANG[lang];
    const body = {
      pipelineTasks: [
        {
          taskType: task,
          config: task === "asr" ? { language: { sourceLanguage: code } } : { language: { sourceLanguage: code } },
        },
      ],
      pipelineRequestConfig: { pipelineId: this.config.pipelineId },
    };

    const res = await this.fetchImpl(PIPELINE_CONFIG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        userID: this.config.userId,
        ulcaApiKey: this.config.ulcaApiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`bhashini: pipeline config failed (${res.status})`);

    const json = (await res.json()) as {
      pipelineResponseConfig?: { config?: { serviceId?: string }[] }[];
      pipelineInferenceAPIEndPoint?: {
        callbackUrl?: string;
        inferenceApiKey?: { name?: string; value?: string };
      };
    };

    const serviceId = json.pipelineResponseConfig?.[0]?.config?.[0]?.serviceId;
    const endpoint = json.pipelineInferenceAPIEndPoint?.callbackUrl;
    const authKey = json.pipelineInferenceAPIEndPoint?.inferenceApiKey?.name;
    const authValue = json.pipelineInferenceAPIEndPoint?.inferenceApiKey?.value;

    if (!serviceId || !endpoint || !authKey || !authValue) {
      throw new Error("bhashini: pipeline config missing serviceId or endpoint");
    }

    const entry = { serviceId, endpoint, authKey, authValue };
    cache.set(lang, entry);
    return entry;
  }

  async stt(audio: ArrayBuffer, lang: Lang): Promise<string> {
    const svc = await this.service("asr", lang);
    const res = await this.fetchImpl(svc.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", [svc.authKey]: svc.authValue },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: "asr",
            config: {
              language: { sourceLanguage: BHASHINI_LANG[lang] },
              serviceId: svc.serviceId,
              audioFormat: "wav",
              samplingRate: 16000,
            },
          },
        ],
        inputData: { audio: [{ audioContent: toBase64(audio) }] },
      }),
    });
    if (!res.ok) throw new Error(`bhashini: asr failed (${res.status})`);
    const json = (await res.json()) as { pipelineResponse?: { output?: { source?: string }[] }[] };
    return json.pipelineResponse?.[0]?.output?.[0]?.source ?? "";
  }

  async tts(text: string, lang: Lang): Promise<ArrayBuffer> {
    const svc = await this.service("tts", lang);
    const res = await this.fetchImpl(svc.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", [svc.authKey]: svc.authValue },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: "tts",
            config: {
              language: { sourceLanguage: BHASHINI_LANG[lang] },
              serviceId: svc.serviceId,
              gender: "female",
            },
          },
        ],
        inputData: { input: [{ source: text }] },
      }),
    });
    if (!res.ok) throw new Error(`bhashini: tts failed (${res.status})`);
    const json = (await res.json()) as { pipelineResponse?: { audio?: { audioContent?: string }[] }[] };
    const b64 = json.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
    if (!b64) throw new Error("bhashini: tts returned no audio");
    return fromBase64(b64);
  }
}

/**
 * Browser-native Web Speech API. Zero setup, no credentials, no network.
 *
 * The real work happens in the browser (see `app/components/VoiceInput.tsx`);
 * this server-side stand-in exists so the interface has two implementations and
 * the switch is a config change rather than a code change.
 */
export class WebSpeechProvider implements SpeechProvider {
  readonly name = "web";
  async stt(): Promise<string> {
    throw new Error("WebSpeechProvider.stt runs in the browser — call the client-side hook instead");
  }
  async tts(): Promise<ArrayBuffer> {
    throw new Error("WebSpeechProvider.tts runs in the browser — call the client-side hook instead");
  }
}

export function selectProvider(env: Record<string, string | undefined>): SpeechProvider {
  const choice = (env.SPEECH_PROVIDER ?? "web").toLowerCase();
  if (choice === "bhashini" && env.BHASHINI_USER_ID && env.BHASHINI_API_KEY && env.BHASHINI_PIPELINE_ID) {
    return new BhashiniProvider({
      userId: env.BHASHINI_USER_ID,
      ulcaApiKey: env.BHASHINI_API_KEY,
      pipelineId: env.BHASHINI_PIPELINE_ID,
    });
  }
  return new WebSpeechProvider();
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
