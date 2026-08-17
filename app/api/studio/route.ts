import { requireBuyingRoomAccess } from "../../../lib/auth";
import { getDb } from "../../../lib/db";
import { errorResponse } from "../../../lib/errors";
import { campaignReport } from "../../../lib/store";

export const runtime = "nodejs";

export function GET(request: Request) {
  try {
    requireBuyingRoomAccess(request);
    return Response.json(campaignReport(getDb()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
