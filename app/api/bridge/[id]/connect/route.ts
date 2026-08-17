import { bad, ok } from "../../../_lib/respond.ts";
import { bridgeStore, getLive, rememberPhoneHost } from "../../../_lib/bridge-store.ts";

/** POST /api/bridge/:id/connect — the phone has opened the capture page. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // The phone just told us the LAN address that works — remember it so a
  // localhost laptop page can offer it as the QR host without being asked.
  rememberPhoneHost(request.headers.get("host"));

  const { id } = await params;
  const session = getLive(id);
  if (!session) return bad("session not found", 404);
  if (session.status === "expired") return bad("session expired", 410);

  // Only pending advances — a reconnect must not rewind a capture already sent.
  if (session.status === "pending") {
    bridgeStore.put({ ...session, status: "connected" });
  }
  return ok({ status: "connected", expires_at: session.expires_at });
}
