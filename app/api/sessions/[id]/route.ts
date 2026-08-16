import { NextResponse } from "next/server";
import { assertSameOrigin, OWNER_COOKIE, ownerCookieOptions } from "../../../../lib/auth";
import { ownedRequest } from "../../../../lib/api";
import { AppError, errorResponse } from "../../../../lib/errors";
import { pollSession, projectSession } from "../../../../lib/session-service";
import { deleteSession, ownedSession } from "../../../../lib/store";
import { hashOwnerToken, ownerTokenFor } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { db } = ownedRequest(request, id);
    await pollSession(db, id);
    const owner = ownerTokenFor(request, id)!;
    return Response.json(projectSession(db, ownedSession(db, id, hashOwnerToken(owner))), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const { db } = ownedRequest(request, id);
    deleteSession(db, id);
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(OWNER_COOKIE, "", { ...ownerCookieOptions, maxAge: 0 });
    return response;
  } catch (error) {
    if (error instanceof AppError && error.code === "session_not_found") {
      const response = new NextResponse(null, { status: 204 });
      response.cookies.set(OWNER_COOKIE, "", { ...ownerCookieOptions, maxAge: 0 });
      return response;
    }
    return errorResponse(error);
  }
}
