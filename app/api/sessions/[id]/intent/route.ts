import { assertSameOrigin } from "../../../../../lib/auth";
import { jsonBody, ownedRequest } from "../../../../../lib/api";
import { AppError, errorResponse } from "../../../../../lib/errors";
import { recordBackingIntent } from "../../../../../lib/store";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const { db } = ownedRequest(request, id);
    const body = await jsonBody(request);
    if (body.kind !== "back_design" || typeof body.willingPriceCents !== "number") {
      throw new AppError("invalid_intent", "Choose a sample and enter the price you would pay.");
    }
    recordBackingIntent(db, id, body.willingPriceCents);
    return Response.json({ recorded: true, paymentCreated: false });
  } catch (error) {
    return errorResponse(error);
  }
}
