#!/usr/bin/env node
/**
 * validate-content.mjs - the content gate. No engine, no network, a few
 * seconds. Run before every deploy (tools/predeploy.sh does) and it exits 1
 * on the first kind of problem, listing every instance.
 *
 *   node tools/validate-content.mjs [--quiet]
 *
 *   puzzles        venue missions and club practice sets: FEN parses, side to
 *                  move matches, every solution move is legal, the stored SAN
 *                  is what the move really is, the line alternates and ends on
 *                  the solver's move, a mate puzzle ends in mate, and the
 *                  start position is not already over
 *   lessons        tools/verify-lessons.mjs (FENs, demo frames, challenges)
 *   openings       every line legal and spelled as chess.js spells it
 *   drills         every opening yields a drill set of MASTERY.drillSetSize
 *                  positions, each with legal book answers
 *
 * The deeper checks that need Stockfish (uniqueness of puzzle solutions) stay
 * in tools/verify-puzzles.mjs and tools/verify-club-puzzles.mjs; they were
 * run when the content was generated.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUZZLES } from '../js/data/puzzles.js';
import { CLUB_PUZZLES } from '../js/data/clubPuzzles.js';
import { OPENINGS } from '../js/data/openings.js';
import { MISSIONS } from '../js/data/missions.js';
import { MASTERY } from '../js/data/config.js';
import { createRules } from '../js/chess/core/rules.js';
import { drillPositions, pickDrillSet } from '../js/ui/screens/drill.js';
import { ICON_NAMES } from '../js/ui/icons.js';
import { existsSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const rulesAt = (fen) => { try { return createRules(fen); } catch { return null; } };

/* ---------------------------------------------------------------- puzzles */
function checkPuzzle(p, { mateByTitle = false } = {}) {
  const where = `puzzle ${p.id}`;
  const r = rulesAt(p.fen);
  if (!r) return fail(where, `FEN does not parse: ${p.fen}`);
  const side = p.fen.split(' ')[1];
  if (p.sideToMove && p.sideToMove !== side) fail(where, `sideToMove ${p.sideToMove} but the FEN has ${side} to move`);
  if (r.isGameOver?.() || !r.moves().length) fail(where, 'the start position is already over');
  if (!Array.isArray(p.solution) || !p.solution.length) return fail(where, 'no solution');
  if (p.solution.length % 2 !== 1) fail(where, `solution has ${p.solution.length} plies: it must end on the solver's move`);
  p.solution.forEach((uci, i) => {
    const turn = r.turn();
    if ((i % 2 === 0) !== (turn === side)) fail(where, `ply ${i + 1}: moves out of turn`);
    const m = r.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    if (!m) { fail(where, `ply ${i + 1}: ${uci} is illegal`); return; }
    if (p.solutionSan && p.solutionSan[i] && p.solutionSan[i] !== m.san) fail(where, `ply ${i + 1}: stored SAN ${p.solutionSan[i]} but the move is ${m.san}`);
  });
  const endsInMate = (p.solutionSan?.at(-1) || '').includes('#') || (mateByTitle && /^Mate/.test(p.title || ''));
  if (endsInMate && !r.isCheckmate()) fail(where, 'announced as mate but the line does not end in mate');
}
PUZZLES.forEach((p) => checkPuzzle(p));
CLUB_PUZZLES.forEach((p) => checkPuzzle(p, { mateByTitle: true }));
for (const m of MISSIONS) {
  const n = PUZZLES.filter((p) => p.mission === m.clubId).length;
  if (n < 3 || n > 5) fail(`mission ${m.id}`, `${n} puzzles (3 to 5 expected)`);
}
const ids = [...PUZZLES, ...CLUB_PUZZLES].map((p) => p.id);
ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => fail(`puzzle ${id}`, 'duplicate id'));

/* --------------------------------------------------------------- openings */
for (const o of OPENINGS) {
  o.lines.forEach((line, i) => {
    const r = createRules();
    for (const [ply, san] of line.entries()) {
      const m = r.move(san);
      if (!m) { fail(`opening ${o.id} line ${i}`, `ply ${ply + 1}: ${san} is illegal`); break; }
      if (m.san !== san) fail(`opening ${o.id} line ${i}`, `ply ${ply + 1}: written ${san}, chess.js spells it ${m.san}`);
    }
  });
}

/* ----------------------------------------------------------------- drills */
for (const o of OPENINGS) {
  const all = drillPositions(o.id);
  const set = pickDrillSet(o.id);
  if (all.length < MASTERY.drillSetSize) fail(`drills ${o.id}`, `only ${all.length} positions (a set needs ${MASTERY.drillSetSize})`);
  if (set.length !== Math.min(MASTERY.drillSetSize, all.length) || !set.length) fail(`drills ${o.id}`, `a set came out with ${set.length} positions`);
  for (const pos of all) {
    const r = rulesAt(pos.fen);
    if (!r) { fail(`drills ${o.id}`, `bad FEN ${pos.fen}`); continue; }
    if (r.turn() !== o.side) fail(`drills ${o.id}`, `position asks the wrong side (${pos.fen})`);
    const legal = new Set(r.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')));
    if (!pos.answers.length) fail(`drills ${o.id}`, `no answer at ${pos.fen}`);
    for (const a of pos.answers) if (!legal.has(a.uci)) fail(`drills ${o.id}`, `answer ${a.uci} is illegal at ${pos.fen}`);
  }
}

/* ------------------------------------------------------------------ icons */
/* The UI icon set is built from a sheet by tools/build_pixel_icons.py and
   referenced by NAME, so a file that never got cut - or a name that got
   renamed on one side only - is a broken image in the HUD and nothing else.
   The path is a template, so the build's own "is every asset shipped" sweep
   cannot see it: this is the check that can. */
for (const name of ICON_NAMES) {
  const file = path.join(ROOT, 'assets', 'ui', 'icons', `${name}.png`);
  if (!existsSync(file)) fail('icons', `js/ui/icons.js names "${name}", but assets/ui/icons/${name}.png is not there (run tools/build_pixel_icons.py)`);
}

/* ---------------------------------------------------------------- lessons */
try {
  execFileSync('node', [path.join(ROOT, 'tools/verify-lessons.mjs'), '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (error) {
  fail('lessons', String(error.stderr || error.stdout || error.message).trim().split('\n').slice(0, 12).join(' | '));
}

if (!quiet) {
  console.log(`${ICON_NAMES.length} UI icons · ${PUZZLES.length} venue puzzles · ${CLUB_PUZZLES.length} club puzzles · ${OPENINGS.length} openings (${OPENINGS.reduce((n, o) => n + o.lines.length, 0)} lines) · drills for ${OPENINGS.map((o) => `${o.id} ${drillPositions(o.id).length}`).join(', ')}`);
}
if (problems.length) {
  console.error(`\nCONTENT INVALID: ${problems.length} problem(s)\n  ${problems.slice(0, 60).join('\n  ')}`);
  process.exit(1);
}
if (!quiet) console.log('CONTENT OK');
