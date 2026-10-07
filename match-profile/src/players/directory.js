/**
 * directory.js - the only queries that show one player to someone else.
 *
 * Visibility is enforced here, in SQL, not in the UI: no query in this file
 * selects an email, a password hash or a session, and display_name and
 * country come back only for players whose current public_name consent is
 * on. Admin screens and exports read players through these functions.
 */

const PUBLIC_NAME = `(
  SELECT ce.granted FROM consent_events ce
  WHERE ce.player_id = p.id AND ce.consent_type = 'public_name'
  ORDER BY ce.id DESC LIMIT 1)`;

const VISIBLE_COLUMNS = `
  p.id, p.username, p.created_at,
  CASE WHEN ${PUBLIC_NAME} = 1 THEN p.display_name END AS display_name,
  CASE WHEN ${PUBLIC_NAME} = 1 THEN p.country END AS country`;

export function listPlayers(db, { search = '', limit = 50, offset = 0 } = {}) {
  const like = `%${String(search).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db.prepare(`SELECT ${VISIBLE_COLUMNS} FROM players p
    WHERE p.username LIKE ? ESCAPE '\\'
    ORDER BY p.username COLLATE NOCASE LIMIT ? OFFSET ?`).all(like, Math.min(200, limit), offset);
}

export const getPlayer = (db, playerId) => db.prepare(`SELECT ${VISIBLE_COLUMNS} FROM players p WHERE p.id = ?`).get(playerId) || null;

export default { listPlayers, getPlayer };
