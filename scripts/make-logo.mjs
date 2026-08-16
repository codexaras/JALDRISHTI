/**
 * Prepare the supplied JalDrishti logo for the header.
 *
 *   - trim the surrounding white margin, which is most of the file
 *   - drop the white background to transparency so it sits on any surface
 *   - emit a wordmark (full lockup) and a mark-only square for the favicon
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const SRC = "C:/Users/LEGION/Downloads/ChatGPT Image Aug 16, 2026, 08_38_26 PM.png";
const OUT = join(process.cwd(), "public", "img");
mkdirSync(OUT, { recursive: true });

const input = readFileSync(SRC);
const meta = await sharp(input).metadata();
console.log(`source ${meta.width}x${meta.height}, ${Math.round(input.length / 1024)} KB`);

// White → alpha. The logo is pure white behind, so a high threshold is safe and
// keeps the anti-aliased edges of the letterforms intact.
async function transparent(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (r > 244 && g > 244 && b > 244) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer();
}

// 1. Full lockup — trimmed, transparent, sized for a retina header.
const lockup = await sharp(await transparent(input))
  .trim({ threshold: 10 })
  .resize({ height: 160, withoutEnlargement: true })
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(join(OUT, "logo.png"), lockup);
const lm = await sharp(lockup).metadata();
console.log(`logo.png       ${lm.width}x${lm.height}  ${Math.round(lockup.length / 1024)} KB`);

// 2. Mark only — the droplet, for the favicon and the mobile header. The
//    droplet occupies roughly the first fifth of the lockup.
const trimmed = await sharp(await transparent(input)).trim({ threshold: 10 }).toBuffer();
const tm = await sharp(trimmed).metadata();
const markWidth = Math.round(tm.width * 0.2);
const mark = await sharp(trimmed)
  .extract({ left: 0, top: 0, width: markWidth, height: tm.height })
  .trim({ threshold: 10 })
  .resize({ height: 256, withoutEnlargement: true })
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(join(OUT, "logo-mark.png"), mark);
const mm = await sharp(mark).metadata();
console.log(`logo-mark.png  ${mm.width}x${mm.height}  ${Math.round(mark.length / 1024)} KB`);

// 3. Favicon + PWA icons from the mark, on the brand cream so the droplet's
//    white interior does not vanish against a dark browser theme.
for (const size of [192, 512]) {
  const buf = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 247, g: 244, b: 233, alpha: 1 } },
  })
    .composite([
      {
        input: await sharp(mark).resize({ height: Math.round(size * 0.76), fit: "contain" }).toBuffer(),
        gravity: "centre",
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(OUT, `../icon-${size}.png`), buf);
  console.log(`icon-${size}.png  ${size}x${size}  ${Math.round(buf.length / 1024)} KB`);
}
