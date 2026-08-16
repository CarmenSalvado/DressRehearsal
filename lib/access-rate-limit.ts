import { createHash } from "node:crypto";
import { AppError } from "./errors.ts";

const attempts = new Map<string, { failures: number; lockedUntil: number }>();

function keyFor(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const value = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(value).digest("hex");
}

export function checkAccessRateLimit(request: Request, now = Date.now()) {
  const entry = attempts.get(keyFor(request));
  if (entry && entry.lockedUntil > now) {
    throw new AppError("try_later", "Access is temporarily locked. Try again shortly.", 429, true);
  }
}

export function recordAccessAttempt(request: Request, succeeded: boolean, now = Date.now()) {
  const key = keyFor(request);
  if (succeeded) {
    attempts.delete(key);
    return;
  }

  const previous = attempts.get(key) ?? { failures: 0, lockedUntil: 0 };
  const failures = previous.failures + 1;
  // ponytail: process-local cooldown fits the single-instance demo; move to shared storage for multi-instance deploys.
  attempts.set(key, { failures, lockedUntil: failures >= 5 ? now + 5_000 : 0 });
}
