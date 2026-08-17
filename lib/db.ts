import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory } from "./config.ts";

let database: DatabaseSync | undefined;

export function createDatabase(filename: string) {
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      owner_token_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      consent_at INTEGER NOT NULL,
      selected_garment_id TEXT,
      source_file_id TEXT,
      start_key TEXT,
      style_profile_json TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      garment_id TEXT NOT NULL,
      provider_task_id TEXT,
      state TEXT NOT NULL,
      result_url TEXT,
      result_expires_at INTEGER,
      latency_ms INTEGER,
      provenance TEXT,
      error_code TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_poll_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(session_id, garment_id)
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event TEXT NOT NULL,
      garment_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_signals (
      session_id TEXT PRIMARY KEY,
      garment_id TEXT NOT NULL,
      willing_price_cents INTEGER CHECK (
        willing_price_cents IS NULL OR willing_price_cents BETWEEN 5000 AND 100000
      ),
      backed_at INTEGER,
      target_price_accepted INTEGER CHECK (target_price_accepted IN (0, 1)),
      intent_recorded_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_counters (
      day TEXT PRIMARY KEY,
      sessions INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS tasks_state_poll ON tasks(state, next_poll_at);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS usage_created ON usage_events(created_at);
    CREATE INDEX IF NOT EXISTS signals_garment ON campaign_signals(garment_id, backed_at);
  `);
  addColumnIfMissing(db, "campaign_signals", "target_price_accepted", "target_price_accepted INTEGER CHECK (target_price_accepted IN (0, 1))");
  addColumnIfMissing(db, "campaign_signals", "intent_recorded_at", "intent_recorded_at INTEGER");
  addColumnIfMissing(db, "sessions", "style_profile_json", "style_profile_json TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS signals_target_intent ON campaign_signals(garment_id, intent_recorded_at, target_price_accepted)");
  return db;
}

function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function getDb() {
  database ??= createDatabase(path.join(dataDirectory(), "dress-rehearsal.sqlite"));
  return database;
}

export type Db = DatabaseSync;
