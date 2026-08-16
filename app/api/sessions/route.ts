import { NextResponse } from "next/server";
import { assertSameOrigin, newOwnerToken, hashOwnerToken, OWNER_COOKIE, ownerCookieOptions, requireAccess } from "../../../lib/auth";
import { jsonBody } from "../../../lib/api";
import { garmentIds, garmentReferenceUrl } from "../../../lib/catalog";
import { youcamApiKey } from "../../../lib/config";
import { getDb } from "../../../lib/db";
import { AppError, errorResponse } from "../../../lib/errors";
import { projectSession } from "../../../lib/session-service";
import { createSession, ownedSession } from "../../../lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireAccess(request);
    const body = await jsonBody(request);
    if (body.consent !== true || body.rightsConfirmed !== true || body.scene !== "main-stage") {
      throw new AppError("consent_required", "Consent and image rights confirmation are required.");
    }

    youcamApiKey();
    for (const garmentId of garmentIds) garmentReferenceUrl(garmentId);

    const ownerToken = newOwnerToken();
    const db = getDb();
    const created = createSession(db, hashOwnerToken(ownerToken));
    const session = ownedSession(db, created.id, hashOwnerToken(ownerToken));
    const response = NextResponse.json(projectSession(db, session), { status: 201 });
    response.cookies.set(OWNER_COOKIE, `${created.id}.${ownerToken}`, ownerCookieOptions);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
