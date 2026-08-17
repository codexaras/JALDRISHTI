/**
 * Pre-demo check for the phone → laptop bridge.
 *
 *   npm run preflight
 *
 * Every check here corresponds to something that actually broke during
 * development. It is meant to be run twice: once the night before, and once in
 * the room on the real network, because the two most dangerous failures —
 * client isolation and a changed IP — only appear at the venue.
 *
 * Run the dev server first, in another terminal.
 */
import { networkInterfaces } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
let failures = 0;
let warnings = 0;

const pass = (label, detail = "") => console.log(`  PASS  ${label.padEnd(42)}${detail}`);
const fail = (label, detail = "") => { failures++; console.log(`  FAIL  ${label.padEnd(42)}${detail}`); };
const warn = (label, detail = "") => { warnings++; console.log(`  WARN  ${label.padEnd(42)}${detail}`); };

const get = async (url, opts = {}) =>
  fetch(url, { signal: AbortSignal.timeout(8000), ...opts });

console.log("\nJalDrishti — phone bridge preflight\n");

// ── 1. LAN addresses ────────────────────────────────────────────────────────
// Read from Node, which CAN see the interfaces — the app itself cannot, because
// workerd sandboxes os.networkInterfaces().
const ips = [];
for (const list of Object.values(networkInterfaces() ?? {})) {
  for (const n of list ?? []) {
    if (n.family === "IPv4" && !n.internal) ips.push(n.address);
  }
}
if (ips.length === 0) fail("laptop has a LAN address", "not connected to any network");
else pass("laptop LAN address", ips.join(", "));

// ── 2. Server up on localhost ───────────────────────────────────────────────
let serverUp = false;
try {
  const r = await get(`http://localhost:${PORT}/api/health`);
  serverUp = r.ok;
  if (serverUp) pass("server on localhost", `:${PORT}`);
  else fail("server on localhost", `HTTP ${r.status}`);
} catch {
  fail("server on localhost", `nothing listening on :${PORT} — run "npm run dev"`);
}

// ── 3. Server reachable on the LAN (this is what the phone dials) ───────────
let reachableIp = "";
for (const ip of ips) {
  try {
    const r = await get(`http://${ip}:${PORT}/api/health`);
    if (r.ok) { reachableIp = `${ip}:${PORT}`; break; }
  } catch { /* try the next interface */ }
}
if (reachableIp) pass("server reachable on the LAN", `http://${reachableIp}`);
else if (serverUp) fail("server reachable on the LAN", "bound to localhost only, or blocked by the firewall");

// ── 4. QR generation, and that it never encodes localhost ───────────────────
if (reachableIp) {
  try {
    const r = await get(`http://${reachableIp}/api/bridge/create`, { method: "POST" });
    const body = await r.json();
    if (!r.ok) fail("QR session creates", body.error ?? `HTTP ${r.status}`);
    else if (/localhost|127\.0\.0\.1/.test(body.qr_url)) fail("QR does not encode localhost", body.qr_url);
    else {
      pass("QR encodes the LAN host", body.qr_url.replace(/\?s=.*/, "?s=…"));

      // ── 5. Full bridge round-trip ──────────────────────────────────────
      const id = body.session_id;
      await get(`http://${reachableIp}/api/bridge/${id}/connect`, { method: "POST" });
      const push = await get(`http://${reachableIp}/api/bridge/${id}/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "barcode", value: "8901719101007", lang: "en" }),
      });
      const poll = await (await get(`http://${reachableIp}/api/bridge/${id}/poll`)).json();
      if (push.ok && poll.status === "ready") pass("bridge round-trip", `delivered "${poll.candidates?.name ?? "?"}"`);
      else fail("bridge round-trip", `push ${push.status}, poll ${poll.status}`);
    }
  } catch (e) {
    fail("QR session creates", e.message);
  }
}

// ── 6. The phone page loads ─────────────────────────────────────────────────
if (reachableIp) {
  try {
    const r = await get(`http://${reachableIp}/mobile-scan?s=preflight`);
    if (r.ok) pass("phone capture page serves");
    else fail("phone capture page serves", `HTTP ${r.status}`);
  } catch (e) { fail("phone capture page serves", e.message); }
}

// ── 7. Vision quota — the camera is useless without it ──────────────────────
if (serverUp) {
  try {
    const tiny = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const r = await (await get(`http://localhost:${PORT}/api/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input_type: "image", image: tiny, media_type: "image/png", lang: "en" }),
    })).json();
    if (r.error === "quota") fail("vision quota", "exhausted for today — barcode and search still work");
    else if (r.error === "not_configured") warn("vision configured", "no GEMINI_API_KEY in .env.local");
    else pass("vision reachable", "quota healthy");
  } catch (e) { warn("vision reachable", e.message); }
}

// ── 8. Offline fallback ─────────────────────────────────────────────────────
const demoFile = join(process.cwd(), "data", "demo", "barcodes.json");
if (existsSync(demoFile)) {
  const n = Object.keys(JSON.parse(readFileSync(demoFile, "utf8"))).length;
  if (n > 0) pass("offline demo cache", `${n} barcodes for ?demo=true`);
  else warn("offline demo cache", "empty");
} else warn("offline demo cache", "missing — run npm run demo:build");

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? "READY" : "NOT READY"} — ${failures} failure(s), ${warnings} warning(s)`);

if (reachableIp) {
  console.log(`\nOpen on the laptop:  http://localhost:${PORT}`);
  console.log(`Phone will dial:     http://${reachableIp}`);
  console.log("\nThe one thing this cannot test for you: whether the venue router");
  console.log("isolates clients. If the phone loads nothing at that address on the");
  console.log("day, switch to a laptop hotspot — that is a network you control.");
}
process.exit(failures === 0 ? 0 : 1);
