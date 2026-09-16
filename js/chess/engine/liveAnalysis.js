/**
 * liveAnalysis.js — background analysis of the position on the board.
 *
 * Two rules keep the UI responsive:
 *   1. The engine lives in a Web Worker, so a search never blocks a frame.
 *   2. When the position changes, the search in flight is CANCELLED rather
 *      than awaited. An answer about a position that is no longer on the board
 *      is worse than no answer, because it will be rendered next to the wrong
 *      pieces.
 *
 * Subscribers get structured data. The eval readout ("+0.8" / "White +0.8") is
 * one presentation of it, not the interface.
 */

import { engineService } from './engineService.js';
import { threatReport } from '../analysis/threatAnalyzer.js';
import { detectPositionMotifs } from '../analysis/motifDetector.js';
import { LIVE_LEVEL } from './analysisLevels.js';

export class LiveAnalysisService {
  /**
   * @param {Object} [options]
   * @param {EngineService} [options.service]
   * @param {number} [options.debounceMs] how long a position must be stable
   * @param {boolean} [options.includeMotifs] run the deterministic layer too
   */
  constructor({ service = engineService, debounceMs = 180, includeMotifs = true } = {}) {
    this.service = service;
    this.debounceMs = debounceMs;
    this.includeMotifs = includeMotifs;
    this.enabled = false;
    this.current = null;           // last completed AnalysisSnapshot
    this._fen = null;
    this._timer = null;
    this._generation = 0;
    this._listeners = new Set();
    this._inFlight = false;
  }

  /** @returns {() => void} unsubscribe */
  subscribe(fn) { this._listeners.add(fn); if (this.current) fn(this.current); return () => this._listeners.delete(fn); }
  _emit(snapshot) { this.current = snapshot; for (const fn of [...this._listeners]) fn(snapshot); }

  enable() {
    if (this.enabled) return this;
    this.enabled = true;
    if (this._fen) this.setPosition(this._fen, { force: true });
    return this;
  }

  disable() {
    this.enabled = false;
    this._generation += 1;                 // invalidate anything in flight
    clearTimeout(this._timer);
    this.service.stop();
    this._emit({ fen: this._fen, status: 'off', score: null, lines: [], threats: null, motifs: [] });
    return this;
  }

  toggle() { return this.enabled ? this.disable() : this.enable(); }

  /**
   * Point the service at a new position. Safe to call on every move; the
   * debounce and generation counter handle the churn.
   */
  setPosition(fen, { force = false, level = null } = {}) {
    if (!force && fen === this._fen) return;
    this._fen = fen;
    this._generation += 1;
    const generation = this._generation;
    clearTimeout(this._timer);
    this.service.stop();                   // cancel the obsolete search NOW

    if (!this.enabled) return;

    // Deterministic layer runs immediately — it is fast and needs no engine,
    // so the player sees threats before the engine has finished thinking.
    const immediate = {
      fen, status: 'thinking',
      score: null, depth: 0, lines: [],
      threats: this.includeMotifs ? threatReport(fen, { limit: 5 }) : null,
      motifs: this.includeMotifs ? detectPositionMotifs(fen).slice(0, 6) : []
    };
    this._emit(immediate);

    this._timer = setTimeout(async () => {
      if (generation !== this._generation) return;
      this._inFlight = true;
      try {
        const result = await this.service.live(fen, level ? { level } : {});
        if (generation !== this._generation) return;   // position moved on
        if (result.cancelled) return;
        this._emit({
          ...immediate,
          status: 'ready',
          score: result.score,
          depth: result.depth,
          nodes: result.nodes,
          bestMove: result.bestMove,
          bestMoveSan: result.bestMoveSan,
          lines: result.lines,
          engine: result.engine,
          cached: result.cached
        });
      } catch (error) {
        if (generation !== this._generation) return;
        this._emit({ ...immediate, status: 'error', error: String(error?.message || error) });
      } finally {
        this._inFlight = false;
      }
    }, this.debounceMs);
  }

  /** Evaluation change caused by the last move, in centipawns (White POV). */
  static evaluationDelta(before, after) {
    if (!before || !after) return null;
    const toCp = (score, turn) => {
      if (!score) return null;
      const sign = turn === 'w' ? 1 : -1;
      if (typeof score.mate === 'number') return sign * (score.mate > 0 ? 3000 : -3000);
      return typeof score.cp === 'number' ? score.cp * sign : null;
    };
    const a = toCp(before.score, before.fen.split(' ')[1]);
    const b = toCp(after.score, after.fen.split(' ')[1]);
    if (a === null || b === null) return null;
    return b - a;
  }

  dispose() { this.disable(); this._listeners.clear(); }
}

export const liveAnalysis = new LiveAnalysisService();
export default liveAnalysis;
