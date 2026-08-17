import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { garmentIds } from "../lib/catalog.ts";
import { createDatabase } from "../lib/db.ts";
import { projectSession } from "../lib/session-service.ts";
import {
  campaignReport,
  claimQueuedTasks,
  createSession,
  deleteSession,
  markTaskLive,
  markTaskStarted,
  ownedSession,
  recordTargetPriceIntent,
  saveSourceFile,
  selectGarment,
  sessionTasks,
  startTasks,
} from "../lib/store.ts";

process.env.DAILY_SESSION_LIMIT = "10";
process.env.MAX_VTO_CONCURRENCY = "2";
process.env.REVIEW_THRESHOLD = "1";

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
    assert.throws(() => selectGarment(db, created.id, claimed[0].garment_id), /all three sample results/);
    assert.equal(ownedSession(db, created.id, "owner-hash", 1_700_000_000_060).state, "revealed");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the report separates the audience favorite from target-price intent", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dress-rehearsal-"));
  const db = createDatabase(path.join(directory, "test.sqlite"));
  try {
    const accepted = recordDecision(db, garmentIds[0], true, 1_700_000_000_000);
    const declined = recordDecision(db, garmentIds[1], false, 1_700_000_100_000);
    recordDecision(db, garmentIds[1], false, 1_700_000_200_000);

    assert.throws(() => selectGarment(db, accepted.sessionId, garmentIds[1]), /choice is already locked/);
    recordTargetPriceIntent(db, accepted.sessionId, true);
    assert.throws(() => recordTargetPriceIntent(db, accepted.sessionId, false), /response is already locked/);

    const report = campaignReport(db);
    assert.deepEqual(report.totals, { decisions: 3, priceResponses: 3, qualifiedIntents: 1, qualificationRate: 33 });
    assert.deepEqual(report.campaign.audienceFavoriteGarmentIds, [garmentIds[1]]);
    assert.deepEqual(report.campaign.commercialFavoriteGarmentIds, [garmentIds[0]]);
    assert.equal(report.campaign.reviewCandidateGarmentId, garmentIds[0]);
    assert.equal(report.garments.find((garment) => garment.id === garmentIds[1])?.qualifiedIntents, 0);

    deleteSession(db, accepted.sessionId);
    deleteSession(db, declined.sessionId);
    assert.equal(campaignReport(db).totals.decisions, 1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("session payloads hide prices until the preference is locked", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dress-rehearsal-"));
  const db = createDatabase(path.join(directory, "test.sqlite"));
  const now = 1_700_000_500_000;
  try {
    const created = createSession(db, "price-owner", now);
    const beforeSelection = projectSession(db, ownedSession(db, created.id, "price-owner", now + 1), now + 1);
    assert.equal(beforeSelection.garments.every((garment) => garment.targetPriceCents === null), true);

    saveSourceFile(db, created.id, "price-source", now + 10);
    startTasks(db, created.id, "price-start", now + 20);
    finishTasks(db, created.id, now);
    selectGarment(db, created.id, garmentIds[0], now + 60);

    const afterSelection = projectSession(db, ownedSession(db, created.id, "price-owner", now + 70), now + 70);
    assert.equal(afterSelection.garments.find((garment) => garment.id === garmentIds[0])?.targetPriceCents, 18000);
    assert.equal(afterSelection.garments.filter((garment) => garment.id !== garmentIds[0]).every((garment) => garment.targetPriceCents === null), true);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("style edits are stored and aggregated as audience signals", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dress-rehearsal-"));
  const db = createDatabase(path.join(directory, "test.sqlite"));
  const profile = {
    occasion: "dinner",
    silhouette: "fluid",
    palette: "earthy",
    priorities: ["versatility", "detail"],
    lookIds: ["fluid", "knit", "metallic"],
  };
  try {
    const created = createSession(db, "style-owner", 1_700_000_700_000, JSON.stringify(profile));
    assert.deepEqual(JSON.parse(ownedSession(db, created.id, "style-owner", 1_700_000_700_001).style_profile_json!), profile);

    const signals = campaignReport(db).styleSignals;
    assert.equal(signals.responses, 1);
    assert.deepEqual(signals.occasions, [{ id: "dinner", count: 1 }]);
    assert.deepEqual(signals.priorities, [{ id: "detail", count: 1 }, { id: "versatility", count: 1 }]);
    assert.deepEqual(signals.looks, [{ id: "fluid", count: 1 }, { id: "knit", count: 1 }, { id: "metallic", count: 1 }]);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("exact ties remain unresolved and legacy prices are not reclassified", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dress-rehearsal-"));
  const databasePath = path.join(directory, "test.sqlite");
  const legacyDb = new DatabaseSync(databasePath);
  legacyDb.exec(`
    CREATE TABLE campaign_signals (
      session_id TEXT PRIMARY KEY,
      garment_id TEXT NOT NULL,
      willing_price_cents INTEGER,
      backed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO campaign_signals VALUES ('legacy-session', '${garmentIds[2]}', 15000, 1, 1, 1);
  `);
  legacyDb.close();
  const db = createDatabase(databasePath);
  try {
    recordDecision(db, garmentIds[0], true, 1_700_001_000_000);
    recordDecision(db, garmentIds[1], true, 1_700_001_100_000);

    const report = campaignReport(db);
    assert.deepEqual(report.campaign.audienceFavoriteGarmentIds, [garmentIds[0], garmentIds[1], garmentIds[2]]);
    assert.deepEqual(report.campaign.commercialFavoriteGarmentIds, [garmentIds[0], garmentIds[1]]);
    assert.equal(report.campaign.reviewCandidateGarmentId, null);
    assert.deepEqual(report.totals, { decisions: 3, priceResponses: 2, qualifiedIntents: 2, qualificationRate: 100 });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function recordDecision(db: ReturnType<typeof createDatabase>, garmentId: string, wouldBuyAtTarget: boolean, now: number) {
  const created = createSession(db, `owner-${now}`, now);
  saveSourceFile(db, created.id, `source-${now}`, now + 10);
  startTasks(db, created.id, `start-${now}`, now + 20);
  finishTasks(db, created.id, now);
  selectGarment(db, created.id, garmentId, now + 60);
  recordTargetPriceIntent(db, created.id, wouldBuyAtTarget, now + 70);
  return { sessionId: created.id };
}

function finishTasks(db: ReturnType<typeof createDatabase>, sessionId: string, now: number) {
  while (sessionTasks(db, sessionId).some((task) => task.state === "queued")) {
    const claimed = claimQueuedTasks(db, now + 30);
    for (const task of claimed) {
      markTaskStarted(db, task.id, `provider-${task.id}`, now + 40);
      markTaskLive(db, task.id, `https://result.test/${task.garment_id}.jpg`, now + 50);
    }
  }
}
