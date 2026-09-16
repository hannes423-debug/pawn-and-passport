/**
 * moveClassifier.js — how good was that move?
 *
 * The classifier works in WIN PROBABILITY, not raw centipawns: giving up 80cp
 * from a dead-won +900 barely matters, while giving up 80cp from a level
 * position is a real error. Raw centipawn thresholds get that backwards, which
 * is why they are not used here as the primary signal.
 *
 * The thresholds are OURS and configurable (see DEFAULT_THRESHOLDS). They are
 * not a reimplementation of any particular website's labels, and the same
 * words deliberately mean slightly different things here.
 *
 * Everything is pure: no engine calls, no DOM. The caller supplies the engine
 * numbers it already has.
 */

import { at, legalMoves } from '../core/rules.js';
/* One-way at module load: brilliance.js reads winProbability and scoreToCp back
   out of this file, and both sides only touch the other from inside a function,
   so the cycle resolves. Keep it that way - a top-level read across it would
   see undefined. */
import { evaluateBrilliance } from './brilliance.js';
import { see, pieceList, clamp01 } from './boardAnalysis.js';
import { PIECE_VALUE, KING, otherColour } from '../core/constants.js';

export const CLASSIFICATIONS = Object.freeze({
  BRILLIANT: 'BRILLIANT',
  BEST: 'BEST',
  EXCELLENT: 'EXCELLENT',
  GOOD: 'GOOD',
  BOOK: 'BOOK',
  INACCURACY: 'INACCURACY',
  MISTAKE: 'MISTAKE',
  BLUNDER: 'BLUNDER',
  MISS: 'MISS',
  FORCED: 'FORCED'
});

/** Display metadata; the UI never hard-codes these strings. */
export const CLASSIFICATION_META = Object.freeze({
  BRILLIANT:  { label: 'Brilliant',  glyph: '!!', tone: 'brilliant', rank: 0 },
  BEST:       { label: 'Best',       glyph: '★',  tone: 'best',      rank: 1 },
  EXCELLENT:  { label: 'Excellent',  glyph: '!',  tone: 'excellent', rank: 2 },
  GOOD:       { label: 'Good',       glyph: '✓',  tone: 'good',      rank: 3 },
  BOOK:       { label: 'Book',       glyph: '📖', tone: 'book',      rank: 3 },
  FORCED:     { label: 'Forced',     glyph: '⇥',  tone: 'forced',    rank: 3 },
  INACCURACY: { label: 'Inaccuracy', glyph: '?!', tone: 'inaccuracy',rank: 4 },
  MISS:       { label: 'Missed win', glyph: '×',  tone: 'miss',      rank: 5 },
  MISTAKE:    { label: 'Mistake',    glyph: '?',  tone: 'mistake',   rank: 6 },
  BLUNDER:    { label: 'Blunder',    glyph: '??', tone: 'blunder',   rank: 7 }
});

/**
 * Boundaries in win-probability points lost (0..100).
 * Tunable per game mode: a Career beginner tier can be given a gentler curve
 * without touching the classifier itself.
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  best: 0.6,          // effectively the engine's move
  excellent: 2.5,
  good: 6,
  inaccuracy: 11,
  mistake: 20,
  // anything above `mistake` is a blunder
  /** How much complexity widens the error bands (fraction). */
  complexityTolerance: 0.35,
  /** Win-probability the position must retain for a sacrifice to be brilliant. */
  brilliantMinWinProb: 45,
  /** Material a brilliant move must genuinely offer, in centipawns. */
  brilliantMinSacrifice: 180,
  /** How far ahead the side had to be for a squandered advantage to be a MISS. */
  missAdvantage: 250
});

/**
 * Centipawns -> win probability (0..100) for the side to move.
 *
 * Pawn & Passport uses the widely used 0.00368208 slope (a logistic with a
 * ~272cp scale: +100cp ≈ 59%, +300cp ≈ 75%, +900cp ≈ 96%). World Tour's 350cp
 * scale flattened every advantage, so in the lopsided games amateurs play most
 * moves lost "nothing" and graded Best.
 */
export const WIN_PROB_SCALE_CP = 1 / 0.00368208;
export function winProbability(cp) {
  return 100 / (1 + Math.exp(-cp / WIN_PROB_SCALE_CP));
}

/**
 * Normalise an engine score object to centipawns from the given side's view.
 * Mate scores are mapped onto a large-but-finite scale so deltas stay usable.
 */
export function scoreToCp(score, { mateScale = 3000 } = {}) {
  if (!score) return 0;
  if (typeof score.mate === 'number' && score.mate !== null) {
    const distance = Math.abs(score.mate);
    const magnitude = mateScale - Math.min(distance, 20) * 40;
    return score.mate > 0 ? magnitude : -magnitude;
  }
  return typeof score.cp === 'number' ? score.cp : 0;
}

/**
 * Position complexity, 0..1. Deterministic and engine-free.
 * Feeds the classifier's tolerance and the explanation engine's confidence.
 */
export function positionComplexity(fen, { multipv = null } = {}) {
  const moves = legalMoves(fen);
  const legal = moves.length;
  const captures = moves.filter((m) => m.captured).length;
  const checks = moves.filter((m) => m.san.includes('+') || m.san.includes('#')).length;
  const promotions = moves.filter((m) => m.promotion).length;
  const pieces = pieceList(fen).filter((p) => p.type !== KING).length;

  // How close together the engine's top candidates are: many near-equal moves
  // means a genuinely hard choice.
  let spread = 0;
  if (multipv && multipv.length >= 2) {
    const top = scoreToCp(multipv[0].score);
    const near = multipv.filter((line) => Math.abs(top - scoreToCp(line.score)) <= 40).length;
    spread = clamp01((near - 1) / 3);
  }

  return clamp01(
    clamp01(legal / 45) * 0.30 +
    clamp01(captures / 8) * 0.20 +
    clamp01(checks / 4) * 0.15 +
    clamp01(promotions / 2) * 0.05 +
    clamp01(pieces / 28) * 0.15 +
    spread * 0.15
  );
}

/**
 * Did this move genuinely offer material?
 * Not "was it a capture" — a recapture is not a sacrifice. The test is: after
 * the move, can the opponent win material on the destination square by force?
 * @returns {{ isSacrifice:boolean, offered:number }}
 */
export function sacrificeValue(fenBefore, move) {
  const board = at(fenBefore);
  const moving = board.get(move.from);
  if (!moving || moving.type === KING) return { isSacrifice: false, offered: 0 };
  const capturedValue = move.captured ? PIECE_VALUE[move.captured] : 0;
  const after = at(fenBefore);
  try { after.move({ from: move.from, to: move.to, promotion: move.promotion }); }
  catch { return { isSacrifice: false, offered: 0 }; }
  const recapture = see(after.fen(), move.to, otherColour(moving.color));
  const offered = recapture - capturedValue;
  return { isSacrifice: offered >= 100, offered: Math.max(0, offered) };
}

/**
 * Classify one played move.
 *
 * @param {Object} input
 * @param {string} input.fenBefore
 * @param {Object} input.move                chess.js verbose move that was played
 * @param {Object} input.bestScore           engine score of the BEST move, mover's POV {cp|mate}
 * @param {Object} input.playedScore         engine score after the played move, mover's POV
 * @param {string} [input.bestMoveUci]
 * @param {boolean} [input.isBook]
 * @param {Array} [input.multipv]            engine candidate lines for fenBefore
 * @param {Object} [input.thresholds]
 * @returns {{classification:string, winProbLoss:number, cpLoss:number, complexity:number,
 *            forced:boolean, sacrifice:Object, reasons:string[]}}
 */
export function classifyMove({
  fenBefore, move, bestScore, playedScore, bestMoveUci = null,
  isBook = false, multipv = null, thresholds = DEFAULT_THRESHOLDS
}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const legal = legalMoves(fenBefore);
  const forced = legal.length === 1;
  const playedUci = move.from + move.to + (move.promotion || '');

  const bestCp = scoreToCp(bestScore);
  const playedCp = scoreToCp(playedScore);
  const cpLoss = Math.max(0, bestCp - playedCp);
  const rawWinProbLoss = Math.max(0, winProbability(bestCp) - winProbability(playedCp));
  /* Pawn & Passport: grade on the LARGER of the win-probability loss and a
     capped centipawn loss. Win probability alone stops moving once a game is
     decided, so from -1700 a king move walking into mate in five lost 0.1
     points and graded Best; amateur games are decided early, so most moves
     landed there. The centipawn term is deliberately gentle (100cp = 5
     points) so converting a won game safely still grades well, and it is
     ignored when both scores are mates for the same side (a slower mate is
     not an error). */
  const bothMatesSameSide = typeof bestScore?.mate === 'number' && typeof playedScore?.mate === 'number' &&
    Math.sign(bestScore.mate) === Math.sign(playedScore.mate);
  const cpTerm = t.cpLossDivisor && !bothMatesSameSide ? Math.min(cpLoss, t.cpLossCap ?? 800) / t.cpLossDivisor : 0;
  const winProbLoss = Math.max(rawWinProbLoss, cpTerm);
  const complexity = positionComplexity(fenBefore, { multipv });
  const sacrifice = sacrificeValue(fenBefore, move);
  const reasons = [];
  let brilliance = null;

  // Complexity widens the error bands: the same loss in a sharp position is a
  // more forgivable human choice than in a quiet one.
  const widen = 1 + complexity * t.complexityTolerance;
  const band = {
    best: t.best,
    excellent: t.excellent * widen,
    good: t.good * widen,
    inaccuracy: t.inaccuracy * widen,
    mistake: t.mistake * widen
  };

  const isEngineMove = bestMoveUci ? playedUci === bestMoveUci : winProbLoss <= t.best;

  if (forced) {
    reasons.push('only-legal-move');
    return result(CLASSIFICATIONS.FORCED);
  }

  /* BRILLIANT is decided in brilliance.js, not here.
     
     It used to be four conditions in a row - is it a sacrifice, is it roughly
     best, is the position still fine - and that combination fires on every
     sound exchange sacrifice and every fork where the material comes straight
     back, which is to say several times a game. The real test is a list of
     ways a candidate FAILS, and it needs the position after the move and the
     opponent's replies to run. */
  if (isEngineMove || winProbLoss <= band.best) {
    brilliance = evaluateBrilliance({
      fenBefore, fenAfter: fenAfterMove(fenBefore, move), move,
      playedScore, beforeScore: bestScore,
      secondBestScore: secondBestOf(multipv),
      isBestMove: true
    });
    if (brilliance.brilliant) {
      reasons.push(brilliance.reason);
      return result(CLASSIFICATIONS.BRILLIANT);
    }
  }

  if (isBook) { reasons.push('opening book'); return result(CLASSIFICATIONS.BOOK); }

  if (isEngineMove || winProbLoss <= band.best) {
    reasons.push('matches the engine first choice');
    return result(CLASSIFICATIONS.BEST);
  }

  // MISS: the side had something decisive (a mate or a big material win) and
  // let it go. That is a different failure from drifting into a worse position,
  // so it gets its own label rather than being folded into MISTAKE.
  const hadMate = typeof bestScore?.mate === 'number' && bestScore.mate > 0;
  const stillMate = typeof playedScore?.mate === 'number' && playedScore.mate > 0;
  const hadDecisive = bestCp >= t.missAdvantage;
  const keptDecisive = playedCp >= t.missAdvantage;
  if (((hadMate && !stillMate) || (hadDecisive && !keptDecisive)) && winProbLoss > band.good) {
    reasons.push(hadMate ? 'a forced mate was available' : 'a decisive advantage was available');
    return result(CLASSIFICATIONS.MISS);
  }

  if (winProbLoss <= band.excellent) return result(CLASSIFICATIONS.EXCELLENT);
  if (winProbLoss <= band.good) return result(CLASSIFICATIONS.GOOD);
  if (winProbLoss <= band.inaccuracy) return result(CLASSIFICATIONS.INACCURACY);
  if (winProbLoss <= band.mistake) return result(CLASSIFICATIONS.MISTAKE);
  return result(CLASSIFICATIONS.BLUNDER);

  function result(classification) {
    return {
      classification,
      winProbLoss: Math.round(winProbLoss * 10) / 10,
      rawWinProbLoss: Math.round(rawWinProbLoss * 10) / 10,
      cpLoss: Math.round(cpLoss),
      complexity: Math.round(complexity * 100) / 100,
      forced, sacrifice, brilliance, bands: band, reasons
    };
  }
}

/** The position after the played move, or the position itself if it will not go. */
function fenAfterMove(fen, move) {
  const board = at(fen);
  try { board.move({ from: move.from, to: move.to, promotion: move.promotion }); }
  catch { return fen; }
  return board.fen();
}

/**
 * The mover's SECOND choice, from the engine lines it already produced.
 * Without it the "another move won just as easily" test cannot run, so a
 * caller with no multipv gets a slightly more generous brilliant.
 */
function secondBestOf(multipv) {
  if (!Array.isArray(multipv) || multipv.length < 2) return null;
  const line = multipv[1];
  return line && (line.score || (typeof line.cp === 'number' ? { cp: line.cp } : null));
}

export default { classifyMove, CLASSIFICATIONS, CLASSIFICATION_META, DEFAULT_THRESHOLDS, winProbability, scoreToCp, positionComplexity, sacrificeValue };
