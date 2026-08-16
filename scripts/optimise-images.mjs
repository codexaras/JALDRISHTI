/**
 * Downscale the product photographs in place.
 *
 *   node scripts/optimise-images.mjs [--width 640] [--quality 78]
 *
 * Wikimedia serves the file at whatever size the original was — beetroot
 * arrived at 2.1 MB for a tile that renders about 170 px tall. Explore shows
 * over a hundred of these at once, so the unoptimised set made the page crawl
 * and bloated the repository.
 *
 * Only ever downscales: an image already narrower than the target is left
 * alone rather than upscaled into blur. Safe to re-run — a second pass finds
 * nothing to do.
 *
 * `sharp` is not a declared dependency; it is present transitively. If this
 * script ever fails with "cannot find module", the images are already committed
 * and nothing is lost — it is an optimiser, not part of the build.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const DIR = join(process.cwd(), "public", "img", "products");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const WIDTH = arg("width", 640);
const QUALITY = arg("quality", 78);

const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".jpg"));
const kb = (n) => Math.round(n / 1024);

let before = 0, after = 0, resized = 0, skipped = 0;
const failures = [];

for (const file of files) {
  const path = join(DIR, file);
  const originalSize = statSync(path).size;
  before += originalSize;

  try {
    // Read through fs, not by path. Given a path, libvips fails on this
    // machine with "UNKNOWN: unknown error, open" for every file, while
    // readFileSync on the same path succeeds — so hand sharp the bytes and
    // keep all filesystem access in Node.
    const input = readFileSync(path);
    const image = sharp(input);
    const meta = await image.metadata();

    // Never upscale, and never re-encode something already small — repeated
    // JPEG encoding loses quality every time.
    if ((meta.width ?? 0) <= WIDTH && originalSize < 120 * 1024) {
      skipped++;
      after += originalSize;
      continue;
    }

    const buf = await image
      .resize({ width: WIDTH, withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer();

    // Keep whichever is smaller — re-encoding does not always win.
    if (buf.length < originalSize) {
      writeFileSync(path, buf);
      after += buf.length;
      resized++;
      if (originalSize > 400 * 1024) {
        console.log(`  ${file.padEnd(28)} ${String(kb(originalSize)).padStart(5)} KB -> ${String(kb(buf.length)).padStart(4)} KB`);
      }
    } else {
      after += originalSize;
      skipped++;
    }
  } catch (e) {
    failures.push(`${file}: ${e.message}`);
    after += originalSize;
  }
}

console.log(
  `\n${files.length} images · ${resized} resized · ${skipped} left as they were` +
    (failures.length ? ` · ${failures.length} failed` : ""),
);
console.log(`${(before / 1024 / 1024).toFixed(1)} MB -> ${(after / 1024 / 1024).toFixed(1)} MB`);
for (const f of failures) console.log(`  ${f}`);
