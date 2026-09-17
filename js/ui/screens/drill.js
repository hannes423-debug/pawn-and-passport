/**
 * drill.js - opening drills in a club's practice room.
 *
 * A set of positions taken from the club opening's own lines, each one with
 * the OPENING side to move. The player must play a book move: any move the
 * opening's lines continue with from that position counts, so transpositions
 * and sidelines are accepted. Two misses reveal the answer as an arrow.
 * Passing a set (config MASTERY.drillPassShare first-try answers) teaches the
 * opening like a game does (career.learnFromDrill).
 */

import { h, button, wait } from '../dom.js';
import { sfx } from '../audio.js';
import { portraitUrl } from '../sprites.js';
import { createBoard } from '../board.js';
import { createRules } from '../../chess/core/rules.js';
import { HIGHLIGHT, ARROW } from '../../chess/render/boardRenderer.js';
import { openingById } from '../../data/openings.js';
import { clubById } from '../../data/clubs.js';
import { MASTERY } from '../../data/config.js';
import { bookForOpening, positionKey } from '../../core/openingBook.js';
import { learnFromDrill, masteryState } from '../../core/career.js';
import { replayLine } from '../openingStudy.js';

/** Every distinct position in the opening's lines where the opening side is to move. */
export function drillPositions(openingId) {
  const opening = openingById(openingId);
  const book = bookForOpening(openingId);
  const seen = new Map();
  opening.lines.forEach((line, lineIndex) => {
    const { fens, moves } = replayLine(line);
    for (let ply = 0; ply < moves.length; ply += 1) {
      const fen = fens[ply];
      if (fen.split(' ')[1] !== opening.side) continue;
      const key = positionKey(fen);
      if (seen.has(key)) continue;
      const answers = [...(book.at(fen)?.moves.values() || [])].map((m) => ({ uci: m.uci, san: m.san }));
      if (!answers.length) continue;
      seen.set(key, { fen, ply, lineIndex, history: moves.slice(0, ply).map((m) => m.san), answers });
    }
  });
  return [...seen.values()];
}

/** A set: shuffled, preferring positions past the first couple of moves. */
export function pickDrillSet(openingId, size = MASTERY.drillSetSize, random = Math.random) {
  const all = drillPositions(openingId);
  const weighted = all.map((p) => ({ p, w: random() * (p.ply < 2 ? 0.35 : 1) }));
  return weighted.sort((a, b) => b.w - a.w).slice(0, size).map((x) => x.p);
}

const movesText = (history) => history.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ') || 'Starting position';

export function drillScreen(app, params) {
  const career = app.career;
  const opening = openingById(params.openingId);
  const club = clubById(params.clubId);
  const coach = club?.regularOpponentPool?.[1]?.look;
  let set = pickDrillSet(opening.id);
  let index = 0;
  let misses = 0;
  let firstTry = 0;
  let rules = null;
  let locked = false;

  const board = createBoard(app, {
    orientation: opening.side,
    getFen: () => rules.fen(),
    getDestinations: (square) => (locked ? [] : rules.moves({ square, verbose: true }).map((m) => ({ to: m.to, capture: !!m.captured, promotion: !!m.promotion }))),
    getMovableColour: () => (locked ? null : opening.side),
    onMove: (move) => attempt(move)
  });
  const { renderer } = board;

  const dots = h('div.pp-dots');
  const title = h('h2.pp-h2');
  const history = h('p.pp-small');
  const status = h('p');
  const nextBtn = button('Next', () => load(index + 1), { cls: 'pp-btn--gold', icon: '▶' });

  const panel = h('aside.pp-match__left', null,
    h('div.pp-panel.pp-player.pp-match__opp', null,
      h('img', { alt: '', src: portraitUrl(coach || { sprite: 'woman' }) }),
      h('div', null, h('div.pp-player__name', { text: `${opening.name} drills` }),
        h('div.pp-small', { text: `${club?.clubName || 'Practice room'} · ${career.openings[opening.id] ?? 0}% ${masteryState(career.openings[opening.id] ?? 0).label}` }))),
    h('div.pp-panel.pp-col.pp-match__focus.pp-puzzle__panel', null,
      h('div.pp-puzzle__info', null, dots, title, history, status),
      h('div.pp-row.pp-puzzle__actions', null,
        nextBtn,
        button('Show answer', () => reveal(), { cls: 'pp-btn--small pp-btn--blue', icon: '💡' }),
        button('Leave', () => app.go('scene', { sceneId: params.returnScene }), { cls: 'pp-btn--small' }))));
  const el = h('div.pp-screen.pp-match.pp-match--puzzle', null, panel, h('main.pp-match__board', null, board.frame), h('aside.pp-match__right'));

  const results = [];
  function paintDots() {
    dots.replaceChildren(...set.map((_, i) => h('span.pp-dot', {
      class: `${results[i] === true ? 'is-done' : ''} ${i === index ? 'is-current' : ''}`,
      style: results[i] === false ? { background: '#d9822b' } : null
    })));
  }

  function load(i) {
    if (i >= set.length) { finish(); return; }
    index = i;
    misses = 0;
    locked = false;
    const p = set[index];
    rules = createRules(p.fen);
    renderer.setOrientation(opening.side);
    renderer.clearArrows(); renderer.clearHighlights(); renderer.clearVerdicts();
    renderer.render(p.fen);
    board.input.setEnabled(true);
    title.textContent = `${index + 1}/${set.length} · ${opening.lineNames[p.lineIndex] || opening.name}`;
    history.textContent = movesText(p.history);
    status.textContent = `${opening.side === 'w' ? 'White' : 'Black'} to move: play the book move.`;
    nextBtn.hidden = true;
    paintDots();
  }

  async function attempt(move) {
    if (locked) return;
    const p = set[index];
    const uci = move.from + move.to + (move.promotion || '');
    const hit = p.answers.find((a) => a.uci === uci);
    if (!hit) {
      misses += 1;
      sfx.mistake();
      board.fx.shake();
      board.fx.chip(move.to, '✗ Not book', '#ff8f3a');
      if (results[index] === undefined) results[index] = false;
      status.textContent = misses >= 2 ? 'Here is the book move: follow the arrow.' : 'Not the book move. Think about the plan of the opening.';
      if (misses >= 2) reveal(false);
      paintDots();
      return;
    }
    locked = true;
    board.input.setEnabled(false);
    rules.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
    renderer.clearArrows();
    renderer.render(rules.fen(), { move: { from: move.from, to: move.to } });
    renderer.highlightMove(move, HIGHLIGHT.LAST_MOVE);
    if (results[index] === undefined) { results[index] = true; firstTry += 1; }
    sfx.best();
    board.fx.ring(move.to, '#36d6d6');
    const others = p.answers.filter((a) => a.uci !== uci).map((a) => a.san);
    status.textContent = `✔ ${hit.san}${others.length ? ` (also book: ${others.join(', ')})` : ''}`;
    paintDots();
    await wait(700);
    nextBtn.hidden = false;
    nextBtn.querySelector('span:last-child').textContent = index >= set.length - 1 ? 'Finish' : 'Next';
  }

  function reveal(countAsMiss = true) {
    const p = set[index];
    if (countAsMiss && results[index] === undefined) { results[index] = false; paintDots(); }
    renderer.clearArrows();
    const a = p.answers[0];
    renderer.drawArrow({ from: a.uci.slice(0, 2), to: a.uci.slice(2, 4) }, ARROW.HINT);
    sfx.hint();
  }

  async function finish() {
    board.input.setEnabled(false);
    const outcome = learnFromDrill(career, opening.id, firstTry, set.length);
    app.save();
    if (outcome.passed) sfx.trophy(); else sfx.lose();
    const choice = await app.overlay((close) => h('div.pp-panel.pp-modal', { style: { textAlign: 'center' } },
      h('h2.pp-h2', { text: outcome.passed ? 'Drill passed!' : 'Keep practising' }),
      h('p', { style: { fontSize: '28px' } }, h('b', { text: `${firstTry}/${set.length}` }), ' first try'),
      h('p', { text: outcome.passed
        ? (outcome.gained ? `${opening.name} +${outcome.gained}% → ${career.openings[opening.id]}%` : `${opening.name} is at ${career.openings[opening.id]}%: past this, only the club trophy teaches more.`)
        : `Pass with ${Math.ceil(MASTERY.drillPassShare * set.length)} or more first-try answers.` }),
      h('div.pp-row', { style: { justifyContent: 'center' } },
        button('Another set', () => close('again'), { cls: 'pp-btn--gold' }),
        button('Leave', () => close('leave'), { cls: 'pp-btn--small' }))), { dismissable: false });
    if (choice === 'again') {
      set = pickDrillSet(opening.id);
      results.length = 0;
      firstTry = 0;
      load(0);
      return;
    }
    app.go('scene', { sceneId: params.returnScene });
  }

  requestAnimationFrame(() => load(0));
  return {
    el,
    drill: { get set() { return set; }, get index() { return index; }, attempt }, // for tools/cdp_practice.py
    destroy() { board.destroy(); }
  };
}

export default drillScreen;
