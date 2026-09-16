/**
 * stockfishEngine.js — Stockfish behind the ChessEngine interface.
 *
 * GPLv3 COMPONENT. Stockfish is free software under the GNU General Public
 * License v3. This project ships the WASM build produced by stockfish.js and
 * keeps the full licence text and corresponding-source pointers in
 * docs/THIRD_PARTY_NOTICES.txt and vendor/stockfish/. The engine is loaded in
 * a separate Web Worker and reached only through this adapter — that boundary
 * is deliberate and documented in docs/LICENSE_TRACKER.md, and it must not be
 * blurred by importing Stockfish anywhere else.
 *
 * The transport is injectable so the same UCI driver runs in a browser Worker
 * and in the Node test suite without a second implementation.
 */

import { ChessEngine } from './chessEngine.js';
import { sanFor, pvToSan } from '../core/rules.js';
import { levelById } from './analysisLevels.js';

/** Default location of the vendored engine, relative to this module. */
export const DEFAULT_ENGINE_URL = new URL('../../../vendor/stockfish/stockfish-18-lite-single.js', import.meta.url).href;

/**
 * A transport is anything that can carry UCI text both ways.
 * @typedef {Object} EngineTransport
 * @property {(command:string)=>void} post
 * @property {(handler:(line:string)=>void)=>void} onMessage
 * @property {()=>void} terminate
 */

/** Browser transport: one Web Worker per engine instance. */
export function createWorkerTransport(url = DEFAULT_ENGINE_URL) {
  const worker = new Worker(url);
  return {
    post: (command) => worker.postMessage(command),
    onMessage: (handler) => {
      worker.onmessage = (event) => {
        const data = typeof event.data === 'string' ? event.data : event.data?.data;
        if (typeof data === 'string') handler(data);
      };
      worker.onerror = (event) => handler(`info string worker-error ${event.message || event}`);
    },
    terminate: () => worker.terminate()
  };
}

export class StockfishEngine extends ChessEngine {
  /**
   * @param {Object} [options]
   * @param {()=>EngineTransport} [options.createTransport]
   * @param {number} [options.hashMb]
   * @param {number} [options.threads]
   */
  constructor({ createTransport = () => createWorkerTransport(), hashMb = 32, threads = 1 } = {}) {
    super({ name: 'stockfish' });
    this._createTransport = createTransport;
    this._transport = null;
    this._hashMb = hashMb;
    this._threads = threads;
    this._initPromise = null;
    this._queue = Promise.resolve();
    /** The search currently in flight, so a newer request can cancel it. */
    this._active = null;
    this._identity = { name: 'Stockfish', author: '' };
    this._options = new Map();
    this._lastLevelId = null;
  }

  get identity() { return { ...this._identity }; }

  /* --------------------------------------------------------------- boot */

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      this._transport = this._createTransport();
      this._transport.onMessage((line) => this._onLine(line));
      await this._await('uci', (line) => line.trim() === 'uciok', 30000);
      this._setOption('Hash', this._hashMb);
      if (this._threads > 1) this._setOption('Threads', this._threads);
      this._setOption('MultiPV', 1);
      await this._isReady();
      this.ready = true;
      return this;
    })();
    return this._initPromise;
  }

  async _isReady() {
    return this._await('isready', (line) => line.trim() === 'readyok', 30000);
  }

  _setOption(name, value) {
    if (this._options.get(name) === value) return;
    this._options.set(name, value);
    this._send(`setoption name ${name} value ${value}`);
  }

  _send(command) {
    if (!this._transport) throw new Error('StockfishEngine: not initialised');
    this._transport.post(command);
  }

  /* ---------------------------------------------------------- messaging */

  _onLine(line) {
    if (line.startsWith('id name ')) this._identity.name = line.slice(8).trim();
    if (line.startsWith('id author ')) this._identity.author = line.slice(10).trim();
    if (this._collector) this._collector(line);
    if (this._active) this._active.consume(line);
  }

  /** Send `command` and resolve when `predicate` sees its terminating line. */
  _await(command, predicate, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const lines = [];
      const timer = setTimeout(() => {
        this._collector = null;
        reject(new Error(`StockfishEngine: timed out waiting for "${command}"`));
      }, timeoutMs);
      this._collector = (line) => {
        lines.push(line);
        if (!predicate(line)) return;
        clearTimeout(timer);
        this._collector = null;
        resolve(lines);
      };
      this._send(command);
    });
  }

  /* ------------------------------------------------------------ analysis */

  /**
   * @param {string} fen
   * @param {Object} [options]
   * @param {string} [options.level]     analysis level id
   * @param {number} [options.depth]
   * @param {number} [options.movetime]
   * @param {number} [options.nodes]
   * @param {number} [options.multiPv]
   * @param {boolean} [options.limitStrength] apply Skill Level / UCI_Elo
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<import('./chessEngine.js').AnalysisResult>}
   */
  async analyze(fen, options = {}) {
    await this.init();
    // UCI is one conversation at a time, so searches are serialised.
    // Pawn & Passport: a newer request only cancels the one in flight when it
    // asks to (`preempt: true`). World Tour always cancelled, and in a match
    // the bot's reply search cut the grading search of the player's move short
    // every time the bot had to think, so moves were graded from a depth-1
    // search and nearly everything came out Best or Excellent.
    if (options.preempt) this.stop();
    const run = this._queue.then(() => this._runSearch(fen, options));
    this._queue = run.catch(() => {});
    return run;
  }

  async _runSearch(fen, options) {
    const level = options.level ? levelById(options.level) : null;
    const depth = options.depth ?? level?.depth ?? 14;
    const movetime = options.movetime ?? level?.movetime ?? null;
    const nodes = options.nodes ?? level?.nodes ?? null;
    const multiPv = Math.max(1, options.multiPv ?? level?.multiPv ?? 1);
    const limitStrength = options.limitStrength ?? false;

    if (options.signal?.aborted) return cancelledResult(fen, this.name);

    this._setOption('MultiPV', multiPv);
    if (limitStrength && level && level.uciElo) {
      this._setOption('UCI_LimitStrength', 'true');
      this._setOption('UCI_Elo', level.uciElo);
      if (level.skillLevel !== null) this._setOption('Skill Level', level.skillLevel);
    } else if (this._options.get('UCI_LimitStrength') === 'true') {
      this._setOption('UCI_LimitStrength', 'false');
      this._setOption('Skill Level', 20);
    }

    const goParts = ['go'];
    if (depth) goParts.push('depth', depth);
    if (movetime) goParts.push('movetime', movetime);
    if (nodes) goParts.push('nodes', nodes);

    const started = Date.now();
    const state = {
      fen, multiPv,
      lines: new Map(),
      depth: 0, seldepth: 0, nodes: 0, nps: 0,
      bestMove: null, ponder: null, cancelled: false
    };

    const result = await new Promise((resolve) => {
      const finish = () => {
        this._active = null;
        resolve(buildResult(state, { timeMs: Date.now() - started, engine: this.name }));
      };
      const timer = setTimeout(() => { this._send('stop'); }, Math.max(20000, (movetime || 0) + 15000));

      this._active = {
        cancel: () => { state.cancelled = true; this._send('stop'); },
        consume: (line) => {
          if (line.startsWith('info ')) { parseInfo(line, state); return; }
          if (line.startsWith('bestmove')) {
            clearTimeout(timer);
            const parts = line.split(/\s+/);
            state.bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
            state.ponder = parts[3] || null;
            finish();
          }
        }
      };

      if (options.signal) {
        options.signal.addEventListener('abort', () => this.stop(), { once: true });
      }

      this._send(`position fen ${fen}`);
      this._send(goParts.join(' '));
    });

    return result;
  }

  stop() {
    if (this._active) { try { this._active.cancel(); } catch { /* engine already gone */ } }
  }

  /** Tell the engine a fresh game is starting so it clears its hash. */
  async newGame() {
    await this.init();
    this._send('ucinewgame');
    await this._isReady();
  }

  dispose() {
    try { this._send('quit'); } catch { /* already down */ }
    try { this._transport?.terminate(); } catch { /* already down */ }
    this._transport = null;
    this._initPromise = null;
    this.ready = false;
  }
}

/* ----------------------------------------------------------- UCI parsing */

/** Parse one `info` line into the accumulating search state. */
export function parseInfo(line, state) {
  const tokens = line.split(/\s+/);
  let multipv = 1;
  let score = null;
  let pv = null;
  let depth = state.depth;
  let seldepth = state.seldepth;

  for (let i = 1; i < tokens.length; i += 1) {
    switch (tokens[i]) {
      case 'depth': depth = Number(tokens[++i]); break;
      case 'seldepth': seldepth = Number(tokens[++i]); break;
      case 'multipv': multipv = Number(tokens[++i]); break;
      case 'nodes': state.nodes = Number(tokens[++i]); break;
      case 'nps': state.nps = Number(tokens[++i]); break;
      case 'score': {
        const kind = tokens[++i];
        const value = Number(tokens[++i]);
        score = kind === 'mate' ? { cp: null, mate: value } : { cp: value, mate: null };
        break;
      }
      case 'pv': pv = tokens.slice(i + 1); i = tokens.length; break;
      default: break;
    }
  }

  if (!pv || !score) return state;
  state.depth = Math.max(state.depth, depth);
  state.seldepth = Math.max(state.seldepth, seldepth);
  state.lines.set(multipv, { multipv, score, pv, depth });
  return state;
}

function buildResult(state, { timeMs, engine }) {
  const lines = [...state.lines.values()]
    .sort((a, b) => a.multipv - b.multipv)
    .map((line) => ({
      multipv: line.multipv,
      score: line.score,
      depth: line.depth,
      pv: line.pv,
      pvSan: pvToSan(state.fen, line.pv),
      move: line.pv[0] || null,
      san: line.pv[0] ? sanFor(state.fen, line.pv[0]) : null
    }));

  const primary = lines.find((line) => line.multipv === 1) || lines[0] || null;
  const bestMove = state.bestMove || primary?.move || null;

  return {
    fen: state.fen,
    depth: state.depth,
    seldepth: state.seldepth,
    nodes: state.nodes,
    nps: state.nps,
    timeMs,
    score: primary ? primary.score : { cp: null, mate: null },
    bestMove,
    bestMoveSan: bestMove ? sanFor(state.fen, bestMove) : null,
    ponder: state.ponder,
    lines,
    cancelled: state.cancelled,
    cached: false,
    engine
  };
}

function cancelledResult(fen, engine) {
  return {
    fen, depth: 0, seldepth: 0, nodes: 0, nps: 0, timeMs: 0,
    score: { cp: null, mate: null }, bestMove: null, bestMoveSan: null,
    ponder: null, lines: [], cancelled: true, cached: false, engine
  };
}

export default StockfishEngine;
