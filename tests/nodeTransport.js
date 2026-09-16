/**
 * nodeTransport.js — TEST-ONLY transport that runs the vendored Stockfish
 * build inside Node instead of a browser Worker.
 *
 * The browser never loads this file. It exists so tests/engine.test.js can
 * exercise the exact same UCI driver (StockfishEngine) that ships to players,
 * rather than a second mock implementation that could drift.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_JS = path.resolve(here, '../vendor/stockfish/stockfish-18-lite-single.js');
const ENGINE_WASM = path.resolve(here, '../vendor/stockfish/stockfish-18-lite-single.wasm');

export function createNodeStockfishTransport() {
  const factory = require(ENGINE_JS);
  const pending = [];
  let handler = null;
  let engine = null;

  const module = {
    locateFile: (file) => (file.includes('.wasm') ? ENGINE_WASM : ENGINE_JS),
    listener: (line) => { if (handler) handler(line); }
  };

  const ready = factory()(module).then(async function wait() {
    if (module._isReady && !module._isReady()) {
      await new Promise((r) => setTimeout(r, 10));
      return wait();
    }
    engine = module;
    for (const command of pending.splice(0)) send(command);
  });

  function send(command) {
    module.ccall('command', null, ['string'], [command], { async: /^go\b/.test(command) });
  }

  return {
    post(command) {
      if (!engine) { pending.push(command); ready.catch(() => {}); return; }
      send(command);
    },
    onMessage(fn) { handler = fn; },
    terminate() { handler = null; }
  };
}

export default createNodeStockfishTransport;
