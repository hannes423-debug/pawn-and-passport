/**
 * chessEngine.js — the interface every engine implements.
 *
 * Gameplay code depends on THIS and never on Stockfish. Swapping in a second
 * engine (a human-likeness model, a tablebase prober, a remote analysis
 * service) is a matter of implementing five methods.
 *
 *   engine.analyze(fen, options)              -> AnalysisResult
 *   engine.getBestMove(fen, options)          -> { uci, san, ponder }
 *   engine.getEvaluation(fen, options)        -> { cp, mate, depth }
 *   engine.getPrincipalVariation(fen, opts)   -> { uci: string[], san: string[] }
 *
 * Scores are ALWAYS from the point of view of the side to move in `fen`, which
 * is what UCI reports. Anything that needs White's point of view converts at
 * the edge (see `toWhitePov`).
 */

/**
 * @typedef {Object} EngineScore
 * @property {number|null} cp     centipawns, side-to-move POV
 * @property {number|null} mate   moves to mate, positive = side to move mates
 *
 * @typedef {Object} EngineLine
 * @property {number} multipv
 * @property {EngineScore} score
 * @property {string[]} pv        UCI moves
 * @property {string[]} pvSan     the same line in SAN
 * @property {string} move        first move, UCI
 * @property {string} san
 *
 * @typedef {Object} AnalysisResult
 * @property {string} fen
 * @property {number} depth
 * @property {number} seldepth
 * @property {number} nodes
 * @property {number} nps
 * @property {number} timeMs
 * @property {EngineScore} score  the best line's score
 * @property {string|null} bestMove
 * @property {string|null} bestMoveSan
 * @property {string|null} ponder
 * @property {EngineLine[]} lines sorted by multipv
 * @property {boolean} cancelled
 * @property {boolean} cached
 * @property {string} engine
 */

export class ChessEngine {
  constructor({ name = 'engine' } = {}) {
    this.name = name;
    this.ready = false;
  }

  /** Boot the engine. Idempotent; returns the same promise on re-entry. */
  async init() { throw new Error(`${this.name}: init() not implemented`); }

  /** Full analysis of a position. @returns {Promise<AnalysisResult>} */
  async analyze(/* fen, options */) { throw new Error(`${this.name}: analyze() not implemented`); }

  /** @returns {Promise<{uci:string|null, san:string|null, ponder:string|null}>} */
  async getBestMove(fen, options = {}) {
    const result = await this.analyze(fen, options);
    return { uci: result.bestMove, san: result.bestMoveSan, ponder: result.ponder };
  }

  /** @returns {Promise<EngineScore & {depth:number}>} */
  async getEvaluation(fen, options = {}) {
    const result = await this.analyze(fen, { ...options, multiPv: 1 });
    return { ...result.score, depth: result.depth };
  }

  /** @returns {Promise<{uci:string[], san:string[]}>} */
  async getPrincipalVariation(fen, options = {}) {
    const result = await this.analyze(fen, { ...options, multiPv: 1 });
    const line = result.lines[0];
    return { uci: line?.pv || [], san: line?.pvSan || [] };
  }

  /** Candidate moves, strongest first. */
  async getCandidateMoves(fen, options = {}) {
    const result = await this.analyze(fen, { multiPv: 4, ...options });
    return result.lines;
  }

  /** Abandon the current search. Never throws. */
  stop() {}

  /** Release the worker/process. The engine is unusable afterwards. */
  dispose() { this.ready = false; }
}

/** Convert a side-to-move score into a White-positive score. */
export function toWhitePov(score, turn) {
  if (!score) return { cp: null, mate: null };
  const sign = turn === 'w' ? 1 : -1;
  return {
    cp: typeof score.cp === 'number' ? score.cp * sign : null,
    mate: typeof score.mate === 'number' ? score.mate * sign : null
  };
}

/** '+0.84' / '-1.20' / 'M4' / '-M2' — the eval readout, White-positive. */
export function formatScore(score, turn = 'w', { alwaysSign = true } = {}) {
  const white = toWhitePov(score, turn);
  if (typeof white.mate === 'number' && white.mate !== null) {
    return `${white.mate > 0 ? '' : '-'}M${Math.abs(white.mate)}`;
  }
  if (typeof white.cp !== 'number') return '—';
  const pawns = white.cp / 100;
  const text = Math.abs(pawns).toFixed(2);
  if (!alwaysSign) return text;
  return `${pawns > 0 ? '+' : pawns < 0 ? '−' : '+'}${text}`;
}

/** 'White +0.84' — the wordier form the analysis panel uses. */
export function describeScore(score, turn = 'w') {
  const white = toWhitePov(score, turn);
  if (typeof white.mate === 'number' && white.mate !== null) {
    return white.mate > 0 ? `White mates in ${Math.abs(white.mate)}` : `Black mates in ${Math.abs(white.mate)}`;
  }
  if (typeof white.cp !== 'number') return 'No evaluation';
  if (Math.abs(white.cp) < 20) return 'Equal';
  const side = white.cp > 0 ? 'White' : 'Black';
  return `${side} +${(Math.abs(white.cp) / 100).toFixed(2)}`;
}

/** A no-op engine so every screen works with the engine turned off. */
export class NullEngine extends ChessEngine {
  constructor() { super({ name: 'null' }); this.ready = true; }
  async init() { return this; }
  async analyze(fen) {
    return {
      fen, depth: 0, seldepth: 0, nodes: 0, nps: 0, timeMs: 0,
      score: { cp: null, mate: null }, bestMove: null, bestMoveSan: null,
      ponder: null, lines: [], cancelled: false, cached: false, engine: 'null'
    };
  }
}

export default ChessEngine;
