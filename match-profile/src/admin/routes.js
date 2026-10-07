/**
 * admin/routes.js - the master account's views (more arrive with milestone 7).
 *
 *   GET /api/admin/players?q=   usernames, public names only with consent, consent states
 *
 * Everything here reads players through players/directory.js, the query
 * layer that never selects an email and hides display names without consent.
 */

import { requireMaster } from '../auth/guard.js';
import { listPlayers } from '../players/directory.js';
import { currentConsents } from '../consent/index.js';

export function adminRoutes(app, { db }) {
  app.get('/api/admin/players', {
    preValidation: requireMaster,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      q: { type: 'string', maxLength: 40 }, limit: { type: 'integer', minimum: 1, maximum: 200 }, offset: { type: 'integer', minimum: 0 } } } }
  }, async (request) => {
    const players = listPlayers(db, { search: request.query.q || '', limit: request.query.limit || 50, offset: request.query.offset || 0 });
    return { players: players.map((p) => ({ ...p, consents: Object.fromEntries(Object.entries(currentConsents(db, p.id)).map(([k, v]) => [k, v.granted])) })) };
  });
}

export default { adminRoutes };
