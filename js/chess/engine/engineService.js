/**
 * engineService.js — the single engine instance the whole app shares.
 *
 * One Stockfish worker is enough and two is wasteful, so everything that needs
 * an engine asks here. The service adds caching and cancellation on top of the
 * raw ChessEngine, and degrades to a NullEngine when the worker cannot start
 * (a file:// load, a blocked worker, an unsupported browser) so no screen ever
 * breaks because analysis is unavailable.
 */

import { StockfishEngine, createWorkerTransport } from './stockfishEngine.js';
import { NullEngine } from './chessEngine.js';
import { PositionCache } from './positionCache.js';
import { levelById, LIVE_LEVEL, REVIEW_LEVEL } from './analysisLevels.js';

export class EngineService {
  constructor({ engine = null, cache = new PositionCache() } = {}) {
    this.engine = engine;
    this.cache = cache;
    this.available = null;      // null = not tried yet
    this.lastError = null;
    this._boot = null;
  }

  /** Boot on first use. Never throws: falls back to NullEngine. */
  async ready() {
    if (this._boot) return this._boot;
    this._boot = (async () => {
      if (!this.engine) {
        try {
          this.engine = new StockfishEngine({ createTransport: () => createWorkerTransport() });
          await this.engine.init();
          this.available = true;
        } catch (error) {
          console.warn('[engine] Stockfish unavailable, falling back to NullEngine:', error);
          this.lastError = error;
          this.engine = new NullEngine();
          this.available = false;
        }
      } else {
        await this.engine.init();
        this.available = !(this.engine instanceof NullEngine);
      }
      return this.engine;
    })();
    return this._boot;
  }

  get engineName() { return this.engine?.identity?.name || this.engine?.name || 'none'; }

  /**
   * Cache-aware analysis.
   * @param {string} fen
   * @param {Object} options  see StockfishEngine#analyze, plus { useCache }
   */
  async analyze(fen, options = {}) {
    const engine = await this.ready();
    const level = options.level || null;
    const multiPv = options.multiPv ?? (level ? levelById(level).multiPv : 1);
    const wantedDepth = options.depth ?? (level ? levelById(level).depth : 0);

    if (options.useCache !== false) {
      const hit = this.cache.get(fen, { multiPv, level, minDepth: wantedDepth });
      if (hit) return hit;
    }
    const result = await engine.analyze(fen, { ...options, multiPv });
    if (options.useCache !== false) this.cache.set(fen, result, { multiPv, level });
    return result;
  }

  async bestMove(fen, options = {}) {
    const result = await this.analyze(fen, options);
    return { uci: result.bestMove, san: result.bestMoveSan, ponder: result.ponder, result };
  }

  async evaluate(fen, options = {}) {
    const result = await this.analyze(fen, { multiPv: 1, ...options });
    return { ...result.score, depth: result.depth, bestMove: result.bestMove, bestMoveSan: result.bestMoveSan };
  }

  async candidates(fen, options = {}) {
    const result = await this.analyze(fen, { multiPv: 4, ...options });
    return result.lines;
  }

  /** The cheap background level used while a game is running. */
  async live(fen, options = {}) {
    return this.analyze(fen, {
      depth: LIVE_LEVEL.depth, movetime: LIVE_LEVEL.movetime,
      nodes: LIVE_LEVEL.nodes, multiPv: LIVE_LEVEL.multiPv, ...options
    });
  }

  /** The level a post-game review pass uses. */
  async review(fen, options = {}) {
    return this.analyze(fen, {
      depth: REVIEW_LEVEL.depth, movetime: REVIEW_LEVEL.movetime,
      nodes: REVIEW_LEVEL.nodes, multiPv: REVIEW_LEVEL.multiPv, ...options
    });
  }

  async newGame() { const engine = await this.ready(); await engine.newGame?.(); }
  stop() { this.engine?.stop?.(); }
  dispose() { this.engine?.dispose?.(); this.engine = null; this._boot = null; }
}

/** The instance every screen uses. */
export const engineService = new EngineService();
export default engineService;
