import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Chess } from 'chess.js';
import { UciEngine } from '../src/engine/uci.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-uci.js');

/* A small executable that runs the fake engine in a given mode. */
function fakeEngine(mode) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cmp-uci-'));
  const file = path.join(dir, 'engine');
  writeFileSync(file, `#!/bin/sh\nFAKE_MODE=${mode} exec "${process.execPath}" "${FAKE}"\n`);
  chmodSync(file, 0o755);
  return file;
}

test('UciEngine: handshake, a move, and the engine name', async () => {
  const engine = new UciEngine({ path: fakeEngine('ok') });
  assert.deepEqual(await engine.bestMove({ moves: [], skill: 3, nodes: 100 }), { uci: 'e2e4' });
  assert.deepEqual(await engine.bestMove({ moves: ['e2e4'], skill: 3, nodes: 100 }), { uci: 'e7e5' });
  assert.equal(engine.name, 'FakeFish 1');
  engine.close();
});

test('UciEngine: requests queue, so concurrent games share one process', async () => {
  const engine = new UciEngine({ path: fakeEngine('ok') });
  const answers = await Promise.all([0, 1, 2, 3].map((n) => engine.bestMove({ moves: n % 2 ? ['e2e4'] : [], nodes: 10 })));
  assert.deepEqual(answers.map((a) => a.uci), ['e2e4', 'e7e5', 'e2e4', 'e7e5']);
  engine.close();
});

test('UciEngine: a hung search times out and the next request starts a fresh process', async () => {
  const engine = new UciEngine({ path: fakeEngine('hang'), timeoutMs: 1500 });
  await assert.rejects(engine.bestMove({ moves: [] }), /no bestmove/);
  engine.path = fakeEngine('ok');
  assert.deepEqual(await engine.bestMove({ moves: [] }), { uci: 'e2e4' });
  engine.close();
});

test('UciEngine: a crashed process fails the request, then recovers', async () => {
  const engine = new UciEngine({ path: fakeEngine('die'), timeoutMs: 2000 });
  await assert.rejects(engine.bestMove({ moves: [] }), /exited/);
  engine.path = fakeEngine('ok');
  assert.deepEqual(await engine.bestMove({ moves: [] }), { uci: 'e2e4' });
  engine.close();
});

test('real Stockfish (only when STOCKFISH_PATH is set): every level answers with a legal move', { skip: !process.env.STOCKFISH_PATH }, async () => {
  const engine = new UciEngine({ path: process.env.STOCKFISH_PATH });
  const moves = ['e2e4', 'c7c5', 'g1f3'];
  for (const skill of [0, 10, 20]) {
    const { uci } = await engine.bestMove({ moves, skill, nodes: 5000 });
    const chess = new Chess();
    for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4) });
    assert.ok(chess.moves({ verbose: true }).some((m) => m.from + m.to + (m.promotion || '') === uci), `${skill}: ${uci}`);
  }
  assert.match(engine.name, /Stockfish/);
  engine.close();
});
