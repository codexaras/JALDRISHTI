"use client";

/**
 * The homepage search bar — AMENDMENT_10.
 *
 * The pattern every major search product uses: secondary inputs live *inside*
 * the field as quiet icon buttons, and exactly one filled primary action sits
 * outside it. Previously four chips of near-equal weight crowded the input,
 * which is the primary control.
 *
 * Icons are lucide-react. The old set was not hand-drawn SVG but Unicode text
 * glyphs — `⌕`, `🎙`, `▮▯▮`, `◎` — which is worse: `🎙` renders as a colour
 * emoji on Windows and monochrome elsewhere, so the set was inconsistent across
 * machines rather than merely within itself.
 *
 * Barcode and photo were two buttons a first-time user could not tell apart.
 * They are genuinely different flows — barcode resolves inline, photo changes
 * route — so they now sit behind one camera button in a chooser labelled by
 * OUTCOME ("Scan a barcode" / "Photograph food") rather than by technology.
 */
import { useEffect, useRef, useState } from "react";
import { Focus, ScanBarcode, Search, X } from "lucide-react";
import { useLang } from "../lib/i18n-client.tsx";
import { VoiceInput } from "./VoiceInput.tsx";
import { BarcodeInput } from "./BarcodeInput.tsx";

export function SearchBar({
  query,
  setQuery,
  onSearch,
  onBarcode,
  onVoice,
  onVoiceInterim,
  onPhoto,
  busy,
}: {
  query: string;
  setQuery: (s: string) => void;
  onSearch: (v: string) => void;
  onBarcode: (v: string) => void;
  onVoice: (v: string) => void;
  onVoiceInterim: (v: string) => void;
  /** Route change to the Scan page — the photo flow. */
  onPhoto: () => void;
  busy?: boolean;
}) {
  const { t } = useLang();
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [short, setShort] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The long example list truncates awkwardly under 640px, so the placeholder
  // has its own short key rather than being clipped.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setShort(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const submit = () => query.trim() && onSearch(query);

  return (
    <div className="searchShell">
      <div className="searchbox unifiedSearch">
        {/* Decorative — the input already carries the accessible name. */}
        <Search className="searchLead" size={20} strokeWidth={2} aria-hidden="true" />

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={t(short ? "search.placeholder_short" : "search.placeholder")}
          aria-label={t("search.button")}
        />

        {/* Clear appears only once there is something to clear. */}
        {query.length > 0 && (
          <button
            type="button"
            className="searchIconBtn"
            onClick={() => { setQuery(""); inputRef.current?.focus(); }}
            aria-label={t("search.clear_aria")}
            title={t("search.clear_aria")}
          >
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        )}

        {/* Hidden entirely where unsupported — a permanently greyed button
            reads as broken. VoiceInput returns null when the browser has no
            speech recognition, and renders a lucide Mic in compact mode. */}
        <VoiceInput compact onResult={onVoice} onInterim={onVoiceInterim} />

        <button
          type="button"
          className="searchIconBtn"
          onClick={() => setBarcodeOpen(true)}
          aria-label={t("search.chooser_barcode")}
          title={t("search.chooser_barcode")}
        >
          <ScanBarcode size={20} strokeWidth={2} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="searchIconBtn"
          onClick={onPhoto}
          aria-label={t("search.chooser_photo")}
          title={t("search.chooser_photo")}
        >
          <Focus size={20} strokeWidth={2} aria-hidden="true" />
        </button>

        <span className="searchDivider" aria-hidden="true" />

        <button className="searchSubmit" disabled={busy || !query.trim()} onClick={submit}>
          {busy ? "…" : t("search.button")}
        </button>
      </div>

      {/* Modal only — its own trigger is suppressed, because the chooser above
          is now the single entry point to both camera flows. */}
      <BarcodeInput
        onScan={onBarcode}
        open={barcodeOpen}
        onOpenChange={setBarcodeOpen}
        triggerless
      />
    </div>
  );
}
