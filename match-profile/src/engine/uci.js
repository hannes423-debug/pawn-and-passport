/**
 * uci.js - a Stockfish process driven over UCI.
 *
 *   const engine = new UciEngine({ path: config.stockfishPath })
 *   const { uci } = await engine.bestMove({ moves: ['e2e4'], skill: 4, nodes: 10000 })
 *   engine.close()
 *
 * Every request is stateless (ucinewgame, position ... moves ..., go), so
 * concurrent games can share one process: requests queue and run one at a
 * time. A crash or a timeout kills the process; the next request starts a
 * fresh one. Play and analysis each get their own UciEngine, so analysis
 * never slows the bot down.
 */

import { spawn } from 'node:child_process';
import readline from 'node:readline';

export class UciEngine {
  constructor({ path, threads = 1, hashMb = 16, timeoutMs = 30000, args = [] }) {
    if (!path) throw new Error('UciEngine: no engine path (set STOCKFISH_PATH)');
    Object.assign(this, { path, threads, hashMb, timeoutMs, args });
    this.proc = null;
    this.ready = null;
    this.waiter = null;
    this.queue = Promise.resolve();
    this.name = null;
  }

  _send(line) { this.proc.stdin.write(`${line}\n`); }

  _onLine(line) {
    if (line.startsWith('id name ')) this.name = line.slice(8).trim();
    const w = this.waiter;
    if (w && w.test(line)) { this.waiter = null; clearTimeout(w.timer); w.resolve(line); }
  }

  _waitFor(test, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiter = null; this._kill(); reject(new Error(`engine: no ${label} within ${this.timeoutMs} ms`)); }, this.timeoutMs);
      this.waiter = { test, resolve, reject, timer };
    });
  }

  _kill() {
    if (this.proc) { try { this.proc.kill('SIGKILL'); } catch { /* already gone */ } }
    this.proc = null;
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const proc = spawn(this.path, this.args, { stdio: ['pipe', 'pipe', 'ignore'] });
      this.proc = proc;
      proc.on('error', () => {});
      proc.on('exit', () => {
        // A process we already replaced (after a timeout) must not fail its successor's request.
        if (this.proc !== proc) return;
        this.proc = null;
        this.ready = null;
        const w = this.waiter;
        if (w) { this.waiter = null; clearTimeout(w.timer); w.reject(new Error('engine: the process exited')); }
      });
      proc.stdin.on('error', () => {});
      readline.createInterface({ input: proc.stdout }).on('line', (line) => this._onLine(line));
      this._send('uci');
      await this._waitFor((l) => l === 'uciok', 'uciok');
      this._send(`setoption name Threads value ${this.threads}`);
      this._send(`setoption name Hash value ${this.hashMb}`);
      this._send('isready');
      await this._waitFor((l) => l === 'readyok', 'readyok');
    })();
    this.ready.catch(() => this._kill());
    return this.ready;
  }

  /** The engine's move for a position; queued behind any search already running. */
  bestMove(request) {
    const run = this.queue.then(() => this._search(request));
    this.queue = run.catch(() => {});
    return run;
  }

  async _search({ fen = null, moves = [], skill = 20, nodes = null, movetime = null }) {
    await this.start();
    this._send('ucinewgame');
    this._send(`setoption name Skill Level value ${skill}`);
    this._send('isready');
    await this._waitFor((l) => l === 'readyok', 'readyok');
    this._send(`position ${fen ? `fen ${fen}` : 'startpos'}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
    this._send(`go${nodes ? ` nodes ${nodes}` : ''}${movetime ? ` movetime ${movetime}` : ''}${!nodes && !movetime ? ' depth 10' : ''}`);
    const line = await this._waitFor((l) => l.startsWith('bestmove '), 'bestmove');
    const uci = line.split(/\s+/)[1];
    if (!uci || uci === '(none)') throw new Error('engine: no move in this position');
    return { uci };
  }

  close() { this._kill(); }
}

export default { UciEngine };
