"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import India from "@svg-maps/india";
import { api, demoActive, type ResolveResult } from "./lib/client.ts";
import { useLang } from "./lib/i18n-client.tsx";
import { ConfirmSheet, type Confirmed } from "./components/ConfirmSheet.tsx";
import { LiveProfile } from "./components/LiveProfile.tsx";
import { SearchBar } from "./components/SearchBar.tsx";
import { LiveResult } from "./components/LiveResult.tsx";
import { LiveCompare } from "./components/LiveCompare.tsx";
import { BarcodeInput } from "./components/BarcodeInput.tsx";
import { LiveCamera } from "./components/LiveCamera.tsx";
import { LiveExplore } from "./components/LiveExplore.tsx";
import { WaterScreen } from "./components/WaterScreen.tsx";
import { HomeGrid } from "./components/HomeGrid.tsx";
import { LANGS, LANG_SHORT } from "../i18n/index.ts";
import type { CalculationResult } from "../engine/types.ts";

const waterQuotes = ["Every drop carries a story.", "Know water. Value every harvest.", "Awareness is where conservation begins.", "Water connects every field and plate."];
type Page = "home" | "scan" | "explore" | "result" | "compare" | "water" | "farmer" | "learn" | "profile";

export default function Home() {
  const [page, setPage] = useState<Page>("home"); const [query, setQuery] = useState("");
  const [scanState, setScanState] = useState<"ready" | "scanning" | "confirm">("ready");
  const [quoteIndex, setQuoteIndex] = useState(0);
  const { lang, setLang, t } = useLang();

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
    setBusy(true); setError(null);
    try {
      const r = await api.calculate({ product_id: c.product_id, serving_g: c.serving_g, month, lang, force_state: c.force_state });
      setResult(r); setPending(c); setResolved(null); setScanState("ready"); nav("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "calculation failed");
    } finally { setBusy(false); }
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
    <header className="topbar"><button className="brand headerBrand" onClick={()=>nav("home")} aria-label="JalDrishti home"><span className="brandCopy"><img className="brandLogo" src="/img/logo.png" alt="JalDrishti" width={614} height={160}/><small className="waterQuote" key={quoteIndex}>{waterQuotes[quoteIndex]}</small></span></button><nav className="desktopnav" aria-label="Primary navigation">{(["home","scan","explore","compare","water","learn"] as Page[]).map(n=><button key={n} className={page===n?"active":""} onClick={()=>nav(n)}>{n==="water"?t("nav.water"):n==="farmer"?"Farmer Calculator":t(`nav.${n}`)}</button>)}</nav><div className="headeractions"><button className="language" onClick={()=>setLang(LANGS[(LANGS.indexOf(lang)+1)%LANGS.length])} aria-label="Change language"><span>अ</span> {LANG_SHORT[lang]}</button><button className="profilebtn" onClick={()=>nav("profile")} aria-label="Profile">AR</button></div></header>
    {page==="home"&&<HomePage nav={nav} query={query} setQuery={setQuery} onSearch={v=>startResolve("name",v)} onBarcode={v=>startResolve("barcode",v)} onVoice={v=>{setQuery(v);startResolve("voice",v)}} onVoiceInterim={setQuery} busy={busy}/>} {page==="scan"&&<Scanner state={scanState} setState={setScanState} nav={nav} onImage={(b64,mt)=>startResolve("image","",{image:b64,media_type:mt})} onBarcode={v=>startResolve("barcode",v)} busy={busy}/>} {page==="explore"&&<LiveExplore query={query} setQuery={setQuery} onPick={v=>startResolve("name",v)} busy={busy}/>} {page==="result"&&(result?<LiveResult result={result} month={month} onMonthChange={changeMonth} onCompare={()=>nav("compare")} reloading={reloading}/>:<EmptyState title={t("state.empty")} body="Search or scan a product to see its water story." action={()=>nav("home")} actionLabel={t("nav.home")}/>)} {page==="compare"&&<LiveCompare seed={pending?.product_id} servingG={pending?.serving_g} month={month}/>} {page==="water"&&<WaterScreen/>} {page==="farmer"&&<Farmer/>} {page==="learn"&&<Learn/>} {page==="profile"&&<LiveProfile onPick={v=>startResolve("name",v)}/>}
    {resolved&&<ConfirmSheet resolved={resolved} busy={busy} onConfirm={confirmAndCalculate} onCancel={()=>setResolved(null)}/>}
    {error&&<div className="modalShade" role="presentation"><div className="bottomSheet"><button className="close" onClick={()=>setError(null)}>×</button><span className="success">{t("state.error").toUpperCase()}</span><p style={{marginTop:16,color:"var(--muted)",fontSize:13,lineHeight:1.7}}>{error}</p><div className="sheetActions"><button className="primary" onClick={()=>setError(null)}>{t("state.retry")}</button></div></div></div>}
    {demo&&<div className="demoBadge">● {t("demo.badge")}</div>}

    <nav className="mobilenav" aria-label="Mobile navigation"><button onClick={()=>nav("home")} className={page==="home"?"active":""}><span>⌂</span>Home</button><button onClick={()=>nav("explore")} className={page==="explore"?"active":""}><span>⌕</span>Explore</button><button onClick={()=>nav("scan")} className="scanmobile"><span>◎</span>Scan</button><button onClick={()=>nav("water")} className={page==="water"?"active":""}><span>◍</span>{t("nav.water")}</button><button onClick={()=>nav("profile")} className={page==="profile"?"active":""}><span>○</span>Profile</button></nav>
  </main>;
}

function EmptyState({title,body,action,actionLabel}:{title:string,body:string,action?:()=>void,actionLabel?:string}){return <section className="appPage"><div className="stateBox"><span style={{fontSize:44}}>◌</span><h2>{title}</h2><p>{body}</p>{action&&<button onClick={action}>{actionLabel}</button>}</div></section>}

function HomePage({nav,query,setQuery,onSearch,onBarcode,onVoice,onVoiceInterim,busy}:{nav:(p:Page)=>void,query:string,setQuery:(s:string)=>void,onSearch:(v:string)=>void,onBarcode:(v:string)=>void,onVoice:(v:string)=>void,onVoiceInterim:(v:string)=>void,busy:boolean}) {return <>
  <section className="hero"><div className="heroCopy"><div className="eyebrow"><span>●</span> WATER INTELLIGENCE FOR EVERYONE</div><h1>Every crop has<br/>a <em>water story.</em></h1><p>Discover the estimated green, blue and grey water behind the food we grow — shaped by place, rain and farming practice.</p><div className="heroNote"><span>◎</span><small>Scan or search below to begin. The camera identifies the product; our data engine estimates its footprint.</small></div></div><div className="indiaVisual" role="img" aria-label="Accurate unlabeled blue map of India with water intelligence signals"><div className="mapOrb orbOne"/><div className="mapOrb orbTwo"/><div className="indiaMap indiaGeoWrap"><svg className="indiaGeoMap" viewBox={India.viewBox} aria-hidden="true">{(India.locations as {id:string,path:string}[]).map(location=><path key={location.id} d={location.path}/>)}</svg><i className="mapSignal s1"/><i className="mapSignal s2"/><i className="mapSignal s3"/><i className="mapSignal s4"/></div><div className="mapReadout"><span>LIVE REGIONAL LAYER</span><b>Water context, across India</b><small>Rainfall · Yield · Irrigation · Season</small></div></div></section>
  <section className="searchSection"><SearchBar query={query} setQuery={setQuery} onSearch={onSearch} onBarcode={onBarcode} onVoice={onVoice} onVoiceInterim={onVoiceInterim} onPhoto={()=>nav("scan")} busy={busy}/><div className="sectionTitle"><div><span className="overline">QUICKLY EXPLORE</span><h2>What’s on your plate?</h2></div><button onClick={()=>nav("explore")}>View all products →</button></div><HomeGrid onPick={onSearch}/></section>
  <section className="storySection"><div className="sectionTitle"><div><span className="overline">A CLEARER PICTURE</span><h2>Three colours. One water story.</h2></div><p>Water footprints reveal where water comes from and how production may affect it.</p></div><div className="waterCards"><article className="waterCard green"><div className="drop">01</div><span>GREEN WATER</span><h3>Rain, held by the soil</h3><p>Rainwater stored in soil and used by crops as they grow.</p><button onClick={()=>nav("learn")}>Learn more →</button></article><article className="waterCard blue"><div className="drop">02</div><span>BLUE WATER</span><h3>Rivers, lakes & aquifers</h3><p>Surface and groundwater supplied through irrigation.</p><button onClick={()=>nav("learn")}>Learn more →</button></article><article className="waterCard grey"><div className="drop">03</div><span>GREY WATER</span><h3>Keeping water clean</h3><p>An estimate of water required to account for pollution.</p><button onClick={()=>nav("learn")}>Learn more →</button></article></div></section>
  <section className="how"><span className="overline">SIMPLE BY DESIGN</span><h2>From crop to clarity in three steps</h2><div className="steps"><div><b>1</b><span className="stepIcon">◎</span><h3>Scan</h3><p>Point your camera at one agricultural product.</p></div><i>→</i><div><b>2</b><span className="stepIcon">✓</span><h3>Confirm</h3><p>Add quantity, location and production method.</p></div><i>→</i><div><b>3</b><span className="stepIcon">≈</span><h3>Understand</h3><p>See an estimated footprint and what influenced it.</p></div></div></section>
  <section className="insight"><div><span className="overline light">YOUR REGIONAL CONTEXT</span><h2>Maharashtra at a glance</h2><p>Regional conditions help give every estimate meaningful context.</p><div className="regionStats"><div><small>MONSOON RAINFALL</small><b>92% <em>of normal</em></b></div><div><small>WATER STRESS</small><b>Moderate</b></div><div><small>SEASON</small><b>Kharif 2026</b></div></div><button>Explore regional insights →</button></div><div className="contour"><div className="pin">⌖</div><span>Maharashtra</span></div></section>
  <footer><div className="brand inverse"><img className="brandMark" src="/img/logo-mark.png" alt="" width={196} height={256}/><span>Jal<span>Drishti</span></span></div><p>Demo estimates vary with location, season, irrigation, yield and farming practice. They are not direct physical measurements.</p><div><button>Methodology</button><button>Data sources</button><button>Privacy</button></div></footer>
  </>}

function Scanner({state,setState,nav,onImage,onBarcode,busy}:{state:"ready"|"scanning"|"confirm",setState:(s:"ready"|"scanning"|"confirm")=>void,nav:(p:Page)=>void,onImage:(b64:string,mt:string)=>void,onBarcode:(v:string)=>void,busy:boolean}) {return <section className="appPage scanPage"><div className="pageIntro"><span className="overline">CAMERA SCANNER</span><h1>Scan an agricultural product</h1><p>The camera identifies your product; contextual data powers the estimate.</p></div><div className="scannerLayout"><div className={`camera ${state}`}><LiveCamera busy={busy||state==="scanning"} onCapture={(b64,mt)=>{setState("scanning");onImage(b64,mt);setTimeout(()=>setState("ready"),400)}}/><div style={{marginTop:14}}><BarcodeInput onScan={onBarcode} label="Enter a barcode instead"/></div></div><aside className="scanHelp"><h3>For a clearer scan</h3>{[["01","One product at a time","Keep other objects outside the frame."],["02","Use natural light","Avoid strong shadows and glare."],["03","Move a little closer","Fill most of the scanning frame."]].map(x=><div key={x[0]}><b>{x[0]}</b><p><strong>{x[1]}</strong><br/>{x[2]}</p></div>)}<button onClick={()=>nav("explore")}>Search manually instead →</button><small>Supported: cereals, pulses, vegetables, fruits and major cash crops.</small></aside></div></section>}




function Farmer(){const [step,setStep]=useState(1);return <section className="appPage"><div className="pageIntro"><span className="overline">FARMER CALCULATOR</span><h1>Build a farm-specific estimate</h1><p>Four clear steps. Practical context. Neutral observations.</p></div><div className="progress">{["Crop","Location","Conditions","Result"].map((x,i)=><div className={step>=i+1?"done":""} key={x}><b>{step>i+1?"✓":i+1}</b><span>{x}</span></div>)}</div><div className="calculator"><div className="calcForm"><span className="overline">STEP {step} OF 4</span><h2>{step===1?"Tell us about the crop":step===2?"Where is the farm?":step===3?"Farming conditions":"Your demo estimate"}</h2>{step===1&&<><label>Crop<select><option>Rice</option><option>Wheat</option><option>Sugarcane</option></select></label><label>Season<select><option>Kharif 2026</option><option>Rabi 2026</option></select></label><label>Farm area<div className="inputGroup"><input defaultValue="2.5"/><select><option>hectares</option></select></div></label></>}{step===2&&<><label>State<select><option>Maharashtra</option></select></label><label>District<select><option>Pune</option><option>Nagpur</option></select></label><label>Soil type<select><option>Black cotton soil</option><option>Alluvial</option></select></label></>}{step===3&&<><label>Expected yield<div className="inputGroup"><input defaultValue="3.2"/><select><option>tonnes/ha</option></select></div></label><label>Irrigation method<select><option>Rain-fed</option><option>Drip irrigation</option><option>Flood irrigation</option></select></label><label>Optional fertiliser information<input placeholder="e.g. nitrogen kg/ha"/></label></>}{step===4&&<div className="calcResult"><span>ESTIMATED CROP WATER REQUIREMENT</span><strong>7.9 million L</strong><p>2,470–2,690 L per kilogram</p><div><b>74</b><span>Water-efficiency score<br/><small>Regional range: 62–78</small></span></div></div>}<div className="calcButtons"><button disabled={step===1} onClick={()=>setStep(step-1)}>← Back</button><button className="primary" onClick={()=>setStep(step===4?1:step+1)}>{step===4?"Start again":"Continue →"}</button></div></div><aside className="calcAside"><h3>Your calculation</h3><p><span>Crop</span><b>Rice</b></p><p><span>Location</span><b>{step>1?"Pune, Maharashtra":"—"}</b></p><p><span>Season</span><b>Kharif 2026</b></p><p><span>Area</span><b>2.5 hectares</b></p><div><b>Why these details matter</b><small>Rainfall, soil, yield and irrigation shape how water contributes to a crop.</small></div></aside></div></section>}

function Learn(){return <section className="appPage"><div className="learnHero"><span className="overline light">LEARN WITH JALDRISHTI</span><h1>Understanding<br/>water footprints</h1><p>Simple stories and clear science for a water-aware future.</p><button>▷ Listen · 3 min</button></div><div className="learnGrid"><article className="featureLesson"><span>FEATURED GUIDE · 6 MIN</span><h2>Where does a crop’s water come from?</h2><p>Follow one drop through monsoon clouds, soil, roots and rivers — and see how green, blue and grey water fit together.</p><button>Start interactive guide →</button><div className="cycle"><i>☁</i><b>↓</b><i>◉</i><b>→</b><i>≈</i></div></article><article><span>PRODUCT STORY</span><h3>The journey of a grain of rice</h3><p>From nursery to harvest, explore how place changes the water story.</p><button>Read story →</button></article><article><span>QUICK QUIZ · 3 QUESTIONS</span><h3>What do you know about rainwater?</h3><p>Test your understanding and grow your learning streak.</p><button>Take the quiz →</button></article></div><div className="myth"><span>MYTH</span><h2>“A single footprint number tells the whole story.”</h2><i>→</i><span>FACT</span><p>Location, rainfall timing, water scarcity, yield and farming practice change what the number means.</p></div><div className="faq"><h2>Frequently asked questions</h2>{["Does the camera measure water use?","Why do estimates show a range?","Is a lower footprint always better?"].map(x=><details key={x}><summary>{x}<span>＋</span></summary><p>The camera only identifies a product. JalDrishti estimates its footprint using contextual datasets; it does not directly measure water.</p></details>)}</div></section>}

// Profile now lives in components/LiveProfile.tsx — its scan history printed
// hardcoded litre figures that disagreed with the engine (wheat by 67 L/kg).
