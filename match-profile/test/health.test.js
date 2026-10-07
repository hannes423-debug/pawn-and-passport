import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp } from './helpers/app.js';

test('GET /api/health reports the app, version and schema', async () => {
  const t = await testApp({ STOCKFISH_PATH: '/usr/games/stockfish' });
  const res = await request(t.app.server).get('/api/health').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.app, 'chess-match-profile');
  assert.match(res.body.version, /^\d+\.\d+\.\d+$/);
  assert.ok(res.body.schema >= 1);
  assert.equal(res.body.database, 'ok');
  assert.equal(res.body.engine, 'configured');
  assert.ok(!JSON.stringify(res.body).includes('/usr/games'), 'no paths');
  await t.close();
});

test('health says degraded, with 503, when the database is gone', async () => {
  const t = await testApp();
  t.db.close();
  const res = await request(t.app.server).get('/api/health').expect(503);
  assert.equal(res.body.database, 'error');
  await t.app.close();
});

test('the static front page is served, unknown API routes are JSON 404s', async () => {
  const t = await testApp();
  const page = await request(t.app.server).get('/').expect(200);
  assert.match(page.text, /Chess Match Profile/);
  const missing = await request(t.app.server).get('/api/nope').expect(404);
  assert.deepEqual(missing.body, { error: 'not_found' });
  await t.close();
});
