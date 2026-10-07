import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, loadJson, publicConfig } from '../src/config.js';

test('defaults: local dev on 127.0.0.1:3100, insecure cookies, console email', () => {
  const c = loadConfig({});
  assert.equal(c.env, 'development');
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 3100);
  assert.equal(c.cookieSecure, false);
  assert.equal(c.smtp, null);
  assert.equal(c.analysisConcurrency, 1);
  assert.ok(c.databasePath.endsWith(path.join('data', 'chess-match-profile.db')));
  assert.ok(Object.isFrozen(c));
});

test('production: secure cookies by default and PUBLIC_URL required', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /PUBLIC_URL/);
  const c = loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://cmp.example.ts.net/' });
  assert.equal(c.cookieSecure, true);
  assert.equal(c.publicUrl, 'https://cmp.example.ts.net', 'trailing slash dropped');
});

test('bad values are refused with the variable named', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ NODE_ENV: 'staging' }), /NODE_ENV/);
  assert.throws(() => loadConfig({ COOKIE_SECURE: 'maybe' }), /COOKIE_SECURE/);
  assert.throws(() => loadConfig({ ANALYSIS_CONCURRENCY: '0' }), /ANALYSIS_CONCURRENCY/);
});

test('SMTP is on only when SMTP_HOST is set', () => {
  const c = loadConfig({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465' });
  assert.deepEqual({ host: c.smtp.host, port: c.smtp.port }, { host: 'smtp.example.com', port: 465 });
});

test('master credentials are never part of the server config', () => {
  const c = loadConfig({ MASTER_EMAIL: 'boss@example.com', MASTER_PASSWORD: 'correct horse battery' });
  assert.ok(!JSON.stringify(c).includes('boss@example.com'));
  assert.ok(!JSON.stringify(c).includes('correct horse'));
});

test('publicConfig says nothing about paths or secrets', () => {
  const c = loadConfig({ STOCKFISH_PATH: '/usr/games/stockfish', SMTP_HOST: 'smtp.example.com', SMTP_PASSWORD: 'hunter2hunter2' });
  const shown = JSON.stringify(publicConfig(c));
  assert.ok(!shown.includes('/usr/games'));
  assert.ok(!shown.includes('hunter2'));
  assert.ok(!shown.includes('smtp.example.com'));
});

test('loadJson names the file it could not read', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cmp-config-'));
  writeFileSync(path.join(dir, 'good.json'), '{"a":1}');
  writeFileSync(path.join(dir, 'bad.json'), '{"a":');
  assert.deepEqual(loadJson('good.json', { dir }), { a: 1 });
  assert.throws(() => loadJson('bad.json', { dir }), /bad\.json is not valid JSON/);
  assert.throws(() => loadJson('nope.json', { dir }), /missing .*nope\.json/);
});
