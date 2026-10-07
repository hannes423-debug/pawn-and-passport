import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp, register, csrf } from './helpers/app.js';
import { POLICY_VERSION } from '../src/consent/index.js';

test('the consent types are public, in plain words, two of them required', async () => {
  const t = await testApp();
  const res = await request(t.app.server).get('/api/consent/types').expect(200);
  assert.equal(res.body.policyVersion, POLICY_VERSION);
  assert.equal(res.body.types.length, 7);
  assert.deepEqual(res.body.types.filter((c) => c.required).map((c) => c.type), ['store_games', 'analyse_games']);
  for (const c of res.body.types) assert.ok(c.text.length > 20 && c.text.endsWith('.'), c.type);
  await t.close();
});

test('optional consents start off; granting and withdrawing each add an event; history is kept', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'c@example.com', username: 'consenter' });
  const start = (await p.agent.get('/api/consent').expect(200)).body;
  for (const type of ['import_lichess', 'pnp_profile_use', 'public_name', 'likeness_use', 'promotional_use']) assert.equal(start.current[type].granted, false, type);
  assert.equal(start.current.store_games.granted, true);
  assert.equal(start.history.length, 7);

  await p.agent.post('/api/consent').set(csrf(p)).send({ type: 'pnp_profile_use', granted: true }).expect(200);
  t.clock.advance(1000);
  const after = (await p.agent.post('/api/consent').set(csrf(p)).send({ type: 'pnp_profile_use', granted: false }).expect(200)).body;
  assert.equal(after.current.pnp_profile_use.granted, false);
  const history = (await p.agent.get('/api/consent')).body.history.filter((h) => h.consent_type === 'pnp_profile_use');
  assert.deepEqual(history.map((h) => h.granted), [false, true, false], 'registration answer, grant, withdrawal');
  assert.ok(history.every((h) => h.policy_version === POLICY_VERSION));
  await t.close();
});

test('a required consent cannot be withdrawn here: the answer points to account deletion', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'r@example.com', username: 'requirer' });
  const res = await p.agent.post('/api/consent').set(csrf(p)).send({ type: 'store_games', granted: false }).expect(409);
  assert.equal(res.body.error, 'required_consent');
  assert.match(res.body.message, /deleting your account/);
  assert.equal(t.db.prepare("SELECT count(*) n FROM consent_events WHERE consent_type = 'store_games'").get().n, 1, 'no event added');
  const bad = await p.agent.post('/api/consent').set(csrf(p)).send({ type: 'sell_my_data', granted: true }).expect(400);
  assert.equal(bad.body.error, 'unknown_consent');
  await t.close();
});

test('changing a consent needs the CSRF token', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'x@example.com', username: 'csrfer' });
  await p.agent.post('/api/consent').send({ type: 'public_name', granted: true }).expect(403);
  await t.close();
});
