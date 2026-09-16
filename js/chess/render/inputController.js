/**
 * inputController.js — ChessInputController.
 *
 * Turns raw pointer/keyboard events from a renderer into ONE intent:
 * "the player wants to move from X to Y". Game logic never learns whether the
 * player clicked, tapped, dragged or used the keyboard, which is what lets a
 * gamepad be added later as a fourth source with no change above this file.
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
import { SQUARES, FILES, RANKS, fileIndex, rankIndex, squareAt } from '../core/constants.js';

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
    this._wireKeyboard();
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
    return this;
  }

  /** Select a square, showing its legal destinations. */
  select(square) {
    const destinations = this.getDestinations(square) || [];
    if (!destinations.length) { this.clearSelection(); return false; }
    this.clearSelection();
    this.selected = square;
    this.destinations = destinations;
    // The arrow-key cursor follows the selection, so switching from mouse to
    // keyboard starts from the piece in hand instead of a fixed square.
    this.cursor = square;
    this.renderer.highlightSquare(square, HIGHLIGHT.SELECTED);
    this.renderer.showDestinations?.(destinations);
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

  /* ------------------------------------------------------------ keyboard */

  /**
   * Is the player actually driving the BOARD right now?
   *
   * This gate exists because the keyboard handler is on `window`, and without
   * it any Enter or Space anywhere in the app committed a move at the board
   * cursor. The real sequence that hit: select a piece, click the Hint button,
   * press Enter — and the game played e2-e4 for you and the opponent replied.
   * From the player's side that reads as "asking for a hint used my turn".
   */
  _boardHasFocus() {
    const host = this.renderer?.host;
    if (!host) return false;
    const active = document.activeElement;
    return active === host || (!!active && host.contains(active));
  }

  _wireKeyboard() {
    this._onKey = (event) => {
      if (!this.enabled) return;
      const target = event.target;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      // Escape is allowed from anywhere: cancelling a selection you can see is
      // never surprising. Everything that MOVES a piece needs board focus.
      if (event.key === 'Escape') {
        if (this.selected) { this.clearSelection(); event.preventDefault(); }
        return;
      }
      if (!this._boardHasFocus()) return;
      const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (moves[event.key]) {
        const [df, dr] = moves[event.key];
        const flip = this.renderer.orientation === 'b' ? -1 : 1;
        const next = squareAt(fileIndex(this.cursor) + df * flip, rankIndex(this.cursor) + dr * flip);
        if (next) {
          this.cursor = next;
          this.renderer.clearHighlights(HIGHLIGHT.HINT);
          this.renderer.highlightSquare(next, HIGHLIGHT.HINT);
          event.preventDefault();
        }
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        this._onSquare(this.cursor, { phase: 'up' });
        event.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', this._onKey);
  }

  destroy() {
    this._unsubscribe?.();
    window.removeEventListener('keydown', this._onKey);
    this.clearSelection();
  }
}

export default ChessInputController;
