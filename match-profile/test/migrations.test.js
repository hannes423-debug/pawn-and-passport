import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate, listMigrations, schemaVersion } from '../src/db/index.js';

const now = () => new Date().toISOString();

function seedPlayer(db) {
  const accountId = randomUUID();
  const playerId = randomUUID();
  db.prepare('INSERT INTO accounts (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(accountId, `${accountId}@example.com`, 'x', now());
  db.prepare('INSERT INTO players (id, account_id, username, created_at) VALUES (?, ?, ?, ?)').run(playerId, accountId, `p${accountId.slice(0, 8)}`, now());
  return { accountId, playerId };
}

function openGame(db, playerId, { source = 'chess_match_profile', sourceId = randomUUID() } = {}) {
  const id = randomUUID();
  db.prepare(`INSERT INTO games_raw (id, source, source_game_id, player_id, colour, opponent_type, time_control, started_at)
              VALUES (?, ?, ?, ?, 'white', 'bot', '5+3', ?)`).run(id, source, sourceId, playerId, now());
  return id;
}

test('a fresh database migrates to the latest version, and again is a no-op', () => {
  const db = openDatabase(':memory:');
  const first = migrate(db);
  assert.equal(first.applied[0], '001_core.sql');
  assert.equal(first.version, Math.max(...listMigrations().map((m) => m.version)));
  const second = migrate(db);
  assert.deepEqual(second.applied, []);
  assert.equal(schemaVersion(db), first.version);
});

test('a file database runs in WAL mode with foreign keys on', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cmp-db-'));
  const db = openDatabase(path.join(dir, 'nested', 'test.db'));
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.close();
});

test('a failing migration leaves nothing half-applied', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cmp-mig-'));
  writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (x INTEGER);');
  writeFileSync(path.join(dir, '002_broken.sql'), 'CREATE TABLE b (x INTEGER); THIS IS NOT SQL;');
  const db = openDatabase(':memory:');
  assert.throws(() => migrate(db, { dir }));
  assert.equal(schemaVersion(db), 1, '001 applied, 002 rolled back');
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name = 'b'").get().n, 0);
});

test('misnamed or repeated migration numbers are refused', () => {
  const bad = mkdtempSync(path.join(tmpdir(), 'cmp-mig-'));
  writeFileSync(path.join(bad, '1_short.sql'), '');
  assert.throws(() => listMigrations(bad), /NNN_words/);
  const twice = mkdtempSync(path.join(tmpdir(), 'cmp-mig-'));
  writeFileSync(path.join(twice, '001_a.sql'), '');
  writeFileSync(path.join(twice, '001_b.sql'), '');
  assert.throws(() => listMigrations(twice), /used twice/);
});

test('a game can be written, closed, and is frozen after it ends', () => {
  const db = openDatabase(':memory:'); migrate(db);
  const { playerId } = seedPlayer(db);
  const gameId = openGame(db, playerId);
  const move = db.prepare("INSERT INTO moves_raw (game_id, ply, san, uci, fen_after) VALUES (?, ?, 'e4', 'e2e4', 'fen')");
  move.run(gameId, 1);
  db.prepare("UPDATE games_raw SET result = '1-0', ended_at = ? WHERE id = ?").run(now(), gameId);
  assert.throws(() => db.prepare("UPDATE games_raw SET result = '0-1' WHERE id = ?").run(gameId), /never changes/);
  assert.throws(() => move.run(gameId, 2), /never changes/);
  assert.throws(() => db.prepare("UPDATE moves_raw SET san = 'd4' WHERE game_id = ?").run(gameId), /never changes/);
});

test('the same source game cannot be stored twice', () => {
  const db = openDatabase(':memory:'); migrate(db);
  const { playerId } = seedPlayer(db);
  openGame(db, playerId, { source: 'lichess', sourceId: 'abcd1234' });
  assert.throws(() => openGame(db, playerId, { source: 'lichess', sourceId: 'abcd1234' }), /UNIQUE/);
  openGame(db, playerId, { source: 'chess_match_profile', sourceId: 'abcd1234' });
});

test('consent events are append-only', () => {
  const db = openDatabase(':memory:'); migrate(db);
  const { playerId } = seedPlayer(db);
  const add = db.prepare('INSERT INTO consent_events (player_id, consent_type, granted, policy_version, created_at) VALUES (?, ?, ?, ?, ?)');
  add.run(playerId, 'store_games', 1, '2026-10-07', now());
  assert.throws(() => db.prepare('UPDATE consent_events SET granted = 0').run(), /append-only/);
  assert.throws(() => add.run(playerId, 'sell_my_data', 1, '2026-10-07', now()), /CHECK/);
});

test('deleting an account removes its player, games and moves', () => {
  const db = openDatabase(':memory:'); migrate(db);
  const { accountId, playerId } = seedPlayer(db);
  const gameId = openGame(db, playerId);
  db.prepare("INSERT INTO moves_raw (game_id, ply, san, uci, fen_after) VALUES (?, 1, 'e4', 'e2e4', 'fen')").run(gameId);
  db.prepare("UPDATE games_raw SET ended_at = ? WHERE id = ?").run(now(), gameId);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  for (const table of ['players', 'games_raw', 'moves_raw', 'consent_events', 'sessions']) {
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, table);
  }
});
