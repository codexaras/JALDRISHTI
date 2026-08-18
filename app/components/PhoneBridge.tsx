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
import { useLang } from "../lib/i18n-client.tsx";
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
  const { t, lang } = useLang();
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
      if (!res.ok) { setStatus("error"); setError(body.error ?? "bridge.createFail"); return; }
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
      setError("bridge.serverFail");
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
  // A bare IP (or .local name) is a LAN address — plain http. Anything with a
  // real domain is a tunnel (npm run tunnel → xxx.trycloudflare.com), which
  // serves https and works from ANY network — the venue-WiFi/firewall escape
  // hatch. https also unlocks the phone's in-browser barcode camera.
  const isLan = /^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(host) || /\.local(:\d+)?$/.test(host);
  const baseUrl = needsHost
    ? (host ? `${isLan ? "http" : "https"}://${host}/mobile-scan?s=${sessionId}` : "")
    : qrUrl;
  // The QR carries the laptop's language, so the phone page opens in the
  // language the demo is being given in.
  const effectiveUrl = baseUrl ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}lang=${lang}` : "";
  const live = status === "pending" || status === "connected" || status === "processing";

  return (
    <>
      <button className="phoneCta" onClick={() => { setOpen(true); void createSession(); }}>
        <Smartphone size={20} strokeWidth={2} aria-hidden="true" />
        <span>
          <b>{t("bridge.cta")}</b>
          <small>{t("bridge.ctaHint")}</small>
        </span>
      </button>

      {open && (
        <div className="modalShade" role="dialog" aria-modal="true" aria-label={t("bridge.cta")}>
          <div className="bottomSheet bridgeSheet">
            <button className="close" onClick={close} aria-label={t("a11y.close")}>
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className="success">{t("bridge.title").toUpperCase()}</span>

            {status === "error" && (
              <>
                {/* `error` is an i18n key for our failures, a raw string when
                    the server body carried its own message. */}
                <p className="bridgeErr">{error.startsWith("bridge.") ? t(error) : error}</p>
                <button className="primary" onClick={() => void createSession()}>{t("state.retry")}</button>
              </>
            )}

            {status === "expired" && (
              <>
                <p className="bridgeErr">{t("bridge.expired")}</p>
                <button className="primary" onClick={() => void createSession()}>{t("bridge.newCode")}</button>
              </>
            )}

            {status === "creating" && <p className="bridgeNote">{t("bridge.preparing")}</p>}

            {live && needsHost && (
              <label className="bridgeUrl">
                {host ? t("bridge.hostEdit") : t("bridge.hostNeeded")}
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
                {status === "pending" && <p className="bridgeNote pulse">{t("bridge.waiting", { time: mmss })}</p>}
                {status === "connected" && <p className="bridgeNote ok">📱 {t("bridge.connected")}</p>}
                {status === "processing" && <p className="bridgeNote"><span className="spinner" /> {t("bridge.reading")}</p>}

                <label className="bridgeUrl">
                  {t("bridge.openOnPhone")}
                  <input readOnly value={effectiveUrl} onFocus={(e) => e.currentTarget.select()} />
                </label>
              </>
            )}

            <button className="bridgeAlt" onClick={() => { close(); onUseComputerCamera(); }}>
              {t("bridge.useComputer")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
