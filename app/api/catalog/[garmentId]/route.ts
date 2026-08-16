import { requireAccess } from "../../../../lib/auth";
import { garmentReferenceUrl } from "../../../../lib/catalog";
import { AppError, errorResponse } from "../../../../lib/errors";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ garmentId: string }> }) {
  try {
    requireAccess(request);
    const { garmentId } = await params;
    const upstream = await fetch(garmentReferenceUrl(garmentId), {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok || !upstream.body) {
      throw new AppError("garment_unavailable", "This garment reference is unavailable.", 502, true);
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
