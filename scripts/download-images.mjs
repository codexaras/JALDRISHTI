/**
 * Download the images listed in data/product_image.csv.
 *
 *   node scripts/download-images.mjs           only what is missing
 *   node scripts/download-images.mjs --force   re-fetch everything
 *
 * Separate from fetch-images.ts because resolving WHICH image a product needs
 * (Wikipedia's API) and FETCHING it (upload.wikimedia.org) are different hosts
 * with different reachability. Resolution is cheap and reliable; downloading is
 * the part that needs patience and retries. Re-run this as often as you like —
 * it only fetches what is absent.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const UA = "JalDrishti/1.0 (SIH 2026 hackathon prototype; image fetch)";
const OUT = join(process.cwd(), "public", "img", "products");
const FORCE = process.argv.includes("--force");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

mkdirSync(OUT, { recursive: true });

const lines = readFileSync(join(process.cwd(), "data", "product_image.csv"), "utf8").trim().split("\n");
const head = splitCsvLine(lines[0]);
const idCol = head.indexOf("product_id");
const urlCol = head.indexOf("download_url");

const rows = lines.slice(1).map(splitCsvLine).map((c) => ({ id: c[idCol], url: c[urlCol] }));
const todo = rows.filter((r) => r.url && (FORCE || !existsSync(join(OUT, `${r.id}.jpg`))));

console.log(`${rows.length} in manifest · ${rows.length - todo.length} already on disk · ${todo.length} to fetch\n`);

let saved = 0;
const failed = [];

for (const [i, row] of todo.entries()) {
  let ok = false;
  // The CDN refuses or times out intermittently from some networks, so each
  // file gets three tries with a widening pause before it is called a failure.
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      const res = await fetch(row.url, {
        headers: { "User-Agent": UA, Accept: "image/*" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error(`${buf.length} bytes — not an image`);
      writeFileSync(join(OUT, `${row.id}.jpg`), buf);
      saved++;
      ok = true;
      process.stdout.write(`  ${String(i + 1).padStart(3)}/${todo.length}  ${row.id} (${Math.round(buf.length / 1024)} KB)\n`);
    } catch (e) {
      if (attempt === 3) failed.push(`${row.id}: ${e.message}`);
      else await sleep(attempt * Number(process.env.IMG_RETRY_MS ?? 1500));
    }
  }
  await sleep(Number(process.env.IMG_DELAY_MS ?? 150));
}

console.log(`\n${saved} downloaded, ${failed.length} failed`);
if (failed.length) {
  writeFileSync(join(process.cwd(), "data", "images-missing.txt"), failed.join("\n") + "\n");
  console.log(`failures written to data/images-missing.txt`);
  for (const f of failed.slice(0, 10)) console.log(`  ${f}`);
}

const onDisk = rows.filter((r) => existsSync(join(OUT, `${r.id}.jpg`))).length;
console.log(`\n${onDisk}/${rows.length} products now have a photo`);
