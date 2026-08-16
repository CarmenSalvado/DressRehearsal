import { NextResponse } from "next/server";
import { checkAccessRateLimit, recordAccessAttempt } from "../../../lib/access-rate-limit";
import { ACCESS_COOKIE, accessCookieOptions, assertSameOrigin, createAccessToken, verifyAccessCode } from "../../../lib/auth";
import { jsonBody } from "../../../lib/api";
import { AppError, errorResponse } from "../../../lib/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    checkAccessRateLimit(request);
    const body = await jsonBody(request);
    const valid = verifyAccessCode(body.code);
    recordAccessAttempt(request, valid);
    if (!valid) throw new AppError("invalid_access", "That access code is not valid.", 401);

    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(ACCESS_COOKIE, createAccessToken(), accessCookieOptions);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
