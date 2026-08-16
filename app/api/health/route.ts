import {
  allCrops,
  allProducts,
  allDistricts,
  builtAt,
  catalogDistribution,
  recordedMisses,
} from "../../../repo/db.ts";
import { demoIndex } from "../_lib/demo.ts";
import { ok } from "../_lib/respond.ts";

export async function GET(): Promise<Response> {
  const misses = recordedMisses();
  return ok({
    status: misses.length === 0 ? "ok" : "degraded",
    data_built_at: builtAt(),
    counts: {
      crops: allCrops().length,
      products: allProducts().length,
      districts: allDistricts().length,
      states_and_uts: new Set(allDistricts().map((d) => d.state)).size,
      catalogue_ranked: catalogDistribution().length,
    },
    demo_items: demoIndex(),
    // A Worker cannot append to data/missing.log, so misses surface here.
    missing_data: misses,
  });
}
