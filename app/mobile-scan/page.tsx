"use client";

/**
 * The phone capture page — AMENDMENT_13 §4.
 *
 * One job: take a capture and hand it to the laptop. It NEVER renders a water
 * footprint. That separation is the whole point of the feature — the room is
 * looking at the laptop, so the answer belongs there.
 *
 * Rule 3: this is a new standalone route, so nothing existing is restyled.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ScanBarcode, Check, RotateCcw } from "lucide-react";

type Phase = "checking" | "invalid" | "ready" | "sending" | "sent" | "error";

/** Longest edge 1024, JPEG 0.85 — a 4 MB phone photo becomes roughly 200 KB. */
async function shrink(file: Blob): Promise<{ base64: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.split(",")[1] ?? "", width: w, height: h };
}

export default function MobileScan() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [note, setNote] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  // Validate the session BEFORE anything touches the camera. A permission
  // prompt on a dead session is the most confusing possible failure (§4).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("s");
    let cancelled = false;
    if (!id) {
      // Deferred: setting state synchronously inside an effect cascades renders.
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setPhase("invalid");
        setNote("No session in this link.");
      });
      return () => { cancelled = true; };
    }
    void fetch(`/api/bridge/${id}/connect`, { method: "POST" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) { setSessionId(id); setPhase("ready"); return; }
        const body = await r.json().catch(() => ({}));
        setPhase("invalid");
        setNote(r.status === 410 ? "This code has expired." : (body.error ?? "Session not found."));
      })
      .catch(() => { if (!cancelled) { setPhase("invalid"); setNote("Could not reach the computer."); } });
    return () => { cancelled = true; };
  }, []);

  const send = useCallback(async (type: "image" | "barcode", value: string) => {
    if (!sessionId) return;
    setPhase("sending");
    try {
      const res = await fetch(`/api/bridge/${sessionId}/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, value, media_type: "image/jpeg" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPhase("error");
        setNote(body.error ?? "The computer could not read that.");
        return;
      }
      setPhase("sent");
    } catch {
      setPhase("error");
      setNote("Lost connection to the computer.");
    }
  }, [sessionId]);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    const shrunk = await shrink(file);
    if (shrunk.width < 200 || shrunk.height < 200) {
      setNote("That image is too small to read. Move closer and try again.");
      return;
    }
    await send("image", shrunk.base64);
  };

  const startBarcode = async () => {
    setScanning(true);
    setNote("");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("barcodeBox");
      scannerRef.current = scanner as unknown as { stop: () => Promise<void>; clear: () => void };
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 160 } },
        async (decoded: string) => {
          // Only the decoded string travels — 13 characters, not a photo of a
          // barcode. Faster and far more reliable than re-reading an image.
          await scanner.stop().catch(() => {});
          scanner.clear();
          setScanning(false);
          await send("barcode", decoded);
        },
        () => {},
      );
    } catch {
      setScanning(false);
      setNote("Could not open the camera for barcodes. Use Photo instead.");
    }
  };

  useEffect(() => () => { void scannerRef.current?.stop().catch(() => {}); }, []);

  if (phase === "checking") return <main className="mScan"><p className="mNote">Connecting…</p></main>;

  if (phase === "invalid") {
    return (
      <main className="mScan">
        <header className="mHead"><b>JalDrishti</b></header>
        <div className="mCenter">
          <h1>Can&apos;t use this link</h1>
          <p className="mNote">{note}</p>
          <p className="mNote">Generate a new code on the computer and scan it again.</p>
        </div>
      </main>
    );
  }

  if (phase === "sent") {
    return (
      <main className="mScan">
        <header className="mHead"><b>JalDrishti</b> · Connected</header>
        <div className="mCenter">
          <span className="mTick"><Check size={44} strokeWidth={2.5} /></span>
          <h1>Sent to your computer</h1>
          <p className="mNote">The result is on the laptop screen.</p>
          <button className="mBtn" onClick={() => { setPhase("ready"); setNote(""); }}>
            <RotateCcw size={18} strokeWidth={2} /> Scan another
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mScan">
      <header className="mHead"><b>JalDrishti</b> · Connected</header>

      <div id="barcodeBox" className="mView" style={scanning ? undefined : { display: "none" }} />
      {!scanning && (
        <div className="mView mIdle">
          <Camera size={54} strokeWidth={1.5} />
          <p>Point at one product</p>
        </div>
      )}

      {note && <p className="mNote">{note}</p>}
      {phase === "sending" && <p className="mNote">Sending…</p>}

      <div className="mActions">
        <label className="mBtn primary">
          <Camera size={22} strokeWidth={2} /> Photo
          <input type="file" accept="image/*" capture="environment" hidden
                 onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <button className="mBtn" onClick={startBarcode} disabled={scanning}>
          <ScanBarcode size={22} strokeWidth={2} /> Barcode
        </button>
      </div>
    </main>
  );
}
