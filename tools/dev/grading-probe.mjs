/**
 * tools/dev/grading-probe.mjs - does live grading see a strong engine?
 *
 *   node tools/dev/grading-probe.mjs [games=2] [seed=1]
 *
 * Plays real PapMatch games in Node: a simulated "human" (the game's own bot at
 * HUMAN_ELO, default 1200) against a club bot, through the match's own
 * playMove -> grade -> bot reply flow.
 * Prints the grade distribution and the depth the grading searches reached.
 */
import { EngineService } from '../../js/chess/engine/engineService.js';
import { StockfishEngine } from '../../js/chess/engine/stockfishEngine.js';
import { createNodeStockfishTransport } from '../../tests/nodeTransport.js';
import { PapMatch } from '../../js/game/match.js';
import { newCareer } from '../../js/core/career.js';
import { ChessBot } from '../../js/chess/bots/chessBot.js';
import { profileForOpponent } from '../../js/core/difficulty.js';

const games = Number(process.argv[2] || 2);
let seed = Number(process.argv[3] || 1);
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

const engine = new StockfishEngine({ createTransport: createNodeStockfishTransport });
const service = new EngineService({ engine });
await service.ready();

const totals = {};
const depths = [];
for (let g = 0; g < games; g += 1) {
  const career = newCareer({ name: 'Probe', avatar: 'boy', startClubId: 'nyc' });
  const colour = g % 2 ? 'b' : 'w';
  const match = new PapMatch({ career, kind: 'friendly', colour, playerColour: colour, service,
    opponent: { id: 'probe', name: 'Bot', elo: 900, style: 'balanced', openingId: 'italian' } });
  const human = new ChessBot(profileForOpponent({ name: 'Human', elo: Number(process.env.HUMAN_ELO || 1200), style: 'balanced' }), { service, random: rand });
  await match.start();
  let plies = 0;
  while (match.game.status === 'active' && plies < 120) {
    if (!match.isPlayersTurn) { await new Promise((r) => setTimeout(r, 50)); continue; }
    const choice = await human.chooseMove(match.fen, { ply: match.game.ply });
    const uci = choice.uci;
    await match.playMove(uci);
    plies += 1;
  }
  const summary = await match.summary();
  for (const [k, v] of Object.entries(summary.grades)) totals[k] = (totals[k] || 0) + v;
  for (const rec of match.game.history.filter((m) => m.color === colour)) {
    if (rec.engineEvaluation) depths.push(rec.engineEvaluation.depth);
    if (process.env.VERBOSE) console.log(`  ${rec.moveNumber}. ${rec.san.padEnd(7)} ${String(rec.grade || rec.mistakeClassification).padEnd(10)} wpLoss ${rec.winProbLoss} cpLoss ${rec.evaluationDelta} best ${rec.bestMoveSan} eval ${JSON.stringify(rec.engineEvaluation && { cp: rec.engineEvaluation.cp, mate: rec.engineEvaluation.mate })}`);
  }
  console.log(`game ${g + 1}: ${summary.headline}, accuracy ${summary.accuracy}, grades ${JSON.stringify(summary.grades)}`);
  match.dispose();
}
const n = Object.values(totals).reduce((a, b) => a + b, 0);
console.log('\nTOTAL', n, 'graded moves');
for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(11)} ${String(v).padStart(3)}  ${Math.round((v / n) * 100)}%`);
depths.sort((a, b) => a - b);
console.log('grading search depth: min', depths[0], 'median', depths[Math.floor(depths.length / 2)], 'max', depths.at(-1));
process.exit(0);
