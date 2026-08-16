import { assertSameOrigin } from "../../../../../lib/auth";
import { jsonBody, ownedRequest } from "../../../../../lib/api";
import { AppError, errorResponse } from "../../../../../lib/errors";
import { selectGarment } from "../../../../../lib/store";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const { db } = ownedRequest(request, id);
    const body = await jsonBody(request);
    if (typeof body.garmentId !== "string") throw new AppError("invalid_garment", "Choose a garment.");
    selectGarment(db, id, body.garmentId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
