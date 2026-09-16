/**
 * board.js - the ornate pixel board, shared by matches and puzzles.
 *
 * Wraps the World Tour's ChessBoard2DRenderer and ChessInputController (all
 * four input gestures and keyboard play come with them) inside the board art,
 * and adds the FX layer that move-grade effects draw into.
 */

import { h } from './dom.js';
import { ChessBoard2DRenderer, ANIMATION_SPEEDS } from '../chess/render/board2d.js';
import { ChessInputController } from '../chess/render/inputController.js';
import { createFx } from './fx.js';

export function createBoard(app, { orientation = 'w', getFen, getDestinations, getMovableColour, onMove }) {
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

  return {
    frame, host, renderer, input, fx,
    destroy() {
      ro.disconnect();
      input.destroy();
      renderer.destroy?.();
      fx.destroy();
    }
  };
}

export default createBoard;
