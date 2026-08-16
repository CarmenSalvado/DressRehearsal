import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "../lib/db.ts";
import {
  campaignReport,
  claimQueuedTasks,
  createSession,
  deleteSession,
  markTaskLive,
  markTaskStarted,
  ownedSession,
  recordBackingIntent,
  saveSourceFile,
  selectGarment,
  sessionTasks,
  startTasks,
} from "../lib/store.ts";

process.env.DAILY_SESSION_LIMIT = "10";
process.env.MAX_VTO_CONCURRENCY = "2";
process.env.GREENLIGHT_THRESHOLD = "1";

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

test("a backed sample becomes an anonymous manufacturer demand signal", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dress-rehearsal-"));
  const db = createDatabase(path.join(directory, "test.sqlite"));
  try {
    const created = createSession(db, "owner-hash", 1_700_000_000_000);
    saveSourceFile(db, created.id, "source-file", 1_700_000_000_010);
    startTasks(db, created.id, "fixed-idempotency-key", 1_700_000_000_020);
    const [task, secondTask] = claimQueuedTasks(db, 1_700_000_000_030);
    markTaskStarted(db, task.id, "provider-task", 1_700_000_000_040);
    markTaskLive(db, task.id, "https://result.test/image.jpg", 1_700_000_000_050);
    markTaskStarted(db, secondTask.id, "second-provider-task", 1_700_000_000_041);
    markTaskLive(db, secondTask.id, "https://result.test/second.jpg", 1_700_000_000_051);
    selectGarment(db, created.id, task.garment_id, 1_700_000_000_060);
    assert.throws(() => recordBackingIntent(db, created.id, 4999), /price between/);
    recordBackingIntent(db, created.id, 20500, 1_700_000_000_070);

    const report = campaignReport(db);
    assert.deepEqual(report.totals, { decisions: 1, backers: 1, backingRate: 100 });
    assert.equal(report.campaign.greenlitGarmentId, task.garment_id);
    assert.equal(report.garments.find((garment) => garment.id === task.garment_id)?.averageWillingPriceCents, 20500);

    selectGarment(db, created.id, secondTask.garment_id, 1_700_000_000_080);
    assert.deepEqual(campaignReport(db).totals, { decisions: 1, backers: 0, backingRate: 0 });

    deleteSession(db, created.id);
    assert.equal(campaignReport(db).totals.decisions, 0);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
