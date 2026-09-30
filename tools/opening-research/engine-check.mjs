#!/usr/bin/env node
/**
 * engine-check.mjs - is every move in js/data/openings.js SOUND, not just popular?
 *
 *   node tools/opening-research/engine-check.mjs [--depth=16] [--json=out.json]
 *
 * check-lines.mjs proves that 2200+ players choose each book move (theory as
 * it is actually played). This proves that Stockfish agrees it is a good move:
 * every position the 85 lines pass through is searched once (MultiPV 5, shared
 * across lines by position), and each book move is scored by what it costs the
 * side that plays it, in the same win-probability points (0..100) the game
 * grades moves with (js/chess/analysis/moveClassifier.js). A move outside the
 * top 5 is scored by searching the position after it.
 *
 * Flags: `inaccuracy` over 5 points (a move the game itself would grade
 * Good at best), `mistake` over 10. Both sides' moves are checked: the club
 * opponents play these lines too.
 */
import { StockfishEngine } from '../../js/chess/engine/stockfishEngine.js';
import { createNodeStockfishTransport } from '../../tests/nodeTransport.js';
import { createRules } from '../../js/chess/core/rules.js';
import { winProbability, scoreToCp } from '../../js/chess/analysis/moveClassifier.js';
import { OPENINGS } from '../../js/data/openings.js';
import { writeFileSync } from 'node:fs';

const arg = (name, dflt) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : dflt; };
const DEPTH = Number(arg('depth', 16));
const MULTIPV = 5;
const WARN = 5;
const BAD = 10;

const engine = new StockfishEngine({ createTransport: createNodeStockfishTransport, bootMs: 60000, hashMb: 64 });
await engine.init();

const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
const searched = new Map();          // position -> { lines, depth }
const after = new Map();             // position after an off-list move -> score (mover's view)
async function search(fen) {
  const k = key(fen);
  if (!searched.has(k)) {
    const r = await engine.analyze(fen, { depth: DEPTH, multiPv: MULTIPV });
    searched.set(k, { lines: r.lines, depth: r.depth });
    if (searched.size % 25 === 0) process.stderr.write(`  ${searched.size} positions\n`);
  }
  return searched.get(k);
}
async function scoreAfter(fenAfter) {
  const k = key(fenAfter);
  if (!after.has(k)) {
    const r = await engine.analyze(fenAfter, { depth: DEPTH - 1, multiPv: 1 });
    const s = r.lines[0]?.score || r.score;
    after.set(k, s ? { cp: typeof s.cp === 'number' ? -s.cp : null, mate: typeof s.mate === 'number' ? -s.mate : null } : null);
  }
  return after.get(k);
}

const moves = [];
for (const o of OPENINGS) {
  for (const [li, line] of o.lines.entries()) {
    const rules = createRules();
    for (const [ply, san] of line.entries()) {
      const fen = rules.fen();
      const mover = fen.split(' ')[1];
      const played = rules.move(san);
      const uci = played.from + played.to + (played.promotion || '');
      moves.push({ opening: o.id, side: o.side, line: li, lineName: o.lineNames?.[li] || `line ${li}`, ply, san, uci, fen, fenAfter: rules.fen(), mover });
    }
  }
}
const unique = new Map();
for (const m of moves) { const k = `${key(m.fen)}|${m.uci}`; if (!unique.has(k)) unique.set(k, m); }
process.stderr.write(`${moves.length} book moves in ${OPENINGS.length} openings, ${unique.size} distinct (position, move) pairs; depth ${DEPTH}\n`);

const verdicts = new Map();
for (const [k, m] of unique) {
  const { lines, depth } = await search(m.fen);
  const best = lines[0];
  const mine = lines.find((l) => l.move === m.uci);
  const bestCp = scoreToCp(best.score);
  const playedScore = mine ? mine.score : await scoreAfter(m.fenAfter);
  const playedCp = scoreToCp(playedScore);
  const loss = Math.max(0, winProbability(bestCp) - winProbability(playedCp));
  verdicts.set(k, { loss, cpLoss: Math.max(0, bestCp - playedCp), bestSan: best.san, bestCp, playedCp, rank: mine ? mine.multipv : null, depth });
}

const rows = moves.map((m) => ({ ...m, ...verdicts.get(`${key(m.fen)}|${m.uci}`) }));
const flagged = [...unique.keys()].map((k) => ({ k, v: verdicts.get(k), m: unique.get(k) }))
  .filter(({ v }) => v.loss > WARN).sort((a, b) => b.v.loss - a.v.loss);
const moveNo = (ply) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'}`;
console.log(`\nbook moves costing more than ${WARN} win-probability points (depth ${DEPTH}):`);
for (const { v, m } of flagged) {
  const inLines = rows.filter((r) => `${key(r.fen)}|${r.uci}` === `${key(m.fen)}|${m.uci}`).map((r) => `${r.opening}:${r.line}`);
  const whose = m.mover === m.side ? 'the opening side' : 'the other side';
  console.log(`  ${v.loss > BAD ? 'MISTAKE   ' : 'inaccuracy'} ${m.opening} ${moveNo(m.ply)}${m.san} (${whose}) loses ${v.loss.toFixed(1)} pts / ${v.cpLoss} cp; Stockfish prefers ${v.bestSan} (${v.bestCp} vs ${v.playedCp}). Lines: ${inLines.join(', ')}`);
}
const losses = [...verdicts.values()].map((v) => v.loss);
const top1 = [...verdicts.values()].filter((v) => v.rank === 1).length;
console.log(`\n${unique.size} distinct book moves: ${flagged.filter((f) => f.v.loss > BAD).length} over ${BAD} pts, ${flagged.filter((f) => f.v.loss <= BAD).length} between ${WARN} and ${BAD}; engine's first choice ${top1} (${Math.round(100 * top1 / unique.size)}%); mean loss ${(losses.reduce((a, b) => a + b, 0) / losses.length).toFixed(2)} pts`);
const json = arg('json', null);
if (json) writeFileSync(json, JSON.stringify({ depth: DEPTH, rows }, null, 1));
process.exit(0);
