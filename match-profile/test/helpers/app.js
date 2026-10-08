/**
 * helpers/app.js - a fresh app on its own in-memory database, per test.
 *
 *   const t = await testApp()             // t.app, t.db, t.mail (what was "sent"), t.clock
 *   const p = await register(t, { email, username })   // p.agent keeps the session cookie
 *   await p.agent.post('/api/...').set(csrf(p)).send({...})
 */

import request from 'supertest';
import { loadConfig, loadJson } from '../../src/config.js';
import { openDatabase, migrate } from '../../src/db/index.js';
import { buildApp } from '../../src/server.js';
import { scriptedEngine } from './engines.js';

export const PASSWORD = 'correct horse battery';

/* The real auth settings with rate limits lifted, so only the test about
   rate limits ever meets one (it passes its own). */
function looseAuth() {
  const auth = loadJson('auth.json');
  for (const rules of Object.values(auth.rateLimits)) for (const k of Object.keys(rules)) rules[k] = [10000, rules[k][1]];
  return auth;
}

export async function testApp(env = {}, { auth = looseAuth(), playEngine = scriptedEngine(), ended = [] } = {}) {
  const config = loadConfig({ NODE_ENV: 'test', ...env });
  const db = openDatabase(':memory:');
  migrate(db);
  const mail = [];
  const clock = { t: Date.parse('2026-10-07T12:00:00Z'), advance(ms) { this.t += ms; } };
  const app = buildApp({ config, db, auth, mailer: { kind: 'test', send: async (m) => { mail.push(m); } }, now: () => new Date(clock.t),
    playEngine, onGameEnded: (id) => ended.push(id), sweepMs: 0 });
  await app.ready();
  return { app, db, config, mail, clock, ended, close: async () => { await app.close(); db.close(); } };
}

export async function register(t, { email, username, password = PASSWORD, consents = {}, ...rest }) {
  const agent = request.agent(t.app.server);
  const res = await agent.post('/api/auth/register')
    .send({ email, username, password, consents: { store_games: true, analyse_games: true, ...consents }, ...rest });
  if (res.status !== 201) throw new Error(`register ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.csrfToken, playerId: res.body.playerId, email, username };
}

export async function login(t, email, password = PASSWORD) {
  const agent = request.agent(t.app.server);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.csrfToken };
}

export const csrf = (who) => ({ 'x-csrf-token': who.csrf });

/** The session cookie's value from a response. */
export function sessionCookie(res) {
  const c = [].concat(res.headers['set-cookie'] || []).find((s) => s.startsWith('cmp_session='));
  return c ? c.split(';')[0].slice('cmp_session='.length) : null;
}
