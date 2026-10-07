/**
 * db/index.js - opening the SQLite database and keeping its schema current.
 *
 *   const db = openDatabase(config.databasePath)   // WAL, foreign keys on
 *   migrate(db) -> { applied: [names], version }  // idempotent
 *
 * Migrations are the numbered .sql files in ./migrations, applied in order,
 * each in its own transaction, and recorded in schema_migrations. A file
 * that was applied is never edited: a change is a new, higher number.
 */

import Database from 'better-sqlite3';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_FILE = /^(\d{3})_[a-z0-9_]+\.sql$/;

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** The migration files, sorted by number. Throws on a misnamed file or a repeated number. */
export function listMigrations(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set();
  return files.map((name) => {
    const m = MIGRATION_FILE.exec(name);
    if (!m) throw new Error(`migrations: "${name}" must be named NNN_words.sql`);
    const version = Number(m[1]);
    if (seen.has(version)) throw new Error(`migrations: number ${m[1]} is used twice`);
    seen.add(version);
    return { version, name, sql: readFileSync(path.join(dir, name), 'utf8') };
  });
}

export function migrate(db, { dir = MIGRATIONS_DIR, now = () => new Date().toISOString() } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  const applied = [];
  for (const m of listMigrations(dir)) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      record.run(m.version, m.name, now());
    })();
    applied.push(m.name);
  }
  return { applied, version: schemaVersion(db) };
}

export const schemaVersion = (db) => db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;

export default { openDatabase, migrate, listMigrations, schemaVersion, MIGRATIONS_DIR };
