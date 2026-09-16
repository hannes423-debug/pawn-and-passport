/**
 * engineService.js — the single engine instance the whole app shares.
 *
 * One Stockfish worker is enough and two is wasteful, so everything that needs
 * an engine asks here. The service adds caching and cancellation on top of the
 * raw ChessEngine, and degrades to a NullEngine when the worker cannot start
 * (a file:// load, a blocked worker, an unsupported browser) so no screen ever
 * breaks because analysis is unavailable.
 */

import { StockfishEngine, createWorkerTransport, ENGINE_BUILDS } from './stockfishEngine.js';
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
    this._injected = !!engine;
    /** 'idle' | 'loading' | 'ready' | 'unavailable', for the UI. */
    this.status = 'idle';
    this.statusText = 'Chess engine not started.';
    this.build = null;
    this._statusListeners = new Set();
  }

  onStatus(fn) { this._statusListeners.add(fn); return () => this._statusListeners.delete(fn); }

  _setStatus(status, text) {
    this.status = status;
    this.statusText = text;
    for (const fn of [...this._statusListeners]) { try { fn(status, text); } catch { /* UI listener */ } }
  }

  /**
   * Boot on first use. Never throws. Tries each build in ENGINE_BUILDS and only
   * then falls back to NullEngine. Pawn & Passport: the World Tour version
   * tried one build and kept NullEngine for the whole session, so a phone that
   * could not start the WASM build silently lost grades and hints for good.
   */
  async ready() {
    if (this._boot) return this._boot;
    this._boot = (async () => {
      if (!this._injected) {
        const errors = [];
        const hasWasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
        // ?engine=asm forces the compatibility build (for testing it on a device).
        const forced = typeof location === 'object' ? new URLSearchParams(location.search).get('engine') : null;
        for (const build of ENGINE_BUILDS) {
          if (forced && build.id !== forced) continue;
          if (build.needsWasm && !hasWasm) { errors.push(`${build.id}: no WebAssembly`); continue; }
          this._setStatus('loading', `Loading ${build.label}...`);
          const engine = new StockfishEngine({ createTransport: () => createWorkerTransport(build.url), bootMs: build.bootMs, hashMb: 16 });
          try {
            await engine.init();
            this.engine = engine;
            this.build = build;
            this.available = true;
            this.lastError = null;
            this._setStatus('ready', `${build.label} ready.`);
            return this.engine;
          } catch (error) {
            console.warn(`[engine] ${build.id} build failed:`, error);
            errors.push(`${build.id}: ${error.message || error}`);
            try { engine.dispose(); } catch { /* never started */ }
          }
        }
        this.lastError = new Error(errors.join('; '));
        this.engine = new NullEngine();
        this.available = false;
        this._setStatus('unavailable', `No chess engine could start (${errors.join('; ')}). Grades and hints are off.`);
      } else {
        await this.engine.init();
        this.available = !(this.engine instanceof NullEngine);
      }
      return this.engine;
    })();
    return this._boot;
  }

  /** Try again after a failed boot or a dead worker (called when a match starts). */
  async retryIfUnavailable() {
    if (this._injected) return this.ready();
    if (this._boot && this.available === false) this._boot = null;
    if (this.engine?.dead) this._replaceDead();
    return this.ready();
  }

  _replaceDead() {
    console.warn('[engine] worker died:', this.engine?.deathReason);
    try { this.engine.dispose(); } catch { /* already gone */ }
    this.engine = null;
    this.available = null;
    this._boot = null;
    this._setStatus('loading', 'The chess engine stopped; restarting it...');
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
    let result = await engine.analyze(fen, { ...options, multiPv });
    if (engine.dead && !this._injected) {
      // The worker died under this search: restart once and ask again.
      if (this.engine === engine) this._replaceDead();
      const fresh = await this.ready();
      result = await fresh.analyze(fen, { ...options, multiPv });
    }
    if (options.useCache !== false && !result.cancelled && result.lines?.length) this.cache.set(fen, result, { multiPv, level });
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
