/**
 * consent/index.js - the consent types and their append-only history.
 *
 * Every change is a new consent_events row carrying the policy version it
 * was given under; the current state of a type is its latest row. History
 * is never deleted (account deletion aside). Changing any wording below
 * means a new POLICY_VERSION.
 */

import { AppError } from '../errors.js';

export const POLICY_VERSION = '2026-10-07';

export const CONSENT_TYPES = Object.freeze([
  { type: 'store_games', required: true, label: 'Store my games',
    text: 'We keep the games you play here and the ones you import, so they can be analysed and shown back to you.' },
  { type: 'analyse_games', required: true, label: 'Analyse my games',
    text: 'A chess engine analyses your games to build your player profile. No AI language model is involved.' },
  { type: 'import_lichess', required: false, label: 'Import from Lichess',
    text: 'You may import games from a Lichess account you prove is yours; we ask again before every import.' },
  { type: 'pnp_profile_use', required: false, label: 'Pawn & Passport opponent',
    text: 'Your profile may be used to build a Pawn & Passport opponent that plays like you.' },
  { type: 'public_name', required: false, label: 'Show my name',
    text: 'Show your display name and country to others; otherwise only your username is shown.' },
  { type: 'likeness_use', required: false, label: 'Use my likeness',
    text: 'Your likeness may be used for a game character. Nothing can be uploaded yet; this only records your answer.' },
  { type: 'promotional_use', required: false, label: 'Promotion',
    text: 'Your games or profile may be shown in news about Pawn & Passport.' }
]);

export const consentType = (type) => CONSENT_TYPES.find((c) => c.type === type) || null;

export function recordConsent(db, playerId, type, granted, { policyVersion = POLICY_VERSION, now = new Date() } = {}) {
  if (!consentType(type)) throw new AppError(400, 'unknown_consent', `No consent called ${type}.`);
  db.prepare('INSERT INTO consent_events (player_id, consent_type, granted, policy_version, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(playerId, type, granted ? 1 : 0, policyVersion, now.toISOString());
}

/** { type: { granted, policy_version, at } } for every type; a type never answered reads as not granted. */
export function currentConsents(db, playerId) {
  const rows = db.prepare(`
    SELECT ce.consent_type, ce.granted, ce.policy_version, ce.created_at
    FROM consent_events ce
    JOIN (SELECT consent_type, MAX(id) AS id FROM consent_events WHERE player_id = ? GROUP BY consent_type) latest
      ON latest.id = ce.id`).all(playerId);
  const out = {};
  for (const c of CONSENT_TYPES) out[c.type] = { granted: false, policy_version: null, at: null };
  for (const r of rows) out[r.consent_type] = { granted: r.granted === 1, policy_version: r.policy_version, at: r.created_at };
  return out;
}

export const consentHistory = (db, playerId) => db.prepare(
  'SELECT consent_type, granted, policy_version, created_at FROM consent_events WHERE player_id = ? ORDER BY id'
).all(playerId).map((r) => ({ ...r, granted: r.granted === 1 }));

export const hasConsent = (db, playerId, type) => currentConsents(db, playerId)[type]?.granted === true;

/** The registration answers: required ones must be accepted, optional ones default to off. */
export function initialConsents(answers = {}) {
  const out = {};
  for (const c of CONSENT_TYPES) {
    const given = answers[c.type] === true;
    if (c.required && !given) throw new AppError(400, 'required_consent', `"${c.label}" is a condition of using the service.`);
    out[c.type] = given;
  }
  return out;
}

export default { POLICY_VERSION, CONSENT_TYPES, consentType, recordConsent, currentConsents, consentHistory, hasConsent, initialConsents };
