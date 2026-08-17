/**
 * Phone → laptop capture sessions — AMENDMENT_13 §5.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ STORAGE: THE SPEC ASKS FOR SQLITE. THIS RUNTIME CANNOT PROVIDE IT.
 *
 * §1 requires session state in SQLite so it survives a dev-server restart. That
 * is not achievable here, and it was measured rather than assumed:
 *
 *   node:fs     writeFileSync  →  "operation not permitted"
 *   node:sqlite DatabaseSync   →  "Illegal constructor"   (file AND :memory:)
 *
 * The app runs inside workerd, which sandboxes disk access. Cloudflare's own
 * store is D1, and no D1 binding is provisioned (`hosting.json` → d1: none).
 *
 * So this is an in-memory Map behind a narrow interface. A dev-server restart
 * drops open sessions; since they expire after ten minutes anyway, the recovery
 * is the same as an expiry — the laptop shows "code expired" and offers a new
 * one. Adding a D1 binding later means implementing `BridgeStore` against it
 * and changing the one line at the bottom of this file. Nothing else moves.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type BridgeStatus = "pending" | "connected" | "processing" | "ready" | "expired";
export type CaptureType = "image" | "barcode";

export interface BridgeSession {
  session_id: string;
  created_at: string;
  expires_at: string;
  status: BridgeStatus;
  capture_type?: CaptureType;
  /** base64 image or the decoded barcode string. */
  payload?: string;
  /** Resolver output, serialised. Never a calculated result. */
  candidates?: string;
  consumed: number;
}

export interface BridgeStore {
  create(session: BridgeSession): void;
  get(id: string): BridgeSession | undefined;
  put(session: BridgeSession): void;
  purgeExpired(now: number): number;
}

class MemoryStore implements BridgeStore {
  private rows = new Map<string, BridgeSession>();

  create(session: BridgeSession): void {
    this.rows.set(session.session_id, session);
  }
  get(id: string): BridgeSession | undefined {
    return this.rows.get(id);
  }
  put(session: BridgeSession): void {
    this.rows.set(session.session_id, session);
  }
  /** Called on every create, so expired rows never accumulate — no cron needed. */
  purgeExpired(now: number): number {
    let removed = 0;
    for (const [id, s] of this.rows) {
      if (Date.parse(s.expires_at) <= now) {
        this.rows.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

export const bridgeStore: BridgeStore = new MemoryStore();

export const SESSION_TTL_MS = 10 * 60 * 1000;

/**
 * The host a phone last reached us on.
 *
 * The laptop should be opened on localhost — it is the only origin Chrome
 * treats as secure over plain HTTP, so the laptop camera and microphone work
 * there and are hard-blocked on http://192.168.x.x. But the server cannot
 * discover its own LAN address (os.networkInterfaces() is empty in the workerd
 * sandbox), so a localhost page has no host to put in the QR.
 *
 * The phone knows it. Its /connect request carries the exact host it dialled,
 * so we remember that and offer it as the default next time. After one
 * successful connection the QR needs no typing again, even from a fresh
 * browser profile with no localStorage.
 */
let lastPhoneHost = "";

export function rememberPhoneHost(host: string | null): void {
  if (!host) return;
  const clean = host.trim().toLowerCase();
  // Never remember loopback — that is the value we are trying to replace.
  if (!clean || clean.startsWith("localhost") || clean.startsWith("127.0.0.1")) return;
  lastPhoneHost = clean;
}

export function suggestedPhoneHost(): string {
  return lastPhoneHost;
}

/**
 * 32 hex characters from the platform CSPRNG.
 *
 * This id is a bearer token that travels in a URL and in a QR code anyone in
 * the room can photograph, so it must not be guessable or sequential.
 */
export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetch a session, enforcing expiry on EVERY request rather than trusting the
 * stored status — a row can sit at "pending" long after its window closed.
 */
export function getLive(id: string, now = Date.now()): BridgeSession | null {
  const session = bridgeStore.get(id);
  if (!session) return null;
  if (Date.parse(session.expires_at) <= now) {
    if (session.status !== "expired") bridgeStore.put({ ...session, status: "expired" });
    return { ...session, status: "expired" };
  }
  return session;
}

/**
 * Build the URL the phone opens, from the REQUEST — never from a constant.
 *
 * This is the single most likely way the feature fails. A QR encoding
 * `localhost` sends the phone to its *own* localhost, where nothing is running.
 * It looks perfectly correct on the laptop, because on the laptop it is.
 *
 * Deriving host and protocol from the incoming request means the same code
 * works on a LAN IP and behind an HTTPS tunnel with no change.
 */
export function qrUrlFor(request: Request, sessionId: string): string {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}/mobile-scan?s=${sessionId}`;
}
