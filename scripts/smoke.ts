/**
 * End-to-end smoke test against a running server.
 *
 * Unlike the vitest suite, this exercises the real network paths — Open Food
 * Facts and Gemini — which is the part that cannot be asserted in CI but is
 * exactly what breaks on demo day.
 *
 *   npm run dev          (in one terminal)
 *   npm run smoke        (in another)
 */
export {}; // top-level await needs this file to be a module

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail: string) {
  if (ok) {
    pass++;
    console.log(`  ok    ${label.padEnd(34)} ${detail}`);
  } else {
    fail++;
    failures.push(`${label} — ${detail}`);
    console.log(`  FAIL  ${label.padEnd(34)} ${detail}`);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface Candidate { product_id: string; score: number; confident: boolean }
interface Resolved {
  found?: boolean;
  name?: string;
  candidates?: Candidate[];
  ingredients?: { crop_id: string }[];
  ok?: boolean;
  error?: string;
  items?: { name: string; confidence: number; candidates: Candidate[] }[];
}
interface Result {
  footprint_l: { green: number; blue: number; grey: number; total: number };
  stress_score: number;
  sources: { state: string; level: string; soe_pct: number; share: number }[];
  swap: { saves_l: number } | null;
  human_equivalent: { key: string };
  confidence: { quality: string };
  lineage: { fallbacks_used: string[] };
}

// ── 1. Search, including the multilingual clause ───────────────────────────
async function searchChecks() {
  console.log("\nSEARCH  (text resolver, all four languages)");
  const cases: [string, string, string][] = [
    ["bhindi", "hi", "okra_raw"],
    ["भेंडी", "mr", "okra_raw"],
    ["vendakkai", "ta", "okra_raw"],
    ["गोभी", "hi", "cauliflower_raw"],
    ["khajur", "en", "dates_raw"],
    ["gur", "hi", "jaggery"],
    ["tofu", "en", "soy_curd_raw"],
    ["வெல்லம்", "ta", "jaggery"],
    ["biryani", "en", "biryani_chicken"],
    // The Hindi word for the fibre resolves to the fibre, not to a garment
    // made from it — searching "cotton" should not jump to a t-shirt.
    ["कपास", "hi", "cotton_raw"],
    ["t-shirt", "en", "cotton_tshirt"],
  ];
  for (const [q, lang, expected] of cases) {
    const hits = await get<Candidate[]>(`/api/product/search?q=${encodeURIComponent(q)}&lang=${lang}`);
    const top = hits[0];
    check(
      `"${q}" (${lang})`,
      top?.product_id === expected,
      top ? `${top.product_id} @ ${Math.round(top.score * 100)}%` : "no match",
    );
  }

  const junk = await get<Candidate[]>("/api/product/search?q=zzqqxx&lang=en");
  check("nonsense returns no confident hit", junk.every((h) => !h.confident), `${junk.length} suggestions, none confident`);
}

// ── 2. Water footprint — the actual calculation ────────────────────────────
async function footprintChecks() {
  console.log("\nWATER FOOTPRINT  (engine via /api/calculate)");

  const biryani = await post<Result>("/api/calculate", { product_id: "biryani_chicken", lang: "en", month: 7 });
  const f = biryani.footprint_l;
  check("biryani totals", f.green + f.blue + f.grey === f.total, `${f.total} L = ${f.green}+${f.blue}+${f.grey}`);
  check("biryani has sources", biryani.sources.length > 0, `${biryani.sources.length} states`);
  check("biryani suggests a swap", (biryani.swap?.saves_l ?? 0) > 0, `saves ${biryani.swap?.saves_l ?? 0} L`);
  check("biryani has an equivalence", biryani.human_equivalent.key.startsWith("result.eq."), biryani.human_equivalent.key);

  // "where the water is taken from" — the PS's central claim
  const punjab = await post<Result>("/api/calculate", { product_id: "rice_raw", lang: "en", force_state: "Punjab" });
  const wb = await post<Result>("/api/calculate", { product_id: "rice_raw", lang: "en", force_state: "West Bengal" });
  check(
    "same rice, different state",
    punjab.stress_score !== wb.stress_score,
    `Punjab ${punjab.stress_score} vs West Bengal ${wb.stress_score}`,
  );
  check("grey is not stress-weighted", punjab.footprint_l.grey === wb.footprint_l.grey, `${punjab.footprint_l.grey} L both`);

  // "and when"
  const rabi = await post<Result>("/api/calculate", { product_id: "rice_raw", lang: "en", month: 1 });
  const kharif = await post<Result>("/api/calculate", { product_id: "rice_raw", lang: "en", month: 7 });
  check("month changes irrigation", rabi.footprint_l.blue !== kharif.footprint_l.blue, `rabi ${rabi.footprint_l.blue} L vs kharif ${kharif.footprint_l.blue} L`);
  check(
    "season conserves the published total",
    Math.abs(rabi.footprint_l.total - kharif.footprint_l.total) <= 2,
    `${rabi.footprint_l.total} vs ${kharif.footprint_l.total}`,
  );

  // groundwater labelling
  const labelled = punjab.sources.every((s) => s.level === "state" || s.level === "national");
  check("every source is labelled", labelled, punjab.sources.map((s) => `${s.state}(${s.level})`).join(" "));

  // non-food, the "daily life" clause
  const shirt = await post<Result>("/api/calculate", { product_id: "cotton_tshirt", lang: "en" });
  check("cotton t-shirt calculates", shirt.footprint_l.total > 0, `${shirt.footprint_l.total} L`);

  // Compare, seeded the way the UI seeds it — with a product_id, not a name.
  interface Compare { items: { product: { id: string } }[]; best: string; ranked_by: string }
  const byId = await get<Compare>("/api/compare?products=rice_raw,bajra_raw&lang=en");
  check(
    "compare honours exact product ids",
    byId.items.map((i) => i.product.id).join(",") === "rice_raw,bajra_raw",
    byId.items.map((i) => i.product.id).join(", "),
  );
  check("compare ranks millet above rice", byId.best === "bajra_raw", `best ${byId.best} by ${byId.ranked_by}`);

  const byName = await get<Compare>("/api/compare?products=rice,bajra,jowar&lang=en");
  check("compare still accepts names", byName.items.length === 3, byName.items.map((i) => i.product.id).join(", "));

  // a newly merged crop
  const dates = await post<Result>("/api/calculate", { product_id: "dates_raw", lang: "en" });
  check(
    "new Table 3 crop calculates",
    dates.footprint_l.total > 0 && dates.confidence.quality === "low",
    `dates ${dates.footprint_l.total} L, quality "${dates.confidence.quality}" (flagged: ${dates.lineage.fallbacks_used.filter((x) => x.includes("production_share")).length > 0})`,
  );
}

// ── 3. Community, city water, map data ─────────────────────────────────────
async function waterScreenChecks() {
  console.log("\nCITY WATER + COMMUNITY");
  interface City { city: string; reservoirs: unknown[]; overall_pct: number; groundwater: { level: string } | null }
  const mumbai = await get<City>("/api/city/Mumbai/water");
  check("Mumbai reservoirs", mumbai.reservoirs.length === 7, `${mumbai.reservoirs.length} reservoirs, ${mumbai.overall_pct}% stored`);
  check("Mumbai groundwater labelled", Boolean(mumbai.groundwater?.level), mumbai.groundwater?.level ?? "none");

  interface Agg { scans: number; total_litres: number; top_items: unknown[] }
  const agg = await get<Agg>("/api/community/aggregate?region=Mumbai&lang=en");
  check("community aggregate", agg.scans > 0 && agg.total_litres > 0, `${agg.scans} scans, ${agg.total_litres} L`);

  // Assert the ARRAY, not the count. The old check read `count`, which is
  // computed before the limit is applied — so it reported 168 while the
  // endpoint served a single product, and Explore sat empty behind a green tick.
  interface Cat { count: number; categories: string[]; items: { product_id: string; type: string }[] }
  const cat = await get<Cat>("/api/catalogue?lang=en");
  check(
    "catalogue returns its items",
    cat.items.length === cat.count && cat.items.length > 100,
    `${cat.items.length} items returned of ${cat.count} counted, ${cat.categories.length} categories`,
  );

  // Every category tab must have something behind it, or Explore shows a
  // filter that leads nowhere.
  for (const category of cat.categories.filter((c) => c !== "All")) {
    const page = await get<Cat>(`/api/catalogue?lang=en&category=${encodeURIComponent(category)}`);
    check(`category "${category}"`, page.items.length > 0, `${page.items.length} products`);
  }

  // The home grid's curated picks must all still exist.
  const ids = new Set(cat.items.map((i) => i.product_id));
  const everyday = ["roti", "dal_tadka", "biryani_chicken", "chai", "paneer_butter_masala", "cotton_tshirt"];
  const missing = everyday.filter((id) => !ids.has(id));
  check("home grid picks all resolve", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "all 6 present");
}

// ── 4. Barcode — real Open Food Facts lookups ──────────────────────────────
async function barcodeChecks() {
  console.log("\nBARCODE  (live Open Food Facts)");

  // Coverage is a property of OFF's database, not of this code: a product
  // nobody has photographed is simply absent. So the assertion is that every
  // lookup RESOLVES CLEANLY — a hit with mapped crops, or an honest miss — and
  // coverage is reported as a number rather than asserted.
  const cases: [string, string][] = [
    ["8901058000108", "Maggi 2-Minute Noodles"],
    ["8901719101007", "Parle-G"],
    ["8901491101813", "Lay's American Cream & Onion"],
    ["8901063093010", "Britannia Good Day"],
    ["8901030865305", "Surf Excel"],
    ["8901725004156", "Kurkure"],
  ];

  let hits = 0;
  for (const [ean, label] of cases) {
    try {
      const r = await post<Resolved>("/api/resolve", { input_type: "barcode", value: ean, lang: "en" });
      const mapped = Boolean(r.found && r.ingredients && r.ingredients.length > 0);
      if (mapped) hits++;
      check(
        label,
        // A clean miss is a pass: the UI falls back to search rather than
        // inventing a footprint.
        r.found === false || mapped,
        r.found ? `${r.name} · ${r.ingredients?.length ?? 0} crops mapped` : "not in OFF — falls back to search",
      );
    } catch (e) {
      check(label, false, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`        coverage: ${hits}/${cases.length} of these barcodes return a footprint`);
}

// ── 5. Image recognition — real Gemini call ────────────────────────────────
async function visionChecks() {
  console.log("\nIMAGE RECOGNITION  (live Gemini)");
  // A 1x1 PNG: the model should decline rather than hallucinate a vegetable.
  const tiny =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  try {
    const r = await post<Resolved>("/api/resolve", {
      input_type: "image",
      image: tiny,
      media_type: "image/png",
      lang: "en",
    });
    if (r.ok === false && r.error) {
      check("vision endpoint reachable", !/quota|429/i.test(r.error), `declined: ${r.error}`);
    } else {
      check("vision endpoint reachable", true, `${r.items?.length ?? 0} item(s) detected on a blank image`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check("vision endpoint reachable", false, msg.slice(0, 160));
  }
}

// ── 6. Every /api/resolve branch returns the same shape ────────────────────
async function resolveShapeChecks() {
  console.log("\nRESOLVE CONTRACT  (all four input types agree on a shape)");

  // The confirmation sheet reads `candidates` and `items` off whatever comes
  // back, whichever button produced it. When the image branch quietly omitted
  // `candidates`, the sheet crashed on `.length` the first time a photo was
  // scanned — and no test noticed, because the crash was in the browser.
  const tiny =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const branches: [string, unknown][] = [
    ["name", { input_type: "name", value: "rice", lang: "en" }],
    ["voice", { input_type: "voice", value: "chawal", lang: "en" }],
    ["barcode", { input_type: "barcode", value: "8901719101007", lang: "en" }],
    ["image", { input_type: "image", image: tiny, media_type: "image/png", lang: "en" }],
  ];

  for (const [label, payload] of branches) {
    try {
      const r = await post<Resolved & { candidates?: unknown }>("/api/resolve", payload);
      const okShape = Array.isArray(r.candidates);
      const itemsOk = r.items === undefined || r.items.every((i) => Array.isArray(i.candidates));
      check(
        `${label} returns candidates[]`,
        okShape && itemsOk,
        okShape ? `${(r.candidates as unknown[]).length} candidates` : `candidates is ${typeof r.candidates}`,
      );
    } catch (e) {
      check(`${label} returns candidates[]`, false, e instanceof Error ? e.message : String(e));
    }
  }
}

const t0 = Date.now();
await searchChecks();
await footprintChecks();
await waterScreenChecks();
await barcodeChecks();
await visionChecks();
await resolveShapeChecks();

console.log(`\n${pass} passed, ${fail} failed  (${Date.now() - t0} ms)`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
