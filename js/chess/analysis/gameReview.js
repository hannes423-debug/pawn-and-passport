/**
 * gameReview.js — the post-game pass.
 *
 * Walks the move list once, and for every ply asks the engine for the position
 * BEFORE the move. That single analysis answers both questions at once — what
 * was best, and what the played move was worth — because the played move
 * appears in the MultiPV list or, when it does not, is evaluated in a second
 * cheap call. Doing it this way roughly halves the number of searches versus
 * the naive before/after pair.
 *
 * Results are written back onto the MoveRecord objects, so everything
 * downstream (result screen, career XP, statistics, the Python exporter) reads
 * one shape.
 */

import { classifyMove, CLASSIFICATIONS, scoreToCp, DEFAULT_THRESHOLDS } from './moveClassifier.js';
import { detectMoveMotifs, verifyMotifs } from './motifDetector.js';
import { analyzeThreats } from './threatAnalyzer.js';
import { factsForMove } from '../explain/facts.js';
import { ExplanationEngine, EXPLANATION_LEVELS } from '../explain/explanationEngine.js';
import { legalMoves, sanFor, at } from '../core/rules.js';
import { REVIEW_LEVEL } from '../engine/analysisLevels.js';

export class GameReview {
  /**
   * @param {Object} deps
   * @param {import('../engine/engineService.js').EngineService} deps.service
   * @param {Object} [deps.openingBook]
   * @param {number} [deps.explanationLevel]
   */
  constructor({ service, openingBook = null, explanationLevel = EXPLANATION_LEVELS.CONCRETE, thresholds = DEFAULT_THRESHOLDS, search = null } = {}) {
    this.service = service;
    /** Pawn & Passport: explicit grading search limits (config.GRADING.search). */
    this.search = search;
    this.openingBook = openingBook;
    this.explainer = new ExplanationEngine({ level: explanationLevel });
    this.explanationLevel = explanationLevel;
    this.thresholds = thresholds;
    this.cancelled = false;
  }

  cancel() { this.cancelled = true; this.service?.stop(); }

  /**
   * Analyse a finished game in place.
   * @param {import('../core/gameResult.js').GameResult} result
   * @param {(progress:{ply:number, total:number, move:Object}) => void} [onProgress]
   * @returns {Promise<import('../core/gameResult.js').GameResult>}
   */
  async run(result, onProgress = null) {
    const moves = result.moves || [];
    const total = moves.length;

    for (let i = 0; i < total; i += 1) {
      if (this.cancelled) break;
      const move = moves[i];
      await this.annotate(move, { previous: moves[i - 1] || null });
      onProgress?.({ ply: i + 1, total, move });
    }

    // Name the opening from the deepest book position the game passed through.
    if (this.openingBook) {
      let best = null;
      for (const move of moves) {
        const identified = this.openingBook.identify(move.fenAfter);
        if (identified && (!best || identified.depth > best.depth)) best = { ...identified, ply: move.ply };
        if (identified) move.book = { name: identified.name, eco: identified.eco };
      }
      result.opening = best;
    }

    result.summarise();
    result.narrative = this.explainer.explainGame(result, { level: this.explanationLevel });
    result.analysed = true;
    return result;
  }

  /**
   * Analyse ONE move and write the findings onto its record.
   * Also used live, one move at a time, while a game is in progress.
   */
  async annotate(move, { previous = null, level = null } = {}) {
    if (!move?.fenBefore) return move;

    const before = await this.service.review(move.fenBefore, { multiPv: REVIEW_LEVEL.multiPv, ...(this.search || {}) });
    if (!before.lines?.length) return move;

    const bestLine = before.lines[0];
    const bestCp = scoreToCp(bestLine.score);

    // Was the played move already searched? If so its score is free.
    const playedLine = before.lines.find((line) => line.move === move.uci);
    let playedScore;
    if (move.checkmate) {
      // Pawn & Passport: a mated position comes back from the engine as
      // "mate 0" for the side to move, which negates to 0 and was read as the
      // MOVER being mated - so the mating move scored as a huge loss (MISS).
      playedScore = { cp: null, mate: 1 };
    } else if (playedLine) {
      playedScore = playedLine.score;
    } else {
      // Evaluate the resulting position and flip it into the mover's view.
      const after = await this.service.review(move.fenAfter, { ...(this.search || {}), multiPv: 1 });
      playedScore = negate(after.score);
    }

    const verbose = legalMoves(move.fenBefore).find((m) => m.from + m.to + (m.promotion || '') === move.uci);
    if (!verbose) return move;

    const isBook = !!this.openingBook?.isBookPosition(move.fenAfter) &&
                   !!this.openingBook?.isBookPosition(move.fenBefore);

    const verdict = classifyMove({
      fenBefore: move.fenBefore,
      move: verbose,
      bestScore: bestLine.score,
      playedScore,
      bestMoveUci: bestLine.move,
      multipv: before.lines,
      isBook,
      thresholds: this.thresholds
    });

    move.engineEvaluation = {
      cp: playedScore.cp ?? null, mate: playedScore.mate ?? null,
      depth: before.depth, nodes: before.nodes
    };
    move.bestMove = bestLine.move;
    move.bestMoveSan = bestLine.san;
    move.evaluationDelta = verdict.cpLoss;
    move.winProbLoss = verdict.winProbLoss;
    move.classificationBands = verdict.bands;
    move.mistakeClassification = verdict.classification;
    move.complexity = verdict.complexity;
    /* Carried on the record so the RPG can pay for it without re-running the
       detector against a position it would have to reconstruct. Null on every
       ordinary move, which is almost all of them. */
    move.brilliance = verdict.brilliance && verdict.brilliance.brilliant
      ? { score: verdict.brilliance.score, band: verdict.brilliance.band.id,
          label: verdict.brilliance.band.label, reason: verdict.brilliance.reason,
          offered: verdict.brilliance.offered.map((o) => ({ name: o.name, square: o.square })) }
      : null;

    const motifs = detectMoveMotifs(move.fenBefore, verbose, { previousMove: previous ? { to: previous.to, captured: previous.capturedPiece } : null });
    move.tacticalMotifs = verifyMotifs(motifs, { bestScoreCp: bestCp, motifScoreCp: scoreToCp(playedScore) })
      .filter((motif) => motif.significance >= 0.15)
      .map((motif) => ({ type: motif.type, label: motif.label, significance: motif.significance, summary: motif.summary, refuted: motif.refuted }));

    move.threats = analyzeThreats(move.fenAfter, opposite(move.color), { limit: 3 })
      .map((threat) => ({ type: threat.type, severity: threat.severity, summary: threat.summary, san: threat.san || null }));

    // Facts and prose only for moves worth commenting on — the cheap path
    // matters because this runs once per ply.
    const worthExplaining = verdict.classification !== CLASSIFICATIONS.GOOD &&
                            verdict.classification !== CLASSIFICATIONS.EXCELLENT &&
                            verdict.classification !== CLASSIFICATIONS.BOOK;
    if (worthExplaining) {
      const explanation = this.explainer.explainMove({
        fenBefore: move.fenBefore,
        playedUci: move.uci,
        bestUci: bestLine.move,
        enginePlayed: { score: playedScore },
        engineBest: { score: bestLine.score },
        classification: verdict.classification,
        previousMove: previous,
        level: level ?? this.explanationLevel
      });
      move.explanation = { level: explanation.level, text: explanation.text, headline: explanation.headline };
      move.explanationFacts = explanation.facts;
    }

    return move;
  }
}

function negate(score) {
  if (!score) return { cp: null, mate: null };
  return {
    cp: typeof score.cp === 'number' ? -score.cp : null,
    mate: typeof score.mate === 'number' ? -score.mate : null
  };
}

function opposite(colour) { return colour === 'w' ? 'b' : 'w'; }

export default GameReview;
