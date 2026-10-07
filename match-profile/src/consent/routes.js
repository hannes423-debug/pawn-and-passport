/**
 * consent/routes.js
 *
 *   GET  /api/consent/types     the types, their wording and the policy version (public: the sign-up page)
 *   GET  /api/consent           your current consents and full history
 *   POST /api/consent           { type, granted }: a new event; required ones cannot be withdrawn here
 */

import { AppError } from '../errors.js';
import { CONSENT_TYPES, POLICY_VERSION, consentType, recordConsent, currentConsents, consentHistory } from './index.js';
import { requirePlayer } from '../auth/guard.js';

export function consentRoutes(app, { db, now }) {
  app.get('/api/consent/types', { config: { public: true } }, async () => ({ policyVersion: POLICY_VERSION, types: CONSENT_TYPES }));

  app.get('/api/consent', { preValidation: requirePlayer }, async (request) => ({
    policyVersion: POLICY_VERSION,
    current: currentConsents(db, request.auth.playerId),
    history: consentHistory(db, request.auth.playerId)
  }));

  app.post('/api/consent', {
    preValidation: requirePlayer,
    schema: { body: { type: 'object', required: ['type', 'granted'], additionalProperties: false,
      properties: { type: { type: 'string', maxLength: 40 }, granted: { type: 'boolean' } } } }
  }, async (request) => {
    const def = consentType(request.body.type);
    if (!def) throw new AppError(400, 'unknown_consent', 'No such consent.');
    if (def.required && !request.body.granted) {
      throw new AppError(409, 'required_consent', `"${def.label}" is a condition of the service: withdrawing it means deleting your account (Settings > Delete account).`);
    }
    recordConsent(db, request.auth.playerId, def.type, request.body.granted, { now: now() });
    return { current: currentConsents(db, request.auth.playerId) };
  });
}

export default { consentRoutes };
