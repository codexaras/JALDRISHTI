import { cities, cityWater } from "../../../../../repo/db.ts";
import { bad, ok } from "../../../_lib/respond.ts";

/**
 * GET /api/city/{city}/water
 *
 * PS: "at the community as well as at the personal levels". A personal
 * footprint is abstract until you can see the reservoir it is drawn from.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ city: string }> },
): Promise<Response> {
  const { city } = await context.params;
  const report = cityWater(decodeURIComponent(city));

  if (!report) {
    return bad(`no reservoir data for "${city}". Known cities: ${cities().join(", ")}`, 404);
  }
  return ok(report);
}
