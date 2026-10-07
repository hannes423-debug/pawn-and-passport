import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApp, register, login, csrf } from './helpers/app.js';
import { createMaster } from '../src/auth/accounts.js';

async function withMaster(t) {
  await createMaster(t.db, { email: 'boss@example.com', password: 'master passphrase' }, { password: { minLength: 10, maxLength: 256 }, hash: t.config.passwordHash });
  return login(t, 'boss@example.com', 'master passphrase');
}

test('the master sees usernames and consent states, never an email', async () => {
  const t = await testApp();
  await register(t, { email: 'hidden.one@example.com', username: 'hidden', displayName: 'Hidden Person', country: 'FI' });
  await register(t, { email: 'shown.one@example.com', username: 'shown', displayName: 'Shown Person', country: 'SE', consents: { public_name: true } });
  const m = await withMaster(t);
  const res = await m.agent.get('/api/admin/players').expect(200);
  const raw = JSON.stringify(res.body);
  assert.ok(!raw.includes('@example.com'), 'no email anywhere');
  assert.ok(!raw.includes('argon2'), 'no password hash');
  const byName = Object.fromEntries(res.body.players.map((p) => [p.username, p]));
  assert.deepEqual([byName.hidden.display_name, byName.hidden.country], [null, null], 'no public_name consent: hidden');
  assert.deepEqual([byName.shown.display_name, byName.shown.country], ['Shown Person', 'SE']);
  assert.equal(byName.shown.consents.public_name, true);
  assert.equal(byName.hidden.consents.store_games, true);
  await t.close();
});

test('withdrawing public_name hides the name from the master again', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'w@example.com', username: 'withdrawer', displayName: 'Was Public', consents: { public_name: true } });
  const m = await withMaster(t);
  assert.equal((await m.agent.get('/api/admin/players')).body.players[0].display_name, 'Was Public');
  await p.agent.post('/api/consent').set(csrf(p)).send({ type: 'public_name', granted: false }).expect(200);
  assert.equal((await m.agent.get('/api/admin/players')).body.players[0].display_name, null);
  await t.close();
});

test('player search matches usernames only, with LIKE wildcards taken literally', async () => {
  const t = await testApp();
  await register(t, { email: 'a@example.com', username: 'alpha_1' });
  await register(t, { email: 'b@example.com', username: 'alphax1' });
  const m = await withMaster(t);
  const names = async (q) => (await m.agent.get('/api/admin/players').query({ q })).body.players.map((p) => p.username);
  assert.deepEqual(await names('alpha'), ['alpha_1', 'alphax1']);
  assert.deepEqual(await names('a_1'), ['alpha_1'], '_ is not a wildcard');
  assert.deepEqual(await names('example'), [], 'emails are not searchable');
  await t.close();
});
