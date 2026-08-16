import { communityAggregate, regions } from "../../../../repo/db.ts";
import { bad, langOf, ok } from "../../_lib/respond.ts";

/**
 * GET /api/community/aggregate?region=
 *
 * PS: "community as well as personal levels". Totals the scans recorded for a
 * region, names the items costing it the most water, and reports virtual water
 * inflow — the litres embedded in produce grown somewhere else.
 *
 * Region only. There is no user, device or session identifier in this data set
 * and the validation script fails the build if a column resembling one appears.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const region = (url.searchParams.get("region") ?? "").trim();
  const lang = langOf(url.searchParams.get("lang"));

  if (!region) {
    return bad(`region is required. Known regions: ${regions().join(", ")}`);
  }

  const aggregate = communityAggregate(region, lang);
  if (aggregate.scans === 0) {
    return ok({ ...aggregate, empty: true, known_regions: regions() });
  }
  return ok(aggregate);
}
