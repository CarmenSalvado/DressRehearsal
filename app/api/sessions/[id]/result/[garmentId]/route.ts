import { ownedRequest } from "../../../../../../lib/api";
import { AppError, errorResponse } from "../../../../../../lib/errors";
import { resultTask } from "../../../../../../lib/store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; garmentId: string }> },
) {
  try {
    const { id, garmentId } = await params;
    const { db } = ownedRequest(request, id);
    const task = resultTask(db, id, garmentId);
    const upstream = await fetch(task.result_url!, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok || !upstream.body) {
      throw new AppError("result_unavailable", "The result could not be loaded.", 502, true);
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
