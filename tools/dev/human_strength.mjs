#!/usr/bin/env node
/**
 * tools/dev/human_strength.mjs - do the opponents play like HUMANS of their label?
 *
 *   node tools/dev/human_strength.mjs --elo=600,800,1000,1250,1500 [--per=160] [--samples=3]
 *        [--cohorts=<dir of elo_<band>_*.pgn>]
 *
 * calibrate_bots.mjs checks that the ladder climbs evenly, but turns ACPL into
 * an Elo with hand-set anchors. This measures the label against real people:
 * positions from real rated Lichess games (the Chess DNA Lab's rating cohorts,
 * 1000 / 1250 / 1500 / 1700 / 2000, the players' ratings in the headers) are
 * scored once by Stockfish (every legal move, depth 12, the same reference the
 * calibration tool uses), then
 *   - the HUMAN's loss is the move they actually played there;
 *   - a BOT's loss is the move it chooses in the very same position.
 * Same positions, same engine, same cap: apples to apples. A bot label B plays
 * like a human rated B when its loss matches the human curve at B.
 *
 * Reported per cohort, "contested" positions only (best |eval| <= 500 cp:
 * in a decided game both humans and bots play loosely, which says little).
 * Loss per move is capped at 1000 cp, as in calibrate_bots.mjs; a move outside
 * the reference's top 24 counts as best - 400. Scores are cached in
 * tools/dev/human-positions.json.
 *
 * Caveats, printed with the result: the cohort games are blitz and rapid
 * (3+0 to 15+10) and the game is untimed, so the humans here are a little
 * weaker than they would be over the board; below 1000 there is no human data
 * and the curve is extrapolated.
 */
import { StockfishEngine } from '../../js/chess/engine/stockfishEngine.js';
import { EngineService } from '../../js/chess/engine/engineService.js';
import { createNodeStockfishTransport } from '../../tests/nodeTransport.js';
import { ChessBot } from '../../js/chess/bots/chessBot.js';
import { profileForOpponent } from '../../js/core/difficulty.js';
import { createRules, legalMoves } from '../../js/chess/core/rules.js';
import { winProbability } from '../../js/chess/analysis/moveClassifier.js';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : dflt; };
const COHORT_DIR = arg('cohorts', path.join(os.homedir(), 'Työpöytä/chess-dna-lab/data/temp/cohorts'));
const PER = Number(arg('per', 160));
const SAMPLES = Number(arg('samples', 3));
const ELOS = arg('elo', '600,800,1000,1250,1500').split(',').map(Number);
const BANDS = [1000, 1250, 1500, 1700, 2000];
const REF_DEPTH = 12;
const REF_MULTIPV = 24;
const CAP = 1000;
const CONTESTED = 500;
const CACHE = path.join(HERE, 'human-positions.json');

const seeded = (s0) => { let s = s0 % 2147483647 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

/** Minimal PGN reader: headers + SAN moves (comments, NAGs, move numbers stripped). */
function readGames(file) {
  const text = readFileSync(file, 'utf8');
  const games = [];
  for (const chunk of text.split(/\n(?=\[Event )/)) {
    const headers = Object.fromEntries([...chunk.matchAll(/^\[(\w+) "([^"]*)"\]/gm)].map((m) => [m[1], m[2]]));
    const body = chunk.replace(/^\[.*\]$/gm, '').replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ')
      .replace(/\$\d+/g, ' ').replace(/\d+\.(\.\.)?/g, ' ').replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, ' ');
    const sans = body.split(/\s+/).filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
    if (headers.Variant && headers.Variant !== 'Standard') continue;
    if (sans.length) games.push({ headers, sans });
  }
  return games;
}

function samplePositions(band, count, rand) {
  const files = readdirSync(COHORT_DIR).filter((f) => f.startsWith(`elo_${band}_`) && f.endsWith('.pgn'));
  const pool = [];
  for (const f of files) {
    for (const game of readGames(path.join(COHORT_DIR, f))) {
      const rules = createRules();
      for (const [ply, san] of game.sans.entries()) {
        const fen = rules.fen();
        const side = fen.split(' ')[1];
        const rating = Number(side === 'w' ? game.headers.WhiteElo : game.headers.BlackElo);
        const played = rules.move(san);
        if (!played) break;
        if (ply < 12 || !rating) continue;
        pool.push({ fen, uci: played.from + played.to + (played.promotion || ''), rating, band, game: game.headers.GameId || game.headers.Site, tc: game.headers.TimeControl });
      }
    }
  }
  // spread over games: shuffle, then keep at most 3 positions per game
  for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const perGame = new Map();
  const out = [];
  for (const p of pool) {
    if (legalMoves(p.fen).length < 3) continue;
    const n = perGame.get(p.game) || 0;
    if (n >= 3) continue;
    perGame.set(p.game, n + 1);
    out.push(p);
    if (out.length >= count) break;
  }
  return out;
}

const cpOf = (score) => (score?.mate != null
  ? (score.mate > 0 ? 10000 - score.mate * 100 : -10000 - score.mate * 100)
  : (score?.cp ?? 0));

async function main() {
  const engine = new StockfishEngine({ createTransport: createNodeStockfishTransport, bootMs: 60000, hashMb: 64 });
  await engine.init();
  const service = new EngineService({ engine });

  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : { positions: [] };
  const have = new Map(cache.positions.map((p) => [`${p.band}|${p.fen}`, p]));
  const rand = seeded(20260930);
  const wanted = [];
  for (const band of BANDS) wanted.push(...samplePositions(band, band >= 1700 ? Math.round(PER * 0.6) : PER, rand));
  let scored = 0;
  for (const p of wanted) {
    const k = `${p.band}|${p.fen}`;
    if (have.has(k)) continue;
    const legal = legalMoves(p.fen);
    const r = await service.analyze(p.fen, { depth: REF_DEPTH, multiPv: Math.min(REF_MULTIPV, legal.length), useCache: false });
    const table = {};
    for (const line of r.lines || []) table[line.move] = cpOf(line.score);
    have.set(k, { ...p, table, best: Math.max(...Object.values(table)) });
    scored += 1;
    if (scored % 20 === 0) {
      process.stderr.write(`  scored ${scored} new positions\n`);
      writeFileSync(CACHE, JSON.stringify({ positions: [...have.values()] }));
    }
  }
  writeFileSync(CACHE, JSON.stringify({ positions: [...have.values()] }));
  const positions = wanted.map((p) => have.get(`${p.band}|${p.fen}`));

  const lossOf = (pos, uci) => {
    const cp = uci in pos.table ? pos.table[uci] : pos.best - 400;
    return Math.max(0, Math.min(CAP, pos.best - cp));
  };
  const wpLossOf = (pos, uci) => {
    const cp = uci in pos.table ? pos.table[uci] : pos.best - 400;
    return Math.max(0, winProbability(Math.max(-CAP * 3, Math.min(CAP * 3, pos.best))) - winProbability(Math.max(-CAP * 3, Math.min(CAP * 3, cp))));
  };
  const contested = positions.filter((p) => Math.abs(p.best) <= CONTESTED);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

  // humans, per cohort
  const human = {};
  for (const band of BANDS) {
    const ps = contested.filter((p) => p.band === band);
    human[band] = {
      n: ps.length, rating: mean(ps.map((p) => p.rating)),
      acpl: mean(ps.map((p) => lossOf(p, p.uci))),
      wp: mean(ps.map((p) => wpLossOf(p, p.uci))),
      blunders: mean(ps.map((p) => (lossOf(p, p.uci) >= 300 ? 1 : 0)))
    };
  }
  // bots, on the same positions
  const bots = {};
  for (const elo of ELOS) {
    const losses = {}; const wps = {}; const bl = {};
    for (const band of BANDS) { losses[band] = []; wps[band] = []; bl[band] = []; }
    for (const [i, p] of contested.entries()) {
      for (let s = 0; s < SAMPLES; s += 1) {
        const bot = new ChessBot(profileForOpponent({ name: 'probe', elo }), { service, random: seeded(7919 * (i + 1) + s * 131 + elo) });
        const choice = await bot.chooseMove(p.fen, {});
        if (!choice.uci) continue;
        losses[p.band].push(lossOf(p, choice.uci));
        wps[p.band].push(wpLossOf(p, choice.uci));
        bl[p.band].push(lossOf(p, choice.uci) >= 300 ? 1 : 0);
      }
    }
    bots[elo] = Object.fromEntries(BANDS.map((b) => [b, { acpl: mean(losses[b]), wp: mean(wps[b]), blunders: mean(bl[b]) }]));
    bots[elo].all = { acpl: mean(BANDS.flatMap((b) => losses[b])), wp: mean(BANDS.flatMap((b) => wps[b])), blunders: mean(BANDS.flatMap((b) => bl[b])) };
    process.stderr.write(`  bot ${elo} done\n`);
  }

  console.log(`\n${contested.length} contested positions (|eval| <= ${CONTESTED}) of ${positions.length}, from real rated Lichess games; depth-${REF_DEPTH} reference\n`);
  console.log('who                          ACPL   win%-loss/move   blunders(>=300cp)');
  for (const band of BANDS) {
    const h = human[band];
    console.log(`humans ~${Math.round(h.rating)} (cohort ${band}, n=${h.n})`.padEnd(29) + `${h.acpl.toFixed(0).padStart(4)}   ${h.wp.toFixed(2).padStart(6)}           ${(100 * h.blunders).toFixed(1).padStart(5)}%`);
  }
  // human curve: ACPL vs mean rating, for reading a bot's equivalent rating
  const pts = BANDS.map((b) => [human[b].rating, human[b].acpl, human[b].wp]).sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const mx = mean(pts.map((p) => p[0])); const my = mean(pts.map((p) => p[1])); const mw = mean(pts.map((p) => p[2]));
  const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const slopeW = pts.reduce((s, p) => s + (p[0] - mx) * (p[2] - mw), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const ratingFor = (acpl) => mx + (acpl - my) / slope;
  const ratingForW = (wp) => mx + (wp - mw) / slopeW;
  console.log(`\nhuman trend (least squares over ${n} cohorts): ACPL ${my.toFixed(0)} at ${mx.toFixed(0)}, ${(slope * 100).toFixed(1)} cp per 100 Elo; win% loss ${(slopeW * 100).toFixed(3)} per 100 Elo`);
  console.log('\nbot label   ACPL   win%-loss   blunders   plays like a human rated (by ACPL / by win% loss)');
  for (const elo of ELOS) {
    const b = bots[elo].all;
    console.log(`${String(elo).padStart(9)}   ${b.acpl.toFixed(0).padStart(4)}   ${b.wp.toFixed(2).padStart(8)}   ${(100 * b.blunders).toFixed(1).padStart(7)}%   ${String(Math.round(ratingFor(b.acpl))).padStart(6)} / ${Math.round(ratingForW(b.wp))}`);
  }
  console.log('\nper cohort (bot ACPL on that cohort\'s positions vs the humans\' own):');
  for (const band of BANDS) {
    console.log(`  cohort ${band}: humans ${human[band].acpl.toFixed(0)}  |  ` + ELOS.map((e) => `bot ${e}: ${bots[e][band].acpl.toFixed(0)}`).join('  '));
  }
  console.log(`\nCaveats: cohort games are blitz/rapid (3+0 .. 15+10), the game is untimed; ${SAMPLES} samples per position per bot; below ${Math.round(pts[0][0])} the human curve is extrapolated.`);
  writeFileSync(path.join(HERE, 'human-strength-result.json'), JSON.stringify({ human, bots, trend: { mx, my, slope, mw, slopeW } }, null, 1));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
