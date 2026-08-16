import { hashOwnerToken, ownerTokenFor, requireAccess } from "./auth.ts";
import type { Db } from "./db.ts";
import { getDb } from "./db.ts";
import { AppError } from "./errors.ts";
import { ownedSession, type SessionRow } from "./store.ts";

export function ownedRequest(request: Request, sessionId: string): { db: Db; session: SessionRow } {
  requireAccess(request);
  const owner = ownerTokenFor(request, sessionId);
  if (!owner) throw new AppError("session_not_found", "This casting session is unavailable.", 404);
  const db = getDb();
  return { db, session: ownedSession(db, sessionId, hashOwnerToken(owner)) };
}

export async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AppError("invalid_request", "Send a JSON request body.");
  }
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new AppError("invalid_request", "Send valid JSON.");
  }
}
