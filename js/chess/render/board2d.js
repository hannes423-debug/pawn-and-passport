/**
 * board2d.js — ChessBoard2DRenderer.
 *
 * A plain DOM board: 64 square elements plus one absolutely positioned element
 * per piece. Pieces are moved by changing two CSS custom properties, so an
 * animated move is one transform transition and the browser does the work.
 *
 * Deliberately generic: no theme art, no branding. It implements
 * ChessBoardRenderer exactly, so replacing it with a Three.js board later
 * touches nothing above it.
 */

import { ChessBoardRenderer, HIGHLIGHT, ARROW } from './boardRenderer.js';
import { hex } from './feedback.js';
import { pieceUrl, DEFAULT_PIECE_SET, BOARD_THEMES, DEFAULT_BOARD_THEME } from './pieceSets.js';
import { FILES, RANKS, SQUARES, fileIndex, rankIndex } from '../core/constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
import { at } from '../core/rules.js';

/** Piece-slide presets, in milliseconds. 0 disables the animation entirely. */
export const ANIMATION_SPEEDS = Object.freeze({
  off: 0,
  fast: 150,
  smooth: 280,
  slow: 450
});
const DEFAULT_ANIM_MS = ANIMATION_SPEEDS.smooth;

export class ChessBoard2DRenderer extends ChessBoardRenderer {
  /**
   * @param {HTMLElement} host
   * @param {Object} [options]
   * @param {'w'|'b'} [options.orientation]
   * @param {string} [options.pieceSet]
   * @param {string} [options.theme]
   * @param {boolean} [options.coordinates]
   */
  constructor(host, {
    orientation = 'w', pieceSet = DEFAULT_PIECE_SET, theme = DEFAULT_BOARD_THEME,
    coordinates = true, animate = true, animationMs = DEFAULT_ANIM_MS
  } = {}) {
    super({ orientation });
    this.host = host;
    this.pieceSet = pieceSet;
    this.theme = theme;
    this.coordinates = coordinates;
    this.animate = animate;
    this.animationMs = Number(animationMs) || 0;
    this.fen = null;

    /** @type {Map<string, HTMLElement>} square -> square element */
    this.squares = new Map();
    /** @type {Map<string, HTMLElement>} square -> piece element currently there */
    this.pieces = new Map();
    this._highlights = new Map();
    /** @type {Array<{from,to,kind,meta,key}>} redrawn on flip */
    this._arrows = [];
    this._arrowHoverListeners = new Set();
    this._drag = null;
    /** @type {Map<*, HTMLElement>} key -> lingering verdict tint */
    this._verdicts = new Map();
    this._lastMove = null;
    this.lastSlideMs = 0;

    this._build();
  }

  /* ----------------------------------------------------------- structure */

  _build() {
    this.host.classList.add('cwt-board', 'cwt-boardhost');
    // The duration lives in a custom property so CSS drives the transition and
    // JS waits exactly as long — one number, no chance of the two drifting.
    this.host.style.setProperty('--piece-anim', `${this.animationMs}ms`);
    this.host.dataset.orientation = this.orientation;
    this.host.dataset.theme = this.theme;
    this.host.setAttribute('role', 'grid');
    this.host.setAttribute('aria-label', 'Chess board');
    // Focusable, so keyboard play is a deliberate mode rather than something
    // every Enter press anywhere in the app can trigger.
    this.host.tabIndex = 0;
    this.host.innerHTML = '';

    this.squareLayer = document.createElement('div');
    this.squareLayer.className = 'cwt-board__squares';
    this.pieceLayer = document.createElement('div');
    this.pieceLayer.className = 'cwt-board__pieces';
    this.markerLayer = document.createElement('div');
    this.markerLayer.className = 'cwt-board__markers';
    /* Its own layer, because clearHighlights() empties the marker layer on
       every repaint and a verdict has to outlive those. */
    this.verdictLayer = document.createElement('div');
    this.verdictLayer.className = 'cwt-board__verdicts';

    for (const square of SQUARES) {
      const el = document.createElement('div');
      el.className = 'cwt-sq';
      el.dataset.square = square;
      el.dataset.shade = (fileIndex(square) + rankIndex(square)) % 2 === 0 ? 'dark' : 'light';
      el.style.setProperty('--f', String(fileIndex(square)));
      el.style.setProperty('--r', String(rankIndex(square)));
      el.setAttribute('role', 'gridcell');
      el.setAttribute('aria-label', square);
      this.squareLayer.append(el);
      this.squares.set(square, el);
    }

    // An SVG overlay in board units (0..8), so arrow geometry is written in
    // squares and the browser scales it with the board.
    this.arrowLayer = document.createElementNS(SVG_NS, 'svg');
    this.arrowLayer.setAttribute('class', 'cwt-board__arrows');
    this.arrowLayer.setAttribute('viewBox', '0 0 8 8');
    this.arrowLayer.setAttribute('preserveAspectRatio', 'none');
    this.arrowLayer.setAttribute('aria-hidden', 'true');

    // The last move gets its own SVG for the same reason: the arrow layer is
    // wiped and redrawn on every repaint, which would restart its draw-in.
    this.lastMoveLayer = document.createElementNS(SVG_NS, 'svg');
    this.lastMoveLayer.setAttribute('class', 'cwt-board__arrows cwt-board__lastmove');
    this.lastMoveLayer.setAttribute('viewBox', '0 0 8 8');
    this.lastMoveLayer.setAttribute('preserveAspectRatio', 'none');
    this.lastMoveLayer.setAttribute('aria-hidden', 'true');

    this.host.append(this.squareLayer, this.verdictLayer, this.markerLayer, this.pieceLayer,
      this.lastMoveLayer, this.arrowLayer);
    if (this.coordinates) this._buildCoordinates();
    this._wireInput();
  }

  _buildCoordinates() {
    const wrap = document.createElement('div');
    wrap.className = 'cwt-board__coords';
    wrap.setAttribute('aria-hidden', 'true');
    for (const file of FILES) {
      const el = document.createElement('span');
      el.className = 'cwt-coord cwt-coord--file';
      el.style.setProperty('--f', String(FILES.indexOf(file)));
      el.textContent = file;
      wrap.append(el);
    }
    for (const rank of RANKS) {
      const el = document.createElement('span');
      el.className = 'cwt-coord cwt-coord--rank';
      el.style.setProperty('--r', String(RANKS.indexOf(rank)));
      el.textContent = rank;
      wrap.append(el);
    }
    this.host.append(wrap);
    this.coordLayer = wrap;
  }

  /* -------------------------------------------------------------- render */

  /**
   * Draw a position. Pieces that stayed put are reused so CSS transitions can
   * animate them; only genuine arrivals and departures touch the DOM.
   *
   * `move` is the move that PRODUCED this position. Passing it is what makes a
   * piece slide instead of teleport, and the slide is applied here — inside the
   * same synchronous call that reconciles the position — deliberately:
   *
   *   * it is IDEMPOTENT. A second render() of the same FEN mid-slide finds
   *     every piece already where it belongs and touches nothing, so any of the
   *     other repaints a move triggers (passives, the clock, an ability) can no
   *     longer cut an animation short or teleport the piece ahead of it.
   *   * there is no DEFERRED render holding a captured FEN. That was a real
   *     bug: the settle fired 280ms later with the position from before the
   *     opponent's reply and put their piece back where it came from.
   *
   * @param {string} fen
   * @param {{from:string,to:string}} [options.move]
   */
  render(fen, { move = null } = {}) {
    if (typeof fen !== 'string') return this;
    this.fen = fen;
    const board = at(fen);
    const wanted = new Map();
    for (const row of board.board()) {
      for (const cell of row) if (cell) wanted.set(cell.square, `${cell.color}${cell.type}`);
    }

    if (move) this._slide(move, wanted);

    // Remove pieces that are gone or changed identity (promotion, capture).
    for (const [square, el] of [...this.pieces]) {
      if (wanted.get(square) !== el.dataset.piece) { el.remove(); this.pieces.delete(square); }
    }
    // Add what is missing.
    for (const [square, code] of wanted) {
      if (this.pieces.has(square)) continue;
      this.pieces.set(square, this._createPiece(square, code));
    }
    return this;
  }

  /**
   * Carry the moving piece (and a castling rook) to its destination so the diff
   * that follows finds it already in place and leaves it alone.
   *
   * Silently does nothing when the piece is not where the move says it started:
   * that means an earlier paint already reconciled this move, and re-running it
   * would drag the wrong piece.
   */
  _slide({ from, to } = {}, wanted) {
    if (!from || !to || from === to) return;
    const el = this.pieces.get(from);
    if (!el) return;
    // A promotion arrives as a different piece; let the diff swap it instead.
    if (wanted.get(to) !== el.dataset.piece) return;

    // The captured piece has to fade before the mover lands on it.
    const captured = this.pieces.get(to);
    this._carry(el, from, to);
    if (captured && captured !== el) this._retire(captured);

    // The rook travels with the castling king, or it snaps across the board
    // while the king glides.
    if (el.dataset.piece[1] === 'k' && Math.abs(fileIndex(to) - fileIndex(from)) === 2) {
      const rank = to[1];
      const kingSide = fileIndex(to) > fileIndex(from);
      const rookFrom = (kingSide ? 'h' : 'a') + rank;
      const rookTo = (kingSide ? 'f' : 'd') + rank;
      const rook = this.pieces.get(rookFrom);
      if (rook && wanted.get(rookTo) === rook.dataset.piece) this._carry(rook, rookFrom, rookTo);
    }
  }

  /** Put an existing piece element on another square, sliding if animation is on. */
  _carry(el, from, to) {
    this.pieces.delete(from);
    this.pieces.set(to, el);
    this.lastSlideMs = this.animate ? this.animationMs : 0;
    if (this.animate && this.animationMs > 0) {
      el.classList.add('is-moving');
      clearTimeout(el._settleTimer);
      // Held past the slide itself, so the landing bump (CSS) gets to play.
      el._settleTimer = setTimeout(() => el.classList.remove('is-moving'), this.animationMs + 190);
    }
    this._place(el, to);
  }

  /** Fade a captured piece out and drop it once the mover has landed. */
  _retire(el) {
    if (!this.animate || this.animationMs <= 0) { el.remove(); return; }
    /* Knocked out as the mover ARRIVES, not the instant it sets off: the CSS
       delays the fade by most of the slide, so the capture reads as contact. */
    el.classList.add('is-captured');
    clearTimeout(el._settleTimer);
    el._settleTimer = setTimeout(() => el.remove(), this.animationMs * 1.9);
  }

  /** The two custom properties that place anything on the grid. */
  _place(el, square) {
    el.dataset.square = square;
    el.style.setProperty('--f', String(fileIndex(square)));
    el.style.setProperty('--r', String(rankIndex(square)));
  }

  _createPiece(square, code) {
    const el = document.createElement('div');
    el.className = 'cwt-piece';
    el.dataset.piece = code;
    el.dataset.colour = code[0];
    this._place(el, square);
    el.style.backgroundImage = `url("${pieceUrl(this.pieceSet, code[0], code[1])}")`;
    el.setAttribute('aria-hidden', 'true');
    this.pieceLayer.append(el);
    return el;
  }

  /**
   * Slide a piece from `from` to `to`, then settle the position.
   * @param {{from:string,to:string}} move
   * @returns {Promise<void>}
   */
  /** Change the slide duration at runtime. 0 turns it off. */
  setAnimationMs(ms) {
    this.animationMs = Math.max(0, Number(ms) || 0);
    this.animate = this.animationMs > 0;
    this.host.style.setProperty('--piece-anim', `${this.animationMs}ms`);
    return this;
  }

  /**
   * Slide a piece without a FEN to reconcile against. `render(fen, { move })`
   * is the path the match screen uses; this stays for the renderer contract and
   * for callers that only have the move.
   */
  animateMove({ from, to } = {}) {
    const el = this.pieces.get(from);
    if (!el) return Promise.resolve();
    const captured = this.pieces.get(to);
    this._carry(el, from, to);
    if (captured && captured !== el) this._retire(captured);
    if (!this.animate || this.animationMs <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, this.animationMs));
  }

  /* ---------------------------------------------------------- highlights */

  /** Kinds that mark the PIECE too, not only the square it stands on. */
  static PIECE_HIGHLIGHTS = new Set([HIGHLIGHT.HINT, HIGHLIGHT.THREAT, HIGHLIGHT.BEST, HIGHLIGHT.BOOK]);

  /** Kinds that get a marker element, so css/board.css can put an icon on it. */
  static MARKER_HIGHLIGHTS = new Set([
    HIGHLIGHT.LEGAL, HIGHLIGHT.LEGAL_CAPTURE,
    HIGHLIGHT.HINT, HIGHLIGHT.THREAT, HIGHLIGHT.BEST, HIGHLIGHT.BOOK, HIGHLIGHT.DEFENCE
  ]);

  highlightSquare(square, kind = HIGHLIGHT.SELECTED) {
    const el = this.squares.get(square);
    if (!el) return;
    el.classList.add(`is-${kind}`);
    if (!this._highlights.has(kind)) this._highlights.set(kind, new Set());
    this._highlights.get(kind).add(square);
    /* Pawn & Passport: the assistance highlights carry a marker too, because
       css/board.css puts the UI pack's icon on it - a square that is only
       tinted says "look here", and the icon says what for. */
    if (ChessBoard2DRenderer.MARKER_HIGHLIGHTS.has(kind)) this._addMarker(square, kind);
    // A wash on the square is mostly hidden by the piece standing on it, which
    // is the very thing being pointed at, so the piece carries the mark too.
    if (ChessBoard2DRenderer.PIECE_HIGHLIGHTS.has(kind)) {
      this.pieces.get(square)?.classList.add(`is-${kind}`);
    }
  }

  highlightMove({ from, to } = {}, kind = HIGHLIGHT.LAST_MOVE) {
    if (from) this.highlightSquare(from, kind);
    if (to) this.highlightSquare(to, kind);
  }

  /** Draw the legal destinations for a selected piece. */
  showDestinations(destinations = []) {
    for (const dest of destinations) {
      this.highlightSquare(dest.to, dest.capture ? HIGHLIGHT.LEGAL_CAPTURE : HIGHLIGHT.LEGAL);
    }
  }

  _addMarker(square, kind) {
    const marker = document.createElement('div');
    marker.className = `cwt-marker cwt-marker--${kind}`;
    marker.dataset.square = square;
    marker.style.setProperty('--f', String(fileIndex(square)));
    marker.style.setProperty('--r', String(rankIndex(square)));
    this.markerLayer.append(marker);
  }

  /* ------------------------------------------------------------ verdicts */

  /**
   * A verdict that STAYS on its square until clearVerdicts() lets it go - the
   * match screen does that when the player makes their next move. `key` is the
   * caller's (the ply), so marking the same verdict twice does nothing.
   */
  markVerdict(key, square, kind) {
    if (this._verdicts.has(key)) return;
    const el = document.createElement('div');
    el.className = `cwt-verdict cwt-verdict--${kind}`;
    el.style.setProperty('--tone', hex(kind));
    el.style.setProperty('--f', String(fileIndex(square)));
    el.style.setProperty('--r', String(rankIndex(square)));
    this.verdictLayer.append(el);
    this._verdicts.set(key, el);
  }

  /** Hidden while the player browses an earlier position, not cleared. */
  setVerdictsVisible(visible) { this.verdictLayer.hidden = !visible; }

  clearVerdicts(keep = null) {
    for (const [key, el] of [...this._verdicts]) {
      if (keep && keep(key)) continue;
      this._verdicts.delete(key);
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 260);
    }
  }

  /* ----------------------------------------------------- last-move arrow */

  /**
   * The arrow from where the last move started to where it ended. Kept out of
   * drawArrow/clearArrows on purpose - see lastMoveLayer.
   */
  showLastMove(move) {
    const same = move && this._lastMove &&
      this._lastMove.from === move.from && this._lastMove.to === move.to;
    if (same) return this;
    this._lastMove = move?.from && move?.to && move.from !== move.to
      ? { from: move.from, to: move.to } : null;
    this._paintLastMove(true);
    return this;
  }

  _paintLastMove(animate) {
    if (!this.lastMoveLayer) return;
    this.lastMoveLayer.innerHTML = '';
    if (!this._lastMove) return;
    this._paintArrow({ ...this._lastMove, kind: 'last-move', meta: null, key: null },
      this.lastMoveLayer);
    const group = this.lastMoveLayer.lastElementChild;
    if (!group || !animate || !this.animate || this.animationMs <= 0) return;
    /* Drawn out alongside the slide, with SMIL rather than a CSS dash trick:
       the stroke is non-scaling, which puts dash lengths in screen pixels and
       makes a "draw the line" dash meaningless. And if SMIL does not run, the
       attributes already hold the finished arrow. */
    const line = group.querySelector('.cwt-arrow__line');
    const head = group.querySelector('.cwt-arrow__head');
    const dur = `${this.animationMs}ms`;
    const x1 = line.getAttribute('x1'), y1 = line.getAttribute('y1');
    const x2 = line.getAttribute('x2'), y2 = line.getAttribute('y2');
    const smil = (tag, attrs) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries({ dur, fill: 'freeze', begin: 'indefinite',
        calcMode: 'spline', keyTimes: '0;1', keySplines: '0.33 0.05 0.2 1', ...attrs })) {
        el.setAttribute(k, v);
      }
      return el;
    };
    const anims = [
      [line, smil('animate', { attributeName: 'x2', from: x1, to: x2 })],
      [line, smil('animate', { attributeName: 'y2', from: y1, to: y2 })],
      [head, smil('animateTransform', { attributeName: 'transform', type: 'translate',
        from: `${x1 - x2} ${y1 - y2}`, to: '0 0' })]
    ];
    for (const [target, anim] of anims) { target.append(anim); anim.beginElement?.(); }
  }

  /* ------------------------------------------------------------- arrows */

  /**
   * @param {{from:string,to:string}} move
   * @param {string} [kind] one of ARROW
   */
  /**
   * @param {{from:string,to:string}} move
   * @param {string} [kind] one of ARROW
   * @param {Object} [meta] carried back to onArrowHover; the renderer never
   *        reads it, so what an arrow "means" stays a UI concern
   */
  drawArrow({ from, to } = {}, kind = ARROW.HINT, meta = null, label = null) {
    if (!from || !to || from === to) return this;
    /* Pawn & Passport: `label` numbers a step of a hint continuation (1, 2, 3). */
    const arrow = { from, to, kind, meta, label, key: `${kind}:${from}${to}:${label ?? ''}` };
    this._arrows.push(arrow);
    this._paintArrow(arrow);
    return this;
  }

  /** @param {(meta:Object|null, event:PointerEvent) => void} fn */
  onArrowHover(fn) {
    this._arrowHoverListeners.add(fn);
    return () => this._arrowHoverListeners.delete(fn);
  }

  _emitArrowHover(meta, event) {
    for (const fn of [...this._arrowHoverListeners]) fn(meta, event);
  }

  clearArrows(kind = null) {
    this._arrows = kind ? this._arrows.filter((arrow) => arrow.kind !== kind) : [];
    this._redrawArrows();
    return this;
  }

  _redrawArrows() {
    if (!this.arrowLayer) return;
    this.arrowLayer.innerHTML = '';
    for (const arrow of this._arrows) this._paintArrow(arrow);
  }

  /** Board coordinates in SVG space, honouring the current orientation. */
  _svgPoint(square) {
    const file = fileIndex(square);
    const rank = rankIndex(square);
    const flipped = this.orientation === 'b';
    return {
      x: (flipped ? 7 - file : file) + 0.5,
      y: (flipped ? rank : 7 - rank) + 0.5
    };
  }

  _paintArrow({ from, to, kind, meta, key, label = null }, layer = this.arrowLayer) {
    const a = this._svgPoint(from);
    const b = this._svgPoint(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!length) return;
    const ux = dx / length;
    const uy = dy / length;

    // Start just outside the origin piece and stop short of the target so the
    // arrowhead sits ON the square rather than covering the piece there.
    // Pawn & Passport: the head is wider and shorter than World Tour's, to match
    // the chunky arrows in the supplied pixel UI pack.
    const head = 0.34;
    const start = { x: a.x + ux * 0.32, y: a.y + uy * 0.32 };
    const end = { x: b.x - ux * head, y: b.y - uy * head };

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', `cwt-arrow cwt-arrow--${kind}`);
    if (key) group.setAttribute('data-arrow', key);
    if (meta) {
      group.addEventListener('pointerenter', (event) => this._emitArrowHover(meta, event));
      group.addEventListener('pointerleave', (event) => this._emitArrowHover(null, event));
      group.classList.add('cwt-arrow--interactive');
    }

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', start.x);
    line.setAttribute('y1', start.y);
    line.setAttribute('x2', end.x);
    line.setAttribute('y2', end.y);
    line.setAttribute('class', 'cwt-arrow__line');

    // An explicit triangle rather than a marker: markers inherit stroke width
    // and scale unpredictably inside a non-uniform viewBox.
    const wing = 0.27;
    const tip = { x: b.x - ux * 0.08, y: b.y - uy * 0.08 };
    const left = { x: end.x - uy * wing, y: end.y + ux * wing };
    const right = { x: end.x + uy * wing, y: end.y - ux * wing };
    const headEl = document.createElementNS(SVG_NS, 'polygon');
    headEl.setAttribute('points', `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`);
    headEl.setAttribute('class', 'cwt-arrow__head');

    if (meta) {
      const hit = document.createElementNS(SVG_NS, 'line');
      hit.setAttribute('x1', a.x); hit.setAttribute('y1', a.y);
      hit.setAttribute('x2', b.x); hit.setAttribute('y2', b.y);
      hit.setAttribute('class', 'cwt-arrow__hit');
      group.append(hit);
    }
    /* The pack's arrows are drawn with a dark outline around a bright core.
       Two extra shapes under the coloured ones do it cheaply: a wider line and
       a scaled-up head. CSS colours them; the geometry is shared. */
    const outline = line.cloneNode(false);
    outline.setAttribute('class', 'cwt-arrow__line cwt-arrow__line--outline');
    const outlineHead = document.createElementNS(SVG_NS, 'polygon');
    const grow = 0.05;
    const oTip = { x: tip.x + ux * grow, y: tip.y + uy * grow };
    const oLeft = { x: left.x - uy * grow - ux * grow, y: left.y + ux * grow - uy * grow };
    const oRight = { x: right.x + uy * grow - ux * grow, y: right.y - ux * grow - uy * grow };
    outlineHead.setAttribute('points', `${oTip.x},${oTip.y} ${oLeft.x},${oLeft.y} ${oRight.x},${oRight.y}`);
    outlineHead.setAttribute('class', 'cwt-arrow__head cwt-arrow__head--outline');
    group.append(outline, outlineHead, line, headEl);
    if (label !== null && label !== undefined) {
      const badge = document.createElementNS(SVG_NS, 'g');
      badge.setAttribute('class', 'cwt-arrow__badge');
      const disc = document.createElementNS(SVG_NS, 'circle');
      disc.setAttribute('cx', start.x); disc.setAttribute('cy', start.y); disc.setAttribute('r', 0.19);
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', start.x); text.setAttribute('y', start.y + 0.075);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '0.22');
      text.textContent = String(label);
      badge.append(disc, text);
      group.append(badge);
    }
    layer.append(group);
  }

  clearHighlights(kind = null) {
    const kinds = kind ? [kind] : [...this._highlights.keys()];
    for (const key of kinds) {
      for (const square of this._highlights.get(key) || []) {
        this.squares.get(square)?.classList.remove(`is-${key}`);
      }
      this._highlights.delete(key);
      for (const marker of this.markerLayer.querySelectorAll(`.cwt-marker--${key}`)) marker.remove();
      // Swept off the LAYER rather than off the recorded squares: a piece that
      // was marked may since have moved or been taken, and the class travels
      // with the element, not with the square.
      if (ChessBoard2DRenderer.PIECE_HIGHLIGHTS.has(key)) {
        for (const el of this.pieceLayer.querySelectorAll(`.is-${key}`)) el.classList.remove(`is-${key}`);
      }
    }
    if (!kind) this.markerLayer.innerHTML = '';
  }

  /* ------------------------------------------------------------- options */

  setOrientation(colour) {
    super.setOrientation(colour);
    this.host.dataset.orientation = colour;
    // Squares and pieces flip through CSS; the SVG is drawn in absolute board
    // coordinates, so its arrows have to be redrawn.
    this._redrawArrows();
    this._paintLastMove(false);
    return this;
  }

  setTheme(theme) {
    if (!BOARD_THEMES[theme]) return this;
    this.theme = theme;
    this.host.dataset.theme = theme;
    return this;
  }

  setPieceSet(setId) {
    this.pieceSet = setId;
    for (const [, el] of this.pieces) {
      const code = el.dataset.piece;
      el.style.backgroundImage = `url("${pieceUrl(setId, code[0], code[1])}")`;
    }
    return this;
  }

  setInteractive(enabled) {
    super.setInteractive(enabled);
    this.host.dataset.interactive = enabled ? 'true' : 'false';
    return this;
  }

  /**
   * Where a square's centre is, in pixels relative to the host box. The
   * inverse of squareAtPoint, and the hook a DOM overlay (a move-quality
   * label, a tooltip) uses to sit over a square without knowing whether the
   * board underneath is flat or a 3D scene.
   * @returns {?{x:number, y:number, size:number}}
   */
  projectSquare(square) {
    const file = FILES.indexOf(square[0]);
    const rank = RANKS.indexOf(square[1]);
    if (file < 0 || rank < 0) return null;
    const size = this.host.getBoundingClientRect().width / 8;
    const col = this.orientation === 'b' ? 7 - file : file;
    const row = this.orientation === 'b' ? rank : 7 - rank;
    return { x: (col + 0.5) * size, y: (row + 0.5) * size, size };
  }

  /** Which square is at these client coordinates, or null. */
  squareAtPoint(clientX, clientY) {
    const rect = this.host.getBoundingClientRect();
    const size = rect.width / 8;
    let file = Math.floor((clientX - rect.left) / size);
    let rank = 7 - Math.floor((clientY - rect.top) / size);
    if (this.orientation === 'b') { file = 7 - file; rank = 7 - rank; }
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return FILES[file] + RANKS[rank];
  }

  /* --------------------------------------------------------------- input */

  _wireInput() {
    const onPointerDown = (event) => {
      if (!this.interactive) return;
      const square = this.squareAtPoint(event.clientX, event.clientY);
      if (!square) return;
      this._drag = { square, startX: event.clientX, startY: event.clientY, moved: false, pointerId: event.pointerId };
      const piece = this.pieces.get(square);
      if (piece) { piece.classList.add('is-grabbed'); this._drag.piece = piece; }
      // Touching the board takes keyboard focus, which is what arms the
      // arrow-key cursor and Enter.
      try { this.host.focus({ preventScroll: true }); } catch { /* older browsers */ }
      this._emitSelect(square, { phase: 'down', originalEvent: event });
      this.host.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (!this._drag || !this.interactive) return;
      const dx = event.clientX - this._drag.startX;
      const dy = event.clientY - this._drag.startY;
      if (!this._drag.moved && Math.hypot(dx, dy) < 6) return;
      this._drag.moved = true;
      const piece = this._drag.piece;
      if (piece) {
        const rect = this.host.getBoundingClientRect();
        const size = rect.width / 8;
        piece.style.setProperty('--drag-x', `${dx / size}`);
        piece.style.setProperty('--drag-y', `${dy / size}`);
      }
    };

    const onPointerUp = (event) => {
      if (!this._drag) return;
      const drag = this._drag;
      this._drag = null;
      drag.piece?.classList.remove('is-grabbed');
      drag.piece?.style.removeProperty('--drag-x');
      drag.piece?.style.removeProperty('--drag-y');
      this.host.releasePointerCapture?.(drag.pointerId);
      if (!this.interactive) return;
      // A press that never passed the drag threshold is a CLICK, and a click
      // belongs to the square it started on — not to whatever square the
      // release coordinates happen to land in. Real mice drift a pixel or two,
      // and near a square boundary that turned a click into "released on a
      // different square", which silently dropped the selection.
      const released = this.squareAtPoint(event.clientX, event.clientY);
      const square = drag.moved ? released : drag.square;
      if (!square) { this._emitSelect(drag.square, { phase: 'cancel' }); return; }
      this._emitSelect(square, {
        phase: drag.moved && square !== drag.square ? 'drop' : 'up',
        from: drag.square, originalEvent: event
      });
    };

    // Any pointer press OUTSIDE the board gives up keyboard control of it.
    // Relying on the clicked element to take focus is not enough: a
    // programmatic click, a label, or a browser that does not focus buttons on
    // click would all leave the board armed, and then a stray Enter plays a
    // move the player never asked for.
    const onDocumentPointerDown = (event) => {
      if (this.host.contains(event.target)) return;
      if (this.host === document.activeElement || this.host.contains(document.activeElement)) {
        this.host.blur();
      }
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);

    this.host.addEventListener('pointerdown', onPointerDown);
    this.host.addEventListener('pointermove', onPointerMove);
    this.host.addEventListener('pointerup', onPointerUp);
    this.host.addEventListener('pointercancel', onPointerUp);
    this.host.addEventListener('contextmenu', (event) => event.preventDefault());

    this._teardown = () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      this.host.removeEventListener('pointerdown', onPointerDown);
      this.host.removeEventListener('pointermove', onPointerMove);
      this.host.removeEventListener('pointerup', onPointerUp);
      this.host.removeEventListener('pointercancel', onPointerUp);
    };
  }

  destroy() {
    this._arrows = [];
    this._verdicts.clear();
    this._arrowHoverListeners.clear();
    this._teardown?.();
    super.destroy();
    this.host.innerHTML = '';
    this.host.classList.remove('cwt-board');
  }
}

export default ChessBoard2DRenderer;
