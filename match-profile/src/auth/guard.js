/**
 * guard.js - who is asking, and may they.
 *
 * An onRequest hook reads the session cookie for every /api/ request and
 * sets request.auth = { accountId, role, playerId, csrfToken, sessionId }
 * (or leaves it null). Every state-changing request made with a session
 * must carry that session's CSRF token in the x-csrf-token header; routes
 * that run before a session exists (register, login, reset) opt out with
 * config: { csrf: false }. Requests without a session are covered by
 * SameSite=Lax cookies and by the API accepting JSON bodies only, which a
 * cross-site form cannot send.
 *
 *   preValidation: requireAuth | requirePlayer | requireMaster
 *   (before body validation, so a signed-out request is always a 401)
 */

import { findSession, touchSession } from './sessions.js';
import { safeEqual } from './tokens.js';
import { AppError } from '../errors.js';

export const SESSION_COOKIE = 'cmp_session';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function cookieOptions(config, auth) {
  return { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: auth.session.days * 86400 };
}

export function registerGuard(app, { config, db, auth, now }) {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const token = request.cookies?.[SESSION_COOKIE];
    if (token) {
      const s = findSession(db, token, { now: now() });
      if (s) {
        request.auth = { accountId: s.account_id, role: s.role, playerId: s.player_id, csrfToken: s.csrf_token, sessionId: s.session_id };
        if (touchSession(db, s, { ...auth.session, now: now() })) reply.setCookie(SESSION_COOKIE, token, cookieOptions(config, auth));
      } else {
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
      }
    }
    if (UNSAFE.has(request.method) && request.auth && request.routeOptions?.config?.csrf !== false) {
      if (!safeEqual(request.headers['x-csrf-token'], request.auth.csrfToken)) {
        throw new AppError(403, 'csrf', 'This request is missing its security token. Reload the page and try again.');
      }
    }
  });
}

export async function requireAuth(request) {
  if (!request.auth) throw new AppError(401, 'not_signed_in', 'Sign in first.');
}

export async function requirePlayer(request) {
  await requireAuth(request);
  if (!request.auth.playerId) throw new AppError(403, 'no_player', 'This account has no player profile.');
}

export async function requireMaster(request) {
  await requireAuth(request);
  if (request.auth.role !== 'master') throw new AppError(403, 'forbidden', 'Only the master account can do this.');
}

export default { registerGuard, requireAuth, requirePlayer, requireMaster, SESSION_COOKIE, cookieOptions };
