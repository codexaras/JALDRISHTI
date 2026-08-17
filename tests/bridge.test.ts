import { beforeEach, describe, expect, it } from "vitest";
import {
  bridgeStore,
  getLive,
  newSessionId,
  qrUrlFor,
  SESSION_TTL_MS,
  type BridgeSession,
} from "../app/api/_lib/bridge-store.ts";

/**
 * AMENDMENT_13 — the phone → laptop bridge.
 *
 * The first test is the one that matters. A QR encoding `localhost` sends the
 * phone to its OWN machine, where nothing is listening — and it looks perfectly
 * correct on the laptop, because on the laptop it is. That is the single most
 * likely way this feature fails in front of a room.
 */
const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

const session = (over: Partial<BridgeSession> = {}): BridgeSession => ({
  session_id: newSessionId(),
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  status: "pending",
  consumed: 0,
  ...over,
});

describe("AMENDMENT_13: QR host derivation", () => {
  it("uses the request host, never localhost", () => {
    // The laptop is reached on its LAN address, so that is what the phone needs.
    const url = qrUrlFor(req("http://192.168.1.6:3000/api/bridge/create", { host: "192.168.1.6:3000" }), "abc");
    expect(url).toBe("http://192.168.1.6:3000/mobile-scan?s=abc");
    expect(url).not.toContain("localhost");
    expect(url).not.toContain("127.0.0.1");
  });

  it("uses https when x-forwarded-proto says so", () => {
    const url = qrUrlFor(
      req("http://localhost:3000/api/bridge/create", {
        host: "demo.trycloudflare.com",
        "x-forwarded-proto": "https",
      }),
      "abc",
    );
    // Behind a tunnel the origin is HTTPS even though the local hop is HTTP —
    // and HTTPS is what gives the phone camera a secure context.
    expect(url).toBe("https://demo.trycloudflare.com/mobile-scan?s=abc");
  });

  it("never hardcodes a port", () => {
    const url = qrUrlFor(req("http://10.0.0.4:8080/x", { host: "10.0.0.4:8080" }), "s1");
    expect(url).toContain("10.0.0.4:8080");
  });
});

describe("AMENDMENT_13: session lifecycle", () => {
  beforeEach(() => bridgeStore.purgeExpired(Date.now() + SESSION_TTL_MS * 10));

  it("issues 32-character ids that are not sequential", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).toHaveLength(32);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("expires a session server-side regardless of its stored status", () => {
    const s = session({ status: "pending", expires_at: new Date(Date.now() - 1000).toISOString() });
    bridgeStore.create(s);
    // Still says "pending" in storage — expiry must be judged on the clock.
    expect(getLive(s.session_id)!.status).toBe("expired");
  });

  it("delivers a payload once, then reports it consumed", () => {
    const s = session({ status: "ready", candidates: JSON.stringify({ ok: true }) });
    bridgeStore.create(s);

    const first = getLive(s.session_id)!;
    expect(first.status).toBe("ready");
    expect(first.consumed).toBe(0);

    // The poll route marks it consumed; simulate that write.
    bridgeStore.put({ ...first, consumed: 1 });
    expect(getLive(s.session_id)!.consumed).toBe(1);
  });

  it("purges expired rows so they cannot accumulate", () => {
    bridgeStore.create(session({ expires_at: new Date(Date.now() - 1).toISOString() }));
    const live = session();
    bridgeStore.create(live);

    const removed = bridgeStore.purgeExpired(Date.now());
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(bridgeStore.get(live.session_id)).toBeTruthy();
  });

  it("returns null for an unknown session rather than inventing one", () => {
    expect(getLive("does-not-exist")).toBeNull();
  });

  it("stores the capture and nothing identifying the user", () => {
    const s = session({ status: "ready", capture_type: "barcode", payload: "8901719101007" });
    bridgeStore.create(s);
    const stored = bridgeStore.get(s.session_id)!;
    for (const key of Object.keys(stored)) {
      expect(key).not.toMatch(/user|email|phone|device|ip|name/i);
    }
    // Barcode mode carries the decoded string, not an image.
    expect(stored.payload).toBe("8901719101007");
    expect(stored.payload!.length).toBeLessThan(20);
  });
});
