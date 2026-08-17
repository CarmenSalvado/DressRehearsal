import { assertSameOrigin } from "../../../../../lib/auth";
import { jsonBody, ownedRequest } from "../../../../../lib/api";
import { AppError, errorResponse } from "../../../../../lib/errors";
import { recordTargetPriceIntent } from "../../../../../lib/store";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const { db } = ownedRequest(request, id);
    const body = await jsonBody(request);
    if (body.kind !== "target_price" || typeof body.wouldBuyAtTarget !== "boolean") {
      throw new AppError("invalid_intent", "Choose a sample and answer the target-price question.");
    }
    recordTargetPriceIntent(db, id, body.wouldBuyAtTarget);
    return Response.json({ recorded: true, paymentCreated: false, preorderCreated: false });
  } catch (error) {
    return errorResponse(error);
  }
}
