"use client";

/**
 * Barcode entry — AMENDMENT_02 §5: "barcode ships before photo."
 *
 * ~99% reliable against ~75% for a photo, and it returns the manufacturer's
 * declared ingredient list, which recognition cannot. It is both the stronger
 * foundation and the better demo opener.
 *
 * Uses the browser's native BarcodeDetector where available (Chrome/Edge on
 * Android and desktop) and falls back to typing the number off the packet —
 * which always works, needs no permission, and cannot fail on stage.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, ScanBarcode, X } from "lucide-react";
import { useLang } from "../lib/i18n-client.tsx";

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

export function BarcodeInput({
  onScan,
  label,
  open: openProp,
  onOpenChange,
  triggerless = false,
}: {
  onScan: (ean: string) => void;
  label?: string;
  /** Controlled open state — the search bar's chooser drives this. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render the modal only. The chooser is the single entry point now, so a
      second trigger beside it would be the very duplication AMENDMENT_10 removes. */
  triggerless?: boolean;
}) {
  const { t } = useLang();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => { setOpenState(v); onOpenChange?.(v); };
  const [manual, setManual] = useState("");
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => stop, []);

  const startCamera = async () => {
    const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor) {
      setNote("This browser cannot read barcodes from the camera. Type the number instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      setNote("");

      const detector = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          if (found.length > 0) {
            stop();
            setOpen(false);
            onScan(found[0].rawValue);
            return;
          }
        } catch {
          /* a frame that fails to decode is normal — keep looking */
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setNote("Camera permission denied. Type the number off the packet instead.");
    }
  };

  return (
    <>
      {!triggerless && (
        <button
          className="scanSearch"
          onClick={() => setOpen(true)}
          aria-label={t("search.chooser_barcode")}
          type="button"
        >
          <ScanBarcode size={16} strokeWidth={2} aria-hidden="true" />
          <b>{label ?? t("search.barcode")}</b>
        </button>
      )}

      {open && (
        <div className="modalShade" role="dialog" aria-modal="true" aria-label="Barcode">
          <div className="bottomSheet">
            <button className="close" onClick={() => { stop(); setOpen(false); }} aria-label={t("search.clear_aria")}><X size={18} strokeWidth={2} aria-hidden="true" /></button>
            <span className="success"><ScanBarcode size={14} strokeWidth={2} aria-hidden="true" /> {t("search.chooser_barcode").toUpperCase()}</span>
            <h2 style={{ margin: "14px 0 6px" }}>Scan the packet</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
              A barcode gives us the manufacturer&apos;s own ingredient list, so the estimate rests on
              the label rather than on a guess.
            </p>

            {scanning && (
              <video
                ref={videoRef}
                muted
                playsInline
                style={{ width: "100%", borderRadius: 12, background: "#1b2925", marginTop: 12 }}
              />
            )}

            {!scanning && (
              <button className="secondary" style={{ width: "100%", marginTop: 12 }} onClick={startCamera}>
                <Camera size={16} strokeWidth={2} aria-hidden="true" /> {t("search.chooser_photo")}
              </button>
            )}

            {note && (
              <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 10, lineHeight: 1.6 }}>{note}</p>
            )}

            <label>
              Or type the number under the bars
              <input
                inputMode="numeric"
                value={manual}
                onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manual.length >= 8) {
                    stop(); setOpen(false); onScan(manual);
                  }
                }}
                placeholder="8901719101090"
              />
            </label>

            <div className="sheetActions">
              <button className="secondary" onClick={() => { stop(); setOpen(false); }}>Cancel</button>
              <button
                className="primary"
                disabled={manual.length < 8}
                onClick={() => { stop(); setOpen(false); onScan(manual); }}
              >
                Look up →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
