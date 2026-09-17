#!/usr/bin/env node
/**
 * tools/verify-club-puzzles.mjs - each club's own puzzle set, from real games
 * in the club's opening, proven by Stockfish.
 *
 *   python3 tools/opening-research/mine-puzzles.py   # candidates (needs the broadcast PGNs)
 *   node tools/verify-club-puzzles.mjs               # -> js/data/clubPuzzles.js
 *
 * The same standard as tools/verify-puzzles.mjs, but the line is DISCOVERED,
 * not composed: at every player turn the engine's first choice must be the
 * only good move (the fastest mate with no equal rival, or a win by at least
 * MARGIN centipawns over the runner-up), the opponent answers with the
 * engine's best defence, and the line stops at the first player move that is
 * no longer unique (at most MAX_MOVES player moves).
 *
 * Rejected: a first move that simply recaptures what was just taken (not a
 * puzzle, a reflex), any position already used by a venue puzzle, a mating
 * line that stops being unique before the mate (the puzzle would end
 * mid-attack), games played online, and a third puzzle with the
 * same title in one club (so a set is not six identical queen mates).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { StockfishEngine } from '../js/chess/engine/stockfishEngine.js';
import { createNodeStockfishTransport } from '../tests/nodeTransport.js';
import { createRules, applyUci, sanFor, isCheckmate } from '../js/chess/core/rules.js';
import { scoreToCp } from '../js/chess/analysis/moveClassifier.js';
import { detectMoveMotifs, MOTIFS } from '../js/chess/analysis/motifDetector.js';
import { CLUBS } from '../js/data/clubs.js';
import { PUZZLES } from '../js/data/puzzles.js';

const DEPTH = 18;
const MARGIN = 200;
const MIN_WIN = 250;
const MAX_MOVES = 3;          // player moves in a non-mating line
const MAX_MATE_MOVES = 5;     // a mate must be played out in full
const MAX_SAME_TITLE = 2;
const MAX_MATES = 3;          // the rest of a set wins material
const PER_CLUB = 6;

const candidates = JSON.parse(await readFile(new URL('./opening-research/puzzle-candidates.json', import.meta.url), 'utf8'));
const engine = new StockfishEngine({ createTransport: createNodeStockfishTransport });
await engine.init();

const mateIn = (score) => (typeof score?.mate === 'number' && score.mate > 0 ? score.mate : null);
const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
const venueKeys = new Set(PUZZLES.map((p) => key(p.fen)));

/** Is the engine's best move here the only good one? */
function unique(best, second) {
  const m = mateIn(best.score);
  if (m) {
    const rival = second && mateIn(second.score) && mateIn(second.score) <= m;
    return { ok: !rival, why: rival ? `${second.san} also mates` : `M${m}`, mate: m };
  }
  const bestCp = scoreToCp(best.score);
  const secondCp = second ? scoreToCp(second.score) : bestCp - 10000;
  return { ok: bestCp >= MIN_WIN && bestCp - secondCp >= MARGIN, why: `${bestCp}cp, margin ${bestCp - secondCp}cp`, mate: null };
}

const THEME = [
  [MOTIFS.MATE, 'Checkmate', 'There is a mate on the board. Check every check.'],
  [MOTIFS.DOUBLE_CHECK, 'Double check', 'Two pieces can give check at once.'],
  [MOTIFS.DISCOVERED_CHECK, 'Discovered check', 'Move one piece so another gives check.'],
  [MOTIFS.DISCOVERED_ATTACK, 'Discovered attack', 'One piece steps aside and another attacks.'],
  [MOTIFS.FORK, 'Fork', 'One piece can attack two targets.'],
  [MOTIFS.SKEWER, 'Skewer', 'Attack the big piece; something is behind it.'],
  [MOTIFS.PIN, 'Pin', 'A piece cannot move without exposing something bigger.'],
  [MOTIFS.DEFLECTION, 'Deflection', 'Lure a defender away from its job.'],
  [MOTIFS.REMOVING_DEFENDER, 'Remove the defender', 'Take the piece that is holding everything together.'],
  [MOTIFS.OVERLOAD, 'Overloaded defender', 'One defender is guarding two things.'],
  [MOTIFS.TRAPPED_PIECE, 'Trapped piece', 'An enemy piece has nowhere to run.'],
  [MOTIFS.BACK_RANK, 'Back rank', 'The king has no escape square.'],
  [MOTIFS.SACRIFICE, 'Sacrifice', 'Give material to get more back.'],
  [MOTIFS.PROMOTION, 'Promotion', 'A pawn is close to becoming a queen.']
];

function theme(fen, uci, mate) {
  const rules = createRules(fen);
  const move = rules.moves({ verbose: true }).find((m) => m.from + m.to + (m.promotion || '') === uci);
  const motifs = move ? detectMoveMotifs(fen, move) : [];
  const types = new Set(motifs.map((m) => m.type));
  if (mate) {
    const lead = THEME.find(([type]) => type !== MOTIFS.MATE && types.has(type));
    return { title: `Mate in ${mate}`, hint: mate === 1 ? 'There is a mate on the board. Check every check.' : (lead ? `${lead[2]} It ends in mate.` : 'Forcing moves first: checks, captures, threats.') };
  }
  for (const [type, title, hint] of THEME) {
    if (types.has(type)) return { title, hint };
  }
  if (move?.captured) return { title: 'Win material', hint: 'Something is not defended well enough.' };
  return { title: 'Find the winning move', hint: 'Look for checks, captures and threats, in that order.' };
}

const out = [];
const report = [];

for (const club of CLUBS) {
  const list = candidates[club.openingId] || [];
  const found = [];
  const seen = new Set();
  for (const cand of list) {
    if (found.length >= PER_CLUB) break;
    if (/online/i.test(cand.game)) continue;
    const rules = createRules();
    let legal = true;
    let lastTo = null;
    for (const san of cand.moves) {
      let m = null;
      try { m = rules.move(san); } catch { m = null; }
      if (!m) { legal = false; break; }
      lastTo = m.to;
    }
    if (!legal) continue;
    const start = rules.fen();
    if (seen.has(key(start)) || venueKeys.has(key(start))) continue;
    seen.add(key(start));

    let fen = start;
    const solution = [];
    let firstInfo = null;
    const limit = cand.mateIn ? MAX_MATE_MOVES : MAX_MOVES;
    let mateLine = false;
    for (let turn = 0; turn < limit * 2 - 1; turn += 1) {
      const result = await engine.analyze(fen, { depth: DEPTH, multiPv: 3 });
      const [best, second] = result.lines;
      if (!best) break;
      if (turn % 2 === 1) {                       // the defence
        solution.push(best.move);
        fen = applyUci(fen, best.move).fen;
        continue;
      }
      const u = unique(best, second);
      if (!u.ok) {
        if (turn === 0) report.push(`skip ${club.clubId} ply ${cand.ply}: ${u.why}`);
        break;
      }
      if (turn === 0) {
        if (best.move.slice(2, 4) === lastTo && best.san.includes('x') && !u.mate) {
          report.push(`skip ${club.clubId} ply ${cand.ply}: plain recapture ${best.san}`);
          break;
        }
        firstInfo = u;
        mateLine = !!u.mate;
      }
      solution.push(best.move);
      fen = applyUci(fen, best.move).fen;
      if (isCheckmate(fen)) break;
    }
    while (solution.length && solution.length % 2 === 0) solution.pop();
    if (!solution.length) continue;
    if (mateLine && !isCheckmate(fen)) { report.push(`skip ${club.clubId} ply ${cand.ply}: mate not unique to the end`); continue; }

    const san = [];
    let f = start;
    for (const move of solution) { san.push(sanFor(f, move)); f = applyUci(f, move).fen; }
    const { title, hint } = theme(start, solution[0], firstInfo?.mate);
    if (found.filter((p) => p.title === title).length >= MAX_SAME_TITLE) { report.push(`skip ${club.clubId} ply ${cand.ply}: enough "${title}"`); continue; }
    if (firstInfo?.mate && found.filter((p) => p.title.startsWith('Mate')).length >= MAX_MATES) { report.push(`skip ${club.clubId} ply ${cand.ply}: enough mates`); continue; }
    const n = found.length + 1;
    found.push({
      id: `club-${club.clubId}-${n}`, club: club.clubId, opening: club.openingId,
      title, hint, fen: start, sideToMove: start.split(' ')[1],
      solution, solutionSan: san, verifiedDepth: DEPTH,
      source: cand.game, moveNumber: Math.floor(cand.ply / 2) + 1
    });
    report.push(`ok   ${club.clubId} #${n} "${title}": ${san.join(' ')}   (${cand.game}, ${firstInfo.why})`);
  }
  out.push(...found);
  report.push(`== ${club.clubId}: ${found.length}/${PER_CLUB}`);
}

engine.dispose?.();

const body = `/**
 * clubPuzzles.js - GENERATED by tools/verify-club-puzzles.mjs. Do not edit by hand.
 *
 * Each club's practice-room puzzles: positions from real tournament games in
 * the club's opening (Lichess broadcasts, both players 1900+), taken right
 * after a mistake. Every player move below was proven by Stockfish at depth
 * ${DEPTH} to be the only good move; each reply is the engine's best defence.
 * None of these positions is used by a venue puzzle.
 */
export const CLUB_PUZZLES = ${JSON.stringify(out, null, 2)};

export const puzzlesForClub = (clubId) => CLUB_PUZZLES.filter((p) => p.club === clubId);

export default CLUB_PUZZLES;
`;
await writeFile(new URL('../js/data/clubPuzzles.js', import.meta.url), body);
console.log(report.join('\n'));
console.log(`\n${out.length} club puzzles -> js/data/clubPuzzles.js`);
process.exit(0);
