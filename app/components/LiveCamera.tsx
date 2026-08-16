"use client";

/**
 * Live camera preview for the scan screen.
 *
 * Replaces the mock's static "RICE" blob with a real `getUserMedia` stream, a
 * shutter that captures the current frame, and an upload path for when the
 * camera is unavailable.
 *
 * Rule 3: renders inside the existing `.scanFrame` and reuses `.shutter`,
 * `.upload` and `.scanline`. No existing class was changed.
 *
 * ⚠ `getUserMedia` requires a **secure context**. It works on `localhost` and
 * over `https://`, and is blocked on a plain `http://192.168.x.x` LAN address
 * with no error event — which is why `unsupported` is reported explicitly here
 * rather than left as a silent dead button.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "starting" | "live" | "denied" | "unsupported" | "insecure";

/** JPEG quality for the captured frame — enough detail to identify, small enough to POST. */
const CAPTURE_QUALITY = 0.85;
const MAX_EDGE = 1568;

export function LiveCamera({
  onCapture,
  busy,
  autoStart = true,
}: {
  onCapture: (base64: string, mediaType: string) => void;
  busy?: boolean;
  autoStart?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [note, setNote] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    // A secure context is the usual reason this fails, and the browser gives no
    // useful error for it — so check first and say so plainly.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setStatus("insecure");
      setNote(
        "The camera needs a secure connection. Open the site over https:// (or on localhost) and it will work.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setNote("This browser cannot open a camera. Upload a photo instead.");
      return;
    }

    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("live");
      setNote("");
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setStatus(name === "NotAllowedError" ? "denied" : "unsupported");
      setNote(
        name === "NotAllowedError"
          ? "Camera permission was blocked. Allow it in the address bar, or upload a photo."
          : "No camera available on this device. Upload a photo instead.",
      );
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the effect body performs no synchronous state write —
    // `start()` sets status immediately on the secure-context and support checks.
    let cancelled = false;
    if (autoStart) void Promise.resolve().then(() => { if (!cancelled) void start(); });
    return () => { cancelled = true; stop(); };
  }, [autoStart, start, stop]);

  /** Grab the current frame, downscale it, hand it up as base64. */
  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || status !== "live") return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // Cap the long edge — a 4K frame is slower to upload with no accuracy gain.
    const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", CAPTURE_QUALITY);
    onCapture(dataUrl.slice(dataUrl.indexOf(",") + 1), "image/jpeg");
  }, [onCapture, status]);

  const readFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const d = String(reader.result);
        onCapture(d.slice(d.indexOf(",") + 1), file.type || "image/jpeg");
      };
      reader.readAsDataURL(file);
    },
    [onCapture],
  );

  const live = status === "live";

  return (
    <>
      <div className="cameraTop">
        <span>
          {live ? "● Camera live" : status === "starting" ? "○ Starting camera…" : "○ Camera off"}
        </span>
        {live && (
          <button onClick={() => { stop(); setStatus("idle"); }} aria-label="Turn camera off" title="Turn camera off">
            ⏻
          </button>
        )}
      </div>

      <div className="scanFrame">
        <i /><i /><i /><i />
        {busy && <b className="scanline" />}

        <video
          ref={videoRef}
          muted
          playsInline
          className="camFeed"
          style={{ display: live ? "block" : "none" }}
        />

        {!live && (
          <div className="camPlaceholder">
            {status === "starting" ? (
              <><div className="spinner" /><p>Starting the camera…</p></>
            ) : (
              <>
                <span>◎</span>
                <p>{note || "The camera is off."}</p>
                <button className="camStart" onClick={() => void start()}>
                  Open camera
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <p>
        {busy
          ? "Identifying product…"
          : live
            ? "Place one product inside the frame, then tap the shutter"
            : "Turn the camera on, or upload a photo"}
      </p>

      <button
        className="shutter"
        onClick={capture}
        disabled={!live || busy}
        aria-label="Capture photo"
        style={!live || busy ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
      >
        <i />
      </button>

      <label className="upload" style={{ cursor: "pointer" }}>
        Upload an image
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
            e.target.value = "";
          }}
        />
      </label>
    </>
  );
}
