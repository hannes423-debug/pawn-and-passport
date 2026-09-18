/**
 * verify-lessons.mjs - re-check js/data/lessons.js against this game's rules.
 *
 * The content was verified in Gambit Academy with Stockfish and the Syzygy
 * tablebase, and converted by tools/build-lessons.mjs. This tool checks the
 * conversion itself, using THIS game's chess library rather than Academy's:
 * every FEN legal, every demo frame reachable by the move it claims, every
 * answer and every judged move legal in its position, every square target a
 * real square, and nothing missing that the practice screens rely on.
 *
 *   node tools/verify-lessons.mjs [--quiet]
 *
 * Exits non-zero on the first kind of problem it finds, so it can gate a build.
 */
import { LESSONS, LESSON_BANDS } from '../js/data/lessons.js';
import { PRACTICE } from '../js/data/config.js';
import { createRules } from '../js/chess/core/rules.js';

const quiet = process.argv.includes('--quiet');
const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const SQUARE = /^[a-h][1-8]$/;

let frames = 0;
let challenges = 0;
let answers = 0;
let verdicts = 0;

for (const lesson of LESSONS) {
  const where = lesson.id;
  if (!lesson.title) fail(where, 'no title');
  if (!lesson.instructions || lesson.instructions.length < 40) fail(where, 'instructions missing or too short to read');
  if (!Number.isInteger(lesson.band) || lesson.band < 0 || lesson.band > 1500) fail(where, `band out of range: ${lesson.band}`);
  if (!PRACTICE.tiers.some((t) => t.bands.includes(lesson.band))) fail(where, `band ${lesson.band} belongs to no tier`);
  if (!lesson.branch) fail(where, 'no branch');

  /* The demo: each frame must be a legal position, and a frame that claims a
     move must be the position that move leads to from the frame before it. */
  let previous = null;
  lesson.demo.forEach((frame, i) => {
    frames += 1;
    const at = `${where}/demo[${i}]`;
    let rules = null;
    try { rules = createRules(frame.fen); } catch { rules = null; }
    if (!rules) { fail(at, `illegal FEN ${frame.fen}`); previous = null; return; }
    if (!frame.text) fail(at, 'frame has no text');
    if (frame.move) {
      if (!SQUARE.test(frame.move.from) || !SQUARE.test(frame.move.to)) fail(at, `move squares ${frame.move.from}${frame.move.to}`);
      /* `before` is present only when the frame rewound the demo to its own
         position; otherwise the move must follow on from the frame before. */
      const start = frame.before || previous;
      if (start) {
        const probe = createRules(start);
        let applied = null;
        try { applied = probe.move({ from: frame.move.from, to: frame.move.to, promotion: 'q' }); } catch { applied = null; }
        if (!applied) fail(at, `move ${frame.move.from}${frame.move.to} is not legal in ${frame.before ? 'its own start position' : 'the previous frame'}`);
        else if (probe.fen().split(' ')[0] !== frame.fen.split(' ')[0])
          fail(at, `frame position is not what ${frame.move.from}${frame.move.to} leads to`);
      }
    }
    Object.keys(frame.marks || {}).forEach((sq) => { if (!SQUARE.test(sq)) fail(at, `mark on ${sq}`); });
    (frame.arrows || []).forEach((a) => {
      if (!SQUARE.test(a.from) || !SQUARE.test(a.to)) fail(at, `arrow ${a.from}-${a.to}`);
    });
    previous = frame.fen;
  });

  if (!lesson.challenges.length) fail(where, 'no challenges');
  const ids = new Set();
  lesson.challenges.forEach((c, i) => {
    challenges += 1;
    const at = `${where}/${c.id || `challenge[${i}]`}`;
    if (ids.has(c.id)) fail(at, 'duplicate challenge id');
    ids.add(c.id);
    if (!c.prompt) fail(at, 'no prompt');
    let rules = null;
    try { rules = createRules(c.fen); } catch { rules = null; }
    if (!rules) { fail(at, `illegal FEN ${c.fen}`); return; }
    if (rules.turn() !== c.sideToMove) fail(at, `sideToMove says ${c.sideToMove}, the FEN says ${rules.turn()}`);
    if (c.orientation !== 'w' && c.orientation !== 'b') fail(at, `orientation ${c.orientation}`);

    if (c.kind === 'square') {
      if (!SQUARE.test(c.target || '')) fail(at, `square target ${c.target}`);
      if (!c.success) fail(at, 'no success text');
      return;
    }
    if (c.kind !== 'move') { fail(at, `unknown kind ${c.kind}`); return; }
    if (!c.answers?.length) fail(at, 'no accepted answer');
    if (!c.fallback) fail(at, 'no fallback text for an unlisted move');
    const legalUci = new Set();
    rules.moves({ verbose: true }).forEach((m) => {
      const promo = m.promotion && m.promotion !== 'q' ? m.promotion : '';
      legalUci.add(m.from + m.to + promo);
    });
    c.answers.forEach((uci) => {
      answers += 1;
      if (!legalUci.has(uci)) fail(at, `answer ${uci} is not a legal move`);
      if (!c.verdicts?.[uci]) fail(at, `answer ${uci} has no verdict text`);
    });
    Object.entries(c.verdicts || {}).forEach(([uci, v]) => {
      verdicts += 1;
      if (!legalUci.has(uci)) fail(at, `judged move ${uci} is not legal`);
      if (!v.text) fail(at, `verdict ${uci} has no text`);
      const pass = v.outcome === 'correct' || v.outcome === 'accepted';
      if (pass !== c.answers.includes(uci)) fail(at, `verdict ${uci} says ${v.outcome} but answers ${c.answers.includes(uci) ? 'include' : 'exclude'} it`);
    });
  });
}

/* Unlocking has to reach 1500 with the six trophies the campaign can award. */
const tiers = PRACTICE.tiers;
if (tiers[0].trophies !== 0) problems.push('the first practice tier is not open at zero trophies');
if (Math.max(...tiers.map((t) => t.trophies)) !== 6) problems.push('the last practice tier does not open at six trophies');
tiers.slice(1).forEach((t, i) => {
  if (t.trophies !== tiers[i].trophies + 1) problems.push(`tier ${t.id} does not open one trophy after ${tiers[i].id}`);
});
const covered = new Set(tiers.flatMap((t) => t.bands));
LESSON_BANDS.forEach((band) => { if (!covered.has(band)) problems.push(`band ${band} is in no tier`); });

if (!quiet) {
  console.log(`${LESSONS.length} lessons · ${frames} demo frames · ${challenges} challenges · ${answers} answers · ${verdicts} judged moves`);
  console.log(`tiers: ${tiers.map((t) => `${t.label}@${t.trophies}`).join(' ')}`);
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.slice(0, 30).join('\n  ')}`);
  process.exit(1);
}
if (!quiet) console.log('LESSONS OK');
