"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import India from "@svg-maps/india";
import { api, ApiError, demoActive, type ResolveResult } from "./lib/client.ts";
import { useLang } from "./lib/i18n-client.tsx";
import { ConfirmSheet, type Confirmed } from "./components/ConfirmSheet.tsx";
import { LiveProfile } from "./components/LiveProfile.tsx";
import { SearchBar } from "./components/SearchBar.tsx";
import { LanguageMenu } from "./components/LanguageMenu.tsx";
import { AccountMenu } from "./components/AccountMenu.tsx";
import { PhoneBridge } from "./components/PhoneBridge.tsx";
import { LiveLearn } from "./components/LiveLearn.tsx";
import { JalMitra } from "./components/JalMitra.tsx";
import { recordSearch } from "./lib/account-store.ts";
import { LiveResult } from "./components/LiveResult.tsx";
import { LiveCompare } from "./components/LiveCompare.tsx";
import { BarcodeInput } from "./components/BarcodeInput.tsx";
import { LiveCamera } from "./components/LiveCamera.tsx";
import { LiveExplore } from "./components/LiveExplore.tsx";
import { WaterScreen } from "./components/WaterScreen.tsx";
import { HomeGrid } from "./components/HomeGrid.tsx";
import type { CalculationResult } from "../engine/types.ts";

// i18n keys, not strings — the rotating line under the logo follows the
// language switcher like everything else in the hero.
const waterQuotes = ["home.quote1", "home.quote2", "home.quote3", "home.quote4"];
type Page = "home" | "scan" | "explore" | "result" | "compare" | "water" | "farmer" | "learn" | "profile";

export default function Home() {
  const [page, setPage] = useState<Page>("home"); const [query, setQuery] = useState("");
  const [scanState, setScanState] = useState<"ready" | "scanning" | "confirm">("ready");
  const [quoteIndex, setQuoteIndex] = useState(0);
  const { lang, t } = useLang();

  // ── Phase 6a: resolve → CONFIRM → calculate. No path skips the middle step.
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [pending, setPending] = useState<Confirmed | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demo = demoActive();
  // Read through refs so the language effect below depends on `lang` alone.
  // Refs are updated in an effect, never during render.
  const pendingRef = useRef<Confirmed | null>(null);
  const monthRef = useRef(month);
  useEffect(() => { pendingRef.current = pending; monthRef.current = month; });

  useEffect(()=>{if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;const timer=window.setInterval(()=>setQuoteIndex(i=>(i+1)%waterQuotes.length),4200);return()=>window.clearInterval(timer)},[]);
  const nav = (p: Page) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); };

  /** Step 1 — identify. Never calculates; always opens the confirmation sheet. */
  const startResolve = useCallback(async (
    input_type: "name" | "barcode" | "image" | "voice",
    value: string,
    extra: { image?: string; media_type?: string } = {},
  ) => {
    setError(null); setBusy(true); setResolved(null);
    try {
      const r = await api.resolve({ input_type, value, lang, ...extra });
      setResolved(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "resolve failed");
    } finally { setBusy(false); }
  }, [lang]);

  /** Step 2 — the human has approved an item and a portion. Now we calculate. */
  const confirmAndCalculate = useCallback(async (c: Confirmed) => {
    // Exhaustively guarded: every exit renders SOMETHING. A click that produces
    // neither a result nor a message is indistinguishable from a broken app,
    // which is exactly how the disabled-button bug hid for so long.
    setBusy(true); setError(null);
    try {
      const r = await api.calculate({
        // A scanned packet has no catalogue id; its ingredients are the recipe.
        product_id: c.product_id || undefined,
        ingredients: c.ingredients,
        name: c.name,
        serving_g: c.serving_g,
        month,
        lang,
        force_state: c.force_state,
      });
      if (!r || !r.footprint_l) {
        setError("We received an incomplete result. Please try again.");
        return;
      }
      setResult(r); setPending(c); setResolved(null); setScanState("ready"); nav("result");
      // Local history. A no-op when signed out — browsing anonymously leaves
      // nothing behind, which is the point of it being optional.
      recordSearch({ product_id: r.product.id, name: r.product.name, litres: r.footprint_l.total, score: r.stress_score, at: new Date().toISOString() });
    } catch (e) {
      // ApiError carries the structured body, including DATA_MISSING + missing[].
      const message =
        e instanceof ApiError
          ? String((e.body as { message?: string })?.message ?? e.message)
          : e instanceof Error
            ? e.message
            : "Something went wrong. Please try again.";
      console.error("calculate failed", e);
      setError(message);
    } finally {
      // MUST always run — a stuck spinner is its own kind of dead button.
      setBusy(false);
    }
  }, [lang, month]);

  /** Season slider — same confirmed item, different month. */
  const changeMonth = useCallback(async (m: number) => {
    setMonth(m);
    if (!pending) return;
    setReloading(true);
    try {
      const r = await api.calculate({ product_id: pending.product_id, serving_g: pending.serving_g, month: m, lang, force_state: pending.force_state });
      setResult(r);
    } catch { /* keep the previous result on screen rather than blanking it */ }
    finally { setReloading(false); }
  }, [pending, lang]);

  // Re-render the current result when the language changes, so entity names
  // and generated sentences follow the switcher.
  useEffect(() => {
    const p = pendingRef.current;
    if (!p) return;
    api.calculate({ product_id: p.product_id, serving_g: p.serving_g, month: monthRef.current, lang, force_state: p.force_state })
      .then(setResult).catch(() => {});
    // Language only: month and portion have their own handlers, and adding them
    // here would refetch twice on every slider move.
  }, [lang]);

  return <main>
    <header className="topbar"><button className="brand headerBrand" onClick={()=>nav("home")} aria-label="JalDrishti home"><span className="brandCopy"><img className="brandLogo" src="/img/logo.png" alt="JalDrishti" width={614} height={160}/><small className="waterQuote" key={quoteIndex}>{t(waterQuotes[quoteIndex])}</small></span></button><nav className="desktopnav" aria-label="Primary navigation">{(["home","scan","explore","compare","water","learn"] as Page[]).map(n=><button key={n} className={page===n?"active":""} onClick={()=>nav(n)}>{n==="water"?t("nav.water"):n==="farmer"?"Farmer Calculator":t(`nav.${n}`)}</button>)}</nav><div className="headeractions"><LanguageMenu/><AccountMenu onOpenProfile={()=>nav("profile")}/></div></header>
    {page==="home"&&<HomePage nav={nav} query={query} setQuery={setQuery} onSearch={v=>startResolve("name",v)} onBarcode={v=>startResolve("barcode",v)} onVoice={v=>{setQuery(v);startResolve("voice",v)}} onVoiceInterim={setQuery} busy={busy}/>} {page==="scan"&&<Scanner state={scanState} setState={setScanState} nav={nav} onImage={(b64,mt)=>startResolve("image","",{image:b64,media_type:mt})} onBarcode={v=>startResolve("barcode",v)} setResolvedFromBridge={r=>{setResolved(r);setScanState("ready")}} busy={busy}/>} {page==="explore"&&<LiveExplore query={query} setQuery={setQuery} onPick={v=>startResolve("name",v)} busy={busy}/>} {page==="result"&&(result?<LiveResult result={result} month={month} onMonthChange={changeMonth} onCompare={()=>nav("compare")} reloading={reloading}/>:<EmptyState title={t("state.empty")} body="Search or scan a product to see its water story." action={()=>nav("home")} actionLabel={t("nav.home")}/>)} {page==="compare"&&<LiveCompare seed={pending?.product_id} servingG={pending?.serving_g} month={month}/>} {page==="water"&&<WaterScreen/>} {page==="farmer"&&<Farmer/>} {page==="learn"&&<LiveLearn onPick={v=>startResolve("name",v)}/>} {page==="profile"&&<LiveProfile onPick={v=>startResolve("name",v)}/>}
    <JalMitra result={result}/>
    {resolved&&<ConfirmSheet resolved={resolved} busy={busy} onConfirm={confirmAndCalculate} onCancel={()=>setResolved(null)}/>}
    {error&&<div className="modalShade" role="presentation"><div className="bottomSheet"><button className="close" onClick={()=>setError(null)}>×</button><span className="success">{t("state.error").toUpperCase()}</span><p style={{marginTop:16,color:"var(--muted)",fontSize:13,lineHeight:1.7}}>{error}</p><div className="sheetActions"><button className="primary" onClick={()=>setError(null)}>{t("state.retry")}</button></div></div></div>}
    {demo&&<div className="demoBadge">● {t("demo.badge")}</div>}

    <nav className="mobilenav" aria-label="Mobile navigation"><button onClick={()=>nav("home")} className={page==="home"?"active":""}><span>⌂</span>Home</button><button onClick={()=>nav("explore")} className={page==="explore"?"active":""}><span>⌕</span>Explore</button><button onClick={()=>nav("scan")} className="scanmobile"><span>◎</span>Scan</button><button onClick={()=>nav("water")} className={page==="water"?"active":""}><span>◍</span>{t("nav.water")}</button><button onClick={()=>nav("profile")} className={page==="profile"?"active":""}><span>○</span>Profile</button></nav>
  </main>;
}

function EmptyState({title,body,action,actionLabel}:{title:string,body:string,action?:()=>void,actionLabel?:string}){return <section className="appPage"><div className="stateBox"><span style={{fontSize:44}}>◌</span><h2>{title}</h2><p>{body}</p>{action&&<button onClick={action}>{actionLabel}</button>}</div></section>}

function HomePage({nav,query,setQuery,onSearch,onBarcode,onVoice,onVoiceInterim,busy}:{nav:(p:Page)=>void,query:string,setQuery:(s:string)=>void,onSearch:(v:string)=>void,onBarcode:(v:string)=>void,onVoice:(v:string)=>void,onVoiceInterim:(v:string)=>void,busy:boolean}) {
  const {t}=useLang();
  return <>
  <section className="hero"><div className="heroCopy"><div className="eyebrow"><span>●</span> {t("home.hero.eyebrow")}</div><h1>{t("home.hero.line1")}<br/><em>{t("home.hero.line2")}</em></h1><p>{t("home.hero.body")}</p><div className="heroNote"><span>◎</span><small>{t("home.hero.note")}</small></div></div><div className="indiaVisual" role="img" aria-label="Accurate unlabeled blue map of India with water intelligence signals"><div className="mapOrb orbOne"/><div className="mapOrb orbTwo"/><div className="indiaMap indiaGeoWrap"><svg className="indiaGeoMap" viewBox={India.viewBox} aria-hidden="true">{(India.locations as {id:string,path:string}[]).map(location=><path key={location.id} d={location.path}/>)}</svg><i className="mapSignal s1"/><i className="mapSignal s2"/><i className="mapSignal s3"/><i className="mapSignal s4"/></div><div className="mapReadout"><span>{t("home.map.overline")}</span><b>{t("home.map.title")}</b><small>{t("home.map.tags")}</small></div></div></section>
  <section className="searchSection"><SearchBar query={query} setQuery={setQuery} onSearch={onSearch} onBarcode={onBarcode} onVoice={onVoice} onVoiceInterim={onVoiceInterim} onPhoto={()=>nav("scan")} busy={busy}/><div className="sectionTitle"><div><span className="overline">{t("home.explore.overline")}</span><h2>{t("home.explore.title")}</h2></div><button onClick={()=>nav("explore")}>{t("home.explore.viewAll")} →</button></div><HomeGrid onPick={onSearch}/></section>
  <section className="storySection"><div className="sectionTitle"><div><span className="overline">A CLEARER PICTURE</span><h2>Three colours. One water story.</h2></div><p>Water footprints reveal where water comes from and how production may affect it.</p></div><div className="waterCards"><article className="waterCard green"><div className="drop">01</div><span>GREEN WATER</span><h3>Rain, held by the soil</h3><p>Rainwater stored in soil and used by crops as they grow.</p><button onClick={()=>nav("learn")}>Learn more →</button></article><article className="waterCard blue"><div className="drop">02</div><span>BLUE WATER</span><h3>Rivers, lakes & aquifers</h3><p>Surface and groundwater supplied through irrigation.</p><button onClick={()=>nav("learn")}>Learn more →</button></article><article className="waterCard grey"><div className="drop">03</div><span>GREY WATER</span><h3>Keeping water clean</h3><p>An estimate of water required to account for pollution.</p><button onClick={()=>nav("learn")}>Learn more →</button></article></div></section>
  <section className="how"><span className="overline">SIMPLE BY DESIGN</span><h2>From crop to clarity in three steps</h2><div className="steps"><div><b>1</b><span className="stepIcon">◎</span><h3>Scan</h3><p>Point your camera at one agricultural product.</p></div><i>→</i><div><b>2</b><span className="stepIcon">✓</span><h3>Confirm</h3><p>Add quantity, location and production method.</p></div><i>→</i><div><b>3</b><span className="stepIcon">≈</span><h3>Understand</h3><p>See an estimated footprint and what influenced it.</p></div></div></section>
  <section className="insight"><div><span className="overline light">YOUR REGIONAL CONTEXT</span><h2>Maharashtra at a glance</h2><p>Regional conditions help give every estimate meaningful context.</p><div className="regionStats"><div><small>MONSOON RAINFALL</small><b>92% <em>of normal</em></b></div><div><small>WATER STRESS</small><b>Moderate</b></div><div><small>SEASON</small><b>Kharif 2026</b></div></div><button>Explore regional insights →</button></div><div className="contour"><div className="pin">⌖</div><span>Maharashtra</span></div></section>
  <footer><div className="brand inverse"><img className="brandMark" src="/img/logo-mark.png" alt="" width={196} height={256}/><span>Jal<span>Drishti</span></span></div><p>Demo estimates vary with location, season, irrigation, yield and farming practice. They are not direct physical measurements.</p><div><button>Methodology</button><button>Data sources</button><button>Privacy</button></div></footer>
  </>}

function Scanner({state,setState,nav,onImage,onBarcode,setResolvedFromBridge,busy}:{state:"ready"|"scanning"|"confirm",setState:(s:"ready"|"scanning"|"confirm")=>void,nav:(p:Page)=>void,onImage:(b64:string,mt:string)=>void,onBarcode:(v:string)=>void,setResolvedFromBridge:(r:ResolveResult)=>void,busy:boolean}) {return <section className="appPage scanPage"><div className="pageIntro"><span className="overline">CAMERA SCANNER</span><h1>Scan an agricultural product</h1><p>The camera identifies your product; contextual data powers the estimate.</p></div><div className="scannerLayout"><div className={`camera ${state}`}><LiveCamera busy={busy||state==="scanning"} onCapture={(b64,mt)=>{setState("scanning");onImage(b64,mt);setTimeout(()=>setState("ready"),400)}}/><div style={{marginTop:14}}><BarcodeInput onScan={onBarcode} label="Enter a barcode instead"/></div><PhoneBridge onCandidates={setResolvedFromBridge} onUseComputerCamera={()=>{}}/></div><aside className="scanHelp"><h3>For a clearer scan</h3>{[["01","One product at a time","Keep other objects outside the frame."],["02","Use natural light","Avoid strong shadows and glare."],["03","Move a little closer","Fill most of the scanning frame."]].map(x=><div key={x[0]}><b>{x[0]}</b><p><strong>{x[1]}</strong><br/>{x[2]}</p></div>)}<button onClick={()=>nav("explore")}>Search manually instead →</button><small>Supported: cereals, pulses, vegetables, fruits and major cash crops.</small></aside></div></section>}




function Farmer(){const [step,setStep]=useState(1);return <section className="appPage"><div className="pageIntro"><span className="overline">FARMER CALCULATOR</span><h1>Build a farm-specific estimate</h1><p>Four clear steps. Practical context. Neutral observations.</p></div><div className="progress">{["Crop","Location","Conditions","Result"].map((x,i)=><div className={step>=i+1?"done":""} key={x}><b>{step>i+1?"✓":i+1}</b><span>{x}</span></div>)}</div><div className="calculator"><div className="calcForm"><span className="overline">STEP {step} OF 4</span><h2>{step===1?"Tell us about the crop":step===2?"Where is the farm?":step===3?"Farming conditions":"Your demo estimate"}</h2>{step===1&&<><label>Crop<select><option>Rice</option><option>Wheat</option><option>Sugarcane</option></select></label><label>Season<select><option>Kharif 2026</option><option>Rabi 2026</option></select></label><label>Farm area<div className="inputGroup"><input defaultValue="2.5"/><select><option>hectares</option></select></div></label></>}{step===2&&<><label>State<select><option>Maharashtra</option></select></label><label>District<select><option>Pune</option><option>Nagpur</option></select></label><label>Soil type<select><option>Black cotton soil</option><option>Alluvial</option></select></label></>}{step===3&&<><label>Expected yield<div className="inputGroup"><input defaultValue="3.2"/><select><option>tonnes/ha</option></select></div></label><label>Irrigation method<select><option>Rain-fed</option><option>Drip irrigation</option><option>Flood irrigation</option></select></label><label>Optional fertiliser information<input placeholder="e.g. nitrogen kg/ha"/></label></>}{step===4&&<div className="calcResult"><span>ESTIMATED CROP WATER REQUIREMENT</span><strong>7.9 million L</strong><p>2,470–2,690 L per kilogram</p><div><b>74</b><span>Water-efficiency score<br/><small>Regional range: 62–78</small></span></div></div>}<div className="calcButtons"><button disabled={step===1} onClick={()=>setStep(step-1)}>← Back</button><button className="primary" onClick={()=>setStep(step===4?1:step+1)}>{step===4?"Start again":"Continue →"}</button></div></div><aside className="calcAside"><h3>Your calculation</h3><p><span>Crop</span><b>Rice</b></p><p><span>Location</span><b>{step>1?"Pune, Maharashtra":"—"}</b></p><p><span>Season</span><b>Kharif 2026</b></p><p><span>Area</span><b>2.5 hectares</b></p><div><b>Why these details matter</b><small>Rainfall, soil, yield and irrigation shape how water contributes to a crop.</small></div></aside></div></section>}

// Learn now lives in components/LiveLearn.tsx — the static version had four
// cards and a Listen button with zero onClick handlers: every one a dead link.

// Profile now lives in components/LiveProfile.tsx — its scan history printed
// hardcoded litre figures that disagreed with the engine (wheat by 67 L/kg).
