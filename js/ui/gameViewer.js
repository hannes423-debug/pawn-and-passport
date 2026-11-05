/**
 * gameViewer.js - step through a finished game from Match History.
 *
 * Two kinds of judgement, never mixed:
 *   LIVE FEEDBACK  the grade the player saw during the game (EPIC ... BLUNDER),
 *                  stored with the game (js/core/history.js). Marked on the
 *                  player's moves and named "live feedback" on screen.
 *   ENGINE CHECK   on request only: Stockfish run now on the position shown,
 *                  printed with the engine's name and depth, from White's
 *                  point of view. Nothing is shown when the engine is not
 *                  available - no estimate is invented instead.
 *
 * Board PNG and PGN copy out the position and the game. The layout is the
 * opening study's (css .pp-study), with the board's input switched off.
 */

import { h, button } from './dom.js';
import { pixelIcon } from './icons.js';
import { sfx } from './audio.js';
import { createBoard } from './board.js';
import { pushHandler } from './controls.js';
import { createRules } from '../chess/core/rules.js';
import { HIGHLIGHT } from '../chess/render/boardRenderer.js';
import { hex } from '../chess/render/feedback.js';
import { GRADE_META } from '../core/grading.js';
import { entryPgn, pgnEvent, START_FEN } from '../core/history.js';
import { clubById } from '../data/clubs.js';
import { equippedStyle } from '../core/shop.js';
import { engineService } from '../chess/engine/engineService.js';
import { GAME } from '../data/config.js';

const GAME_TITLE = GAME.title;
import { copyText } from './clipboard.js';
import { openExportSheet, gameGif, gamePicture, exportName } from './gameExport.js';

/** The moves of an entry replayed: fens[i] after i plies. Stops at the first unreadable move. */
export function replayEntry(entry) {
  const rules = createRules(entry.startFen || START_FEN);
  const fens = [rules.fen()];
  const moves = [];
  for (const san of entry.moves ? entry.moves.split(' ') : []) {
    let move = null;
    try { move = rules.move(san); } catch { move = null; }
    if (!move) break;
    moves.push({ san: move.san, from: move.from, to: move.to, color: move.color });
    fens.push(rules.fen());
  }
  return { fens, moves };
}

const ERRORS = new Set(['INACCURACY', 'MISTAKE', 'BLUNDER', 'MISS']);
const KIND = { friendly: 'Friendly', challenge: 'Challenge', tournament: 'Tournament', star: 'Final', finale: 'Grand Finale' };
export const resultWord = (score) => (score === 1 ? 'Won' : score === 0.5 ? 'Drawn' : 'Lost');
export const kindLabel = (kind) => KIND[kind] || 'Game';

/** Score from White's point of view, as a short string. */
function whiteScore(score, fen) {
  const flip = fen.split(' ')[1] === 'b' ? -1 : 1;
  if (typeof score?.mate === 'number') {
    const m = score.mate * flip;
    return m === 0 ? 'mate on the board' : `mate in ${Math.abs(m)} for ${m > 0 ? 'White' : 'Black'}`;
  }
  if (typeof score?.cp === 'number') {
    const cp = score.cp * flip;
    return `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)} (White's view)`;
  }
  return 'no score';
}

/**
 * @param {Object} app
 * @param {Object} entry   one js/core/history.js entry
 */
export function openGameViewer(app, entry) {
  const replay = replayEntry(entry);
  const total = replay.moves.length;
  const style = equippedStyle(app.career);
  let ply = total;
  let board = null;
  let releaseKeys = null;
  let engineToken = 0;

  return app.overlay((close) => {
    board = createBoard(app, {
      orientation: entry.colour,
      getFen: () => replay.fens[ply],
      getDestinations: () => [],
      getMovableColour: () => null,
      onMove: () => {}
    });
    board.input.setEnabled(false);
    const { renderer } = board;

    const date = new Date(entry.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const title = h('div.pp-study__title', null,
      h('h2.pp-h2', { text: `${resultWord(entry.score)} against ${entry.opponent.name}` }),
      h('div.pp-small', { text: [kindLabel(entry.kind), entry.opponent.elo ? `${entry.opponent.elo} Elo` : null, entry.colour === 'w' ? 'you had White' : 'you had Black', date, entry.headline].filter(Boolean).join(' · ') }));
    const note = h('div.pp-study__note');
    const engineNote = h('div.pp-small.pp-muted', { 'aria-live': 'polite' });
    const moveList = h('div.pp-study__moves');
    const counter = h('span.pp-study__counter');
    const summary = h('div.pp-small.pp-muted', {
      text: [
        entry.accuracy !== null ? `Accuracy ${entry.accuracy}% (live feedback)` : null,
        entry.matchScore ? `Score ${entry.matchScore.letter} ${entry.matchScore.total.toLocaleString('en')}` : null,
        entry.eloDelta !== null && entry.eloDelta !== undefined ? `Elo ${entry.eloDelta >= 0 ? '+' : ''}${entry.eloDelta}` : (entry.rated ? null : 'unrated'),
        entry.hintsUsed ? `${entry.hintsUsed} hint${entry.hintsUsed > 1 ? 's' : ''}` : null
      ].filter(Boolean).join(' · ')
    });

    const nav = (label, fn, aria) => h('button.pp-btn.pp-btn--small', { type: 'button', 'aria-label': aria, onclick: () => fn() }, label);

    function go(target) {
      const next = Math.max(0, Math.min(total, target));
      if (next === ply) return;
      const forward = next === ply + 1;
      ply = next;
      if (forward) sfx.move();
      engineToken += 1;
      engineNote.textContent = '';
      paint(forward);
    }

    /* The game's turning points by the live feedback: the player's next graded error. */
    function nextError() {
      for (let i = ply; i < total; i += 1) if (ERRORS.has(entry.liveGrades[i])) { go(i + 1); return; }
      for (let i = 0; i < ply - 1; i += 1) if (ERRORS.has(entry.liveGrades[i])) { go(i + 1); return; }
      app.toast('No inaccuracies, mistakes or blunders in the live feedback.');
    }

    async function engineCheck() {
      const token = (engineToken += 1);
      const fen = replay.fens[ply];
      engineNote.textContent = 'Stockfish is looking at this position...';
      try {
        const result = await engineService.evaluate(fen, { depth: 16, movetime: 2500, useCache: true });
        if (token !== engineToken) return;
        if (engineService.available === false || result.depth == null) { engineNote.textContent = `Engine not available: ${engineService.statusText}`; return; }
        const best = result.bestMoveSan ? ` · its move: ${result.bestMoveSan}` : '';
        engineNote.textContent = `Engine check (${engineService.engineName}, depth ${result.depth}): ${whiteScore(result, fen)}${best}`;
      } catch (error) {
        if (token === engineToken) engineNote.textContent = `Engine not available: ${engineService.statusText || error.message}`;
      }
    }

    function paint(animate = false) {
      const fen = replay.fens[ply];
      const last = ply > 0 ? replay.moves[ply - 1] : null;
      renderer.render(fen, { move: animate && last ? { from: last.from, to: last.to } : null });
      renderer.clearHighlights(HIGHLIGHT.LAST_MOVE);
      if (last) renderer.highlightMove(last, HIGHLIGHT.LAST_MOVE);
      const cells = [];
      const blackFirst = replay.fens[0].split(' ')[1] === 'b';
      const firstNo = Number(replay.fens[0].split(' ')[5]) || 1;
      if (blackFirst && total) cells.push(h('span.num', { text: `${firstNo}.` }), h('span', { text: '...' }));
      replay.moves.forEach((m, i) => {
        const p = i + (blackFirst ? 1 : 0);
        if (p % 2 === 0) cells.push(h('span.num', { text: `${firstNo + p / 2}.` }));
        const grade = entry.liveGrades[i];
        const meta = grade ? GRADE_META[grade] : null;
        cells.push(h('button.pp-study__move', {
          type: 'button', class: i === ply - 1 ? 'is-current' : '',
          title: meta ? `Live feedback: ${meta.label}` : '',
          onclick: () => go(i + 1)
        }, m.san, meta ? h('sup', { text: ` ${meta.glyph}`, style: { color: hex(meta.tier) } }) : null));
      });
      moveList.replaceChildren(...cells);
      moveList.querySelector('.is-current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      counter.textContent = `${ply}/${total}`;
      if (!last) note.textContent = 'The starting position.';
      else {
        const grade = entry.liveGrades[ply - 1];
        const who = last.color === entry.colour ? 'You' : entry.opponent.name.split(' ')[0];
        const moveNo = `${Math.ceil(((blackFirst ? 1 : 0) + ply) / 2) + firstNo - 1}${last.color === 'w' ? '.' : '...'} ${last.san}`;
        note.textContent = `${moveNo} (${who})${grade ? ` · live feedback: ${GRADE_META[grade]?.label || grade}` : ''}${ply === total ? ` · ${entry.headline}` : ''}`;
      }
    }

    releaseKeys = pushHandler({
      name: 'game-viewer',
      modal: true,
      scope: () => panel,
      onAction: (a) => {
        if (a.type !== 'left' && a.type !== 'right') return false;
        go(ply + (a.type === 'right' ? 1 : -1));
        return true;
      }
    });

    const finish = () => { engineToken += 1; releaseKeys?.(); board.destroy(); close(); };
    const playerName = app.career?.name || 'Player';
    const shareText = `${resultWord(entry.score)} against ${entry.opponent.name} in ${GAME_TITLE}`;
    const picture = () => {
      sfx.click();
      const at = ply;
      openExportSheet(app, {
        title: at === total ? 'The final position' : `After move ${Math.ceil(at / 2)}`, kind: 'png',
        filename: exportName(entry, 'png', at === total ? '' : `-move-${at}`), shareText,
        make: () => gamePicture({ entry, style, playerName, ply: at, coordinates: app.settings.coordinates })
      });
    };
    const animation = () => {
      sfx.click();
      openExportSheet(app, {
        title: 'The game, move by move', kind: 'gif', filename: exportName(entry, 'gif'), shareText,
        make: (onProgress, cancelled) => gameGif({ entry, style, playerName, coordinates: app.settings.coordinates, onProgress, cancelled })
      });
    };
    const copyPgn = () => {
      sfx.click();
      const pgn = entryPgn(entry, { playerName, ...pgnEvent(entry.kind, clubById(entry.clubId), entry.round ?? null) });
      return copyText(app, pgn, { done: 'PGN copied: paste it into any chess site or program.', title: 'This game as PGN' });
    };

    const panel = h('div.pp-panel.pp-modal.pp-study.pp-gameview', null,
      title,
      h('div.pp-study__body', null,
        h('div.pp-study__board', null, board.frame),
        h('div.pp-study__side', null,
          note,
          h('div.pp-row.pp-study__nav', null,
            nav('|<', () => go(0), 'Start'), nav(pixelIcon('back', { size: 'sm' }), () => go(ply - 1), 'Back'), counter,
            nav(pixelIcon('play', { size: 'sm' }), () => go(ply + 1), 'Forward'), nav('>|', () => go(total), 'End')),
          summary,
          moveList,
          h('p.pp-small.pp-muted', { text: 'Marks on your moves are the live feedback you saw during the game: a quick search, not a full engine review.' }),
          h('div.pp-row', { style: { flexWrap: 'wrap', gap: '6px' } },
            button('Next mistake', nextError, { cls: 'pp-btn--small' }),
            button('Engine check', engineCheck, { cls: 'pp-btn--small' }),
            button('Copy PGN', copyPgn, { cls: 'pp-btn--small' }),
            button('Picture', picture, { cls: 'pp-btn--small', title: 'This position as a picture: share or save it' }),
            button('Animated GIF', animation, { cls: 'pp-btn--small', title: 'The whole game as an animation: watch, share or save it' })),
          engineNote)),
      h('div.pp-row', { style: { justifyContent: 'flex-end' } }, button('Close', finish, { cls: 'pp-btn--small', back: true })));
    requestAnimationFrame(() => paint(false));
    return panel;
  }, { dismissable: false });
}

export default openGameViewer;
