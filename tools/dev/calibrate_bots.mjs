#!/usr/bin/env node
/**
 * tools/dev/calibrate_bots.mjs - what do the campaign's opponents actually play like?
 *
 *   node tools/dev/calibrate_bots.mjs                 every mode, every tier
 *   node tools/dev/calibrate_bots.mjs easy normal     only these modes
 *   node tools/dev/calibrate_bots.mjs --elo 400,700   raw Elos instead of the curve
 *
 * The displayed Elo of an opponent is a LABEL. What a player actually meets is
 * the move js/chess/bots/chessBot.js ends up choosing, after the blunder roll,
 * the engine level, the eval-loss filter and the softmax. This measures that
 * directly, so the curves in js/data/config.js can be set from evidence rather
 * than from what the number says.
 *
 * Method: average centipawn loss (ACPL), the standard strength proxy.
 *   1. A fixed, cached set of positions (positions.json next to this file),
 *      sampled from engine self-play so they look like real games rather than
 *      like puzzles.
 *   2. ONE deep MultiPV search per position scores EVERY legal move once, into
 *      a table. That is 30 searches for the whole run, not one per bot move.
 *   3. Each profile picks a move in each position, several times with different
 *      seeds so the blunder roll is sampled, and its loss is a table lookup.
 *
 * ACPL is noisy per game but stable over hundreds of moves, and it is what the
 * rating sites use. The ANCHORS below turn it back into an Elo. They are
 * APPROXIMATE and depend on the reference depth, so treat the column they
 * produce as a band, not a rating: what it is really good for is checking that
 * the ladder climbs, and that two rungs are as far apart as they look.
 *
 * For scale: a bot playing legal moves at random measures about 250-280 here.
 * That is the floor. Nothing this game ships can be weaker than that without
 * being the random nonsense the brief rules out.
 */

import { EngineService } from '../../js/chess/engine/engineService.js';
import { StockfishEngine } from '../../js/chess/engine/stockfishEngine.js';
import { createNodeStockfishTransport } from '../../tests/nodeTransport.js';
import { ChessBot } from '../../js/chess/bots/chessBot.js';
import { profileForOpponent } from '../../js/core/difficulty.js';
import { DIFFICULTY, difficultyMode } from '../../js/data/config.js';
import { legalMoves, applyUci } from '../../js/chess/core/rules.js';
import { START_FEN } from '../../js/chess/core/constants.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'positions.json');
const REF_DEPTH = 12;
const REF_MULTIPV = 24;
const SAMPLES = 8;                 // move choices per position per profile
const ANCHORS = [[280, 350], [190, 600], [150, 800], [115, 1000], [90, 1200], [70, 1400], [55, 1600]];

const seeded = (s0) => { let s = s0 % 2147483647 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

/** ACPL -> a rough Elo, by interpolating the anchors above. */
function eloForAcpl(acpl) {
  if (acpl >= ANCHORS[0][0]) return ANCHORS[0][1];
  if (acpl <= ANCHORS.at(-1)[0]) return ANCHORS.at(-1)[1];
  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    const [a1, e1] = ANCHORS[i];
    const [a2, e2] = ANCHORS[i + 1];
    if (acpl <= a1 && acpl >= a2) return Math.round(e1 + ((a1 - acpl) / (a1 - a2)) * (e2 - e1));
  }
  return ANCHORS.at(-1)[1];
}

async function boot() {
  const engine = new StockfishEngine({ createTransport: createNodeStockfishTransport, bootMs: 60000, hashMb: 32 });
  await engine.init();
  return new EngineService({ engine });
}

/** Positions that look like real games: engine self-play, sampled every few plies. */
async function makePositions(service) {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));
  const out = [];
  for (let game = 0; game < 5; game += 1) {
    const random = seeded(1000 + game * 77);
    let fen = START_FEN;
    for (let ply = 0; ply < 44; ply += 1) {
      const legal = legalMoves(fen);
      if (!legal.length) break;
      const result = await service.analyze(fen, { depth: 6, multiPv: 4, useCache: false });
      const lines = result.lines?.length ? result.lines : null;
      const uci = lines ? lines[Math.floor(random() * Math.min(lines.length, ply < 10 ? 4 : 2))].move : null;
      const played = uci ? applyUci(fen, uci) : null;
      if (!played) break;
      fen = played.fen;
      if (ply >= 8 && ply % 6 === 0) out.push(fen);
    }
  }
  writeFileSync(CACHE, JSON.stringify(out, null, 1));
  return out;
}

/** cp for every legal move in a position, from one deep MultiPV search. */
async function scoreTable(service, fen) {
  const legal = legalMoves(fen);
  const result = await service.analyze(fen, { depth: REF_DEPTH, multiPv: Math.min(REF_MULTIPV, legal.length), useCache: false });
  const table = new Map();
  let best = -Infinity;
  for (const line of result.lines || []) {
    const cp = line.score?.mate != null ? (line.score.mate > 0 ? 10000 - line.score.mate * 100 : -10000 - line.score.mate * 100) : (line.score?.cp ?? 0);
    table.set(line.move, cp);
    best = Math.max(best, cp);
  }
  return { table, best, covered: table.size, legal: legal.length };
}

async function main() {
  const args = process.argv.slice(2);
  const eloArg = args.includes('--elo') ? args[args.indexOf('--elo') + 1].split(',').map(Number) : null;
  const modes = args.filter((a) => !a.startsWith('--') && DIFFICULTY.modes.some((m) => m.id === a));

  const service = await boot();
  process.stderr.write('engine up; building positions...\n');
  const positions = await makePositions(service);
  process.stderr.write(`${positions.length} positions; scoring every legal move at depth ${REF_DEPTH}...\n`);
  const tables = [];
  for (const [i, fen] of positions.entries()) {
    tables.push({ fen, ...(await scoreTable(service, fen)) });
    if (i % 5 === 4) process.stderr.write(`  ${i + 1}/${positions.length}\n`);
  }

  /** ACPL for one opponent spec. */
  async function measure(spec) {
    const losses = [];
    let blunders = 0;
    for (const [i, entry] of tables.entries()) {
      for (let s = 0; s < SAMPLES; s += 1) {
        const profile = profileForOpponent(spec);
        const bot = new ChessBot(profile, { service, random: seeded(7919 * (i + 1) + s * 131 + spec.elo) });
        const choice = await bot.chooseMove(entry.fen, {});
        if (!choice.uci) continue;
        const cp = entry.table.has(choice.uci) ? entry.table.get(choice.uci) : entry.best - 400;
        const loss = Math.max(0, Math.min(1000, entry.best - cp));
        losses.push(loss);
        if (loss >= 300) blunders += 1;
      }
    }
    const acpl = losses.reduce((a, b) => a + b, 0) / Math.max(1, losses.length);
    return { acpl, moves: losses.length, blunderRate: blunders / Math.max(1, losses.length) };
  }

  const rows = [];
  if (eloArg) {
    for (const elo of eloArg) rows.push({ label: `elo ${elo}`, elo, ...(await measure({ name: 'probe', elo })) });
  } else {
    for (const mode of DIFFICULTY.modes) {
      if (modes.length && !modes.includes(mode.id)) continue;
      const m = difficultyMode(mode.id);
      for (let t = 0; t < m.starByTier.length; t += 1) {
        const [lo, hi] = m.regularBands[t];
        const mid = Math.round((lo + hi) / 2);
        rows.push({ label: `${mode.id} club ${t + 1} regular`, elo: mid, ...(await measure({ name: 'regular', elo: mid })) });
        rows.push({ label: `${mode.id} club ${t + 1} STAR`, elo: m.starByTier[t], ...(await measure({ name: 'star', elo: m.starByTier[t] })) });
      }
      for (const [i, elo] of m.finaleRounds.entries()) {
        rows.push({ label: `${mode.id} finale ${i + 1}`, elo, ...(await measure({ name: 'finale', elo })) });
      }
    }
  }

  console.log('\nopponent                        label  ACPL  blunders  ~plays like');
  for (const r of rows) {
    console.log(`${r.label.padEnd(30)} ${String(r.elo).padStart(5)} ${r.acpl.toFixed(0).padStart(5)} ${(r.blunderRate * 100).toFixed(0).padStart(8)}% ${String(eloForAcpl(r.acpl)).padStart(12)}`);
  }
  console.log(`\n${rows[0]?.moves || 0} sampled moves per opponent, depth-${REF_DEPTH} reference.`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
