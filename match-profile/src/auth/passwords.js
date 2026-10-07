/**
 * passwords.js - argon2id hashing and the password rules.
 *
 * The one path every password goes through: registration, change, reset
 * and the create-master CLI. Length is the only rule (spec: minimum 10, no
 * composition rules); the maximum only stops someone hashing a megabyte.
 */

import argon2 from 'argon2';
import { AppError } from '../errors.js';

export function checkPassword(password, { minLength, maxLength }) {
  if (typeof password !== 'string') throw new AppError(400, 'password_invalid', 'Choose a password.');
  if (password.length < minLength) throw new AppError(400, 'password_too_short', `Use at least ${minLength} characters.`);
  if (password.length > maxLength) throw new AppError(400, 'password_too_long', `Use at most ${maxLength} characters.`);
}

export const hashPassword = (password, opts) => argon2.hash(password, { type: argon2.argon2id, ...opts });

export async function verifyPassword(hash, password) {
  try { return await argon2.verify(hash, password); } catch { return false; }
}

/* An unknown email still costs one verify, so the answer's timing does not
   tell whether an account exists. */
const dummies = new Map();
export async function dummyVerify(opts) {
  const key = JSON.stringify(opts);
  if (!dummies.has(key)) dummies.set(key, await hashPassword('not-a-real-password', opts));
  await verifyPassword(dummies.get(key), 'still-not-a-real-password');
  return false;
}

export default { checkPassword, hashPassword, verifyPassword, dummyVerify };
