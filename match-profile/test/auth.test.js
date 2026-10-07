import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp, register, login, csrf, sessionCookie, PASSWORD } from './helpers/app.js';
import { sha256 } from '../src/auth/tokens.js';
import { createMailer } from '../src/mail/index.js';

const DAY = 86400000;

test('register: account, player, all seven consents, signed in', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'Ada@Example.com', username: 'ada_l', displayName: 'Ada', country: 'GB', consents: { public_name: true } });
  const me = await p.agent.get('/api/session').expect(200);
  assert.equal(me.body.signedIn, true);
  assert.equal(me.body.role, 'player');
  assert.equal(me.body.email, 'Ada@Example.com');
  assert.equal(me.body.player.username, 'ada_l');
  assert.equal(me.body.csrfToken, p.csrf);
  const events = t.db.prepare('SELECT consent_type, granted FROM consent_events WHERE player_id = ? ORDER BY id').all(p.playerId);
  assert.equal(events.length, 7);
  const granted = Object.fromEntries(events.map((e) => [e.consent_type, e.granted]));
  assert.deepEqual(granted, { store_games: 1, analyse_games: 1, import_lichess: 0, pnp_profile_use: 0, public_name: 1, likeness_use: 0, promotional_use: 0 });
  const hash = t.db.prepare('SELECT password_hash FROM accounts').get().password_hash;
  assert.match(hash, /^\$argon2id\$/);
  assert.ok(!hash.includes(PASSWORD));
  await t.close();
});

test('the session cookie is HttpOnly, SameSite=Lax, 30 days; Secure when configured', async () => {
  for (const [env, secure] of [[{}, false], [{ COOKIE_SECURE: 'true' }, true]]) {
    const t = await testApp(env);
    const res = await request(t.app.server).post('/api/auth/register')
      .send({ email: 'c@example.com', username: 'cookie', password: PASSWORD, consents: { store_games: true, analyse_games: true } }).expect(201);
    const cookie = [].concat(res.headers['set-cookie']).find((c) => c.startsWith('cmp_session='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=2592000/);
    assert.equal(/;\s*Secure/.test(cookie), secure);
    await t.close();
  }
});

test('register refuses bad input and taken names, and requires the required consents', async () => {
  const t = await testApp();
  const post = (body) => request(t.app.server).post('/api/auth/register')
    .send({ email: 'x@example.com', username: 'xuser', password: PASSWORD, consents: { store_games: true, analyse_games: true }, ...body });
  assert.equal((await post({ password: 'short' })).body.error, 'password_too_short');
  assert.equal((await post({ email: 'not-an-email' })).body.error, 'email_invalid');
  assert.equal((await post({ username: 'no spaces!' })).body.error, 'username_invalid');
  assert.equal((await post({ country: 'Finland' })).body.error, 'country_invalid');
  const noConsent = await post({ consents: { store_games: true } });
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.body.error, 'required_consent');
  await post({}).expect(201);
  const sameEmail = await post({ email: 'X@EXAMPLE.com', username: 'other' });
  assert.equal(sameEmail.status, 409); assert.equal(sameEmail.body.error, 'email_taken');
  const sameName = await post({ email: 'y@example.com', username: 'XUSER' });
  assert.equal(sameName.status, 409); assert.equal(sameName.body.error, 'username_taken');
  assert.equal(t.db.prepare('SELECT count(*) n FROM accounts').get().n, 1);
  await t.close();
});

test('login: wrong password and unknown email get the same answer; success rotates the session', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'b@example.com', username: 'bobby' });
  const wrong = await request(t.app.server).post('/api/auth/login').send({ email: 'b@example.com', password: 'wrong password!' }).expect(401);
  const unknown = await request(t.app.server).post('/api/auth/login').send({ email: 'nobody@example.com', password: PASSWORD }).expect(401);
  assert.deepEqual(wrong.body, unknown.body);
  // Logging in again on the same browser replaces its session: the old id stops working.
  const before = await p.agent.get('/api/session');
  const oldCookie = t.db.prepare('SELECT id FROM sessions').get().id;
  const again = await p.agent.post('/api/auth/login').send({ email: 'b@example.com', password: PASSWORD }).expect(200);
  assert.equal(before.body.signedIn, true);
  assert.ok(sessionCookie(again));
  assert.equal(t.db.prepare('SELECT count(*) n FROM sessions WHERE id = ?').get(oldCookie).n, 0, 'old session deleted');
  assert.notEqual(again.body.csrfToken, p.csrf, 'a new CSRF token with the new session');
  await t.close();
});

test('sessions are stored as the SHA-256 of the cookie, never the cookie itself', async () => {
  const t = await testApp();
  const res = await request(t.app.server).post('/api/auth/register')
    .send({ email: 'h@example.com', username: 'hashed', password: PASSWORD, consents: { store_games: true, analyse_games: true } }).expect(201);
  const token = sessionCookie(res);
  const ids = t.db.prepare('SELECT id FROM sessions').all().map((r) => r.id);
  assert.deepEqual(ids, [sha256(token)]);
  await t.close();
});

test('logout needs the CSRF token, then the session is gone', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'l@example.com', username: 'leaver' });
  const forged = await p.agent.post('/api/auth/logout').send({}).expect(403);
  assert.equal(forged.body.error, 'csrf');
  await p.agent.post('/api/auth/logout').set('x-csrf-token', 'wrong').send({}).expect(403);
  await p.agent.post('/api/auth/logout').set(csrf(p)).send({}).expect(200);
  assert.equal((await p.agent.get('/api/session')).body.signedIn, false);
  assert.equal(t.db.prepare('SELECT count(*) n FROM sessions').get().n, 0);
  await t.close();
});

test('password change: checks the current one, ends every session, opens a new one here', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'c@example.com', username: 'changer' });
  const elsewhere = await login(t, 'c@example.com');
  const bad = await p.agent.post('/api/account/password').set(csrf(p)).send({ currentPassword: 'not it at all', newPassword: 'a brand new passphrase' }).expect(403);
  assert.equal(bad.body.error, 'wrong_password');
  const ok = await p.agent.post('/api/account/password').set(csrf(p)).send({ currentPassword: PASSWORD, newPassword: 'a brand new passphrase' }).expect(200);
  assert.ok(ok.body.csrfToken && ok.body.csrfToken !== p.csrf);
  assert.equal((await p.agent.get('/api/session')).body.signedIn, true, 'this browser keeps a fresh session');
  assert.equal((await elsewhere.agent.get('/api/session')).body.signedIn, false, 'the other one is signed out');
  await request(t.app.server).post('/api/auth/login').send({ email: 'c@example.com', password: PASSWORD }).expect(401);
  await login(t, 'c@example.com', 'a brand new passphrase');
  await t.close();
});

test('password reset: one-hour single-use token, sessions end, unknown emails look the same', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'r@example.com', username: 'resetter' });
  const unknown = await request(t.app.server).post('/api/auth/reset/request').send({ email: 'nobody@example.com' }).expect(200);
  assert.equal(t.mail.length, 0);
  const known = await request(t.app.server).post('/api/auth/reset/request').send({ email: 'R@example.com' }).expect(200);
  assert.deepEqual(unknown.body, known.body);
  assert.equal(t.mail.length, 1);
  assert.equal(t.mail[0].to, 'r@example.com');
  const token = t.mail[0].link.split('#/reset/')[1];
  assert.ok(token && token.length >= 40);
  assert.equal(t.db.prepare('SELECT count(*) n FROM password_resets WHERE token_hash = ?').get(sha256(token)).n, 1, 'stored hashed');
  assert.equal(t.db.prepare('SELECT count(*) n FROM password_resets WHERE token_hash = ?').get(token).n, 0);
  await request(t.app.server).post('/api/auth/reset/complete').send({ token, newPassword: 'short' }).expect(400);
  await request(t.app.server).post('/api/auth/reset/complete').send({ token, newPassword: 'reset to this one' }).expect(200);
  assert.equal((await p.agent.get('/api/session')).body.signedIn, false, 'sessions ended');
  const reused = await request(t.app.server).post('/api/auth/reset/complete').send({ token, newPassword: 'and again this one' }).expect(400);
  assert.equal(reused.body.error, 'reset_invalid');
  await login(t, 'r@example.com', 'reset to this one');
  // An hour and a second later, a fresh token no longer works.
  await request(t.app.server).post('/api/auth/reset/request').send({ email: 'r@example.com' }).expect(200);
  const late = t.mail[1].link.split('#/reset/')[1];
  t.clock.advance(3601 * 1000);
  assert.equal((await request(t.app.server).post('/api/auth/reset/complete').send({ token: late, newPassword: 'too late for this' })).body.error, 'reset_invalid');
  await t.close();
});

test('the console mailer prints the link, never the address', async () => {
  const lines = [];
  const mailer = createMailer({ smtp: null }, { print: (l) => lines.push(l) });
  await mailer.send({ to: 'secret@example.com', subject: 'Reset', text: 't', link: 'http://x/#/reset/abc' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /#\/reset\/abc/);
  assert.ok(!lines[0].includes('secret@example.com'));
});

test('sessions slide: used within 30 days they stay; unused for 30 they end', async () => {
  const t = await testApp();
  const p = await register(t, { email: 's@example.com', username: 'slider' });
  const first = t.db.prepare('SELECT expires_at FROM sessions').get().expires_at;
  t.clock.advance(20 * DAY);
  assert.equal((await p.agent.get('/api/session')).body.signedIn, true);
  const slid = t.db.prepare('SELECT expires_at FROM sessions').get().expires_at;
  assert.ok(slid > first, 'expiry pushed out');
  t.clock.advance(29 * DAY);
  assert.equal((await p.agent.get('/api/session')).body.signedIn, true, '49 days in, still signed in');
  t.clock.advance(31 * DAY);
  assert.equal((await p.agent.get('/api/session')).body.signedIn, false);
  assert.equal(t.db.prepare('SELECT count(*) n FROM sessions').get().n, 0, 'the expired row is removed');
  await t.close();
});

test('login, register and reset are rate-limited per IP and per email', async () => {
  const t = await testApp({}, { auth: { password: { minLength: 10, maxLength: 256 }, session: { days: 30, extendAfterMinutes: 60 }, reset: { expiresMinutes: 60 },
    rateLimits: { login: { perIp: [100, 900], perEmail: [3, 900] }, register: { perIp: [2, 3600] }, reset: { perIp: [100, 3600], perEmail: [1, 3600] } } } });
  const tries = [];
  for (let i = 0; i < 4; i += 1) tries.push((await request(t.app.server).post('/api/auth/login').send({ email: 'z@example.com', password: 'wrong password!' })).status);
  assert.deepEqual(tries, [401, 401, 401, 429]);
  const limited = await request(t.app.server).post('/api/auth/login').send({ email: 'Z@example.com', password: 'wrong password!' });
  assert.equal(limited.status, 429, 'the email key ignores case');
  assert.ok(Number(limited.headers['retry-after']) > 0);
  const reg = (n) => request(t.app.server).post('/api/auth/register').send({ email: `r${n}@example.com`, username: `reg${n}`, password: PASSWORD, consents: { store_games: true, analyse_games: true } });
  assert.deepEqual([(await reg(1)).status, (await reg(2)).status, (await reg(3)).status], [201, 201, 429]);
  await request(t.app.server).post('/api/auth/reset/request').send({ email: 'r1@example.com' }).expect(200);
  await request(t.app.server).post('/api/auth/reset/request').send({ email: 'r1@example.com' }).expect(429);
  await t.close();
});

test('the API takes JSON bodies only', async () => {
  const t = await testApp();
  const form = await request(t.app.server).post('/api/auth/login').type('form').send('email=a@example.com&password=xxxxxxxxxx');
  assert.equal(form.status, 415);
  const plain = await request(t.app.server).post('/api/auth/login').set('content-type', 'text/plain').send('{"email":"a@example.com","password":"xxxxxxxxxx"}');
  assert.equal(plain.status, 415);
  await t.close();
});

test('request.ip comes from the trusted local proxy, not from what the client wrote', async () => {
  const t = await testApp({}, { auth: { password: { minLength: 10, maxLength: 256 }, session: { days: 30, extendAfterMinutes: 60 }, reset: { expiresMinutes: 60 },
    rateLimits: { login: { perIp: [2, 900], perEmail: [100, 900] }, register: { perIp: [100, 3600] }, reset: { perIp: [100, 3600], perEmail: [100, 3600] } } } });
  // The proxy appends the real address last; a client's own entries come before it.
  const attempt = (xff) => request(t.app.server).post('/api/auth/login').set('x-forwarded-for', xff).send({ email: `${Math.random()}@example.com`, password: 'wrong password!' });
  const statuses = [];
  for (const spoof of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) statuses.push((await attempt(`${spoof}, 203.0.113.9`)).status);
  assert.deepEqual(statuses, [401, 401, 429], 'a changing spoofed entry does not reset the limit');
  assert.equal((await attempt('203.0.113.10')).status, 401, 'another real client is counted on its own');
  await t.close();
});
