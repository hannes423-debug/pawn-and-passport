/**
 * gameResult.js — how a game ended, and what it produced.
 *
 * Built once when a game finishes. Career XP, Ultimate Chess progression,
 * rating updates, the result screen and match history all read this object and
 * nothing else, so a new consumer never has to re-derive anything from a PGN.
 */

import { WHITE, BLACK, COLOUR_NAME } from './constants.js';
import { CLASSIFICATIONS } from '../analysis/moveClassifier.js';

/** Why the game stopped. */
export const TERMINATION = Object.freeze({
  CHECKMATE: 'checkmate',
  RESIGNATION: 'resignation',
  TIMEOUT: 'timeout',
  STALEMATE: 'stalemate',
  INSUFFICIENT_MATERIAL: 'insufficient-material',
  THREEFOLD: 'threefold-repetition',
  FIFTY_MOVE: 'fifty-move-rule',
  AGREEMENT: 'draw-agreed',
  ABANDONED: 'abandoned'
});

const TERMINATION_TEXT = {
  checkmate: 'Checkmate',
  resignation: 'Resignation',
  timeout: 'Time forfeit',
  stalemate: 'Stalemate',
  'insufficient-material': 'Insufficient material',
  'threefold-repetition': 'Threefold repetition',
  'fifty-move-rule': 'Fifty-move rule',
  'draw-agreed': 'Draw agreed',
  abandoned: 'Abandoned'
};

export class GameResult {
  constructor(fields = {}) {
    this.result = fields.result ?? '*';            // '1-0' | '0-1' | '1/2-1/2' | '*'
    this.termination = fields.termination ?? null;
    this.winner = fields.winner ?? null;           // 'w' | 'b' | null
    this.loser = fields.loser ?? null;
    this.players = fields.players ?? { w: 'White', b: 'Black' };
    this.moves = fields.moves ?? [];               // MoveRecord[]
    this.plyCount = fields.plyCount ?? this.moves.length;
    this.durationMs = fields.durationMs ?? 0;
    this.timeControl = fields.timeControl ?? null;
    this.pgn = fields.pgn ?? '';
    this.finalFen = fields.finalFen ?? null;
    this.startedAt = fields.startedAt ?? null;
    this.endedAt = fields.endedAt ?? Date.now();
    this.mode = fields.mode ?? 'quick-match';
    this.opening = fields.opening ?? null;         // { name, eco, ply }

    // Filled by summarise() once the review pass has classified the moves.
    this.accuracy = fields.accuracy ?? { w: null, b: null };
    this.averageCentipawnLoss = fields.averageCentipawnLoss ?? { w: null, b: null };
    this.counts = fields.counts ?? null;
    this.tacticalEvents = fields.tacticalEvents ?? [];
    this.keyMoments = fields.keyMoments ?? [];
    this.phases = fields.phases ?? null;
    this.analysed = fields.analysed ?? false;
  }

  get resultText() {
    if (this.result === '1/2-1/2') return 'Draw';
    if (this.winner) return `${COLOUR_NAME[this.winner]} wins`;
    return 'Unfinished';
  }

  get terminationText() { return TERMINATION_TEXT[this.termination] || 'Unknown'; }

  /** Human headline: 'White wins by checkmate'. */
  get headline() {
    if (this.result === '*') return 'Game in progress';
    if (this.result === '1/2-1/2') return `Draw — ${this.terminationText.toLowerCase()}`;
    return `${COLOUR_NAME[this.winner]} wins by ${this.terminationText.toLowerCase()}`;
  }

  /** Points for the given colour: 1 / 0.5 / 0. */
  scoreFor(colour) {
    if (this.result === '1/2-1/2') return 0.5;
    if (!this.winner) return 0;
    return this.winner === colour ? 1 : 0;
  }

  /**
   * Recompute the derived statistics from the (already analysed) move list.
   * Safe to call on an unanalysed game — everything analysis-derived stays null.
   */
  summarise() {
    const counts = { w: blankCounts(), b: blankCounts() };
    const losses = { w: [], b: [] };
    /**
     * Accuracy is computed from WIN-PROBABILITY loss, not centipawn loss.
     * Centipawns mis-score decided games badly: once a side is losing by a
     * queen, every move "loses" hundreds of centipawns while changing the
     * outcome not at all, and a clean game would score 35% accuracy. The
     * classifier already works in win probability, so accuracy uses the same
     * scale and the two numbers agree with each other.
     */
    const wpLosses = { w: [], b: [] };
    const tactical = [];

    for (const move of this.moves) {
      const side = move.color;
      counts[side].total += 1;
      if (move.mistakeClassification) {
        counts[side][move.mistakeClassification] = (counts[side][move.mistakeClassification] || 0) + 1;
      }
      if (typeof move.evaluationDelta === 'number') losses[side].push(move.evaluationDelta);
      if (typeof move.winProbLoss === 'number') wpLosses[side].push(move.winProbLoss);
      if (move.tacticalMotifs?.length) {
        for (const motif of move.tacticalMotifs) {
          tactical.push({ ply: move.ply, san: move.san, color: side, ...motif });
        }
      }
    }

    this.counts = counts;
    for (const side of [WHITE, BLACK]) {
      const list = losses[side];
      this.averageCentipawnLoss[side] = list.length
        ? Math.round(list.reduce((a, b) => a + b, 0) / list.length)
        : null;
      this.accuracy[side] = wpLosses[side].length ? accuracyFromWinProbLoss(wpLosses[side]) : null;
    }

    this.tacticalEvents = tactical;
    // A key moment is a move that CHANGED THE OUTCOME, so it is selected on
    // win-probability loss. Ranking on centipawns instead surfaces meaningless
    // swings inside an already-decided position.
    this.keyMoments = this.moves
      .filter((m) => typeof m.winProbLoss === 'number' && m.winProbLoss >= KEY_MOMENT_WP_LOSS)
      .sort((a, b) => b.winProbLoss - a.winProbLoss)
      .slice(0, 5)
      .map((m) => ({
        ply: m.ply, moveNumber: m.moveNumber, color: m.color, san: m.san,
        delta: m.evaluationDelta, winProbLoss: m.winProbLoss,
        classification: m.mistakeClassification,
        explanation: m.explanation?.text || null
      }))
      .sort((a, b) => a.ply - b.ply);

    this.phases = derivePhases(this.moves);
    this.analysed = this.moves.some((m) => m.mistakeClassification);
    return this;
  }

  toJSON() {
    return {
      ...this,
      moves: this.moves.map((m) => (typeof m.toJSON === 'function' ? m.toJSON() : m))
    };
  }
}

function blankCounts() {
  const counts = { total: 0 };
  for (const key of Object.values(CLASSIFICATIONS)) counts[key] = 0;
  return counts;
}

/** Win-probability points a move must cost to count as a key moment. */
const KEY_MOMENT_WP_LOSS = 9;

/**
 * Accuracy from a list of per-move WIN-PROBABILITY losses (0..100 each).
 *
 * 0 -> 100%, 2 -> ~93%, 5 -> ~82%, 10 -> ~66%, 20 -> ~46%. This is OUR curve,
 * chosen so the number agrees with the move classifications shown beside it.
 * It is not a reimplementation of any other site's accuracy score and is not
 * claimed to be comparable with one.
 */
export function accuracyFromWinProbLoss(losses) {
  if (!losses.length) return null;
  const average = losses.reduce((a, b) => a + b, 0) / losses.length;
  const value = 100 / (1 + Math.pow(average / 18, 1.2));
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

/**
 * Accuracy from centipawn losses. Kept for tooling that only has centipawns
 * (the Python pipeline reading a PGN without win-probability annotations);
 * summarise() prefers accuracyFromWinProbLoss, which scores decided games far
 * more sensibly.
 */
export function accuracyFromLosses(losses) {
  if (!losses.length) return null;
  const acpl = losses.reduce((a, b) => a + b, 0) / losses.length;
  const value = 100 / (1 + Math.pow(acpl / 90, 1.15));
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

/**
 * Split the game into opening / middlegame / endgame by ply.
 * Endgame starts when non-pawn material (both sides, kings excluded) drops
 * below the equivalent of a queen and a rook.
 */
export function derivePhases(moves) {
  if (!moves.length) return null;
  const openingEnd = Math.min(moves.length, moves.findIndex((m) => !m.book) === -1 ? 20 : Math.max(6, moves.findIndex((m) => !m.book)));
  let endgameStart = null;
  for (const move of moves) {
    if (!move.fenAfter) continue;
    if (nonPawnMaterial(move.fenAfter) <= 1400) { endgameStart = move.ply; break; }
  }
  return {
    opening: { fromPly: 1, toPly: openingEnd },
    middlegame: { fromPly: openingEnd + 1, toPly: endgameStart ? endgameStart - 1 : moves.length },
    endgame: endgameStart ? { fromPly: endgameStart, toPly: moves.length } : null
  };
}

const MAT = { n: 320, b: 330, r: 500, q: 900 };
function nonPawnMaterial(fen) {
  let total = 0;
  for (const ch of fen.split(' ')[0]) {
    const lower = ch.toLowerCase();
    if (MAT[lower]) total += MAT[lower];
  }
  return total;
}

export default GameResult;
