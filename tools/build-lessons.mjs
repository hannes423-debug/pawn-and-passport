/**
 * build-lessons.mjs - generate js/data/lessons.js for the club practice tree.
 *
 * The lessons come from Gambit Academy (the same author's chess trainer), whose
 * content is engine- and tablebase-verified at build time by its own pipeline:
 * every answer was scored by Stockfish at depth >= 14 or proven against the
 * Syzygy tablebase, and its harnesses replay every position through its own
 * rules. This tool reads that content and flattens it into data this game can
 * play without importing any of Gambit Academy's code:
 *
 *   - the intro becomes the lesson's INSTRUCTIONS (read)
 *   - the demo frames become the ANIMATED instructions: each frame is
 *     pre-resolved to a FEN here, so the runner only renders and animates
 *   - the exercises become CHALLENGES, with every candidate move pre-judged by
 *     Gambit Academy's own judge() at the lesson's band, so the verdict and the
 *     wording a player sees are the verified ones
 *
 * Only bands 0-1500 are taken: this game caps at 1500 Elo.
 *
 *   node tools/build-lessons.mjs [--src <path to gambit-academy/index.html>] [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SRC = path.resolve(opt('--src', path.join(process.env.HOME, 'Työpöytä/gambit-academy/index.html')));
const OUT = path.join(ROOT, 'js', 'data', 'lessons.js');
const MAX_BAND = Number(opt('--max-band', 1500));

/* ------------------------------------------------------------------ source */
/* Gambit Academy is one self-contained HTML file whose script blocks carry
   SECTION markers. Load the blocks we need into a vm context, exactly the way
   its own tools do (by marker, never by index). */
function loadAcademy(file) {
  const src = fs.readFileSync(file, 'utf8');
  const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const markers = [
    'SECTION 13 — RULES LAYER',
    'SECTION 33 — ACADEMY MODEL',
    'SECTION 34a — ACADEMY GENERATED CONTENT',
    'SECTION 34b — IMPORTED REVIEW ITEMS',
    'SECTION 34 — ACADEMY CURRICULUM'
  ];
  const ctx = {
    console,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    performance: { now: () => Date.now() },
    requestAnimationFrame: (f) => setTimeout(f, 0),
    setTimeout, clearTimeout,
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
                createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } }) },
    window: { matchMedia: () => ({ matches: false }), addEventListener() {} }
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  const wanted = blocks.filter((b) => markers.some((m) => b.includes(m)));
  const missing = markers.filter((m) => !blocks.some((b) => b.includes(m)) && !m.includes('34a') && !m.includes('34b'));
  if (missing.length) throw new Error(`Gambit Academy blocks not found: ${missing.join(', ')}`);
  wanted.forEach((b, i) => vm.runInContext(b, ctx, { filename: `academy:${i}` }));
  return (name) => vm.runInContext(name, ctx);
}

const get = loadAcademy(SRC);
const Rules = get('Rules');
const Academy = get('Academy');
const ACADEMY = get('ACADEMY');
const LESSONS = get('ACADEMY_LESSONS');

/* ------------------------------------------------------------------ helpers */
const uciOf = (pos, mv) => Rules.name(mv.from) + Rules.name(mv.to) + (mv.promo && mv.promo !== 'q' ? mv.promo : '');
const legal = (pos, uci) => {
  const m = Rules.coerce(pos, uci);
  return !!m && !!pos.board[m.from] && Rules.moves(pos, m.from).indexOf(m.to) >= 0 ? m : null;
};
/** Gambit Academy writes feedback either as a string or as rating variants. */
const textAt = (value, band) => Academy.levelText(value, band) || '';
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** A demo frame's marks/arrows use Academy's own vocabulary; keep the squares
    and translate the class into what this game's renderer understands. */
const MARK_CLASS = { key: 'best', attack: 'threat', target: 'hint', hintFrom: 'hint', hintTo: 'hint', good: 'best', bad: 'threat' };
function frameMarks(marks) {
  if (!marks) return null;
  const out = {};
  Object.entries(marks).forEach(([sq, cls]) => { out[sq] = MARK_CLASS[cls] || 'best'; });
  return Object.keys(out).length ? out : null;
}
function frameArrows(arrows) {
  if (!arrows || !arrows.length) return null;
  return arrows.map(([from, to, colour]) => ({ from, to, kind: colour === 'red' ? 'threat' : colour === 'green' ? 'book' : 'hint' }));
}

/* --------------------------------------------------------------- the demo */
/* Academy demo frames are relative: a frame may reset the position with its
   own `fen`, and a frame's `move` is played on top of the previous one. Resolve
   all of that here so the runner just renders frame.fen and animates from/to. */
function buildDemo(lesson) {
  const stage = lesson.stages.find((s) => s.type === 'demo');
  if (!stage) return [];
  let pos = Rules.parse(stage.fen);
  const frames = [];
  for (const raw of stage.frames) {
    /* A frame may rewind the demo by naming its own position; note that, so
       the verifier knows not to expect continuity from the frame before. */
    const reset = !!raw.fen;
    if (reset) pos = Rules.parse(raw.fen);
    const before = Rules.toFEN(pos);
    let move = null;
    if (raw.move) {
      const mv = legal(pos, raw.move);
      if (!mv) throw new Error(`${lesson.id}: illegal demo move ${raw.move}`);
      move = { from: Rules.name(mv.from), to: Rules.name(mv.to), san: Rules.san(pos, mv) };
      pos = Rules.apply(pos, mv);
    }
    frames.push({
      /* Academy leaves a frame's text empty when it is only the reply in a
         sequence. The watcher needs a line either way, so name the move. */
      text: clean(raw.text) || (move ? `${pos.turn === 'w' ? '…' : ''}${move.san}.` : ''),
      fen: Rules.toFEN(pos),
      before: reset && move ? before : undefined,
      move,
      marks: frameMarks(raw.marks),
      arrows: frameArrows(raw.arrows),
      orientation: raw.orientation === 'b' ? 'b' : undefined
    });
  }
  return frames.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v != null)));
}

/* ---------------------------------------------------------- the challenges */
/* Every authored candidate is run through Academy.judge at the lesson's band,
   so the outcome and the wording are the ones its own tests cover. The runner
   then needs no chess judgement at all: it looks the move up. */
function buildChallenge(lesson, ex) {
  const pos = Rules.parse(ex.fen);
  const band = lesson.band;
  const common = {
    id: ex.id,
    fen: ex.fen,
    orientation: ex.orientation === 'b' ? 'b' : (pos.turn === 'b' ? 'b' : 'w'),
    sideToMove: pos.turn,
    label: clean(ex.label) || undefined,
    prompt: clean(ex.prompt),
    hints: (ex.hints || []).map((hint) => clean(typeof hint === 'string' ? hint : hint.text)).filter(Boolean),
    stage: ex.stage,
    quiet: ex.quiet ? true : undefined
  };
  if (ex.kind === 'square') {
    return {
      ...common,
      kind: 'square',
      target: ex.target,
      success: clean(textAt(ex.success, band)) || `${ex.target}.`
    };
  }
  const verdicts = {};
  const answers = [];
  for (const cand of ex.candidates || []) {
    const mv = legal(pos, cand.move);
    if (!mv) throw new Error(`${lesson.id}/${ex.id}: illegal candidate ${cand.move}`);
    const res = Academy.judge(ex, pos, mv, band);
    const uci = uciOf(pos, mv);
    const pass = res.outcome === 'correct' || res.outcome === 'accepted';
    verdicts[uci] = {
      outcome: res.outcome,
      san: Rules.san(pos, mv),
      text: clean(res.text) || (pass ? 'Good move.' : 'Not this time.')
    };
    if (pass) answers.push(uci);
  }
  if (!answers.length) throw new Error(`${lesson.id}/${ex.id}: no move judges as correct at band ${band}`);
  const fb = ex.fallback || {};
  return {
    ...common,
    kind: 'move',
    answers,
    verdicts,
    fallback: clean(textAt(fb.feedback, band)) || 'Legal, but not what this lesson is about.',
    success: clean(textAt(ex.success, band)) || undefined
  };
}

/* ------------------------------------------------------------------- build */
const kept = [];
const skipped = [];
for (const lesson of LESSONS) {
  if (lesson.band > MAX_BAND) { skipped.push(`${lesson.id} (band ${lesson.band})`); continue; }
  const refs = lesson.stages.filter((s) => s.type === 'exercise').map((s) => s.ref);
  const own = refs.map((ref) => ACADEMY.exercises[ref]).filter(Boolean);
  /* The lesson's own test items are not in the stage list (Academy draws them
     at run time for its mastery test); include them as extra challenges so a
     practice lesson has something left to do once the guided ones are solved. */
  const extra = Object.values(ACADEMY.exercises)
    .filter((x) => x.conceptId === lesson.conceptId && x.stage === 'test' && !refs.includes(x.id));
  const challenges = [...own, ...extra].map((ex) => buildChallenge(lesson, ex));
  if (!challenges.length) { skipped.push(`${lesson.id} (no challenges)`); continue; }
  kept.push({
    id: lesson.id.replace(/^academy-/, ''),
    title: clean(lesson.title),
    band: lesson.band,
    branch: lesson.branch,
    skills: lesson.skills,
    instructions: clean((lesson.stages.find((s) => s.type === 'intro') || {}).text),
    demo: buildDemo(lesson),
    challenges
  });
}
kept.sort((a, b) => a.band - b.band || a.id.localeCompare(b.id));

const bands = [...new Set(kept.map((l) => l.band))].sort((a, b) => a - b);
const counts = bands.map((b) => `${b}:${kept.filter((l) => l.band === b).length}`).join(' ');
const totalChallenges = kept.reduce((n, l) => n + l.challenges.length, 0);
const totalFrames = kept.reduce((n, l) => n + l.demo.length, 0);
console.log(`${kept.length} lessons, ${totalChallenges} challenges, ${totalFrames} demo frames`);
console.log(`bands: ${counts}`);
if (skipped.length) console.log(`skipped ${skipped.length}: ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? ' …' : ''}`);

if (argv.includes('--check')) process.exit(0);

const header = `/**
 * lessons.js - GENERATED by tools/build-lessons.mjs. Do not edit by hand.
 *
 * The club practice tree's content, flattened from Gambit Academy (the same
 * author's chess trainer), whose build pipeline verified every answer with
 * Stockfish at depth >= 14 or against the Syzygy tablebase.
 *
 * Per lesson: instructions to read, demo frames to watch (each already
 * resolved to a FEN, with the move to animate), and challenges to solve. A
 * challenge's candidate moves were pre-judged by Gambit Academy's own judge()
 * at that lesson's band, so \`verdicts\` holds the verified outcome and wording
 * and this game needs no chess judgement of its own.
 *
 * ${kept.length} lessons across bands ${bands[0]}-${bands[bands.length - 1]}, ${totalChallenges} challenges.
 * Rebuild: node tools/build-lessons.mjs
 */

export const LESSON_BANDS = ${JSON.stringify(bands)};

export const LESSONS = [
`;
const body = kept.map((l) => `  ${JSON.stringify(l)}`).join(',\n');
const footer = `
];

export const lessonById = (id) => LESSONS.find((l) => l.id === id) || null;
export const lessonsInBand = (band) => LESSONS.filter((l) => l.band === band);

export default { LESSONS, LESSON_BANDS, lessonById, lessonsInBand };
`;
fs.writeFileSync(OUT, header + body + footer);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
