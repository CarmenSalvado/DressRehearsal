import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { accessCode, buyingRoomAccessCode, secureCookies, sessionSecret, SESSION_TTL_MS } from "./config.ts";
import { AppError } from "./errors.ts";

export const ACCESS_COOKIE = "dr_access";
export const BUYING_ROOM_ACCESS_COOKIE = "dr_buying_room_access";
export const OWNER_COOKIE = "dr_owner";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function signature(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function verifyAccessCode(value: unknown) {
  return verifyCode(value, accessCode());
}

export function verifyBuyingRoomAccessCode(value: unknown) {
  return verifyCode(value, buyingRoomAccessCode());
}

function verifyCode(value: unknown, expected: string) {
  if (typeof value !== "string" || value.length > 200) return false;
  return timingSafeEqual(digest(value), digest(expected));
}

export function createAccessToken(now = Date.now()) {
  const payload = `v1.${now + SESSION_TTL_MS}.${randomBytes(18).toString("base64url")}`;
  return `${payload}.${signature(payload)}`;
}

export function verifyAccessToken(token: string | undefined, now = Date.now()) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;

  const payload = parts.slice(0, 3).join(".");
  const expected = signature(payload);
  const received = parts[3];
  if (received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return false;
  }

  const expiresAt = Number(parts[1]);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
}

export function requireAccess(request: Request) {
  if (!verifyAccessToken(cookieValue(request, ACCESS_COOKIE))) {
    throw new AppError("access_required", "Enter the demo access code first.", 401);
  }
}

export function requireBuyingRoomAccess(request: Request) {
  if (!verifyAccessToken(cookieValue(request, BUYING_ROOM_ACCESS_COOKIE))) {
    throw new AppError("buying_room_access_required", "Enter the buying-room access code first.", 401);
  }
}

export function newOwnerToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOwnerToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function ownerTokenFor(request: Request, sessionId: string) {
  const value = cookieValue(request, OWNER_COOKIE);
  if (!value) return undefined;
  const separator = value.indexOf(".");
  if (separator === -1 || value.slice(0, separator) !== sessionId) return undefined;
  return value.slice(separator + 1);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const originUrl = new URL(origin);
  const host = request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (!host || originUrl.host !== host || (forwardedProtocol && originUrl.protocol !== `${forwardedProtocol}:`)) {
    throw new AppError("invalid_origin", "Cross-origin requests are not allowed.", 403);
  }
}

export const accessCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: secureCookies,
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
};

export const ownerCookieOptions = accessCookieOptions;
