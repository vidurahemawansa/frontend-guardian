import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as path from "path";
import * as fs from "fs";
import * as schema from "./schema.js";

// ── Resolve database file path ─────────────────────────────────────────────

const DB_PATH = process.env["DB_PATH"] ?? path.join(process.cwd(), "guardian.db");

// Ensure the directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// ── Open connection ────────────────────────────────────────────────────────

const sqlite = new Database(DB_PATH);

// WAL mode: much better concurrent read performance
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// ── Bootstrap tables (run on every startup) ───────────────────────────────

export function bootstrapDb(): void {
  // Create tables if they don't exist — no migration files needed for initial schema
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      kind        TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'unknown',
      payload     TEXT NOT NULL,
      received_at TEXT NOT NULL,
      user_id     TEXT,
      user_email  TEXT,
      user_name   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_session    ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_kind       ON events(kind);
    CREATE INDEX IF NOT EXISTS idx_events_received   ON events(received_at);
    CREATE INDEX IF NOT EXISTS idx_events_user       ON events(user_id);

    CREATE TABLE IF NOT EXISTS analyses (
      id           TEXT PRIMARY KEY,
      event_id     TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      rule_results TEXT NOT NULL DEFAULT '[]',
      ai_analysis  TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_event    ON analyses(event_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_status   ON analyses(status);
    CREATE INDEX IF NOT EXISTS idx_analyses_created  ON analyses(created_at);
  `);

  console.log(`[DB] SQLite ready at ${DB_PATH}`);
}

export { schema };
