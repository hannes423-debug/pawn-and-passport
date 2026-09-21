/**
 * analysisLevels.js — the seven strength/assistance bands the game speaks in.
 *
 * IMPORTANT: these names are GAME-FACING DIFFICULTY LABELS. They are not
 * claimed to correspond to human Elo ratings, FIDE titles, or any rating list.
 * "Grandmaster" here means "the sixth of six analysis presets in this game",
 * nothing more. The numbers underneath (depth, nodes, movetime, MultiPV,
 * Skill Level) are what actually change.
 */

export const LEVELS = Object.freeze({
  NOVICE: 'novice',
  BEGINNER: 'beginner',
  CLUB: 'club',
  ADVANCED: 'advanced',
  MASTER: 'master',
  GRANDMASTER: 'grandmaster',
  MAXIMUM: 'maximum'
});

/**
 * @typedef {Object} AnalysisLevel
 * @property {string} id
 * @property {string} label
 * @property {number|null} depth       search depth cap
 * @property {number|null} nodes       node cap (dominant when set)
 * @property {number|null} movetime    milliseconds
 * @property {number} multiPv          candidate lines requested
 * @property {number|null} skillLevel  Stockfish "Skill Level" 0..20, null = full
 * @property {number|null} uciElo      Stockfish UCI_Elo, null = unlimited
 * @property {string} note
 */

/** Ordered weakest -> strongest. The UI renders them in this order. */
export const ANALYSIS_LEVELS = Object.freeze([
  {
    id: LEVELS.NOVICE, label: 'Novice', order: 0,
    depth: 2, nodes: 700, movetime: 50, multiPv: 6,
    skillLevel: 0, uciElo: 1320,
    note: 'Barely looks past the move it is making. Stockfish will not limit itself below 1320, so what actually makes a novice weak is the wide pool this returns and the mistakes the bot layer makes on top.'
  },
  {
    id: LEVELS.BEGINNER, label: 'Beginner', order: 1,
    depth: 4, nodes: 6000, movetime: 120, multiPv: 4,
    skillLevel: 1, uciElo: 1320,
    note: 'Shallow search. Misses most tactics beyond one move.'
  },
  {
    id: LEVELS.CLUB, label: 'Club', order: 2,
    depth: 8, nodes: 60000, movetime: 300, multiPv: 3,
    skillLevel: 6, uciElo: 1600,
    note: 'Sees short tactics reliably; long plans are hit and miss.'
  },
  {
    id: LEVELS.ADVANCED, label: 'Advanced', order: 3,
    depth: 12, nodes: 300000, movetime: 600, multiPv: 3,
    skillLevel: 11, uciElo: 2000,
    note: 'Solid tactical vision and reasonable positional judgement.'
  },
  {
    id: LEVELS.MASTER, label: 'Master', order: 4,
    depth: 16, nodes: 1200000, movetime: 1200, multiPv: 3,
    skillLevel: 16, uciElo: 2400,
    note: 'Strong tactics, few oversights.'
  },
  {
    id: LEVELS.GRANDMASTER, label: 'Grandmaster', order: 5,
    depth: 20, nodes: 4000000, movetime: 2500, multiPv: 3,
    skillLevel: 20, uciElo: 2850,
    note: 'Near the engine ceiling for this build.'
  },
  {
    id: LEVELS.MAXIMUM, label: 'Maximum', order: 6,
    depth: 24, nodes: null, movetime: 5000, multiPv: 4,
    skillLevel: null, uciElo: null,
    note: 'No handicap. Used for post-game review, not as an opponent.'
  }
]);

export function levelById(id) {
  return ANALYSIS_LEVELS.find((level) => level.id === id) || ANALYSIS_LEVELS[2];
}

/** A cheap level for live analysis during play — never blocks the move. */
export const LIVE_LEVEL = Object.freeze({
  id: 'live', label: 'Live', order: -1,
  depth: 12, nodes: 120000, movetime: 350, multiPv: 3,
  skillLevel: null, uciElo: null,
  note: 'Background analysis while a game is running.'
});

/** The level post-game review runs at. */
export const REVIEW_LEVEL = Object.freeze({
  id: 'review', label: 'Review', order: -2,
  depth: 14, nodes: 400000, movetime: 500, multiPv: 3,
  skillLevel: null, uciElo: null,
  note: 'Per-move review pass. Depth is capped so a 60-move game stays quick.'
});

export default { ANALYSIS_LEVELS, LEVELS, levelById, LIVE_LEVEL, REVIEW_LEVEL };
