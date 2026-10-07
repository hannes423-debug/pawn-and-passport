/**
 * auth/routes.js - HTTP for accounts: thin wrappers over accounts.js.
 *
 *   POST /api/auth/register         create account + player + consents, signed in
 *   POST /api/auth/login            signed in (a new session every time)
 *   POST /api/auth/logout
 *   GET  /api/session               who am I (and the CSRF token)
 *   POST /api/account/password      change password: all sessions end, a new one opens
 *   POST /api/auth/reset/request    always 200; emails a link if the account exists
 *   POST /api/auth/reset/complete   new password from a reset token; all sessions end
 */

import { AppError } from '../errors.js';
import { registerAccount, authenticate, changePassword, requestReset, completeReset, normalizeEmail } from './accounts.js';
import { createSession, deleteSession } from './sessions.js';
import { SESSION_COOKIE, cookieOptions, requireAuth } from './guard.js';

const str = { type: 'string', maxLength: 300 };
const body = (required, properties) => ({ body: { type: 'object', required, additionalProperties: false, properties } });

export function authRoutes(app, { config, db, auth, limiter, mailer, now }) {
  const opts = { password: auth.password, hash: config.passwordHash, reset: auth.reset, now };

  function limit(name, kind, key) {
    const rule = auth.rateLimits[name]?.[kind];
    if (!rule || !key) return;
    const r = limiter.hit(`${name}:${kind}:${String(key).toLowerCase()}`, rule);
    if (!r.ok) {
      const error = new AppError(429, 'rate_limited', 'Too many attempts. Wait a while and try again.');
      error.retryAfter = r.retryAfter;
      throw error;
    }
  }

  function signIn(request, reply, accountId) {
    if (request.auth) deleteSession(db, request.auth.sessionId);       // rotate: the old id stops working
    const s = createSession(db, accountId, { days: auth.session.days, now: now() });
    reply.setCookie(SESSION_COOKIE, s.token, cookieOptions(config, auth));
    return s.csrfToken;
  }

  app.post('/api/auth/register', {
    config: { csrf: false, public: true },
    schema: body(['email', 'password', 'username', 'consents'], {
      email: str, password: str, username: str, displayName: str, country: str,
      consents: { type: 'object', additionalProperties: { type: 'boolean' } }
    })
  }, async (request, reply) => {
    limit('register', 'perIp', request.ip);
    const { accountId, playerId } = await registerAccount(db, request.body, opts);
    const csrfToken = signIn(request, reply, accountId);
    reply.code(201);
    return { playerId, username: request.body.username, csrfToken };
  });

  app.post('/api/auth/login', {
    config: { csrf: false, public: true },
    schema: body(['email', 'password'], { email: str, password: str })
  }, async (request, reply) => {
    limit('login', 'perIp', request.ip);
    limit('login', 'perEmail', String(request.body.email).trim());
    const account = await authenticate(db, request.body.email, request.body.password, opts);
    if (!account) throw new AppError(401, 'invalid_credentials', 'That email and password do not match.');
    return { role: account.role, csrfToken: signIn(request, reply, account.id) };
  });

  app.post('/api/auth/logout', { preValidation: requireAuth }, async (request, reply) => {
    deleteSession(db, request.auth.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/session', { config: { public: true } }, async (request) => {
    if (!request.auth) return { signedIn: false };
    const account = db.prepare('SELECT email, role FROM accounts WHERE id = ?').get(request.auth.accountId);
    const player = request.auth.playerId
      ? db.prepare('SELECT id, username, display_name, country FROM players WHERE id = ?').get(request.auth.playerId)
      : null;
    // Your own email, to you only: no other route returns an email.
    return { signedIn: true, role: account.role, email: account.email, player, csrfToken: request.auth.csrfToken };
  });

  app.post('/api/account/password', {
    preValidation: requireAuth,
    schema: body(['currentPassword', 'newPassword'], { currentPassword: str, newPassword: str })
  }, async (request, reply) => {
    const { accountId } = request.auth;
    // Ends every session of the account, this one included: a fresh one replaces it.
    await changePassword(db, accountId, request.body.currentPassword, request.body.newPassword, opts);
    const s = createSession(db, accountId, { days: auth.session.days, now: now() });
    reply.setCookie(SESSION_COOKIE, s.token, cookieOptions(config, auth));
    return { ok: true, csrfToken: s.csrfToken };
  });

  app.post('/api/auth/reset/request', {
    config: { csrf: false, public: true },
    schema: body(['email'], { email: str })
  }, async (request) => {
    limit('reset', 'perIp', request.ip);
    let email = null;
    try { email = normalizeEmail(request.body.email); } catch { /* answered the same as an unknown address */ }
    if (email) limit('reset', 'perEmail', email);
    const reset = email ? requestReset(db, email, opts) : null;
    if (reset) {
      // The token travels in the URL fragment: never sent to a server, so never in an access log.
      const link = `${config.publicUrl}/#/reset/${reset.token}`;
      await mailer.send({
        to: reset.email,
        subject: 'Reset your Chess Match Profile password',
        text: `Someone asked to reset the password for this account. If it was you, open this link within ${auth.reset.expiresMinutes} minutes:\n\n${link}\n\nIf it was not you, ignore this email.`,
        link
      });
    }
    return { ok: true };
  });

  app.post('/api/auth/reset/complete', {
    config: { csrf: false, public: true },
    schema: body(['token', 'newPassword'], { token: str, newPassword: str })
  }, async (request, reply) => {
    limit('reset', 'perIp', request.ip);
    await completeReset(db, request.body.token, request.body.newPassword, opts);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}

export default { authRoutes };
