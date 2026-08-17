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
import { useLang } from "../lib/i18n-client.tsx";
import { LANGS } from "../../i18n/index.ts";
import type { Lang } from "../../engine/types.ts";

type Phase = "checking" | "invalid" | "ready" | "sending" | "sent" | "error";

/**
 * `note` holds an i18n KEY when the message is ours, or a raw string when it
 * came from the server body. Rendering resolves the first and passes the
 * second through — so a translated UI never blocks a server detail.
 */
const noteText = (t: (k: string) => string, note: string) =>
  note.startsWith("phone.") ? t(note) : note;

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
  const { t, setLang } = useLang();
  const [phase, setPhase] = useState<Phase>("checking");
  const [note, setNote] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  // Validate the session BEFORE anything touches the camera. A permission
  // prompt on a dead session is the most confusing possible failure (§4).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // The QR carries the laptop's language, so the phone page opens in the
    // language the demo is being given in — the phone has no switcher.
    const qrLang = params.get("lang");
    if (qrLang && (LANGS as string[]).includes(qrLang)) setLang(qrLang as Lang);

    const id = params.get("s");
    let cancelled = false;
    if (!id) {
      // Deferred: setting state synchronously inside an effect cascades renders.
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setPhase("invalid");
        setNote("phone.noSession");
      });
      return () => { cancelled = true; };
    }
    void fetch(`/api/bridge/${id}/connect`, { method: "POST" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) { setSessionId(id); setPhase("ready"); return; }
        const body = await r.json().catch(() => ({}));
        setPhase("invalid");
        setNote(r.status === 410 ? "phone.expired" : (body.error ?? "phone.notFound"));
      })
      .catch(() => { if (!cancelled) { setPhase("invalid"); setNote("phone.unreachable"); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once; setLang is stable
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
        setNote(body.error ?? "phone.pushFail");
        return;
      }
      setPhase("sent");
    } catch {
      setPhase("error");
      setNote("phone.lost");
    }
  }, [sessionId]);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    const shrunk = await shrink(file);
    if (shrunk.width < 200 || shrunk.height < 200) {
      setNote("phone.tooSmall");
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
      setNote("phone.barcodeFail");
    }
  };

  useEffect(() => () => { void scannerRef.current?.stop().catch(() => {}); }, []);

  if (phase === "checking") return <main className="mScan"><p className="mNote">{t("phone.connecting")}</p></main>;

  if (phase === "invalid") {
    return (
      <main className="mScan">
        <header className="mHead"><b>JalDrishti</b></header>
        <div className="mCenter">
          <h1>{t("phone.invalidTitle")}</h1>
          <p className="mNote">{noteText(t, note)}</p>
          <p className="mNote">{t("phone.regenerate")}</p>
        </div>
      </main>
    );
  }

  if (phase === "sent") {
    return (
      <main className="mScan">
        <header className="mHead"><b>JalDrishti</b> · {t("phone.connected")}</header>
        <div className="mCenter">
          <span className="mTick"><Check size={44} strokeWidth={2.5} /></span>
          <h1>{t("phone.sentTitle")}</h1>
          <p className="mNote">{t("phone.sentBody")}</p>
          <button className="mBtn" onClick={() => { setPhase("ready"); setNote(""); }}>
            <RotateCcw size={18} strokeWidth={2} /> {t("phone.again")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mScan">
      <header className="mHead"><b>JalDrishti</b> · {t("phone.connected")}</header>

      <div id="barcodeBox" className="mView" style={scanning ? undefined : { display: "none" }} />
      {!scanning && (
        <div className="mView mIdle">
          <Camera size={54} strokeWidth={1.5} />
          <p>{t("phone.point")}</p>
        </div>
      )}

      {note && <p className="mNote">{noteText(t, note)}</p>}
      {phase === "sending" && <p className="mNote">{t("phone.sending")}</p>}

      <div className="mActions">
        <label className="mBtn primary">
          <Camera size={22} strokeWidth={2} /> {t("phone.photo")}
          <input type="file" accept="image/*" capture="environment" hidden
                 onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <button className="mBtn" onClick={startBarcode} disabled={scanning}>
          <ScanBarcode size={22} strokeWidth={2} /> {t("search.barcode")}
        </button>
      </div>
    </main>
  );
}
