import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_CHAIN, GeminiVisionProvider, QuotaError } from "../resolvers/vision-providers.ts";

/**
 * The phone-bridge outage of 2026-08-18, pinned as a test.
 *
 * Google's gemini-3.6-flash began HANGING — not erroring — while every other
 * model in the chain answered in about a second. The chain only failed over on
 * QuotaError and had no per-model deadline, so one hanging model spent the
 * caller's entire 20 s budget and every photo died as "timeout". Google also
 * retired gemini-2.0/2.5-flash with 404s the same season, which the old code
 * treated as fatal rather than as a reason to try the next model.
 */

const okBody = JSON.stringify({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [{ name: "okra", est_grams: 250, confidence: 0.9 }] }) }] } }],
});

function respond(status: number, body = "{}"): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

/** A fetch that hangs until the signal aborts — Gemini's observed behaviour. */
function hangUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
}

describe("gemini chain failover", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("a hanging model is abandoned at the per-model deadline, not the request deadline", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string | URL, init?: RequestInit) => {
      const model = String(url).match(/models\/([^:]+):/)![1];
      calls.push(model);
      if (calls.length === 1) return hangUntilAborted(init); // first model hangs
      return Promise.resolve(respond(200, okBody));
    }));

    const provider = new GeminiVisionProvider("test-key");
    const promise = provider.identify("aGk=", "image/jpeg");
    await vi.advanceTimersByTimeAsync(GeminiVisionProvider.PER_MODEL_TIMEOUT_MS + 50);

    const items = await promise;
    expect(items).toEqual([{ name: "okra", est_grams: 250, confidence: 0.9 }]);
    expect(calls.length).toBe(2); // hung model abandoned, next one answered
  });

  it("a retired model's 404 fails over instead of killing the request", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve(respond(404, '{"error":{"message":"no longer available"}}'));
      return Promise.resolve(respond(200, okBody));
    }));

    const provider = new GeminiVisionProvider("test-key");
    const items = await provider.identify("aGk=", "image/jpeg");
    expect(items[0].name).toBe("okra");
    expect(call).toBe(2);
  });

  it("quota errors still walk the whole chain and surface as QuotaError at the end", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(respond(429, "quota exceeded"))));

    const provider = new GeminiVisionProvider("test-key");
    await expect(provider.identify("aGk=", "image/jpeg")).rejects.toBeInstanceOf(QuotaError);
    expect(vi.mocked(fetch).mock.calls.length).toBe(DEFAULT_MODEL_CHAIN.length);
  });

  it("the caller's own abort still ends the request immediately", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string | URL, init?: RequestInit) => hangUntilAborted(init)));

    const outer = new AbortController();
    const provider = new GeminiVisionProvider("test-key");
    const promise = provider.identify("aGk=", "image/jpeg", outer.signal);
    const failed = expect(promise).rejects.toThrow();
    outer.abort();
    await failed;
    // One call only: the outer abort must not be mistaken for a per-model
    // deadline and walk on to the remaining models.
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
  });

  it("the known-hanging model is last in the default chain", () => {
    expect(DEFAULT_MODEL_CHAIN[DEFAULT_MODEL_CHAIN.length - 1]).toBe("gemini-3.6-flash");
  });
});
