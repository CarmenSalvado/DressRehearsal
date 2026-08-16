import type { Db } from "./db.ts";
import { catalog, garmentReferenceUrl } from "./catalog.ts";
import { TASK_TIMEOUT_MS } from "./config.ts";
import {
  claimQueuedTasks,
  dueTasks,
  failStaleClaims,
  markTaskFailed,
  markTaskLive,
  markTaskPending,
  markTaskStarted,
  sessionTasks,
  type SessionRow,
  type TaskRow,
} from "./store.ts";
import { createClothesTask, pollClothesTask, YouCamError } from "./youcam/client.ts";

export async function fillTaskQueue(db: Db) {
  const claimed = claimQueuedTasks(db);
  await Promise.all(claimed.map(async (task) => {
    try {
      const providerTaskId = await createClothesTask(
        task.source_file_id,
        garmentReferenceUrl(task.garment_id),
      );
      markTaskStarted(db, task.id, providerTaskId);
    } catch (error) {
      markTaskFailed(db, task.id, error instanceof YouCamError ? error.code : "provider_unavailable");
    }
  }));
}

export async function pollSession(db: Db, sessionId: string, now = Date.now()) {
  failStaleClaims(db, sessionId, now);
  const tasks = dueTasks(db, sessionId, now);
  await Promise.all(tasks.map(async (task) => {
    if (now - task.created_at >= TASK_TIMEOUT_MS) {
      markTaskFailed(db, task.id, "provider_timeout", now);
      return;
    }
    if (!task.provider_task_id) {
      markTaskFailed(db, task.id, "provider_invalid_response", now);
      return;
    }

    try {
      const result = await pollClothesTask(task.provider_task_id);
      if (result.state === "success") markTaskLive(db, task.id, result.url, now);
      else if (result.state === "error") markTaskFailed(db, task.id, result.code, now);
      else markTaskPending(db, task.id, now);
    } catch (error) {
      if (error instanceof YouCamError && !error.retryable) markTaskFailed(db, task.id, error.code, now);
      else markTaskPending(db, task.id, now);
    }
  }));
  await fillTaskQueue(db);
}

const messages: Record<string, string> = {
  invalid_pose: "Use one front-facing photo with your face and outfit area clearly visible.",
  garment_mismatch: "This garment could not be applied to the uploaded framing.",
  content_rejected: "The provider could not process this image safely.",
  invalid_image: "Use a clear JPEG, PNG, or WebP under 10 MB.",
  provider_timeout: "This look took too long to process.",
  provider_rate_limited: "The provider is busy. Try this look once more.",
  provider_unavailable: "The provider is temporarily unavailable.",
  provider_upload_failed: "The photo upload did not complete.",
  provider_rejected: "The provider could not create this look.",
  provider_invalid_response: "The provider returned an incomplete response.",
  provider_state_lost: "This task stopped before its provider receipt was saved.",
};

export function projectSession(db: Db, session: SessionRow, now = Date.now()) {
  const tasks = sessionTasks(db, session.id);
  return {
    sessionId: session.id,
    state: session.state,
    expiresAt: new Date(session.expires_at).toISOString(),
    selectedGarmentId: session.selected_garment_id,
    fittingIntentRecorded: Boolean(session.fitting_intent_at),
    garments: catalog().map(({ configured: _configured, ...garment }) => garment),
    tasks: tasks.map((task) => projectTask(task, now)),
  };
}

function projectTask(task: TaskRow, now: number) {
  return {
    garmentId: task.garment_id,
    state: task.state,
    provenance: task.provenance,
    elapsedMs: task.latency_ms ?? Math.max(0, now - task.created_at),
    resultUrl: task.state === "live"
      ? `/api/sessions/${task.session_id}/result/${task.garment_id}`
      : null,
    error: task.error_code
      ? {
          code: task.error_code,
          message: messages[task.error_code] ?? messages.provider_rejected,
          retryable: task.retry_count < 1 && task.error_code !== "provider_state_lost",
        }
      : null,
  };
}
