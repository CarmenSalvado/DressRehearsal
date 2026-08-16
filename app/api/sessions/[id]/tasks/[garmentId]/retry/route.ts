import { assertSameOrigin } from "../../../../../../../lib/auth";
import { ownedRequest } from "../../../../../../../lib/api";
import { errorResponse } from "../../../../../../../lib/errors";
import { fillTaskQueue, projectSession } from "../../../../../../../lib/session-service";
import { queueRetry } from "../../../../../../../lib/store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; garmentId: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id, garmentId } = await params;
    const { db, session } = ownedRequest(request, id);
    queueRetry(db, id, garmentId);
    await fillTaskQueue(db);
    return Response.json(projectSession(db, { ...session, state: "processing" }));
  } catch (error) {
    return errorResponse(error);
  }
}
