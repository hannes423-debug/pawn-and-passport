/**
 * grading.js - one verdict per player move, in the game's own vocabulary.
 *
 * The classifier (analysis/moveClassifier.js, unchanged from Chess: World
 * Tour) decides BRILLIANT ... BLUNDER. feedback.js turns BRILLIANT into EPIC
 * when it was also the engine's move. Pawn & Passport adds one tier on top:
 *
 *   CLUTCH  the only good move under pressure. The played move is the
 *           engine's choice (BEST/EXCELLENT), the runner-up was at least
 *           config.CLUTCH.minGapWinProb worse, the mover was not already
 *           cruising, and the move holds the position.
 *
 * EPIC and BRILLIANT outrank CLUTCH: a sound sacrifice is rarer still.
 */

import { CLUTCH } from '../data/config.js';
import { tierFor } from '../chess/render/feedback.js';
import { winProbability, scoreToCp } from '../chess/analysis/moveClassifier.js';

/** Display metadata for the grade keys, best first. */
export const GRADE_META = Object.freeze({
  EPIC:       { label: 'Epic',       glyph: '!!!', tier: 'epic' },
  BRILLIANT:  { label: 'Brilliant',  glyph: '!!',  tier: 'brilliant' },
  CLUTCH:     { label: 'Clutch',     glyph: '!★',  tier: 'clutch' },
  BEST:       { label: 'Best',       glyph: '★',   tier: 'best' },
  EXCELLENT:  { label: 'Excellent',  glyph: '!',   tier: 'best' },
  GOOD:       { label: 'Good',       glyph: '✓',   tier: 'good' },
  BOOK:       { label: 'Book',       glyph: '📖',  tier: 'playable' },
  FORCED:     { label: 'Forced',     glyph: '⇥',   tier: 'neutral' },
  INACCURACY: { label: 'Inaccuracy', glyph: '?!',  tier: 'mistake' },
  MISS:       { label: 'Missed win', glyph: '×',   tier: 'mistake' },
  MISTAKE:    { label: 'Mistake',    glyph: '?',   tier: 'mistake' },
  BLUNDER:    { label: 'Blunder',    glyph: '??',  tier: 'blunder' }
});

export const GRADE_ORDER = ['EPIC', 'BRILLIANT', 'CLUTCH', 'BEST', 'EXCELLENT', 'GOOD', 'BOOK', 'INACCURACY', 'MISS', 'MISTAKE', 'BLUNDER'];

/**
 * Is this annotated move CLUTCH?
 * @param {Object} record   a MoveRecord after GameReview.annotate
 * @param {Object[]} lines  the MultiPV lines for record.fenBefore (mover's POV)
 */
export function isClutch(record, lines) {
  const c = record.mistakeClassification;
  if (c !== 'BEST' && c !== 'EXCELLENT') return false;
  if (!lines || lines.length < 2) return false;
  const best = winProbability(scoreToCp(lines[0].score));
  const second = winProbability(scoreToCp(lines[1].score));
  const played = typeof record.engineEvaluation?.cp === 'number' || typeof record.engineEvaluation?.mate === 'number'
    ? winProbability(scoreToCp(record.engineEvaluation))
    : best;
  return best - second >= CLUTCH.minGapWinProb &&
         best <= CLUTCH.maxWinProbBefore &&
         played >= CLUTCH.minWinProbAfter;
}

/**
 * @returns {{grade:string, tier:string, meta:Object}}
 */
export function gradeMove(record, lines = null) {
  const c = record.mistakeClassification;
  if (!c) return { grade: null, tier: 'neutral', meta: null };
  let grade = c;
  if (c === 'BRILLIANT') {
    grade = tierFor(c, { isBest: record.bestMove === record.uci, loss: record.evaluationDelta }) === 'epic' ? 'EPIC' : 'BRILLIANT';
  } else if (isClutch(record, lines)) {
    grade = 'CLUTCH';
  }
  const meta = GRADE_META[grade] || GRADE_META.GOOD;
  return { grade, tier: meta.tier, meta };
}

export function emptyGradeCounts() {
  return Object.fromEntries(GRADE_ORDER.map((g) => [g, 0]));
}

export default { GRADE_META, GRADE_ORDER, isClutch, gradeMove, emptyGradeCounts };
