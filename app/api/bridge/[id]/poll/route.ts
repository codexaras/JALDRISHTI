import { bad, ok } from "../../../_lib/respond.ts";
import { bridgeStore, getLive } from "../../../_lib/bridge-store.ts";

/**
 * GET /api/bridge/:id/poll — the laptop asks whether anything has arrived.
 *
 * Single delivery: the first poll that returns a payload marks it consumed, so
 * a stale tab cannot replay someone's capture, and the laptop cannot re-open
 * the same confirmation twice.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = getLive(id);
  if (!session) return bad("session not found", 404);

  if (session.status === "expired") {
    return ok({ status: "expired", expires_at: session.expires_at });
  }

  if (session.status === "ready") {
    if (session.consumed === 1) {
      return ok({ status: "consumed", expires_at: session.expires_at });
    }
    bridgeStore.put({ ...session, consumed: 1 });
    return ok({
      status: "ready",
      capture_type: session.capture_type,
      candidates: session.candidates ? JSON.parse(session.candidates) : null,
      expires_at: session.expires_at,
    });
  }

  return ok({ status: session.status, expires_at: session.expires_at });
}
