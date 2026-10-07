import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp, register, login, csrf } from './helpers/app.js';
import { createMaster } from '../src/auth/accounts.js';

// Every route is public on purpose or refuses a request without a session.
const PUBLIC = new Set([
  'GET /api/health', 'GET /api/session', 'GET /api/consent/types',
  'POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/reset/request', 'POST /api/auth/reset/complete'
]);

const fill = (url) => url.replace(/:[a-zA-Z]+/g, '00000000-0000-4000-8000-000000000000');

test('the public routes are exactly the expected ones', async () => {
  const t = await testApp();
  const marked = t.app.routeList.filter((r) => r.public).map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(new Set(marked), PUBLIC);
  await t.close();
});

test('every other route answers 401 without a session', async () => {
  const t = await testApp();
  const closed = t.app.routeList.filter((r) => !r.public);
  assert.ok(closed.length >= 5);
  for (const r of closed) {
    const res = await request(t.app.server)[r.method.toLowerCase()](fill(r.url)).send(r.method === 'GET' ? undefined : {});
    assert.equal(res.status, 401, `${r.method} ${r.url} -> ${res.status}`);
    assert.equal(res.body.error, 'not_signed_in');
  }
  await t.close();
});

test('master-only routes refuse a player, and a player cannot become master through the API', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'p@example.com', username: 'plain' });
  const admin = t.app.routeList.filter((r) => r.url.startsWith('/api/admin/'));
  assert.ok(admin.length >= 1);
  for (const r of admin) {
    const res = await p.agent[r.method.toLowerCase()](fill(r.url)).set(csrf(p)).send(r.method === 'GET' ? undefined : {});
    assert.equal(res.status, 403, `${r.method} ${r.url}`);
  }
  assert.ok(!t.app.routeList.some((r) => /master|role|promote/.test(r.url)), 'no route touches roles');
  await t.close();
});

test('a master account with no player row cannot use player routes', async () => {
  const t = await testApp();
  await createMaster(t.db, { email: 'm@example.com', password: 'master passphrase' }, { password: { minLength: 10, maxLength: 256 }, hash: t.config.passwordHash });
  const m = await login(t, 'm@example.com', 'master passphrase');
  const res = await m.agent.get('/api/consent').expect(403);
  assert.equal(res.body.error, 'no_player');
  await m.agent.get('/api/admin/players').expect(200);
  await t.close();
});
