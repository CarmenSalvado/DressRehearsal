import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "../lib/db.ts";
import {
  claimQueuedTasks,
  createSession,
  markTaskLive,
  markTaskStarted,
  ownedSession,
  saveSourceFile,
  sessionTasks,
  startTasks,
} from "../lib/store.ts";

process.env.DAILY_SESSION_LIMIT = "10";
process.env.MAX_VTO_CONCURRENCY = "2";

test("a session creates exactly three tasks and claims only two", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dress-rehearsal-"));
  const db = createDatabase(path.join(directory, "test.sqlite"));
  try {
    const created = createSession(db, "owner-hash", 1_700_000_000_000);
    saveSourceFile(db, created.id, "source-file", 1_700_000_000_010);
    assert.equal(startTasks(db, created.id, "fixed-idempotency-key", 1_700_000_000_020), true);
    assert.equal(startTasks(db, created.id, "fixed-idempotency-key", 1_700_000_000_021), false);
    assert.equal(sessionTasks(db, created.id).length, 3);

    const claimed = claimQueuedTasks(db, 1_700_000_000_030);
    assert.equal(claimed.length, 2);
    markTaskStarted(db, claimed[0].id, "provider-task", 1_700_000_000_040);
    markTaskLive(db, claimed[0].id, "https://result.test/image.jpg", 1_700_000_000_050);
    assert.equal(ownedSession(db, created.id, "owner-hash", 1_700_000_000_060).state, "revealed");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
