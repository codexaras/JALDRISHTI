"use client";

/**
 * "Take from phone" — the desktop half of the bridge (AMENDMENT_13 §3).
 *
 * The phone is the primary camera; the laptop webcam stays available beneath
 * it. This dialog shows a QR, polls, and hands the candidates to the existing
 * confirmation modal the moment they arrive.
 *
 * Three bugs this file has already been through, all worth keeping in mind:
 *
 *  1. The poll effect listed `onCandidates` and `status` as dependencies. The
 *     parent re-renders every 4.2 s (a rotating quote), producing a fresh
 *     callback identity each time, which tore down and recreated the interval
 *     — and `setInterval` does not fire until one full period has elapsed, so
 *     a delivery could be missed indefinitely. The callback now lives in a ref
 *     and the loop is created ONCE per session.
 *
 *  2. `setInterval` alone means a 1.5 s dead start. It now polls immediately
 *     and then on the interval.
 *
 *  3. On a phone this control is meaningless — you are already holding the
 *     camera. It is hidden there, so the QR appears on the laptop only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, X } from "lucide-react";
import type { ResolveResult } from "../lib/client.ts";

type Status = "creating" | "pending" | "connected" | "processing" | "expired" | "error";

const POLL_MS = 1500;

/**
 * The LAN address, remembered between sessions.
 *
 * The server cannot discover its own LAN IP — os.networkInterfaces() returns []
 * inside the workerd sandbox — so on localhost the host has to come from the
 * user. Asking every single time would be worse than the original bug: the QR
 * would appear to have vanished. It is asked once and remembered.
 */
const HOST_KEY = "jaldrishti.lanHost";

function rememberedHost(): string {
  try {
    return window.localStorage.getItem(HOST_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Rough, and only used to hide a control that makes no sense on a handset. */
function isHandheld(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function PhoneBridge({
  onCandidates,
  onUseComputerCamera,
}: {
  onCandidates: (resolved: ResolveResult) => void;
  onUseComputerCamera: () => void;
}) {
  const [handheld, setHandheld] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("creating");
  const [sessionId, setSessionId] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [needsHost, setNeedsHost] = useState(false);
  const [lanHost, setLanHost] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState("");

  const timer = useRef<number | null>(null);
  // Held in a ref so a new callback identity never restarts the poll loop.
  const deliver = useRef(onCandidates);
  useEffect(() => { deliver.current = onCandidates; }, [onCandidates]);

  // Deferred: a synchronous setState in an effect cascades renders.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) setHandheld(isHandheld()); });
    return () => { cancelled = true; };
  }, []);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const createSession = useCallback(async () => {
    stopPolling();
    setStatus("creating");
    setError("");
    // Restore the address used last time, so the QR renders straight away.
    setLanHost((current) => current || rememberedHost());
    try {
      const res = await fetch("/api/bridge/create", { method: "POST" });
      const body = await res.json();
      if (!res.ok) { setStatus("error"); setError(body.error ?? "Could not create a session."); return; }
      setSessionId(body.session_id);
      setQrUrl(body.qr_url);
      setNeedsHost(Boolean(body.needs_lan_host));
      // Prefer what a phone actually connected on before falling back to
      // whatever was typed here previously.
      if (body.suggested_host) setLanHost((current) => current || String(body.suggested_host));
      setExpiresAt(Date.parse(body.expires_at));
      setStatus("pending");
    } catch {
      setStatus("error");
      setError("Could not reach the server.");
    }
  }, [stopPolling]);

  /**
   * One loop per session. Deliberately NOT dependent on `status` — restarting
   * the interval every time the status changed was how deliveries got lost.
   */
  useEffect(() => {
    if (!open || !sessionId) return;

    let done = false;
    const tick = async () => {
      if (done) return;
      try {
        const res = await fetch(`/api/bridge/${sessionId}/poll`);
        if (!res.ok) return;
        const body = await res.json();

        if (body.status === "expired") { done = true; stopPolling(); setStatus("expired"); return; }
        if (body.status === "ready" && body.candidates) {
          done = true;
          stopPolling();
          setOpen(false);
          deliver.current(body.candidates as ResolveResult);
          return;
        }
        if (body.status === "connected") setStatus("connected");
        else if (body.status === "processing") setStatus("processing");
      } catch {
        /* a dropped poll is not fatal — the next tick retries */
      }
    };

    void tick();                                   // no 1.5 s dead start
    timer.current = window.setInterval(tick, POLL_MS);
    return () => { done = true; stopPolling(); };
  }, [open, sessionId, stopPolling]);

  // Remember the address as it is typed, so next time the QR is immediate.
  useEffect(() => {
    const clean = lanHost.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!clean) return;
    try {
      window.localStorage.setItem(HOST_KEY, clean);
    } catch {
      /* private browsing — the QR still works for this session */
    }
  }, [lanHost]);

  useEffect(() => {
    if (!open || !expiresAt) return;
    const t = window.setInterval(() => {
      const left = Math.max(0, expiresAt - Date.now());
      setRemaining(left);
      if (left === 0) { stopPolling(); setStatus("expired"); }
    }, 1000);
    return () => window.clearInterval(t);
  }, [open, expiresAt, stopPolling]);

  // Meaningless on a handset — you are already holding the camera.
  if (handheld) return null;

  const close = () => { stopPolling(); setOpen(false); };
  const mmss = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;

  // On localhost the server cannot know its own LAN address, so the host comes
  // from the user; only the session id is server-issued.
  const host = lanHost.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const effectiveUrl = needsHost
    ? (host ? `http://${host}/mobile-scan?s=${sessionId}` : "")
    : qrUrl;
  const live = status === "pending" || status === "connected" || status === "processing";

  return (
    <>
      <button className="phoneCta" onClick={() => { setOpen(true); void createSession(); }}>
        <Smartphone size={20} strokeWidth={2} aria-hidden="true" />
        <span>
          <b>Take from phone</b>
          <small>Better camera — the result appears here</small>
        </span>
      </button>

      {open && (
        <div className="modalShade" role="dialog" aria-modal="true" aria-label="Take from phone">
          <div className="bottomSheet bridgeSheet">
            <button className="close" onClick={close} aria-label="Close">
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className="success">TAKE A PHOTO WITH YOUR PHONE</span>

            {status === "error" && (
              <>
                <p className="bridgeErr">{error}</p>
                <button className="primary" onClick={() => void createSession()}>Try again</button>
              </>
            )}

            {status === "expired" && (
              <>
                <p className="bridgeErr">This code expired.</p>
                <button className="primary" onClick={() => void createSession()}>Generate new code</button>
              </>
            )}

            {status === "creating" && <p className="bridgeNote">Preparing…</p>}

            {live && needsHost && (
              <label className="bridgeUrl">
                {host
                  ? "Phone address (edit if your laptop's IP changed):"
                  : "This page is open on localhost, which your phone cannot reach. Enter your laptop's address (ipconfig → IPv4):"}
                <input
                  value={lanHost}
                  onChange={(e) => setLanHost(e.target.value)}
                  placeholder="192.168.1.6:3000"
                />
              </label>
            )}

            {live && effectiveUrl && (
              <>
                <div className={`bridgeQr ${status !== "pending" ? "dim" : ""}`}>
                  <QRCodeSVG value={effectiveUrl} size={196} level="M" />
                </div>
                {status === "pending" && <p className="bridgeNote pulse">Waiting for phone… · expires in {mmss}</p>}
                {status === "connected" && <p className="bridgeNote ok">📱 Phone connected — take your photo</p>}
                {status === "processing" && <p className="bridgeNote"><span className="spinner" /> Reading your photo…</p>}

                <label className="bridgeUrl">
                  Or open on your phone:
                  <input readOnly value={effectiveUrl} onFocus={(e) => e.currentTarget.select()} />
                </label>
              </>
            )}

            <button className="bridgeAlt" onClick={() => { close(); onUseComputerCamera(); }}>
              Use this computer&apos;s camera instead
            </button>
          </div>
        </div>
      )}
    </>
  );
}
