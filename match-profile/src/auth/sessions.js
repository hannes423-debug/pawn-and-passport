/**
 * sessions.js - server-side sessions.
 *
 * The cookie carries a random 256-bit id; the sessions row stores its
 * SHA-256 and a per-session CSRF token. Sessions last 30 days and slide: a
 * request more than an hour after the last extension pushes the expiry out
 * again (one write an hour, not one per request).
 */

import { newToken, sha256 } from './tokens.js';

const DAY = 86400 * 1000;

export function createSession(db, accountId, { days, now = new Date() }) {
  const token = newToken();
  const csrfToken = newToken();
  const expiresAt = new Date(now.getTime() + days * DAY).toISOString();
  db.prepare('INSERT INTO sessions (id, account_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), accountId, csrfToken, now.toISOString(), expiresAt);
  return { token, csrfToken, expiresAt };
}

/** The live session for a cookie value, with its account and player; null if none or expired. */
export function findSession(db, token, { now = new Date() } = {}) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db.prepare(`
    SELECT s.id AS session_id, s.csrf_token, s.expires_at, a.id AS account_id, a.role, p.id AS player_id
    FROM sessions s
    JOIN accounts a ON a.id = s.account_id
    LEFT JOIN players p ON p.account_id = a.id
    WHERE s.id = ?`).get(sha256(token));
  if (!row) return null;
  if (row.expires_at <= now.toISOString()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }
  return row;
}

/** Slide the expiry; returns the new expiry when it moved, else null. */
export function touchSession(db, session, { days, extendAfterMinutes, now = new Date() }) {
  const target = now.getTime() + days * DAY;
  if (target - Date.parse(session.expires_at) < extendAfterMinutes * 60 * 1000) return null;
  const expiresAt = new Date(target).toISOString();
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expiresAt, session.session_id);
  return expiresAt;
}

export const deleteSession = (db, sessionId) => db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
export const deleteAccountSessions = (db, accountId) => db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);

export default { createSession, findSession, touchSession, deleteSession, deleteAccountSessions };
