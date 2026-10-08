/**
 * inputController.js — ChessInputController.
 *
 * Turns raw pointer events from a renderer, and the keyboard/gamepad cursor,
 * into ONE intent: "the player wants to move from X to Y". Game logic never
 * learns whether the player clicked, tapped, dragged, or steered the cursor
 * with keys or a pad and pressed accept.
 *
 * The cursor is driven from outside (js/ui/board.js hands it the actions of
 * js/ui/controls.js): moveCursor() steps it, pressCursor() is a click on its
 * square - so picking a piece up and putting it down again, re-selecting, and
 * promotion all run through exactly the same code as the mouse.
 *
 * Handles the awkward parts once, for every device:
 *   - click/tap-then-click/tap and drag both produce the same move
 *   - tapping a second own piece re-selects instead of failing
 *   - clicking the selected piece again puts it down
 *   - a promotion asks the caller and waits for the answer
 *
 * The subtle part is that ONE CLICK is a pointerdown followed by a pointerup on
 * the same square. The down has to select (so a drag has something to carry)
 * and the up must NOT treat that as "clicked an already-selected square, put it
 * down" — otherwise every click selects and instantly deselects, and only
 * dragging appears to work. `_selectedOnThisPress` is what separates the two.
 */

import { HIGHLIGHT } from './boardRenderer.js';
import { SQUARES, fileIndex, rankIndex, squareAt } from './constants.js';

export class ChessInputController {
  /**
   * @param {Object} deps
   * @param {import('./boardRenderer.js').ChessBoardRenderer} deps.renderer
   * @param {() => string} deps.getFen
   * @param {(square:string) => Array} deps.getDestinations   legal destinations from a square
   * @param {(move:{from,to,promotion}) => any} deps.onMove
   * @param {() => 'w'|'b'|null} deps.getMovableColour        null = nothing is movable
   * @param {(move:{from,to}) => Promise<string>} [deps.askPromotion]
   */
  constructor({ renderer, getFen, getDestinations, onMove, getMovableColour, askPromotion = null }) {
    this.renderer = renderer;
    this.getFen = getFen;
    this.getDestinations = getDestinations;
    this.onMove = onMove;
    this.getMovableColour = getMovableColour;
    this.askPromotion = askPromotion;

    this.selected = null;
    this.destinations = [];
    this.cursor = 'e4';
    this.enabled = true;
    /** Did THIS pointer press create the current selection? */
    this._selectedOnThisPress = false;
    this._unsubscribe = renderer.onSquareSelected((square, event) => this._onSquare(square, event));
    this._paintCursor();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.renderer.setInteractive(this.enabled);
    if (!enabled) this.clearSelection();
    return this;
  }

  clearSelection() {
    this.selected = null;
    this.destinations = [];
    this._selectedOnThisPress = false;
    this.renderer.clearHighlights(HIGHLIGHT.SELECTED);
    this.renderer.clearHighlights(HIGHLIGHT.LEGAL);
    this.renderer.clearHighlights(HIGHLIGHT.LEGAL_CAPTURE);
    this._paintCursor();
    return this;
  }

  /** Select a square, showing its legal destinations. */
  select(square) {
    const destinations = this.getDestinations(square) || [];
    if (!destinations.length) { this.clearSelection(); return false; }
    this.clearSelection();
    this.selected = square;
    this.destinations = destinations;
    // The keyboard cursor follows the selection, so switching from mouse to
    // keys starts from the piece in hand instead of a fixed square.
    this.cursor = square;
    this.renderer.highlightSquare(square, HIGHLIGHT.SELECTED);
    this.renderer.showDestinations?.(destinations);
    this._paintCursor();
    return true;
  }

  async _onSquare(square, event = {}) {
    if (!this.enabled) return;

    // --- pointer down: pick the piece up, so a drag has something to carry --
    if (event.phase === 'down') {
      if (!this.getMovableColour?.()) return;
      if (this.selected === square) {
        // Already selected. Leave it alone and let the release put it down,
        // which is how "click it again to cancel" works.
        this._selectedOnThisPress = false;
        return;
      }
      // Something else is selected: this press might be a move onto this
      // square, so the release decides rather than the press.
      if (this.selected) return;
      this._selectedOnThisPress = this.select(square);
      return;
    }

    if (event.phase === 'cancel') return;

    // --- pointer up / drop: commit, re-select, or put the piece down --------
    const justSelected = this._selectedOnThisPress;
    this._selectedOnThisPress = false;

    const origin = event.phase === 'drop' ? event.from : this.selected;

    if (origin && origin !== square) {
      const target = this.destinations.find((d) => d.to === square);
      if (target) { await this._commit(origin, square, target); return; }
    }

    // Releasing on the square this same click just selected keeps it selected —
    // that is a click-to-pick-up, not a click-to-put-down.
    if (this.selected === square) {
      if (!justSelected) this.clearSelection();
      return;
    }

    this.select(square);
  }

  async _commit(from, to, target) {
    this.clearSelection();
    let promotion = null;
    if (target?.promotion) {
      promotion = this.askPromotion ? await this.askPromotion({ from, to }) : 'q';
      if (!promotion) return;
    }
    this.onMove({ from, to, promotion });
  }

  /* -------------------------------------------------------------- cursor */

  /**
   * Step the cursor by whole squares, in SCREEN directions (dx right, dy
   * down): up is always up the screen, whichever side the board shows.
   * It stops at the edge. Returns true when it moved.
   */
  moveCursor(dx, dy) {
    const flip = this.renderer.orientation === 'b' ? -1 : 1;
    const next = squareAt(fileIndex(this.cursor) + dx * flip, rankIndex(this.cursor) - dy * flip);
    if (!next || next === this.cursor) return false;
    this.cursor = next;
    this._paintCursor();
    return true;
  }

  /** Put the cursor on a square (a screen starts it on the player's side). */
  placeCursor(square) {
    if (!SQUARES.includes(square)) return;
    this.cursor = square;
    this._paintCursor();
  }

  /**
   * Accept on the cursor's square: a whole click, press and release, sent
   * through the renderer so every listener hears it (the lesson player's
   * "tap a square" challenges listen there too). The first press picks a
   * piece up, the second commits the move or puts the piece back down.
   */
  pressCursor() {
    this.renderer.pressSquare?.(this.cursor);
  }

  _paintCursor() {
    this.renderer.setCursor?.(this.cursor, { carrying: !!this.selected });
  }

  destroy() {
    this._unsubscribe?.();
    this.clearSelection();
  }
}

export default ChessInputController;
