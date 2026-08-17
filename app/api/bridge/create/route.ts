import { ok } from "../../_lib/respond.ts";
import {
  bridgeStore,
  newSessionId,
  qrUrlFor,
  SESSION_TTL_MS,
  suggestedPhoneHost,
} from "../../_lib/bridge-store.ts";

/**
 * POST /api/bridge/create → { session_id, qr_url, expires_at }
 *
 * The laptop calls this when the user clicks "Take from phone".
 */
export async function POST(request: Request): Promise<Response> {
  const now = Date.now();
  // Housekeeping on the way in, so expired rows never accumulate.
  const purged = bridgeStore.purgeExpired(now);

  const session_id = newSessionId();
  const expires_at = new Date(now + SESSION_TTL_MS).toISOString();

  bridgeStore.create({
    session_id,
    created_at: new Date(now).toISOString(),
    expires_at,
    status: "pending",
    consumed: 0,
  });

  const qr_url = qrUrlFor(request, session_id);

  // The server cannot discover its own LAN address — os.networkInterfaces()
  // returns [] inside the workerd sandbox — so when the page is opened on
  // localhost we report that rather than emitting a QR the phone cannot use.
  // The client then asks for the IP and rebuilds the URL. Refusing outright
  // would block the perfectly reasonable "I'm working on localhost" case.
  const host = new URL(qr_url).hostname;
  const needs_lan_host = host === "localhost" || host === "127.0.0.1";

  return ok({
    session_id,
    qr_url,
    expires_at,
    purged,
    needs_lan_host,
    // Whatever host a phone last connected on, so localhost need not ask twice.
    suggested_host: needs_lan_host ? suggestedPhoneHost() : "",
  });
}
