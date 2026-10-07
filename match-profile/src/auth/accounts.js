/**
 * accounts.js - accounts as plain functions over the database.
 *
 * Routes and the create-master CLI call these; none of them knows about
 * HTTP. `opts` carries the password rules and hash cost (config/auth.json
 * and config.passwordHash) and, in tests, a fixed clock.
 */

import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { checkPassword, hashPassword, verifyPassword, dummyVerify } from './passwords.js';
import { newToken, sha256 } from './tokens.js';
import { deleteAccountSessions } from './sessions.js';
import { initialConsents, recordConsent, POLICY_VERSION } from '../consent/index.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
const COUNTRY = /^[A-Z]{2}$/;

export function normalizeEmail(email) {
  const e = typeof email === 'string' ? email.trim() : '';
  if (!EMAIL.test(e) || e.length > 254) throw new AppError(400, 'email_invalid', 'Enter a valid email address.');
  return e;
}

function checkProfileFields({ username, displayName, country }) {
  if (typeof username !== 'string' || !USERNAME.test(username)) {
    throw new AppError(400, 'username_invalid', 'Usernames are 3-20 letters, digits, _ or -.');
  }
  if (displayName != null && (typeof displayName !== 'string' || displayName.trim().length > 40)) {
    throw new AppError(400, 'display_name_invalid', 'Display names are at most 40 characters.');
  }
  if (country != null && country !== '' && (typeof country !== 'string' || !COUNTRY.test(country))) {
    throw new AppError(400, 'country_invalid', 'Country is a two-letter code such as FI.');
  }
}

export async function registerAccount(db, input, opts) {
  const now = opts.now?.() ?? new Date();
  const email = normalizeEmail(input.email);
  checkPassword(input.password, opts.password);
  checkProfileFields(input);
  const consents = initialConsents(input.consents);
  if (db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(email)) throw new AppError(409, 'email_taken', 'An account with that email already exists.');
  if (db.prepare('SELECT 1 FROM players WHERE username = ?').get(input.username)) throw new AppError(409, 'username_taken', 'That username is taken.');
  const hash = await hashPassword(input.password, opts.hash);
  const accountId = randomUUID();
  const playerId = randomUUID();
  try {
    db.transaction(() => {
      db.prepare("INSERT INTO accounts (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'player', ?)")
        .run(accountId, email, hash, now.toISOString());
      db.prepare('INSERT INTO players (id, account_id, username, display_name, country, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(playerId, accountId, input.username, input.displayName?.trim() || null, input.country || null, now.toISOString());
      for (const [type, granted] of Object.entries(consents)) recordConsent(db, playerId, type, granted, { policyVersion: POLICY_VERSION, now });
    })();
  } catch (error) {
    // Two sign-ups racing for the same email or username between the checks above and here.
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw /players\.username/.test(error.message)
        ? new AppError(409, 'username_taken', 'That username is taken.')
        : new AppError(409, 'email_taken', 'An account with that email already exists.');
    }
    throw error;
  }
  return { accountId, playerId };
}

/** The account for these credentials, or null. Same cost either way. */
export async function authenticate(db, email, password, opts) {
  const e = typeof email === 'string' ? email.trim() : '';
  const row = e ? db.prepare('SELECT id, password_hash, role FROM accounts WHERE email = ?').get(e) : null;
  if (!row || typeof password !== 'string' || password.length > opts.password.maxLength) {
    await dummyVerify(opts.hash);
    return null;
  }
  return (await verifyPassword(row.password_hash, password)) ? { id: row.id, role: row.role } : null;
}

/** Change a password; ends every session of the account (the caller opens a fresh one). */
export async function changePassword(db, accountId, current, next, opts) {
  const row = db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(accountId);
  if (!row || !(await verifyPassword(row.password_hash, current ?? ''))) throw new AppError(403, 'wrong_password', 'Your current password is not right.');
  checkPassword(next, opts.password);
  const hash = await hashPassword(next, opts.hash);
  db.transaction(() => {
    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, accountId);
    deleteAccountSessions(db, accountId);
  })();
}

/** A single-use reset token for this email, or null when there is no such account. */
export function requestReset(db, email, opts) {
  const now = opts.now?.() ?? new Date();
  let e;
  try { e = normalizeEmail(email); } catch { return null; }
  const row = db.prepare('SELECT id, email FROM accounts WHERE email = ?').get(e);
  if (!row) return null;
  const token = newToken();
  db.prepare('INSERT INTO password_resets (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), row.id, now.toISOString(), new Date(now.getTime() + opts.reset.expiresMinutes * 60000).toISOString());
  return { token, accountId: row.id, email: row.email };
}

/** Use a reset token: new password, token spent, every session ended. */
export async function completeReset(db, token, password, opts) {
  const now = opts.now?.() ?? new Date();
  const row = typeof token === 'string' && token.length <= 100
    ? db.prepare('SELECT token_hash, account_id, expires_at, used_at FROM password_resets WHERE token_hash = ?').get(sha256(token))
    : null;
  if (!row || row.used_at || row.expires_at <= now.toISOString()) throw new AppError(400, 'reset_invalid', 'This reset link is invalid or has expired. Ask for a new one.');
  checkPassword(password, opts.password);
  const hash = await hashPassword(password, opts.hash);
  db.transaction(() => {
    const spent = db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(now.toISOString(), row.token_hash);
    if (spent.changes !== 1) throw new AppError(400, 'reset_invalid', 'This reset link has already been used.');
    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, row.account_id);
    deleteAccountSessions(db, row.account_id);
  })();
  return { accountId: row.account_id };
}

/**
 * Create the master account, or promote an existing one. Either way the
 * password is (re)set through the same argon2id path and old sessions end,
 * so afterwards exactly these credentials sign in as master. Safe to repeat.
 */
export async function createMaster(db, { email, password }, opts) {
  const now = opts.now?.() ?? new Date();
  const e = normalizeEmail(email);
  checkPassword(password, opts.password);
  const hash = await hashPassword(password, opts.hash);
  const existing = db.prepare('SELECT id, role FROM accounts WHERE email = ?').get(e);
  if (existing) {
    db.transaction(() => {
      db.prepare("UPDATE accounts SET role = 'master', password_hash = ? WHERE id = ?").run(hash, existing.id);
      deleteAccountSessions(db, existing.id);
    })();
    return { accountId: existing.id, action: existing.role === 'master' ? 'updated' : 'promoted' };
  }
  const accountId = randomUUID();
  db.prepare("INSERT INTO accounts (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'master', ?)").run(accountId, e, hash, now.toISOString());
  return { accountId, action: 'created' };
}

export default { normalizeEmail, registerAccount, authenticate, changePassword, requestReset, completeReset, createMaster };
