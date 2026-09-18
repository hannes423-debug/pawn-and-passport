/**
 * boardRenderer.js — the renderer contract.
 *
 * The chess layer must never know whether a board is 2D or 3D. Everything
 * above this line (rules, engine, bots, analysis, hints, career, Ultimate
 * Chess, online) talks to a renderer through these methods and nothing else.
 *
 * A future ChessBoard3DRenderer implements the same nine methods against a
 * Three.js scene, and the swap is one line in matchView.js.
 *
 *   render(position, opts)    draw a whole position (FEN); opts.move slides
 *   highlightSquare(square)   mark one square
 *   highlightMove(move)       mark a from/to pair
 *   drawArrow(move, kind)     an overlay arrow from one square to another
 *   clearArrows(kind)
 *   animateMove(move)         move a piece with a transition
 *   clearHighlights()
 *   setOrientation(colour)
 *   setInteractive(enabled)
 *   onSquareSelected(fn)
 *   destroy()
 */

export const HIGHLIGHT = Object.freeze({
  SELECTED: 'selected',
  LEGAL: 'legal',
  LEGAL_CAPTURE: 'legal-capture',
  LAST_MOVE: 'last-move',
  CHECK: 'check',
  HINT: 'hint',
  THREAT: 'threat',
  BEST: 'best',
  /* Pawn & Passport: the square an arrow POINTS AT carries the same meaning as
     the arrow, and css/board.css gives each one its marker from the UI pack -
     a reticle for a suggestion, a shield for the reply, a sparkle for your own
     preparation, crossed swords for a threat. */
  BOOK: 'book',
  DEFENCE: 'defence'
});

/** Arrow families. Colour and dash come from CSS, not from the caller. */
export const ARROW = Object.freeze({
  HINT: 'hint',           // what the game is suggesting
  THREAT: 'threat',       // what the opponent is threatening
  DEFENCE: 'defence',     // the opponent's best answer to a suggestion
  BEST: 'best',           // the engine's first choice, on the analysis board
  BOOK: 'book',           // the player's own opening preparation, main line
  BOOK_ALT: 'book-alt',   // an alternative the player has also prepared
  CANDIDATE: 'candidate'  // a move that was considered, next to the best one
});

export class ChessBoardRenderer {
  constructor({ orientation = 'w' } = {}) {
    this.orientation = orientation;
    this.interactive = true;
    this._selectListeners = new Set();
  }

  /** @param {string} fen @param {{move?:{from:string,to:string}}} [options] */
  render(/* fen, options */) { throw new Error('render() not implemented'); }
  highlightSquare(/* square, kind */) { throw new Error('highlightSquare() not implemented'); }
  highlightMove(/* {from,to}, kind */) { throw new Error('highlightMove() not implemented'); }
  /**
   * Draw an arrow between two squares. A renderer that cannot draw one is
   * expected to no-op rather than throw — arrows are an aid, never a
   * requirement, and a 3D board may express the same thing differently.
   */
  drawArrow(/* { from, to }, kind */) {}
  clearArrows(/* kind */) {}
  /** The arrow for the move that produced the position. null removes it. */
  showLastMove(/* { from, to } | null */) {}
  /**
   * A move verdict that stays on its square until cleared. `key` identifies it
   * (the ply) so re-marking is a no-op; clearVerdicts(keep) keeps the keys
   * `keep` returns true for.
   */
  markVerdict(/* key, square, kind */) {}
  clearVerdicts(/* keep */) {}
  setVerdictsVisible(/* visible */) {}
  /** @returns {Promise<void>} resolves when the animation has finished */
  animateMove(/* move */) { return Promise.resolve(); }
  clearHighlights(/* kind */) {}
  setOrientation(colour) { this.orientation = colour; }
  flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); return this.orientation; }
  setInteractive(enabled) { this.interactive = !!enabled; }

  /** @param {(square:string, event:Object) => void} fn */
  onSquareSelected(fn) { this._selectListeners.add(fn); return () => this._selectListeners.delete(fn); }
  _emitSelect(square, event = {}) { for (const fn of [...this._selectListeners]) fn(square, event); }

  destroy() { this._selectListeners.clear(); }
}

export default ChessBoardRenderer;
