import { randomUUID, timingSafeEqual } from "node:crypto";
import { dailySessionLimit, globalConcurrency, pollIntervalMs, RESULT_URL_TTL_MS, SESSION_TTL_MS } from "./config.ts";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";
import { garmentIds, isGarmentId } from "./catalog.ts";

export type SessionRow = {
  id: string;
  owner_token_hash: string;
  state: string;
  consent_at: number;
  selected_garment_id: string | null;
  fitting_intent_at: number | null;
  source_file_id: string | null;
  start_key: string | null;
  created_at: number;
  expires_at: number;
};

export type TaskRow = {
  id: string;
  session_id: string;
  garment_id: string;
  provider_task_id: string | null;
  state: string;
  result_url: string | null;
  result_expires_at: number | null;
  latency_ms: number | null;
  provenance: string | null;
  error_code: string | null;
  retry_count: number;
  next_poll_at: number | null;
  created_at: number;
  updated_at: number;
};

function transaction<T>(db: Db, work: () => T) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function cleanupExpired(db: Db, now = Date.now()) {
  transaction(db, () => {
    db.prepare("DELETE FROM usage_events WHERE session_id IN (SELECT id FROM sessions WHERE expires_at <= ?)")
      .run(now);
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  });
}

export function createSession(db: Db, ownerHash: string, now = Date.now()) {
  cleanupExpired(db, now);
  return transaction(db, () => {
    const day = new Date(now).toISOString().slice(0, 10);
    const count = db.prepare("SELECT sessions FROM daily_counters WHERE day = ?")
      .get(day) as { sessions: number } | undefined;
    if ((count?.sessions ?? 0) >= dailySessionLimit()) {
      throw new AppError("daily_limit_reached", "The demo has reached today's casting limit.", 429);
    }

    const session = {
      id: randomUUID(),
      ownerHash,
      now,
      expiresAt: now + SESSION_TTL_MS,
    };
    db.prepare(`
      INSERT INTO sessions (id, owner_token_hash, state, consent_at, created_at, expires_at)
      VALUES (?, ?, 'created', ?, ?, ?)
    `).run(session.id, session.ownerHash, now, now, session.expiresAt);
    db.prepare(`
      INSERT INTO daily_counters (day, sessions) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET sessions = sessions + 1
    `).run(day);
    recordEvent(db, session.id, "session_created", null, now);
    return session;
  });
}

export function ownedSession(db: Db, sessionId: string, ownerHash: string, now = Date.now()) {
  cleanupExpired(db, now);
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
  if (!row) throw new AppError("session_not_found", "This casting session is unavailable.", 404);

  const stored = Buffer.from(row.owner_token_hash);
  const received = Buffer.from(ownerHash);
  if (stored.length !== received.length || !timingSafeEqual(stored, received)) {
    throw new AppError("session_not_found", "This casting session is unavailable.", 404);
  }
  return row;
}

export function saveSourceFile(db: Db, sessionId: string, fileId: string, now = Date.now()) {
  const result = db.prepare(`
    UPDATE sessions SET source_file_id = ?, state = 'uploaded'
    WHERE id = ? AND state = 'created'
  `).run(fileId, sessionId);
  if (result.changes !== 1) throw new AppError("invalid_state", "A photo is already attached to this session.", 409);
  recordEvent(db, sessionId, "photo_uploaded", null, now);
}

export function startTasks(db: Db, sessionId: string, idempotencyKey: string, now = Date.now()) {
  return transaction(db, () => {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow;
    if (session.start_key) {
      if (session.start_key !== idempotencyKey) {
        throw new AppError("idempotency_conflict", "This casting has already started.", 409);
      }
      return false;
    }
    if (session.state !== "uploaded" || !session.source_file_id) {
      throw new AppError("invalid_state", "Upload a valid photo before starting the casting.", 409);
    }

    db.prepare("UPDATE sessions SET state = 'processing', start_key = ? WHERE id = ?")
      .run(idempotencyKey, sessionId);
    const insert = db.prepare(`
      INSERT INTO tasks (id, session_id, garment_id, state, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `);
    for (const garmentId of garmentIds) insert.run(randomUUID(), sessionId, garmentId, now, now);
    recordEvent(db, sessionId, "casting_started", null, now);
    return true;
  });
}

export type ClaimedTask = TaskRow & { source_file_id: string };

export function claimQueuedTasks(db: Db, now = Date.now()) {
  return transaction(db, () => {
    const inflight = db.prepare("SELECT COUNT(*) AS total FROM tasks WHERE state IN ('uploading', 'processing')")
      .get() as { total: number };
    const slots = Math.max(0, globalConcurrency() - inflight.total);
    if (!slots) return [];

    const rows = db.prepare(`
      SELECT tasks.*, sessions.source_file_id
      FROM tasks JOIN sessions ON sessions.id = tasks.session_id
      WHERE tasks.state = 'queued' AND sessions.expires_at > ? AND sessions.source_file_id IS NOT NULL
      ORDER BY tasks.created_at ASC LIMIT ?
    `).all(now, slots) as ClaimedTask[];
    const claim = db.prepare("UPDATE tasks SET state = 'uploading', updated_at = ? WHERE id = ? AND state = 'queued'");
    return rows.filter((row) => claim.run(now, row.id).changes === 1);
  });
}

export function markTaskStarted(db: Db, taskId: string, providerTaskId: string, now = Date.now()) {
  db.prepare(`
    UPDATE tasks SET provider_task_id = ?, state = 'processing', next_poll_at = ?, updated_at = ?
    WHERE id = ? AND state = 'uploading'
  `).run(providerTaskId, now + pollIntervalMs(), now, taskId);
}

export function markTaskFailed(db: Db, taskId: string, code: string, now = Date.now()) {
  const task = db.prepare("SELECT session_id FROM tasks WHERE id = ?").get(taskId) as { session_id: string } | undefined;
  db.prepare(`
    UPDATE tasks SET state = 'failed', provenance = 'failed', error_code = ?, next_poll_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(code, now, taskId);
  if (task) refreshSessionState(db, task.session_id, now);
}

export function dueTasks(db: Db, sessionId: string, now = Date.now()) {
  return db.prepare(`
    SELECT * FROM tasks
    WHERE session_id = ? AND state = 'processing' AND next_poll_at <= ?
    ORDER BY created_at ASC
  `).all(sessionId, now) as TaskRow[];
}

export function failStaleClaims(db: Db, sessionId: string, now = Date.now()) {
  const rows = db.prepare(`
    SELECT id FROM tasks
    WHERE session_id = ? AND state = 'uploading' AND provider_task_id IS NULL AND updated_at <= ?
  `).all(sessionId, now - 60_000) as Array<{ id: string }>;
  for (const row of rows) markTaskFailed(db, row.id, "provider_state_lost", now);
}

export function markTaskPending(db: Db, taskId: string, now = Date.now()) {
  db.prepare("UPDATE tasks SET next_poll_at = ?, updated_at = ? WHERE id = ? AND state = 'processing'")
    .run(now + pollIntervalMs(), now, taskId);
}

export function markTaskLive(db: Db, taskId: string, resultUrl: string, now = Date.now()) {
  const task = db.prepare("SELECT session_id, created_at FROM tasks WHERE id = ?").get(taskId) as {
    session_id: string;
    created_at: number;
  };
  db.prepare(`
    UPDATE tasks SET state = 'live', result_url = ?, result_expires_at = ?, latency_ms = ?,
      provenance = 'live', error_code = NULL, next_poll_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(resultUrl, now + RESULT_URL_TTL_MS, now - task.created_at, now, taskId);
  refreshSessionState(db, task.session_id, now);
}

function refreshSessionState(db: Db, sessionId: string, now = Date.now()) {
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN state = 'live' THEN 1 ELSE 0 END) AS live,
      SUM(CASE WHEN state IN ('live', 'failed') THEN 1 ELSE 0 END) AS terminal,
      COUNT(*) AS total
    FROM tasks WHERE session_id = ?
  `).get(sessionId) as { live: number; terminal: number; total: number };
  if (counts.live > 0) {
    const changed = db.prepare("UPDATE sessions SET state = 'revealed' WHERE id = ? AND state = 'processing'")
      .run(sessionId).changes;
    if (changed) recordEvent(db, sessionId, "first_look_revealed", null, now);
  } else if (counts.total > 0 && counts.terminal === counts.total) {
    db.prepare("UPDATE sessions SET state = 'failed' WHERE id = ? AND state = 'processing'").run(sessionId);
  }
  if (counts.total > 0 && counts.terminal === counts.total) {
    const exists = db.prepare("SELECT 1 FROM usage_events WHERE session_id = ? AND event = 'all_tasks_terminal'")
      .get(sessionId);
    if (!exists) recordEvent(db, sessionId, "all_tasks_terminal", null, now);
  }
}

export function sessionTasks(db: Db, sessionId: string) {
  return db.prepare("SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as TaskRow[];
}

export function queueRetry(db: Db, sessionId: string, garmentId: string, now = Date.now()) {
  if (!isGarmentId(garmentId)) throw new AppError("invalid_garment", "Choose a garment from this casting.");
  return transaction(db, () => {
    const retries = db.prepare("SELECT SUM(retry_count) AS total FROM tasks WHERE session_id = ?")
      .get(sessionId) as { total: number | null };
    if ((retries.total ?? 0) >= 1) throw new AppError("retry_limit_reached", "This session's retry has been used.", 409);
    const result = db.prepare(`
      UPDATE tasks SET state = 'queued', provider_task_id = NULL, result_url = NULL,
        result_expires_at = NULL, provenance = NULL, error_code = NULL, retry_count = 1,
        next_poll_at = NULL, created_at = ?, updated_at = ?
      WHERE session_id = ? AND garment_id = ? AND state = 'failed'
    `).run(now, now, sessionId, garmentId);
    if (result.changes !== 1) throw new AppError("invalid_state", "Only a failed look can be retried.", 409);
    db.prepare("UPDATE sessions SET state = 'processing' WHERE id = ? AND state = 'failed'").run(sessionId);
  });
}

export function selectGarment(db: Db, sessionId: string, garmentId: string, now = Date.now()) {
  if (!isGarmentId(garmentId)) throw new AppError("invalid_garment", "Choose a garment from this casting.");
  const task = db.prepare(`
    SELECT 1 FROM tasks WHERE session_id = ? AND garment_id = ? AND state = 'live'
  `).get(sessionId, garmentId);
  if (!task) throw new AppError("invalid_state", "Only a completed look can be selected.", 409);
  db.prepare("UPDATE sessions SET selected_garment_id = ?, state = 'selected' WHERE id = ?")
    .run(garmentId, sessionId);
  recordEvent(db, sessionId, "look_selected", garmentId, now);
}

export function recordFittingIntent(db: Db, sessionId: string, now = Date.now()) {
  const session = db.prepare("SELECT selected_garment_id FROM sessions WHERE id = ?")
    .get(sessionId) as { selected_garment_id: string | null };
  if (!session.selected_garment_id) {
    throw new AppError("invalid_state", "Select a completed look first.", 409);
  }
  db.prepare("UPDATE sessions SET fitting_intent_at = COALESCE(fitting_intent_at, ?) WHERE id = ?")
    .run(now, sessionId);
  const exists = db.prepare("SELECT 1 FROM usage_events WHERE session_id = ? AND event = 'fitting_intent'")
    .get(sessionId);
  if (!exists) recordEvent(db, sessionId, "fitting_intent", session.selected_garment_id, now);
}

export function resultTask(db: Db, sessionId: string, garmentId: string, now = Date.now()) {
  const task = db.prepare(`
    SELECT * FROM tasks WHERE session_id = ? AND garment_id = ? AND state = 'live'
      AND result_expires_at > ?
  `).get(sessionId, garmentId, now) as TaskRow | undefined;
  if (!task?.result_url) throw new AppError("result_unavailable", "This result is unavailable or expired.", 404);
  return task;
}

export function deleteSession(db: Db, sessionId: string, now = Date.now()) {
  transaction(db, () => {
    db.prepare("DELETE FROM usage_events WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  });
}

function recordEvent(db: Db, sessionId: string, event: string, garmentId: string | null, now: number) {
  db.prepare("INSERT INTO usage_events (session_id, event, garment_id, created_at) VALUES (?, ?, ?, ?)")
    .run(sessionId, event, garmentId, now);
}
