/**
 * Test whether the camera can actually identify a vegetable.
 *
 *   npm run test:vision -- path/to/photo.jpg [more.jpg ...]
 *
 * Requires ANTHROPIC_API_KEY (put it in .env.local, or export it).
 *
 * Reports three separate things, because they fail for different reasons:
 *   1. did the model identify anything?
 *   2. does what it identified exist in our catalogue?
 *   3. would that produce a footprint?
 *
 * A photo can pass 1 and fail 2 — the model correctly says "bitter gourd" and
 * we have no crop row for it. That is a data gap, not a vision failure, and
 * this script tells the two apart.
 */
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { resolveImage } from "../resolvers/vision.ts";
import { calculateProduct } from "../repo/db.ts";

const MEDIA: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function readEnvLocal(): void {
  // Minimal .env.local reader so you don't have to export the key by hand.
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  readEnvLocal();
  const env = {
    VISION_PROVIDER: process.env.VISION_PROVIDER,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  };

  if (!env.GEMINI_API_KEY && !env.GOOGLE_API_KEY && !env.ANTHROPIC_API_KEY) {
    console.error(
      "\n✗ No vision key configured.\n\n" +
        "  Free option (recommended):\n" +
        "    1. https://aistudio.google.com/apikey  → Create API key\n" +
        "    2. cp .env.example .env.local\n" +
        "    3. paste it into GEMINI_API_KEY=\n\n" +
        "  Or set ANTHROPIC_API_KEY for Claude.\n" +
        "  Without either, the scan screen falls back to manual search by design.\n",
    );
    process.exit(1);
  }

  const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (files.length === 0) {
    console.error("\n  usage: npm run test:vision -- photo1.jpg [photo2.jpg ...]\n");
    process.exit(1);
  }

  let identified = 0;
  let matched = 0;
  let calculated = 0;

  for (const file of files) {
    console.log(`\n${"─".repeat(70)}\n${file}`);

    if (!existsSync(file)) {
      console.log("  ✗ file not found");
      continue;
    }
    const mediaType = MEDIA[extname(file).toLowerCase()];
    if (!mediaType) {
      console.log(`  ✗ unsupported type "${extname(file)}" — use jpg, png or webp`);
      continue;
    }

    const started = Date.now();
    const result = await resolveImage(readFileSync(file).toString("base64"), mediaType, { env });
    const ms = Date.now() - started;

    if (!result.ok) {
      console.log(`  ✗ vision failed: ${result.error}  [${result.provider ?? "no provider"}]  (${ms} ms)`);
      continue;
    }
    if (result.items.length === 0) {
      console.log(`  ○ model saw no food in this image  [${result.provider}]  (${ms} ms)`);
      continue;
    }

    identified++;
    for (const item of result.items) {
      const confidence = `${Math.round(item.confidence * 100)}%`;
      console.log(`  ✓ identified: "${item.name}"  ~${item.est_grams} g  confidence ${confidence}  (${ms} ms)`);

      const best = item.candidates[0];
      if (!best) {
        console.log(`      ✗ NOT IN CATALOGUE — no product matches "${item.name}"`);
        console.log("        (this is a data gap, not a vision failure)");
        continue;
      }

      console.log(`      → catalogue match: ${best.name} (${best.product_id}) at ${best.score}%${best.confident ? "" : "  ⚠ below the confidence threshold"}`);
      matched++;

      try {
        const calc = calculateProduct(best.product_id, { servingG: item.est_grams || undefined });
        console.log(`      → ${calc.footprint_l.total} L total · green ${calc.footprint_l.green} / blue ${calc.footprint_l.blue} / grey ${calc.footprint_l.grey} · score ${calc.stress_score}`);
        calculated++;
      } catch (err) {
        console.log(`      ✗ could not calculate: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  identified by the model : ${identified}/${files.length}`);
  console.log(`  matched to a product    : ${matched}`);
  console.log(`  produced a footprint    : ${calculated}`);
  console.log(
    "\n  If a photo is identified but not matched, the fix is a new row in\n" +
      "  data/crop.csv + data/product.csv, not a change to the vision code.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
