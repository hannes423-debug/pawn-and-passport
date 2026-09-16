/**
 * puzzle.js - a casual venue's puzzle mission.
 *
 * Positions and answers come from js/data/puzzles.js, generated and proven by
 * Stockfish (tools/verify-puzzles.mjs). A move is accepted when it is the
 * solution move, or when it mates on the spot. The opponent's replies are
 * played automatically. Finishing the set pays the postcard.
 */

import { h, button, wait } from '../dom.js';
import { sfx } from '../audio.js';
import { portraitUrl } from '../sprites.js';
import { createBoard } from '../board.js';
import { createRules } from '../../chess/core/rules.js';
import { HIGHLIGHT } from '../../chess/render/boardRenderer.js';
import { missionById } from '../../data/missions.js';
import { clubById } from '../../data/clubs.js';
import { PUZZLES } from '../../data/puzzles.js';
import { recordPuzzleSolved, missionProgress } from '../../core/career.js';
import { postcardFlip } from './journal.js';
import { tapWord } from '../touch.js';

export function puzzleScreen(app, params) {
  const career = app.career;
  const mission = missionById(params.missionId);
  const club = clubById(mission.clubId);
  const puzzles = PUZZLES.filter((p) => p.mission === mission.clubId);
  let index = Math.max(0, puzzles.findIndex((p) => !career.puzzlesSolved[p.id]));
  let rules = null;
  let step = 0;
  let locked = false;
  let hintLevel = 0;

  const board = createBoard(app, {
    orientation: puzzles[index].sideToMove,
    getFen: () => rules.fen(),
    getDestinations: (square) => (locked ? [] : rules.moves({ square, verbose: true }).map((m) => ({ to: m.to, capture: !!m.captured, promotion: !!m.promotion }))),
    getMovableColour: () => (locked ? null : puzzles[index].sideToMove),
    onMove: (move) => attempt(move)
  });
  const { renderer } = board;

  const title = h('h2.pp-h2');
  const status = h('p');
  const dots = h('div.pp-dots');
  const hintText = h('p.pp-small.pp-muted');
  const nextBtn = button('Next puzzle', () => load(index + 1), { cls: 'pp-btn--gold', icon: '▶' });
  const panel = h('aside.pp-match__left', null,
    h('div.pp-panel.pp-player.pp-match__opp', null,
      h('img', { alt: '', src: portraitUrl(mission.host.look) }),
      h('div', null, h('div.pp-player__name', { text: mission.host.name }), h('div.pp-small', { text: club.casualLocationName }))),
    h('div.pp-panel.pp-col.pp-match__focus', null,
      h('div.pp-h3', { text: `${mission.title} · ${mission.theme}` }),
      dots, title, status, hintText,
      h('div.pp-row', null,
        button('Hint (free)', () => giveHint(), { cls: 'pp-btn--small pp-btn--blue', icon: '💡' }),
        button('Retry', () => load(index), { cls: 'pp-btn--small' })),
      nextBtn,
      button('Leave', () => app.go('scene', { sceneId: params.returnScene }), { cls: 'pp-btn--small' })));
  const el = h('div.pp-screen.pp-match', null, panel, h('main.pp-match__board', null, board.frame), h('aside.pp-match__right'));

  function paintDots() {
    dots.replaceChildren(...puzzles.map((p, i) => h('span.pp-dot', {
      class: `${career.puzzlesSolved[p.id] ? 'is-done' : ''} ${i === index ? 'is-current' : ''}`, title: p.title
    })));
  }

  function load(i) {
    if (i >= puzzles.length) { finishMission(); return; }
    index = i;
    const p = puzzles[index];
    rules = createRules(p.fen);
    step = 0; locked = false; hintLevel = 0;
    renderer.setOrientation(p.sideToMove);
    renderer.clearArrows(); renderer.clearHighlights(); renderer.clearVerdicts();
    renderer.render(rules.fen());
    board.input.setEnabled(true);
    title.textContent = `${index + 1}. ${p.title}`;
    status.textContent = `${p.sideToMove === 'w' ? 'White' : 'Black'} to move. Find the best line.`;
    hintText.textContent = '';
    nextBtn.hidden = true;
    paintDots();
  }

  async function attempt(move) {
    if (locked) return;
    const p = puzzles[index];
    const expected = p.solution[step];
    const probe = createRules(rules.fen());
    let applied = null;
    try { applied = probe.move({ from: move.from, to: move.to, promotion: move.promotion || undefined }); } catch { applied = null; }
    if (!applied) { sfx.illegal(); return; }
    const uci = applied.from + applied.to + (applied.promotion || '');
    const mates = probe.isCheckmate();
    if (uci !== expected && !mates) {
      sfx.mistake();
      board.fx.chip(move.to, '✗ Not quite', '#ff8f3a');
      board.fx.shake();
      status.textContent = 'Not the move. Look again.';
      return;
    }
    rules.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
    renderer.render(rules.fen(), { move: { from: move.from, to: move.to } });
    renderer.clearHighlights(HIGHLIGHT.HINT);
    renderer.clearHighlights(HIGHLIGHT.LAST_MOVE);
    renderer.highlightMove(applied, HIGHLIGHT.LAST_MOVE);
    step += 1;
    const done = mates || step >= p.solution.length;
    if (!done) {
      sfx.best();
      board.fx.ring(move.to, '#36d6d6');
      status.textContent = 'Good! Keep going.';
      locked = true;
      await wait(550);
      const reply = p.solution[step];
      const r = rules.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply.slice(4) || undefined });
      renderer.render(rules.fen(), { move: { from: r.from, to: r.to } });
      renderer.clearHighlights(HIGHLIGHT.LAST_MOVE);
      renderer.highlightMove(r, HIGHLIGHT.LAST_MOVE);
      sfx.move();
      step += 1;
      locked = false;
      hintLevel = 0;
      return;
    }
    locked = true;
    board.input.setEnabled(false);
    board.fx.burst(move.to, 'brilliant', 40);
    board.fx.word('SOLVED!', '#ffc341', mates ? 'Checkmate' : p.solutionSan.join(' '));
    sfx.brilliant();
    const result = recordPuzzleSolved(career, p.id);
    app.save();
    paintDots();
    status.textContent = result.firstSolve ? `Solved! +${result.xp.xp} XP` : 'Solved again!';
    if (result.postcard) {
      await wait(1300);
      const navigated = await postcardReward(result.postcard, result.allPostcards);
      if (!navigated) finishMission(true);
      return;
    }
    nextBtn.hidden = false;
    nextBtn.querySelector('span:last-child').textContent = index >= puzzles.length - 1 ? 'Finish' : 'Next puzzle';
  }

  function giveHint() {
    const p = puzzles[index];
    hintLevel += 1;
    sfx.hint();
    if (hintLevel === 1) hintText.textContent = p.hint;
    else {
      const from = p.solution[step]?.slice(0, 2);
      if (from) renderer.highlightSquare(from, HIGHLIGHT.HINT);
      hintText.textContent = `${p.hint} The highlighted piece moves.`;
    }
  }

  async function postcardReward(postcard, all) {
    sfx.postcard();
    await app.dialogue({ name: mission.host.name, role: club.casualLocationName, look: mission.host.look, lines: mission.outro });
    await app.overlay((close) => h('div.pp-panel.pp-modal', { style: { textAlign: 'center' } },
      h('h2.pp-h2', { text: 'Postcard collected!' }),
      h('p.pp-small', { text: `${tapWord()[0].toUpperCase()}${tapWord().slice(1)} the card to turn it over.` }),
      postcardFlip(postcard, { collected: true, startFlipped: false }),
      all ? h('p', null, h('b', { text: 'All six postcards! Something strange appears in your journal...' })) : null,
      button(all ? 'Open the journal' : 'Keep it', () => close(), { cls: 'pp-btn--gold' })), { dismissable: false });
    if (!all) return false;
    app.go('journal', { tab: 'beyond', back: { screen: 'scene', params: { sceneId: params.returnScene } } });
    return true;
  }

  function finishMission(justCompleted = false) {
    if (!justCompleted && !missionProgress(career, mission.id).complete) {
      load(Math.max(0, puzzles.findIndex((p) => !career.puzzlesSolved[p.id])));
      return;
    }
    app.go('scene', { sceneId: params.returnScene });
  }

  load(index);
  return { el, destroy() { board.destroy(); } };
}

export default puzzleScreen;
