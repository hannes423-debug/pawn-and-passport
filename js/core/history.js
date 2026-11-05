/**
 * history.js - the record of finished games: what Match History and the
 * game viewer read. Pure: the storage is js/core/save.js (its own key,
 * PAP_history_v1, so the career - written on every step through a door -
 * does not grow with every game played).
 *
 * One entry per finished game, written once, after its rewards are committed
 * (js/ui/screens/match.js). An entry is small (about 1 KB for a 40-move
 * game): the moves as SAN, the start position only if it was not the usual
 * one, and the player's live grade per move.
 *
 * What an entry says about the moves is labelled for what it is:
 *   liveGrades  the RPG feedback the player saw during the game (EPIC ... BLUNDER,
 *               js/core/grading.js): win-probability bands from a quick search,
 *               NOT an engine verdict, and FOCUS where a hint was followed
 *   accuracy    the same live grading, summarised
 * A review screen that runs the engine afresh must say so separately.
 *
 * Versioned: HISTORY_VERSION is in the stored object; migrateHistory() takes
 * any older shape forward and drops entries it cannot read rather than
 * failing the whole list.
 */

export const HISTORY_VERSION = 1;
export const HISTORY_MAX = 200;      // oldest dropped first
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const emptyHistory = () => ({ version: HISTORY_VERSION, games: [] });

/**
 * Build one entry from a finished game.
 * @param {Object} o
 * @param {Object} o.career            the career it was played in (after commit)
 * @param {string} o.gameId
 * @param {string} o.kind              friendly | challenge | tournament | star | finale
 * @param {string|null} o.clubId
 * @param {{id?:string, name:string, elo:number}} o.opponent
 * @param {'w'|'b'} o.colour           the player's side
 * @param {string} o.startFen
 * @param {Array} o.moves              MoveRecords (san, uci, color, grade)
 * @param {Object} o.summary           PapMatch.summary()
 * @param {Object} [o.rewards]         commitMatchResult rewards (eloDelta, elo)
 * @param {number} [o.now]
 */
export function historyEntry({ career, gameId, kind, clubId = null, opponent, colour, startFen = START_FEN, moves, summary, rewards = null, now = Date.now() }) {
  const sans = moves.map((m) => m.san).filter(Boolean);
  return {
    id: gameId,
    career: career?.createdAt ?? null,      // which career this game belongs to
    at: now,
    kind,
    clubId,
    opponent: { id: opponent?.id ?? null, name: opponent?.name || 'Opponent', elo: opponent?.elo ?? null },
    colour,
    score: summary.score,
    termination: summary.termination || null,
    headline: summary.headline || '',
    startFen: startFen && startFen !== START_FEN ? startFen : null,
    moves: sans.join(' '),
    // One slot per ply; only the player's own plies carry a grade.
    liveGrades: moves.map((m) => (m.color === colour && m.grade ? m.grade : null)),
    accuracy: typeof summary.accuracy === 'number' ? summary.accuracy : null,
    matchScore: summary.matchScore ? { letter: summary.matchScore.letter, total: summary.matchScore.total } : null,
    hintsUsed: summary.hintsUsed || 0,
    undosUsed: summary.undosUsed || 0,
    rated: kind !== 'friendly',
    eloDelta: rewards && kind !== 'friendly' ? rewards.eloDelta : null,
    eloAfter: rewards?.elo ?? career?.elo ?? null
  };
}

/** Add an entry (once per game id), newest first, capped. Returns the list. */
export function addEntry(history, entry, max = HISTORY_MAX) {
  const h = history && Array.isArray(history.games) ? history : emptyHistory();
  if (!entry?.id || h.games.some((g) => g.id === entry.id)) return h;
  h.games.unshift(entry);
  if (h.games.length > max) h.games.length = max;
  return h;
}

/** Is this a readable entry? (A hand-edited or half-written one is dropped.) */
export function validEntry(g) {
  return !!g && typeof g === 'object' && typeof g.id === 'string' && typeof g.moves === 'string' &&
    [0, 0.5, 1].includes(g.score) && (g.colour === 'w' || g.colour === 'b') && typeof g.at === 'number';
}

/** Bring a stored history up to date. Never throws; unreadable parts are dropped. */
export function migrateHistory(raw) {
  if (!raw || typeof raw !== 'object') return emptyHistory();
  // (v0 never shipped: a bare array is accepted in case one is ever hand-made.)
  const games = Array.isArray(raw) ? raw : Array.isArray(raw.games) ? raw.games : [];
  const out = { version: HISTORY_VERSION, games: [] };
  const seen = new Set();
  for (const g of games) {
    if (!validEntry(g) || seen.has(g.id)) continue;
    seen.add(g.id);
    if (!Array.isArray(g.liveGrades)) g.liveGrades = [];
    out.games.push(g);
  }
  out.games.sort((a, b) => b.at - a.at);
  if (out.games.length > HISTORY_MAX) out.games.length = HISTORY_MAX;
  return out;
}

/** The games of one career, newest first. */
export const gamesOf = (history, career) => (history?.games || []).filter((g) => career && g.career === career.createdAt);

/** A PGN of an entry, for copying out to any chess program. */
export function entryPgn(g, { playerName = 'Player', event = 'Pawn & Passport' } = {}) {
  const white = g.colour === 'w' ? playerName : g.opponent.name;
  const black = g.colour === 'w' ? g.opponent.name : playerName;
  const whiteScore = g.colour === 'w' ? g.score : 1 - g.score;
  const result = whiteScore === 1 ? '1-0' : whiteScore === 0 ? '0-1' : '1/2-1/2';
  const d = new Date(g.at);
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const tags = [
    ['Event', event], ['Site', 'Pawn & Passport'], ['Date', date], ['White', white], ['Black', black], ['Result', result],
    ...(g.colour === 'w' ? [['BlackElo', g.opponent.elo]] : [['WhiteElo', g.opponent.elo]]).filter(([, v]) => v != null),
    ...(g.startFen ? [['SetUp', '1'], ['FEN', g.startFen]] : [])
  ];
  const sans = g.moves ? g.moves.split(' ') : [];
  const startBlack = g.startFen ? g.startFen.split(' ')[1] === 'b' : false;
  const startNo = g.startFen ? Number(g.startFen.split(' ')[5]) || 1 : 1;
  const parts = [];
  sans.forEach((san, i) => {
    const ply = i + (startBlack ? 1 : 0);
    const no = startNo + Math.floor(ply / 2);
    if (ply % 2 === 0) parts.push(`${no}.`);
    else if (i === 0) parts.push(`${no}...`);
    parts.push(san);
  });
  parts.push(result);
  // A tag value may not hold a double quote; several readers (chess.js among
  // them) reject the \" escape the standard allows, so it becomes a single one.
  const esc = (v) => String(v).replace(/\\/g, '/').replace(/"/g, "'").replace(/[\r\n]/g, ' ');
  return `${tags.map(([k, v]) => `[${k} "${esc(v)}"]`).join('\n')}\n\n${parts.join(' ')}\n`;
}

export default { HISTORY_VERSION, HISTORY_MAX, emptyHistory, historyEntry, addEntry, validEntry, migrateHistory, gamesOf, entryPgn };
