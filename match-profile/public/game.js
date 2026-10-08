/**
 * game.js - starting a game against Stockfish, and playing it.
 *
 *   newGameCard(deps)          the home screen's "Play" card (or "Resume")
 *   gameScreen(deps, id)       { nodes, destroy } for #/game/<id>
 *
 * deps = { h, api, go } from app.js. The server owns the game: this screen
 * shows the position it sends, offers the legal moves it lists, and posts
 * the move the player makes. The board (./board/) is Pawn & Passport's.
 */

import { ChessBoard2DRenderer } from './board/board2d.js';
import { HIGHLIGHT } from './board/boardRenderer.js';
import { ChessInputController } from './board/inputController.js';
import { pieceUrl } from './board/pieceSets.js';
import { boardFromFen } from './board/fen.js';

const TIME_LABELS = { untimed: 'No clock', '10+0': '10 min', '5+3': '5 min + 3 s', '15+10': '15 min + 10 s' };
const TERMINATION = {
  checkmate: 'checkmate', stalemate: 'stalemate', insufficient_material: 'insufficient material',
  threefold_repetition: 'threefold repetition', fifty_moves: 'the fifty-move rule', resignation: 'resignation',
  time: 'time', abandoned: 'no move for 24 hours'
};

/* The last choices, remembered on this device only. */
function remembered() {
  try { return JSON.parse(localStorage.getItem('cmp:new-game')) || {}; } catch { return {}; }
}
function remember(choice) {
  try { localStorage.setItem('cmp:new-game', JSON.stringify(choice)); } catch { /* private mode */ }
}

/* ----------------------------------------------------------- new game -- */

export async function newGameCard({ h, api, go }) {
  const [{ game }, levels] = await Promise.all([api('GET', '/api/games/current'), api('GET', '/api/bot-levels')]);
  if (game) {
    return h('div', { class: 'card' }, h('h2', {}, 'Game in progress'),
      h('p', {}, `You are ${game.colour} against Stockfish, level ${game.level}. ${game.moves.length ? `${Math.ceil(game.moves.length / 2)} moves played.` : 'No moves yet.'}`),
      h('a', { href: `#/game/${game.id}`, class: 'button primary' }, 'Resume game'));
  }
  const last = { level: 3, colour: 'white', timeControl: 'untimed', ...remembered() };
  const choice = { ...last };
  const group = (name, options, legend) => {
    const box = h('fieldset', { class: 'choices' }, h('legend', {}, legend));
    for (const [value, label] of options) {
      const id = `${name}-${value}`;
      const radio = h('input', { type: 'radio', name, id, value: String(value), checked: String(choice[name]) === String(value) });
      radio.addEventListener('change', () => { choice[name] = name === 'level' ? Number(value) : value; });
      box.append(radio, h('label', { for: id }, label));
    }
    return box;
  };
  const error = h('p', { class: 'error', role: 'alert' });
  const startButton = h('button', { type: 'submit', class: 'primary' }, 'Play');
  const form = h('form', { class: 'newgame' },
    group('level', levels.levels.map((l) => [l.level, String(l.level)]), 'Stockfish level (1 is gentlest)'),
    group('colour', [['white', 'White'], ['random', 'Random'], ['black', 'Black']], 'You play'),
    group('timeControl', levels.timeControls.map((t) => [t, TIME_LABELS[t] || t]), 'Clock'),
    error, startButton);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    startButton.disabled = true;
    try {
      remember(choice);
      const g = await api('POST', '/api/games', choice);
      go(`#/game/${g.id}`);
    } catch (err) {
      if (err.code === 'game_in_progress' && err.data?.gameId) { go(`#/game/${err.data.gameId}`); return; }
      error.textContent = err.message;
      startButton.disabled = false;
    }
  });
  return h('div', { class: 'card' }, h('h2', {}, 'Play Stockfish'), form);
}

/* ------------------------------------------------------------- the game -- */

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

function outcome(g) {
  if (g.result === '*') return { title: 'Game abandoned', line: 'No move for 24 hours. It does not count as a loss.' };
  const youWon = (g.result === '1-0' && g.colour === 'white') || (g.result === '0-1' && g.colour === 'black');
  const how = TERMINATION[g.termination] || g.termination;
  if (g.result === '1/2-1/2') return { title: 'Draw', line: `By ${how}.` };
  if (g.termination === 'resignation') return { title: 'Stockfish wins', line: 'You resigned.' };
  return youWon ? { title: 'You won', line: `By ${how}.` } : { title: 'Stockfish wins', line: `By ${how}.` };
}

export async function gameScreen({ h, api, go }, id) {
  let state = await api('GET', `/api/games/${id}`);
  let busy = false;
  let received = performance.now();
  let flagCheck = false;
  let problem = '';         // the last request's error, shown until the next move

  const boardHost = h('div', { class: 'board' });
  const renderer = new ChessBoard2DRenderer(boardHost, { orientation: state.colour === 'black' ? 'b' : 'w', coordinates: true, animationMs: 220 });
  const input = new ChessInputController({
    renderer,
    getFen: () => state.fen,
    getMovableColour: () => (state.playerToMove && !busy ? (state.colour === 'white' ? 'w' : 'b') : null),
    getDestinations: (square) => state.legal.filter((m) => m.uci.startsWith(square))
      .reduce((out, m) => (out.some((d) => d.to === m.uci.slice(2, 4)) ? out : [...out, { to: m.uci.slice(2, 4), capture: m.capture, promotion: m.uci.length === 5 }]), []),
    askPromotion: () => pickPromotion(),
    onMove: ({ from, to, promotion }) => play(`${from}${to}${promotion || ''}`)
  });

  const oppClock = h('span', { class: 'clock' });
  const myClock = h('span', { class: 'clock' });
  const status = h('p', { class: 'status', role: 'status' });
  const moveList = h('ol', { class: 'movelist' });
  const actions = h('div', { class: 'row game-actions' });
  const resultCard = h('div', { class: 'card result', hidden: true });

  // One grid: a column on a phone held upright, board beside the rest on a wide screen (app.css).
  const nodes = [h('div', { class: 'game' },
    h('div', { class: 'player-bar opp' }, h('span', {}, h('b', {}, 'Stockfish'), ` · Level ${state.level}`), oppClock),
    h('div', { class: 'game-board' }, boardHost),
    h('div', { class: 'player-bar me' }, h('span', {}, h('b', {}, 'You'), ` · ${state.colour}`), myClock),
    h('div', { class: 'game-info' }, status, resultCard, actions, h('details', { class: 'moves' }, h('summary', {}, 'Moves'), moveList)))];

  function pickPromotion() {
    return new Promise((resolve) => {
      const colour = state.colour === 'white' ? 'w' : 'b';
      const dialog = h('dialog', { class: 'promote' },
        h('p', {}, 'Promote to'),
        h('div', { class: 'row' }, [['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']].map(([p, label]) =>
          h('button', { type: 'button', 'aria-label': label, onclick: () => { dialog.close(); dialog.remove(); resolve(p); } },
            h('img', { src: pieceUrl('chessnut', colour, p), alt: '' })))),
        h('button', { type: 'button', class: 'cancel', onclick: () => { dialog.close(); dialog.remove(); resolve(null); } }, 'Cancel'));
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  function kingSquare(fen, colour) {
    for (const row of boardFromFen(fen)) for (const c of row) if (c && c.type === 'k' && c.color === colour) return c.square;
    return null;
  }

  function paintBoard(move = null) {
    renderer.render(state.fen, { move });
    renderer.clearHighlights(HIGHLIGHT.LAST_MOVE);
    renderer.clearHighlights(HIGHLIGHT.CHECK);
    const last = state.moves.at(-1);
    if (last) renderer.highlightMove({ from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) }, HIGHLIGHT.LAST_MOVE);
    if (state.check) {
      const k = kingSquare(state.fen, state.toMove === 'white' ? 'w' : 'b');
      if (k) renderer.highlightSquare(k, HIGHLIGHT.CHECK);
    }
    input.setEnabled(state.playerToMove && !busy);
  }

  function paintMoves() {
    moveList.replaceChildren();
    for (let i = 0; i < state.moves.length; i += 2) {
      moveList.append(h('li', {}, h('span', {}, state.moves[i].san), state.moves[i + 1] ? h('span', {}, state.moves[i + 1].san) : null));
    }
  }

  function paintStatus() {
    actions.replaceChildren();
    if (state.status === 'ended') {
      const o = outcome(state);
      status.textContent = '';
      resultCard.hidden = false;
      resultCard.replaceChildren(h('h2', {}, o.title), h('p', {}, o.line),
        h('div', { class: 'row' }, h('a', { href: '#/', class: 'button primary' }, 'New game')));
      return;
    }
    resultCard.hidden = true;
    if (problem) {
      status.textContent = problem;
    } else if (state.engineError && state.botToMove) {
      status.textContent = 'Stockfish did not answer.';
      actions.append(h('button', { type: 'button', class: 'primary', onclick: () => run(() => api('POST', `/api/games/${id}/continue`, {})) }, 'Ask again'));
    } else {
      status.textContent = busy || state.botToMove ? 'Stockfish is thinking…' : (state.check ? 'Check. Your move.' : 'Your move.');
    }
    actions.append(h('button', { type: 'button', class: 'danger', onclick: resignClicked }, 'Resign'));
  }

  function paintClocks() {
    if (!state.clocks) { oppClock.textContent = ''; myClock.textContent = ''; return; }
    const spent = performance.now() - received;
    const left = (side) => state.clocks[side] - (state.clocks.running === side && state.status === 'active' ? spent : 0);
    const mine = state.colour;
    const theirs = mine === 'white' ? 'black' : 'white';
    myClock.textContent = fmt(left(mine));
    oppClock.textContent = fmt(left(theirs));
    myClock.classList.toggle('running', state.clocks.running === mine && state.status === 'active');
    oppClock.classList.toggle('running', state.clocks.running === theirs && state.status === 'active');
    myClock.classList.toggle('low', left(mine) < 20000);
    // Your flag fell: ask the server, which decides.
    if (state.status === 'active' && left(mine) <= 0 && !flagCheck && !busy) {
      flagCheck = true;
      run(() => api('GET', `/api/games/${id}`)).finally(() => { flagCheck = false; });
    }
  }

  function apply(next, { animatePly = null } = {}) {
    const before = state.moves.length;
    state = next;
    received = performance.now();
    // Animate only the moves that are new on the board.
    const fresh = state.moves.slice(before);
    const move = fresh.length ? fresh.at(-1) : null;
    paintBoard(move && animatePly !== false ? { from: move.uci.slice(0, 2), to: move.uci.slice(2, 4) } : null);
    paintMoves();
    paintStatus();
    paintClocks();
  }

  async function run(request) {
    problem = '';
    busy = true;
    paintStatus();
    input.setEnabled(false);
    try {
      apply(await request());
    } catch (err) {
      if (err.data?.state) apply(err.data.state);
      else problem = err.message;
    } finally {
      busy = false;
      paintStatus();
      input.setEnabled(state.playerToMove);
    }
  }

  async function play(uci) {
    problem = '';
    busy = true;
    input.setEnabled(false);
    // Show your move straight away; the reply follows when the server has it.
    await renderer.animateMove({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    status.textContent = 'Stockfish is thinking…';
    try {
      const next = await api('POST', `/api/games/${id}/moves`, { uci, ply: state.moves.length + 1 });
      const mine = next.moves[state.moves.length];
      if (mine) { renderer.render(mine.fen); }
      await new Promise((r) => setTimeout(r, 120));
      apply(next);
    } catch (err) {
      if (err.data?.state) apply(err.data.state, { animatePly: false });
      else { paintBoard(); problem = err.message; }
    } finally {
      busy = false;
      input.setEnabled(state.playerToMove);
      paintStatus();
    }
  }

  async function resignClicked() {
    if (!window.confirm('Resign this game?')) return;
    await run(() => api('POST', `/api/games/${id}/resign`, {}));
  }

  apply(state, { animatePly: false });
  if (state.botToMove && !state.engineError) run(() => api('POST', `/api/games/${id}/continue`, {}));
  const ticker = setInterval(paintClocks, 250);

  return {
    nodes,
    destroy() {
      clearInterval(ticker);
      input.destroy?.();
      renderer.destroy?.();
    }
  };
}

export default { newGameCard, gameScreen };
