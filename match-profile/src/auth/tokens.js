/**
 * tokens.js - random tokens and how they are stored.
 *
 * Session ids and reset tokens are 256-bit random values handed to the
 * browser; the database keeps only their SHA-256, so a copy of it cannot
 * be used to sign in or reset a password.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export default { newToken, sha256, safeEqual };
