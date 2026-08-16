/**
 * Freeze the demo payloads into data/demo/.
 *
 *   payloads.json   the five locked items, calculated offline
 *   barcodes.json   REAL Open Food Facts responses, snapshotted
 *
 * Run: npm run demo:build   (also runs in prebuild)
 *
 * The barcode snapshot is the point of this file. The engine never touches the
 * network, so `/api/calculate` was never at risk — but a barcode scan calls
 * Open Food Facts live, and venue WiFi is exactly what `?demo=true` exists to
 * survive. These are cached real responses, not invented ones: if the fetch
 * fails at build time the entry is skipped rather than faked.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calculateProduct } from "../repo/db.ts";
import { DEMO_ITEMS } from "../app/api/_lib/demo-items.ts";
import { resolveBarcode } from "../resolvers/barcode.ts";

const OUT_DIR = join(process.cwd(), "data", "demo");

/**
 * Barcodes worth having offline. Verified to exist on Open Food Facts and to
 * map to crops we hold — a barcode that returns nothing is not worth caching.
 */
const DEMO_BARCODES = ["8901719101007", "8901491101813"];

/** Snapshot live OFF responses, keeping whatever already worked if we are offline. */
async function buildBarcodes(): Promise<number> {
  const path = join(OUT_DIR, "barcodes.json");
  const existing: Record<string, unknown> = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)
    : {};

  for (const ean of DEMO_BARCODES) {
    try {
      const result = await resolveBarcode(ean);
      if (result.found) {
        existing[ean] = result;
        console.log(`    ${ean}  ${result.name} · ${result.ingredients.length} crops`);
      } else {
        console.warn(`    ${ean}  not usable (${result.error ?? "no ingredients"}) — keeping any previous snapshot`);
      }
    } catch (err) {
      console.warn(`    ${ean}  fetch failed (${err instanceof Error ? err.message : String(err)}) — keeping any previous snapshot`);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(existing, null, 2), "utf8");
  return Object.keys(existing).length;
}

async function main() {
  const payloads: Record<string, unknown> = {};
  const failures: string[] = [];

  for (const id of DEMO_ITEMS) {
    try {
      // Month pinned so the cached payload is reproducible.
      payloads[id] = calculateProduct(id, { month: 7 });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length) {
    console.error("✗ demo build failed:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "payloads.json"), JSON.stringify(payloads, null, 2), "utf8");
  console.log(`✓ cached ${DEMO_ITEMS.length} demo payloads → data/demo/payloads.json`);
  for (const id of DEMO_ITEMS) {
    const p = payloads[id] as { footprint_l: { total: number }; stress_score: number };
    console.log(`    ${id.padEnd(20)} ${String(p.footprint_l.total).padStart(6)} L  score ${p.stress_score}`);
  }

  console.log("  snapshotting barcodes for offline demo…");
  const cached = await buildBarcodes();
  console.log(`✓ ${cached} barcode(s) cached → data/demo/barcodes.json`);
  if (cached === 0) {
    console.warn("  ⚠ no barcode snapshot — a barcode scan will not work under ?demo=true");
  }
}

await main();
