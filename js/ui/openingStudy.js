/**
 * openingStudy.js - step through an opening's lines on a board.
 *
 *   review    from the journal: only as deep as the player KNOWS the opening
 *             (ClubBook.knownPlies at their mastery); the rest stays hidden
 *   tutorial  from a club's practice room: every line in full, with the notes,
 *             starting with the opening's introduction
 *
 * Lines, names and notes come from js/data/openings.js. The board is the same
 * ornate board as matches, with input switched off; the next move is drawn as
 * an arrow so the player sees where a piece goes before it moves.
 */

import { h, button } from './dom.js';
import { sfx } from './audio.js';
import { createBoard } from './board.js';
import { createRules } from '../chess/core/rules.js';
import { HIGHLIGHT, ARROW } from '../chess/render/boardRenderer.js';
import { openingById } from '../data/openings.js';
import { fullBook } from '../core/openingBook.js';
import { masteryState } from '../core/career.js';
import { GAMES, OPENING_RESEARCH } from '../data/openingStats.js';

/** Replays a SAN line once: fens[i] is the position after i plies, moves[i] the i-th move. */
export function replayLine(line) {
  const rules = createRules();
  const fens = [rules.fen()];
  const moves = [];
  for (const san of line) {
    let move = null;
    try { move = rules.move(san); } catch { move = null; }
    if (!move) break;
    moves.push({ san: move.san, from: move.from, to: move.to, uci: move.from + move.to + (move.promotion || '') });
    fens.push(rules.fen());
  }
  return { fens, moves };
}

/**
 * @param {Object} app
 * @param {string} openingId
 * @param {{mode?: 'review'|'tutorial'}} [options]
 * @returns {Promise<{finishedMain: boolean, linesCompleted: number}>}
 */
export function openOpeningStudy(app, openingId, { mode = 'review' } = {}) {
  const opening = openingById(openingId);
  const career = app.career;
  const mastery = career?.openings[openingId] ?? 0;
  const tutorial = mode === 'tutorial';
  const known = tutorial ? Infinity : fullBook.knownPlies(openingId, mastery);

  let lineIndex = 0;
  let ply = 0;
  let replay = replayLine(opening.lines[0]);
  let autoplay = null;
  let finishedMain = false;
  const completed = new Set();
  let board = null;
  let keyHandler = null;

  const limitFor = (i) => Math.min(opening.lines[i].length, known);

  return app.overlay((close) => {
    board = createBoard(app, {
      orientation: opening.side,
      getFen: () => replay.fens[ply],
      getDestinations: () => [],
      getMovableColour: () => null,
      onMove: () => {}
    });
    board.input.setEnabled(false);
    const { renderer } = board;

    const title = h('div.pp-study__title', null,
      h('h2.pp-h2', { text: tutorial ? `Tutorial: ${opening.name}` : opening.name }),
      h('div.pp-small', null, h('b', { text: opening.side === 'w' ? '♔ White' : '♚ Black' }), ` · ${opening.eco} · `,
        tutorial ? 'every line, with notes' : `${mastery}% ${masteryState(mastery).label}`));
    const note = h('div.pp-study__note');
    const moveList = h('div.pp-study__moves');
    const lineList = h('div.pp-study__lines');
    const depthNote = h('div.pp-small.pp-muted');
    const counter = h('span.pp-study__counter');
    const popularity = h('div.pp-small.pp-muted.pp-study__popularity');

    const nav = (label, fn, aria) => h('button.pp-btn.pp-btn--small', { type: 'button', 'aria-label': aria, onclick: () => { stopAuto(); fn(); } }, label);
    const playBtn = h('button.pp-btn.pp-btn--small.pp-btn--gold', { type: 'button', onclick: () => toggleAuto() }, '▶ Play');

    function selectLine(i) {
      lineIndex = i;
      replay = replayLine(opening.lines[i]);
      ply = 0;
      sfx.click();
      paint(true);
    }

    function go(target) {
      const limit = limitFor(lineIndex);
      const next = Math.max(0, Math.min(limit, target));
      if (next === ply) return;
      const forward = next === ply + 1;
      ply = next;
      if (forward) sfx.move();
      if (ply >= opening.lines[lineIndex].length) {
        completed.add(lineIndex);
        if (lineIndex === 0) finishedMain = true;
      }
      paint(false, forward);
    }

    function toggleAuto() {
      if (autoplay) { stopAuto(); return; }
      if (ply >= limitFor(lineIndex)) ply = 0;
      playBtn.textContent = '⏸ Pause';
      autoplay = setInterval(() => {
        if (ply >= limitFor(lineIndex)) { stopAuto(); return; }
        go(ply + 1);
      }, 1500);
    }
    function stopAuto() {
      clearInterval(autoplay);
      autoplay = null;
      playBtn.textContent = '▶ Play';
    }

    function paint(fresh = false, animate = false) {
      const fen = replay.fens[ply];
      const last = ply > 0 ? replay.moves[ply - 1] : null;
      renderer.render(fen, { move: animate && last ? { from: last.from, to: last.to } : null });
      renderer.clearHighlights(HIGHLIGHT.LAST_MOVE);
      if (last) renderer.highlightMove(last, HIGHLIGHT.LAST_MOVE);
      renderer.clearArrows();
      const limit = limitFor(lineIndex);
      const upcoming = ply < limit ? replay.moves[ply] : null;
      renderer.clearHighlights(HIGHLIGHT.BOOK);
      if (upcoming) {
        renderer.drawArrow({ from: upcoming.from, to: upcoming.to }, ARROW.BOOK);
        renderer.highlightSquare(upcoming.to, HIGHLIGHT.BOOK);
      }

      // Moves: numbered pairs; known ones are buttons, unknown ones a locked dot.
      const cells = [];
      replay.moves.forEach((m, i) => {
        if (i % 2 === 0) cells.push(h('span.num', { text: `${i / 2 + 1}.` }));
        if (i >= limit) { cells.push(h('span.pp-study__locked', { text: '···', title: 'Not learned yet' })); return; }
        cells.push(h('button.pp-study__move', {
          type: 'button', class: i === ply - 1 ? 'is-current' : '',
          onclick: () => { stopAuto(); go(i + 1); }
        }, m.san));
      });
      if (replay.moves.length % 2 === 1) cells.push(h('span'));
      moveList.replaceChildren(...cells);
      moveList.querySelector('.is-current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

      const notes = opening.lineNotes?.[lineIndex] || {};
      let text = ply === 0
        ? (tutorial && lineIndex === 0 ? (opening.tutorial || [opening.description]).join(' ') : (opening.lineIntro?.[lineIndex] || `${opening.lineNames[lineIndex]}. ${opening.idea}`))
        : (notes[ply - 1] || '');
      if (!text && ply > 0) text = `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '...'} ${last.san}`;
      if (ply >= limit && limit < opening.lines[lineIndex].length) {
        text = `${text ? `${text} ` : ''}That is as far as you know this line. Play the opening, do the club's drills, or win its trophy to learn deeper.`;
      } else if (ply >= opening.lines[lineIndex].length) {
        text = `${text ? `${text} ` : ''}End of the line.`;
      }
      note.textContent = text;
      counter.textContent = `${ply}/${opening.lines[lineIndex].length}`;
      // How often strong players really reach this point (tools/opening-research).
      const reached = ply > 0 ? GAMES[openingId]?.[lineIndex]?.[ply - 1] : OPENING_RESEARCH.roots?.[openingId];
      popularity.textContent = typeof reached === 'number'
        ? `Reached in ${reached.toLocaleString('en')} games between 2200+ players (${OPENING_RESEARCH.months[0]} to ${OPENING_RESEARCH.months[1]}).`
        : 'Rare in master games from here on: a line worth knowing, not a common one.';
      depthNote.textContent = tutorial ? '' : Number.isFinite(known)
        ? `You know the first ${known} moves (plies) of each line at ${mastery}%.`
        : 'Mastered: every line is open.';

      if (fresh) {
        lineList.replaceChildren(...opening.lines.map((line, i) => h('button.pp-study__line', {
          type: 'button', class: `${i === lineIndex ? 'is-active' : ''} ${completed.has(i) ? 'is-done' : ''}`,
          onclick: () => { stopAuto(); selectLine(i); }
        }, h('b', { text: opening.lineNames[i] || `Line ${i + 1}` }),
          h('span.pp-muted', { text: ` ${line.slice(0, 6).join(' ')}${line.length > 6 ? ' ...' : ''}` }))));
      } else {
        [...lineList.children].forEach((b, i) => { b.classList.toggle('is-active', i === lineIndex); b.classList.toggle('is-done', completed.has(i)); });
      }
    }

    keyHandler = (e) => {
      if (e.key === 'ArrowRight') { stopAuto(); go(ply + 1); }
      if (e.key === 'ArrowLeft') { stopAuto(); go(ply - 1); }
    };
    document.addEventListener('keydown', keyHandler);

    const finish = () => {
      stopAuto();
      document.removeEventListener('keydown', keyHandler);
      board.destroy();
      close({ finishedMain, linesCompleted: completed.size });
    };

    const panel = h('div.pp-panel.pp-modal.pp-study', null,
      title,
      h('div.pp-study__body', null,
        h('div.pp-study__board', null, board.frame),
        h('div.pp-study__side', null,
          note,
          h('div.pp-row.pp-study__nav', null,
            nav('⏮', () => go(0), 'Start'), nav('◀', () => go(ply - 1), 'Back'), counter,
            nav('▶', () => go(ply + 1), 'Forward'), nav('⏭', () => go(limitFor(lineIndex)), 'End'), playBtn),
          popularity,
          moveList,
          depthNote,
          h('h3.pp-h3', { text: 'Lines' }),
          lineList)),
      h('div.pp-row', { style: { justifyContent: 'flex-end' } }, button(tutorial ? 'Done' : 'Close', finish, { cls: 'pp-btn--small' })));
    requestAnimationFrame(() => paint(true));
    return panel;
  }, { dismissable: false }).then((result) => result || { finishedMain, linesCompleted: completed.size });
}

export default openOpeningStudy;
