import { assertSameOrigin } from "../../../../../lib/auth";
import { ownedRequest } from "../../../../../lib/api";
import { AppError, errorResponse } from "../../../../../lib/errors";
import { fillTaskQueue, projectSession } from "../../../../../lib/session-service";
import { ownedSession, startTasks } from "../../../../../lib/store";
import { hashOwnerToken, ownerTokenFor } from "../../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const { db } = ownedRequest(request, id);
    const key = request.headers.get("idempotency-key")?.trim();
    if (!key || key.length < 8 || key.length > 200) {
      throw new AppError("idempotency_key_required", "Send an Idempotency-Key header.");
    }

    startTasks(db, id, key);
    await fillTaskQueue(db);
    const owner = ownerTokenFor(request, id)!;
    return Response.json(projectSession(db, ownedSession(db, id, hashOwnerToken(owner))));
  } catch (error) {
    return errorResponse(error);
  }
}
