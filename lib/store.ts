import { randomUUID, timingSafeEqual } from "node:crypto";
import { dailySessionLimit, globalConcurrency, pollIntervalMs, RESULT_URL_TTL_MS, reviewThreshold, SESSION_TTL_MS } from "./config.ts";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";
import { catalog, garmentIds, isGarmentId } from "./catalog.ts";
import { isStyleProfile } from "./style-profile.ts";

export type SessionRow = {
  id: string;
  owner_token_hash: string;
  state: string;
  consent_at: number;
  selected_garment_id: string | null;
  source_file_id: string | null;
  start_key: string | null;
  style_profile_json: string | null;
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

type SignalRow = {
  session_id: string;
  garment_id: string;
  willing_price_cents: number | null;
  backed_at: number | null;
  target_price_accepted: number | null;
  intent_recorded_at: number | null;
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

export function createSession(db: Db, ownerHash: string, now = Date.now(), styleProfileJson: string | null = null) {
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
      INSERT INTO sessions (id, owner_token_hash, state, consent_at, style_profile_json, created_at, expires_at)
      VALUES (?, ?, 'created', ?, ?, ?, ?)
    `).run(session.id, session.ownerHash, now, styleProfileJson, now, session.expiresAt);
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
  const session = db.prepare("SELECT selected_garment_id FROM sessions WHERE id = ?")
    .get(sessionId) as { selected_garment_id: string | null } | undefined;
  if (!session) throw new AppError("session_not_found", "This casting session is unavailable.", 404);
  if (session.selected_garment_id) {
    if (session.selected_garment_id === garmentId) return;
    throw new AppError("decision_locked", "Your sample choice is already locked.", 409);
  }
  const tasks = db.prepare("SELECT garment_id, state FROM tasks WHERE session_id = ?")
    .all(sessionId) as Array<{ garment_id: string; state: string }>;
  if (tasks.length !== garmentIds.length || tasks.some((item) => item.state !== "live" && item.state !== "failed")) {
    throw new AppError("invalid_state", "Wait for all three sample results before choosing.", 409);
  }
  const task = tasks.find((item) => item.garment_id === garmentId && item.state === "live");
  if (!task) throw new AppError("invalid_state", "Only a completed look can be selected.", 409);
  transaction(db, () => {
    db.prepare("UPDATE sessions SET selected_garment_id = ?, state = 'selected' WHERE id = ?")
      .run(garmentId, sessionId);
    db.prepare(`
      INSERT INTO campaign_signals (session_id, garment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        willing_price_cents = CASE
          WHEN campaign_signals.garment_id = excluded.garment_id THEN campaign_signals.willing_price_cents
          ELSE NULL
        END,
        backed_at = CASE
          WHEN campaign_signals.garment_id = excluded.garment_id THEN campaign_signals.backed_at
          ELSE NULL
        END,
        garment_id = excluded.garment_id,
        updated_at = excluded.updated_at
    `).run(sessionId, garmentId, now, now);
    recordEvent(db, sessionId, "look_selected", garmentId, now);
  });
}

export function recordTargetPriceIntent(db: Db, sessionId: string, wouldBuyAtTarget: boolean, now = Date.now()) {
  const session = db.prepare("SELECT selected_garment_id FROM sessions WHERE id = ?")
    .get(sessionId) as { selected_garment_id: string | null };
  if (!session.selected_garment_id) {
    throw new AppError("invalid_state", "Choose a completed sample before recording purchase intent.", 409);
  }
  const existing = signalForSession(db, sessionId);
  if (existing?.intent_recorded_at) {
    if (Boolean(existing.target_price_accepted) === wouldBuyAtTarget) return;
    throw new AppError("decision_locked", "Your target-price response is already locked.", 409);
  }
  transaction(db, () => {
    db.prepare(`
      INSERT INTO campaign_signals (
        session_id, garment_id, target_price_accepted, intent_recorded_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        garment_id = excluded.garment_id,
        target_price_accepted = excluded.target_price_accepted,
        intent_recorded_at = COALESCE(campaign_signals.intent_recorded_at, excluded.intent_recorded_at),
        updated_at = excluded.updated_at
    `).run(sessionId, session.selected_garment_id, wouldBuyAtTarget ? 1 : 0, now, now, now);
    const event = wouldBuyAtTarget ? "target_price_accepted" : "target_price_declined";
    const exists = db.prepare("SELECT 1 FROM usage_events WHERE session_id = ? AND event = ?")
      .get(sessionId, event);
    if (!exists) recordEvent(db, sessionId, event, session.selected_garment_id, now);
  });
}

export function signalForSession(db: Db, sessionId: string) {
  return db.prepare("SELECT * FROM campaign_signals WHERE session_id = ?").get(sessionId) as SignalRow | undefined;
}

export function campaignReport(db: Db) {
  // ponytail: one fixed campaign; add a campaigns table when this becomes multi-brand.
  const threshold = reviewThreshold();
  const rows = db.prepare(`
    SELECT garment_id,
      COUNT(*) AS decisions,
      SUM(CASE WHEN intent_recorded_at IS NOT NULL THEN 1 ELSE 0 END) AS price_responses,
      SUM(CASE WHEN intent_recorded_at IS NOT NULL AND target_price_accepted = 1 THEN 1 ELSE 0 END) AS qualified_intents
    FROM campaign_signals
    GROUP BY garment_id
  `).all() as Array<{
    garment_id: string;
    decisions: number;
    price_responses: number;
    qualified_intents: number;
  }>;
  const byGarment = new Map(rows.map((row) => [row.garment_id, row]));
  const decisions = rows.reduce((total, row) => total + row.decisions, 0);
  const priceResponses = rows.reduce((total, row) => total + row.price_responses, 0);
  const qualifiedIntents = rows.reduce((total, row) => total + row.qualified_intents, 0);
  const topDecisionCount = Math.max(0, ...rows.map((row) => row.decisions));
  const topQualifiedCount = Math.max(0, ...rows.map((row) => row.qualified_intents));
  const audienceFavoriteIds = topDecisionCount
    ? garmentIds.filter((id) => rows.some((row) => row.garment_id === id && row.decisions === topDecisionCount))
    : [];
  const commercialFavoriteIds = topQualifiedCount
    ? garmentIds.filter((id) => rows.some((row) => row.garment_id === id && row.qualified_intents === topQualifiedCount))
    : [];
  const reviewCandidateId = commercialFavoriteIds.length === 1 && topQualifiedCount >= threshold
    ? commercialFavoriteIds[0]
    : null;
  const profiles = (db.prepare("SELECT style_profile_json FROM sessions WHERE style_profile_json IS NOT NULL").all() as Array<{ style_profile_json: string }>)
    .flatMap(({ style_profile_json }) => {
      try {
        const profile: unknown = JSON.parse(style_profile_json);
        return isStyleProfile(profile) ? [profile] : [];
      } catch {
        return [];
      }
    });

  return {
    campaign: {
      id: "first-edition",
      name: "The First Edition",
      productionSlots: 1,
      reviewThreshold: threshold,
      audienceFavoriteGarmentIds: audienceFavoriteIds,
      commercialFavoriteGarmentIds: commercialFavoriteIds,
      reviewCandidateGarmentId: reviewCandidateId,
    },
    totals: {
      decisions,
      priceResponses,
      qualifiedIntents,
      qualificationRate: priceResponses ? Math.round((qualifiedIntents / priceResponses) * 100) : 0,
    },
    styleSignals: {
      responses: profiles.length,
      occasions: ranked(profiles.map((profile) => profile.occasion)),
      silhouettes: ranked(profiles.map((profile) => profile.silhouette)),
      palettes: ranked(profiles.map((profile) => profile.palette)),
      priorities: ranked(profiles.flatMap((profile) => profile.priorities)),
      looks: ranked(profiles.flatMap((profile) => profile.lookIds)),
    },
    garments: catalog().map(({ configured: _configured, ...garment }) => {
      const row = byGarment.get(garment.id);
      const garmentResponses = row?.price_responses ?? 0;
      const garmentQualifiedIntents = row?.qualified_intents ?? 0;
      return {
        ...garment,
        decisions: row?.decisions ?? 0,
        priceResponses: garmentResponses,
        qualifiedIntents: garmentQualifiedIntents,
        qualificationRate: garmentResponses ? Math.round((garmentQualifiedIntents / garmentResponses) * 100) : 0,
        progress: Math.min(100, Math.round((garmentQualifiedIntents / threshold) * 100)),
        isAudienceFavorite: audienceFavoriteIds.includes(garment.id),
        isCommercialFavorite: commercialFavoriteIds.includes(garment.id),
        isReviewReady: reviewCandidateId === garment.id,
      };
    }),
  };
}

function ranked(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
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
    db.prepare("DELETE FROM campaign_signals WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM usage_events WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  });
}

function recordEvent(db: Db, sessionId: string, event: string, garmentId: string | null, now: number) {
  db.prepare("INSERT INTO usage_events (session_id, event, garment_id, created_at) VALUES (?, ?, ?, ?)")
    .run(sessionId, event, garmentId, now);
}
