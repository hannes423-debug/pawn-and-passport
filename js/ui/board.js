/**
 * board.js - the ornate pixel board, shared by matches and puzzles.
 *
 * Wraps the World Tour's ChessBoard2DRenderer and ChessInputController inside
 * the board art, and adds the FX layer that move-grade effects draw into.
 *
 * Keys and pads (js/ui/controls.js) drive a cursor on it: directions step
 * the cursor, accept picks a piece up and accept again puts it on the square
 * (the same press-and-release a mouse click is), and Back first drops a
 * piece in hand, then leaves the board for the buttons beside it. Back from
 * those buttons returns to the board. Which of the two has the controls is
 * simply where focus is, so a mouse click on either hands them over too.
 *
 * `onCursor(square)` hears every cursor step (the match shows its opening
 * notes for the square under it, as it does for the mouse).
 *
 * `isLive()` says whether the board is in play at all. By default that is
 * "the board takes input"; a match keeps it live through the opponent's turn
 * too, so the cursor does not hand the controls to the buttons every time the
 * bot thinks. While it is not live (a lesson's demo, a solved puzzle) the
 * keys and the pad drive the buttons, and Back is the screen's Back.
 */

import { h } from './dom.js';
import { ChessBoard2DRenderer, ANIMATION_SPEEDS } from '../chess/render/board2d.js';
import { ChessInputController } from '../chess/render/inputController.js';
import { createFx } from './fx.js';
import { pushHandler, DIRECTIONS, firstFocus, focusEl, inputDevice } from './controls.js';

export function createBoard(app, { orientation = 'w', getFen, getDestinations, getMovableColour, onMove, onCursor = null, isLive = null }) {
  const host = h('div');
  const fxLayer = h('div.pp-fx');
  const frame = h('div.pp-boardframe', null, host, fxLayer);

  const renderer = new ChessBoard2DRenderer(host, {
    orientation,
    pieceSet: 'pixel',
    coordinates: app.settings.coordinates,
    animationMs: ANIMATION_SPEEDS[app.settings.pieceAnimation] ?? ANIMATION_SPEEDS.smooth
  });

  const input = new ChessInputController({
    renderer, getFen, getDestinations, getMovableColour, onMove,
    askPromotion: ({ to }) => app.overlay((close) => h('div.pp-panel.pp-modal', null,
      h('h2.pp-h2', { text: 'Promote to' }),
      h('div.pp-row', null, [['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']].map(([id, label]) =>
        h('button.pp-btn', { type: 'button', onclick: () => close(id) },
          h('img', { src: `assets/pieces/pixel/${getFen().split(' ')[1]}${id.toUpperCase()}.png`, alt: '', style: { width: '40px' } }), label)))))
  });

  // Publish the square size in px (see the note in css/board.css).
  const ro = new ResizeObserver(() => {
    const size = host.clientWidth / 8;
    if (size > 0) host.style.setProperty('--sq', `${size}px`);
  });
  ro.observe(host);

  const fx = createFx(frame, renderer, app);

  /* --------------------------------------------------- keys and pads -- */
  // The cursor starts on the player's side, where the first move comes from.
  input.placeCursor(orientation === 'b' ? 'e7' : 'e2');
  const live = () => (isLive ? isLive() : renderer.interactive);
  const onBoard = () => {
    const active = document.activeElement;
    return !active || active === document.body || frame.contains(active);
  };
  // The cursor hides while the buttons have the controls (css/board.css).
  const paintZone = () => host.classList.toggle('is-parked', !onBoard() || !live());
  const setEnabled = input.setEnabled.bind(input);
  input.setEnabled = (enabled) => { setEnabled(enabled); paintZone(); return input; };
  const onFocusChange = () => setTimeout(paintZone, 0);
  document.addEventListener('focusin', onFocusChange);
  document.addEventListener('focusout', onFocusChange);

  let taught = false;
  const teach = () => {
    if (taught || !app.career) return;
    taught = true;
    const pad = inputDevice() === 'gamepad';
    app.coach('board-keys', pad
      ? 'Steer the cursor with the stick or the d-pad. A picks a piece up and A again puts it on the square. B puts it back, or goes to the buttons beside the board; B again comes back.'
      : 'Steer the cursor with WASD or the arrow keys. E (or Space) picks a piece up and E again puts it on the square. Esc puts it back, or goes to the buttons beside the board; Esc again comes back.',
    { title: 'Playing without a mouse' });
  };

  const release = pushHandler({
    name: 'board',
    scope: () => frame,
    onAction(a) {
      if (!live()) return false;
      if (!onBoard()) {
        if (a.type !== 'cancel') return false;
        try { host.focus({ preventScroll: true }); } catch { host.focus(); }
        paintZone();
        return true;
      }
      const dir = DIRECTIONS[a.type];
      if (dir) {
        teach();
        if (input.moveCursor(dir[0], dir[1])) onCursor?.(input.cursor);
        return true;
      }
      if (a.type === 'accept') {
        teach();
        input.pressCursor();
        onCursor?.(input.cursor);
        return true;
      }
      if (a.type === 'cancel') {
        if (input.selected) { input.clearSelection(); return true; }
        const target = firstFocus(frame.closest('.pp-screen, .pp-overlay') || document.body);
        if (!target) return false;
        focusEl(target);
        paintZone();
        return true;
      }
      return false;
    }
  });

  return {
    frame, host, renderer, input, fx,
    destroy() {
      release();
      document.removeEventListener('focusin', onFocusChange);
      document.removeEventListener('focusout', onFocusChange);
      ro.disconnect();
      input.destroy();
      renderer.destroy?.();
      fx.destroy();
    }
  };
}

export default createBoard;
