import path from "node:path";
import { AppError } from "./errors.ts";

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const RESULT_URL_TTL_MS = 2 * 60 * 60 * 1000;
export const TASK_TIMEOUT_MS = 120_000;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError("not_configured", `${name} is not configured.`, 503);
  }
  return value;
}

export function accessCode() {
  return required("DEMO_ACCESS_CODE");
}

export function buyingRoomAccessCode() {
  return required("BUYING_ROOM_ACCESS_CODE");
}

export function sessionSecret() {
  const value = required("SESSION_SECRET");
  if (value.length < 32) {
    throw new AppError("not_configured", "SESSION_SECRET must be at least 32 characters.", 503);
  }
  return value;
}

export function youcamApiKey() {
  return required("YOUCAM_API_KEY");
}

export function youcamBaseUrl() {
  const url = new URL(process.env.YOUCAM_API_BASE ?? "https://yce-api-01.makeupar.com");
  if (url.protocol !== "https:" && process.env.NODE_ENV !== "test") {
    throw new AppError("not_configured", "YOUCAM_API_BASE must use HTTPS.", 503);
  }
  return url.origin;
}

export function dataDirectory() {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
}

export function pollIntervalMs() {
  return Math.max(2_000, Number(process.env.YOUCAM_POLL_INTERVAL_MS) || 3_000);
}

export function globalConcurrency() {
  return Math.max(1, Math.min(2, Number(process.env.MAX_VTO_CONCURRENCY) || 2));
}

export function dailySessionLimit() {
  return Math.max(1, Number(process.env.DAILY_SESSION_LIMIT) || 10);
}

export function reviewThreshold() {
  return Math.max(1, Number(process.env.REVIEW_THRESHOLD ?? process.env.GREENLIGHT_THRESHOLD) || 25);
}

export const secureCookies = process.env.NODE_ENV === "production";
