import { assertSameOrigin } from "../../../../../lib/auth";
import { jsonBody, ownedRequest } from "../../../../../lib/api";
import { AppError, errorResponse } from "../../../../../lib/errors";
import { recordFittingIntent } from "../../../../../lib/store";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const { db } = ownedRequest(request, id);
    const body = await jsonBody(request);
    if (body.kind !== "reserve_fitting") {
      throw new AppError("invalid_intent", "Only the demo fitting action is supported.");
    }
    recordFittingIntent(db, id);
    return Response.json({ recorded: true, bookingCreated: false });
  } catch (error) {
    return errorResponse(error);
  }
}
