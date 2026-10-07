import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testApp, register, login } from './helpers/app.js';
import { createMaster } from '../src/auth/accounts.js';
import { openDatabase } from '../src/db/index.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'create-master.js');
const rules = { minLength: 10, maxLength: 256 };

test('createMaster creates a hashed master account, and running it again is safe', async () => {
  const t = await testApp();
  const opts = { password: rules, hash: t.config.passwordHash };
  assert.equal((await createMaster(t.db, { email: 'boss@example.com', password: 'master passphrase' }, opts)).action, 'created');
  assert.equal((await createMaster(t.db, { email: 'BOSS@example.com', password: 'master passphrase' }, opts)).action, 'updated');
  const rows = t.db.prepare('SELECT role, password_hash FROM accounts').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'master');
  assert.match(rows[0].password_hash, /^\$argon2id\$/);
  await login(t, 'boss@example.com', 'master passphrase');
  await assert.rejects(createMaster(t.db, { email: 'boss@example.com', password: 'short' }, opts), /at least 10/);
  await t.close();
});

test('createMaster promotes an existing player, keeps the player, ends its sessions', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'me@example.com', username: 'promoted' });
  const res = await createMaster(t.db, { email: 'me@example.com', password: 'now the master' }, { password: rules, hash: t.config.passwordHash });
  assert.equal(res.action, 'promoted');
  assert.equal(t.db.prepare('SELECT role FROM accounts').get().role, 'master');
  assert.equal(t.db.prepare('SELECT count(*) n FROM players').get().n, 1);
  assert.equal((await p.agent.get('/api/session')).body.signedIn, false);
  const m = await login(t, 'me@example.com', 'now the master');
  assert.equal((await m.agent.get('/api/session')).body.role, 'master');
  await t.close();
});

test('the npm run create-master CLI works from the environment and prints no credentials', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cmp-cli-'));
  const db = path.join(dir, 'cli.db');
  const run = (env) => spawnSync(process.execPath, [CLI], { env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_PATH: db, ...env }, encoding: 'utf8' });
  const missing = run({});
  assert.equal(missing.status, 2);
  const first = run({ MASTER_EMAIL: 'cli@example.com', MASTER_PASSWORD: 'cli master passphrase' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /created/);
  const second = run({ MASTER_EMAIL: 'cli@example.com', MASTER_PASSWORD: 'cli master passphrase' });
  assert.equal(second.status, 0);
  assert.match(second.stdout, /already existed/);
  for (const out of [first.stdout, second.stdout, first.stderr]) {
    assert.ok(!out.includes('cli@example.com') && !out.includes('cli master passphrase'));
  }
  const conn = openDatabase(db);
  assert.equal(conn.prepare("SELECT count(*) n FROM accounts WHERE role = 'master'").get().n, 1);
  conn.close();
});
