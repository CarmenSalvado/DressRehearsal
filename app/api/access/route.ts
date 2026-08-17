import { NextResponse } from "next/server";
import { checkAccessRateLimit, recordAccessAttempt } from "../../../lib/access-rate-limit";
import { ACCESS_COOKIE, accessCookieOptions, assertSameOrigin, BUYING_ROOM_ACCESS_COOKIE, createAccessToken, verifyAccessCode, verifyBuyingRoomAccessCode } from "../../../lib/auth";
import { jsonBody } from "../../../lib/api";
import { AppError, errorResponse } from "../../../lib/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    checkAccessRateLimit(request);
    const body = await jsonBody(request);
    if (body.room !== undefined && body.room !== "buying") {
      throw new AppError("invalid_access", "Choose a valid access room.");
    }
    const buyingRoom = body.room === "buying";
    const valid = buyingRoom ? verifyBuyingRoomAccessCode(body.code) : verifyAccessCode(body.code);
    recordAccessAttempt(request, valid);
    if (!valid) throw new AppError("invalid_access", "That access code is not valid.", 401);

    const response = new NextResponse(null, { status: 204 });
    const token = createAccessToken();
    response.cookies.set(ACCESS_COOKIE, token, accessCookieOptions);
    if (buyingRoom) response.cookies.set(BUYING_ROOM_ACCESS_COOKIE, token, accessCookieOptions);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
