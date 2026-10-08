/**
 * helpers/engines.js - stand-in play engines for tests (no Stockfish needed).
 *
 *   scriptedEngine(['f2f3', 'g2g4'])  plays these, then the first legal move in UCI order
 *   brokenEngine()                    every request fails, like a crashed process
 */

import { Chess } from 'chess.js';

export function scriptedEngine(script = []) {
  const calls = [];
  return {
    calls,
    async bestMove(request) {
      calls.push(request);
      if (script.length) return { uci: script.shift() };
      const chess = new Chess();
      for (const u of request.moves) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      return { uci: chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')).sort()[0] };
    }
  };
}

export const brokenEngine = () => ({ async bestMove() { throw new Error('engine: the process exited'); } });
