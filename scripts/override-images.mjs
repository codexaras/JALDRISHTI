/**
 * Replace specific products' images with a hand-picked Commons file.
 *
 *   node scripts/override-images.mjs
 *
 * Wikipedia's lead image is usually the best available, but not always: the
 * "Parle-G" article leads with the brand logo, "Sari" with a 1940s portrait,
 * and a few dish articles have no image at all. Those are chosen here by file
 * name instead, resolved through the Commons API for a thumbnail URL and its
 * licence, then merged into data/product_image.csv.
 *
 * Adding an entry here is a deliberate editorial choice and should stay rare —
 * the article lead image is the default for a reason.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const UA = "JalDrishti/1.0 (SIH 2026 hackathon prototype; image fetch)";
const OUT = join(process.cwd(), "public", "img", "products");
const CSV = join(process.cwd(), "data", "product_image.csv");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** product_id → exact Commons file name (without the "File:" prefix). */
const OVERRIDES = {
  // The article leads with the brand logo; this is the actual biscuit.
  parle_g_biscuit: "Parle-G Biscuit.jpg",
  // "Sari" leads with a 1940s studio portrait — not a garment on a shelf.
  cotton_saree: "Border of Tangail sari,from the 1970s.jpg",
  // Articles with no lead image at all.
  bhindi_masala: "Bhindi Masala.jpg",
  egg_curry: "Spicy Anda Curry.jpg",
  // Dish articles whose lead image is an ingredient rather than the dish.
  roti: "Chapati roti.jpg",
  dal_tadka: "Dal tadka and chapati.jpg",
  dal_rice: "Dal bhat.jpg",
  khichdi: "Masala Khichadi.jpg",
  upma: "Upma South India.JPG",
  vada_pav: "Crunchy Crispy Vada pav.jpg",
};

function splitCsvLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const esc = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const strip = (h) => String(h ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

mkdirSync(OUT, { recursive: true });

const ids = Object.keys(OVERRIDES);
const url =
  "https://commons.wikimedia.org/w/api.php?" +
  new URLSearchParams({
    format: "json",
    action: "query",
    titles: ids.map((id) => `File:${OVERRIDES[id]}`).join("|"),
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "640",
  });

const j = await (await fetch(url, { headers: { "User-Agent": UA } })).json();
const byFile = new Map();
for (const page of Object.values(j.query?.pages ?? {})) {
  const info = page.imageinfo?.[0];
  if (!info) { console.log(`  not found: ${page.title}`); continue; }
  const meta = info.extmetadata ?? {};
  byFile.set(page.title.replace(/^File:/, ""), {
    thumb: info.thumburl ?? info.url,
    licence: strip(meta.LicenseShortName?.value) || "unknown",
    artist: strip(meta.Artist?.value) || "unknown",
    source: info.descriptionurl ?? "",
  });
}

// Merge into the manifest.
const lines = readFileSync(CSV, "utf8").trim().split("\n");
const head = splitCsvLine(lines[0]);
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const rows = lines.slice(1).map(splitCsvLine);
const index = new Map(rows.map((r, i) => [r[col.product_id], i]));

let updated = 0;
for (const id of ids) {
  const hit = byFile.get(OVERRIDES[id]);
  if (!hit) continue;
  const row = index.has(id) ? rows[index.get(id)] : head.map(() => "");
  row[col.product_id] = id;
  row[col.path] = `/img/products/${id}.jpg`;
  row[col.article] = OVERRIDES[id];
  row[col.download_url] = hit.thumb;
  row[col.licence] = hit.licence;
  row[col.artist] = hit.artist;
  row[col.source_url] = hit.source;
  if (!index.has(id)) rows.push(row);
  updated++;
}

rows.sort((a, b) => a[col.product_id].localeCompare(b[col.product_id]));
writeFileSync(CSV, [head.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n");
console.log(`manifest: ${updated} rows overridden`);

// Fetch them now, replacing whatever is on disk.
let saved = 0;
const failed = [];
for (const id of ids) {
  const hit = byFile.get(OVERRIDES[id]);
  if (!hit) continue;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(hit.thumb, {
        headers: { "User-Agent": UA, Accept: "image/*" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error("not an image");
      writeFileSync(join(OUT, `${id}.jpg`), buf);
      saved++;
      console.log(`  ok    ${id}  (${hit.licence})`);
      break;
    } catch (e) {
      if (attempt === 3) { failed.push(`${id}: ${e.message}`); console.log(`  fail  ${id}  ${e.message}`); }
      else await sleep(attempt * 3000);
    }
  }
  await sleep(1200);
}

console.log(`\n${saved} downloaded, ${failed.length} failed`);
console.log(`${new Set(readFileSync(CSV, "utf8").trim().split("\n").slice(1).map((l) => splitCsvLine(l)[col.product_id])).size} products in manifest`);
console.log(`${ids.filter((id) => existsSync(join(OUT, `${id}.jpg`))).length}/${ids.length} overrides now on disk`);
