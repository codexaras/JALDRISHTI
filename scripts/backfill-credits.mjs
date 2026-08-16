/**
 * Fill in the licence and author for rows in data/product_image.csv that still
 * say "unknown".
 *
 *   node scripts/backfill-credits.mjs
 *
 * The bulk fetch asks Commons for 40 files at a time and quietly returns
 * nothing for most of them, so attribution was missing for images we are
 * shipping. This walks the same query in small batches with retries. Attribution
 * is a licence condition, not a nicety — an image whose author we cannot name
 * should be replaced, not published.
 *
 * Safe to re-run: rows that already have a licence are skipped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UA = "JalDrishti/1.0 (SIH 2026 hackathon prototype; image fetch)";
const CSV = join(process.cwd(), "data", "product_image.csv");
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
const esc = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const strip = (h) => String(h ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/** The download URL contains the Commons file name — recover it from there. */
function fileNameFromUrl(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const parts = path.split("/").filter(Boolean);
    // .../commons/thumb/a/ab/Name.jpg/640px-Name.jpg  → "Name.jpg"
    // .../commons/a/ab/Name.jpg                       → "Name.jpg"
    const idx = parts.indexOf("thumb");
    const name = idx >= 0 ? parts[idx + 3] : parts[parts.length - 1];
    return name?.replace(/_/g, " ") ?? null;
  } catch {
    return null;
  }
}

const lines = readFileSync(CSV, "utf8").trim().split("\n");
const head = splitCsvLine(lines[0]);
const C = Object.fromEntries(head.map((h, i) => [h, i]));
const rows = lines.slice(1).map(splitCsvLine);

const needed = rows.filter((r) => !r[C.licence] || r[C.licence] === "unknown");
console.log(`${needed.length} of ${rows.length} rows need attribution`);

const byFile = new Map();
for (const r of needed) {
  const f = fileNameFromUrl(r[C.download_url]);
  if (f) byFile.set(f, [...(byFile.get(f) ?? []), r]);
}
const files = [...byFile.keys()];
console.log(`resolving ${files.length} distinct files…\n`);

let filled = 0;
for (let i = 0; i < files.length; i += 10) {
  const batch = files.slice(i, i + 10);
  let done = false;

  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      const url =
        "https://commons.wikimedia.org/w/api.php?" +
        new URLSearchParams({
          format: "json",
          action: "query",
          titles: batch.map((f) => `File:${f}`).join("|"),
          prop: "imageinfo",
          iiprop: "extmetadata|url",
        });
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const j = await res.json();

      for (const page of Object.values(j.query?.pages ?? {})) {
        const info = page.imageinfo?.[0];
        if (!info) continue;
        const meta = info.extmetadata ?? {};
        const name = page.title.replace(/^File:/, "");
        for (const row of byFile.get(name) ?? []) {
          row[C.licence] = strip(meta.LicenseShortName?.value) || "unknown";
          row[C.artist] = strip(meta.Artist?.value) || "unknown";
          row[C.source_url] = info.descriptionurl ?? "";
          if (row[C.licence] !== "unknown") filled++;
        }
      }
      done = true;
      process.stdout.write(`  ${Math.min(i + 10, files.length)}/${files.length}\r`);
    } catch (e) {
      if (attempt === 3) console.log(`\n  batch at ${i} failed: ${e.message}`);
      else await sleep(attempt * 2500);
    }
  }
  await sleep(700);
}

writeFileSync(CSV, [head.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n");

const still = rows.filter((r) => !r[C.licence] || r[C.licence] === "unknown").length;
console.log(`\n\n${filled} rows given a licence · ${still} still unknown`);
