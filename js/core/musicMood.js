/**
 * musicMood.js - which match track should be playing, and when it may change.
 *
 * DELIBERATELY BLIND TO THE EVALUATION. The soundtrack must never work as a
 * hidden eval bar: if the music darkened whenever the engine disliked your
 * position, it would be telling you that you are losing, which is exactly the
 * coaching this game does not do (the Focus hints are opt-in and cost
 * something; the music is not opt-in). So nothing here reads a centipawn
 * score, a mate score, or anything derived from one. It reads only what a
 * player watching the board can already see for themselves:
 *
 *   - checks, captures and promotions in the last few moves (forcing play)
 *   - being in check right now
 *   - having almost no legal moves (a real crisis, from the rules alone)
 *   - a mate available on the board this move, to whoever is to move
 *   - the phase of the game
 *   - a clock about to run out, in a timed game
 *
 * Those add up to a HEAT, 0..100. Heat picks a mood through two rules that
 * keep the music from flickering:
 *
 *   HYSTERESIS  it takes more heat to climb than to stay, so a mood that has
 *               been earned holds until things genuinely calm down.
 *   DWELL       no mood lasts less than DWELL_MS, whichever way heat moves.
 *
 * `critical` needs a CRISIS on top of the heat - mate on the board, a king
 * with almost nowhere to go, or seconds left - so it stays rare. An ordinary
 * check in a quiet opening scores 32 and does not even reach `intense`.
 */

import { legalMoves, inCheck, phaseOf, turnOf } from '../chess/core/rules.js';

export const MOODS = Object.freeze(['tactical', 'intense', 'critical']);

export const MOOD_RULES = Object.freeze({
  window: 6,              // plies of recent play that count as "recent"
  check: 14,              // a check in the window
  capture: 8,             // a capture in the window
  promotion: 12,
  inCheckNow: 18,
  fewReplies: 25,         // the side to move has two legal moves or fewer
  mateOnBoard: 30,        // mate available this move, either way
  endgame: 10,
  lowClock: 25,           // under LOW_CLOCK_S seconds left
  lowClockS: 30,
  hurryClockS: 12,        // this much left is a crisis in its own right
  toIntense: 45,
  holdIntense: 32,
  toCritical: 70,
  holdCritical: 55,
  dwellMs: 15000,
  minPly: 16              // no `critical` before this, unless mate is on the board
});

/** Everything the heat is built from, as plain observable facts. */
export function moodFacts(fen, moves = [], clock = null) {
  const recent = moves.slice(-MOOD_RULES.window);
  const facts = {
    ply: moves.length,
    phase: phaseOf(fen),
    inCheck: false,
    replies: 99,
    mateOnBoard: false,
    checks: recent.filter((m) => m.check && !m.checkmate).length,
    captures: recent.filter((m) => m.capturedPiece).length,
    promotions: recent.filter((m) => m.promotion).length,
    secondsLeft: null
  };
  try {
    facts.inCheck = inCheck(fen);
    const legal = legalMoves(fen);
    facts.replies = legal.length;
    // chess.js spells mate into the SAN, so this costs one move generation,
    // not a search - and it is a fact about the position, not an opinion.
    facts.mateOnBoard = legal.some((m) => typeof m.san === 'string' && m.san.endsWith('#'));
  } catch { /* a malformed FEN just scores as quiet */ }
  if (clock && typeof clock === 'object') {
    const side = turnOf(fen) === 'b' ? 'b' : 'w';
    const left = clock[side];
    if (typeof left === 'number' && Number.isFinite(left)) facts.secondsLeft = left > 1000 ? left / 1000 : left;
  }
  return facts;
}

/** 0..100, from `moodFacts`. */
export function heatOf(facts) {
  const R = MOOD_RULES;
  let heat = 0;
  heat += facts.checks * R.check;
  heat += facts.captures * R.capture;
  heat += facts.promotions * R.promotion;
  if (facts.inCheck) heat += R.inCheckNow;
  if (facts.replies <= 2) heat += R.fewReplies;
  if (facts.mateOnBoard) heat += R.mateOnBoard;
  if (facts.phase === 'endgame') heat += R.endgame;
  if (facts.secondsLeft !== null && facts.secondsLeft <= R.lowClockS) heat += R.lowClock;
  return Math.max(0, Math.min(100, heat));
}

/** The things that alone justify the last track. Without one, heat cannot. */
export function isCrisis(facts) {
  const R = MOOD_RULES;
  if (facts.mateOnBoard) return true;
  if (facts.inCheck && facts.replies <= 3) return true;
  if (facts.secondsLeft !== null && facts.secondsLeft <= R.hurryClockS) return true;
  return false;
}

/**
 * The mood machine. Feed it a position after each move; it returns the track
 * that should be playing, changing as rarely as the rules above allow.
 *
 *   const mood = createMoodTracker();
 *   mood.update(fen, moves, clock, now) // -> 'tactical' | 'intense' | 'critical'
 */
export function createMoodTracker({ now = () => Date.now(), rules = MOOD_RULES } = {}) {
  let mood = 'tactical';
  let since = now();
  let last = { heat: 0, facts: null, crisis: false };

  function update(fen, moves = [], clock = null, at = now()) {
    const facts = moodFacts(fen, moves, clock);
    const heat = heatOf(facts);
    const crisis = isCrisis(facts);
    last = { heat, facts, crisis };

    const wanted = (() => {
      const criticalOk = crisis && (facts.ply >= rules.minPly || facts.mateOnBoard);
      if (mood === 'critical') {
        if (heat >= rules.holdCritical && crisis) return 'critical';
        return heat >= rules.holdIntense ? 'intense' : 'tactical';
      }
      if (heat >= rules.toCritical && criticalOk) return 'critical';
      if (mood === 'intense') return heat >= rules.holdIntense ? 'intense' : 'tactical';
      return heat >= rules.toIntense ? 'intense' : 'tactical';
    })();

    // One step at a time on the way down, so the fall is critical -> intense
    // -> tactical rather than a drop straight back to calm.
    const step = (from, to) => {
      const a = MOODS.indexOf(from);
      const b = MOODS.indexOf(to);
      return b < a ? MOODS[a - 1] : MOODS[b];
    };
    const next = step(mood, wanted);
    if (next !== mood && at - since >= rules.dwellMs) {
      mood = next;
      since = at;
    }
    return mood;
  }

  return {
    update,
    get mood() { return mood; },
    get heat() { return last.heat; },
    get facts() { return last.facts; },
    get crisis() { return last.crisis; },
    /** For a fresh game: back to the default track with no dwell owed. */
    reset(at = now()) { mood = 'tactical'; since = at - rules.dwellMs; last = { heat: 0, facts: null, crisis: false }; }
  };
}

export default { MOODS, MOOD_RULES, moodFacts, heatOf, isCrisis, createMoodTracker };
