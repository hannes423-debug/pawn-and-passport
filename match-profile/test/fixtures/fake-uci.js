#!/usr/bin/env node
// A pretend UCI engine for the UciEngine tests. FAKE_MODE: 'ok' answers
// every go with e2e4 / e7e5; 'hang' never answers go; 'die' exits on go;
// 'script' plays FAKE_SCRIPT (comma-separated UCI moves) in order.
import readline from 'node:readline';

const mode = process.env.FAKE_MODE || 'ok';
let moves = [];
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (line === 'uci') console.log('id name FakeFish 1\nuciok');
  else if (line === 'isready') console.log('readyok');
  else if (line.startsWith('position')) moves = (line.split(' moves ')[1] || '').split(' ').filter(Boolean);
  else if (line.startsWith('go')) {
    if (mode === 'hang') return;
    if (mode === 'die') process.exit(1);
    if (mode === 'script') { const script = (process.env.FAKE_SCRIPT || '').split(','); console.log(`bestmove ${script[Math.floor(moves.length / 2)] || '(none)'}`); return; }
    console.log(`bestmove ${moves.length % 2 ? 'e7e5' : 'e2e4'}`);
  } else if (line === 'quit') process.exit(0);
});
