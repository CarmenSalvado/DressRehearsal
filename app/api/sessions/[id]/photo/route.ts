import { assertSameOrigin } from "../../../../../lib/auth";
import { ownedRequest } from "../../../../../lib/api";
import { errorResponse, AppError } from "../../../../../lib/errors";
import { normalizePhoto } from "../../../../../lib/image";
import { saveSourceFile } from "../../../../../lib/store";
import { uploadPhoto, YouCamError } from "../../../../../lib/youcam/client";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const { db } = ownedRequest(request, id);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 11 * 1024 * 1024) {
      throw new AppError("invalid_image", "Use an image under 10 MB.", 413, true);
    }
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      throw new AppError("invalid_request", "Upload the photo as multipart form data.");
    }

    const form = await request.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File)) throw new AppError("invalid_image", "Choose one photo.", 400, true);

    const normalized = await normalizePhoto(photo);
    let fileId: string;
    try {
      fileId = await uploadPhoto(normalized.data);
    } catch (error) {
      if (error instanceof YouCamError) {
        throw new AppError(error.code, "The photo could not be sent to YouCam.", 502, error.retryable);
      }
      throw error;
    }
    saveSourceFile(db, id, fileId);
    return Response.json({ state: "uploaded", width: normalized.width, height: normalized.height });
  } catch (error) {
    return errorResponse(error);
  }
}
