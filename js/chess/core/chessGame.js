/**
 * chessGame.js — one game session.
 *
 * Owns the rules instance, the clock, the move history and the result. Emits
 * events; renders nothing. A 2D board, a 3D board, a headless test and the
 * Python-facing PGN exporter all drive the same object.
 *
 * Events: 'start' 'move' 'clock' 'end' 'undo' 'position'
 */

import { createRules, at, passTurn } from './rules.js';
import { START_FEN, WHITE, BLACK, otherColour, COLOUR_NAME } from './constants.js';
import { MoveRecord } from './moveRecord.js';
import { ChessClock, TIME_CONTROLS, TimeControl } from './timeControl.js';
import { GameResult, TERMINATION } from './gameResult.js';

export class ChessGame {
  /**
   * @param {Object} options
   * @param {string} [options.fen]         starting position
   * @param {TimeControl} [options.timeControl]
   * @param {{w:Object,b:Object}} [options.players]  { name, kind:'human'|'bot', profile }
   * @param {string} [options.mode]        quick-match | local | career | ultimate | training | analysis
   * @param {boolean} [options.allowUndo]  never true in a competitive mode
   * @param {boolean} [options.rated]
   */
  constructor({
    fen = START_FEN,
    timeControl = TIME_CONTROLS[3],
    players = { w: { name: 'White', kind: 'human' }, b: { name: 'Black', kind: 'human' } },
    mode = 'quick-match',
    allowUndo = false,
    rated = false,
    now = () => Date.now()
  } = {}) {
    this.startFen = fen;
    this.rules = createRules(fen);
    this.timeControl = timeControl;
    this.clock = new ChessClock(timeControl, { now });
    this.players = players;
    this.mode = mode;
    /**
     * Undo is a mode capability, never a runtime toggle: a competitive game
     * must not be able to acquire one by accident.
     */
    this.allowUndo = !!allowUndo && !rated;
    this.rated = rated;
    this.status = 'idle';                 // idle | active | finished
    /** @type {MoveRecord[]} */
    this.history = [];
    /** @type {GameResult|null} */
    this.result = null;
    this.startedAt = null;
    this.drawOffer = null;                // colour that has an offer standing
    this._listeners = new Set();
    this._now = now;
    this.clock.onChange((state) => this.emit('clock', state));
  }

  /* ------------------------------------------------------------ events */

  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit(type, payload = null) {
    for (const fn of [...this._listeners]) {
      try { fn({ type, payload, game: this }); }
      catch (error) { console.error(`[ChessGame] listener failed on "${type}"`, error); }
    }
  }

  /* ----------------------------------------------------------- queries */

  get fen() { return this.rules.fen(); }
  get turn() { return this.rules.turn(); }
  get ply() { return this.history.length; }
  get moveNumber() { return this.rules.moveNumber(); }
  get isActive() { return this.status === 'active'; }
  get lastMove() { return this.history[this.history.length - 1] || null; }

  /** Whose turn it is, as a player descriptor. */
  get sideToMovePlayer() { return this.players[this.turn]; }

  /** True when a bot (not a human) owns the side to move. */
  get waitingOnBot() {
    return this.isActive && this.players[this.turn]?.kind === 'bot';
  }

  legalMoves(square) {
    return square
      ? this.rules.moves({ square, verbose: true })
      : this.rules.moves({ verbose: true });
  }

  /** Destination squares for a piece — what the board highlights. */
  destinationsFrom(square) {
    return this.legalMoves(square).map((m) => ({
      to: m.to, capture: !!m.captured, promotion: !!m.promotion, san: m.san
    }));
  }

  inCheck() { return this.rules.inCheck(); }
  checkedKingSquare() {
    if (!this.rules.inCheck()) return null;
    const found = this.rules.findPiece({ type: 'k', color: this.turn });
    return found[0] || null;
  }

  /** Captured material, for the board's captured-pieces strip. */
  capturedPieces() {
    const captured = { w: [], b: [] };
    for (const move of this.history) {
      if (move.capturedPiece) captured[move.color].push(move.capturedPiece);
    }
    return captured;
  }

  pgn() {
    const headers = {
      Event: 'Pawn & Passport',
      Site: 'Pawn & Passport: A Chess Career RPG',
      Date: new Date(this.startedAt || Date.now()).toISOString().slice(0, 10).replace(/-/g, '.'),
      White: this.players.w?.name || 'White',
      Black: this.players.b?.name || 'Black',
      Result: this.result?.result || '*',
      TimeControl: this.timeControl.isUnlimited
        ? '-'
        : `${this.timeControl.baseSeconds}+${this.timeControl.incrementSeconds}`
    };
    if (this.startFen !== START_FEN) { headers.SetUp = '1'; headers.FEN = this.startFen; }
    for (const [key, value] of Object.entries(headers)) this.rules.setHeader(key, String(value));
    return this.rules.pgn();
  }

  /* ------------------------------------------------------------ control */

  start() {
    if (this.status !== 'idle') return this;
    this.status = 'active';
    this.startedAt = this._now();
    this.clock.start(this.turn);
    this.emit('start');
    return this;
  }

  /**
   * Play a move.
   * @param {string|{from:string,to:string,promotion?:string}} move UCI, SAN or object
   * @returns {MoveRecord|null} null when the move was illegal or the game is over
   */
  move(move) {
    if (this.status !== 'active') return null;
    const fenBefore = this.fen;
    const clockBefore = { w: this.clock.remaining.w, b: this.clock.remaining.b };
    const colour = this.turn;

    let applied = null;
    try {
      applied = this.rules.move(normaliseMove(move));
    } catch { applied = null; }
    if (!applied) return null;

    const thinkMs = this.clock.press(colour);
    const clockAfter = { w: this.clock.remaining.w, b: this.clock.remaining.b };

    const record = MoveRecord.fromChessJs(applied, {
      ply: this.history.length + 1,
      fenBefore,
      fenAfter: this.rules.fen(),
      check: this.rules.inCheck(),
      checkmate: this.rules.isCheckmate(),
      thinkMs, clockBefore, clockAfter,
      timestamp: this._now()
    });
    this.history.push(record);
    this.drawOffer = null;
    this.emit('move', record);
    this.emit('position', { fen: this.fen, ply: this.ply });

    this._checkNaturalEnd();
    if (this.clock.flagged) this._flag(this.clock.flagged);
    return record;
  }

  /** Poll the clock. The UI calls this on an interval; nothing else needs to. */
  tick() {
    if (this.status !== 'active') return;
    this.clock.tick();
    if (this.clock.flagged) this._flag(this.clock.flagged);
  }

  /** Take back the last half-move. Refused unless the mode allows it. */
  undo() {
    if (!this.allowUndo) return { ok: false, reason: 'undo-not-allowed-in-this-mode' };
    if (!this.history.length) return { ok: false, reason: 'nothing-to-undo' };
    const undone = this.rules.undo();
    if (!undone) return { ok: false, reason: 'rules-refused' };
    const record = this.history.pop();
    if (this.status === 'finished') { this.status = 'active'; this.result = null; }
    this.clock.side = record.color;
    this.clock.remaining.w = record.clockBefore.w;
    this.clock.remaining.b = record.clockBefore.b;
    this.clock.flagged = null;
    this.emit('undo', record);
    this.emit('position', { fen: this.fen, ply: this.ply });
    return { ok: true, move: record };
  }

  /** Take back a full move pair, so a human keeps the move. */
  undoPair() {
    const first = this.undo();
    if (!first.ok) return first;
    if (this.history.length && this.players[this.turn]?.kind !== 'human') this.undo();
    return first;
  }

  resign(colour) {
    if (this.status !== 'active') return null;
    return this._finish({
      result: colour === WHITE ? '0-1' : '1-0',
      winner: otherColour(colour),
      loser: colour,
      termination: TERMINATION.RESIGNATION
    });
  }

  offerDraw(colour) { this.drawOffer = colour; this.emit('draw-offer', colour); return this.drawOffer; }

  acceptDraw() {
    if (this.status !== 'active') return null;
    return this._finish({ result: '1/2-1/2', winner: null, loser: null, termination: TERMINATION.AGREEMENT });
  }

  declineDraw() { this.drawOffer = null; this.emit('draw-declined'); }

  _flag(colour) {
    if (this.status !== 'active') return;
    // A flag only loses if the other side can still deliver mate.
    const opponent = otherColour(colour);
    const board = at(this.fen);
    const opponentCanMate = !board.isInsufficientMaterial() || hasMatingMaterial(this.fen, opponent);
    this._finish(opponentCanMate
      ? { result: colour === WHITE ? '0-1' : '1-0', winner: opponent, loser: colour, termination: TERMINATION.TIMEOUT }
      : { result: '1/2-1/2', winner: null, loser: null, termination: TERMINATION.TIMEOUT });
  }

  _checkNaturalEnd() {
    if (!this.rules.isGameOver()) return;
    if (this.rules.isCheckmate()) {
      const loser = this.turn;
      return this._finish({
        result: loser === WHITE ? '0-1' : '1-0',
        winner: otherColour(loser), loser, termination: TERMINATION.CHECKMATE
      });
    }
    let termination = TERMINATION.STALEMATE;
    if (this.rules.isStalemate()) termination = TERMINATION.STALEMATE;
    else if (this.rules.isInsufficientMaterial()) termination = TERMINATION.INSUFFICIENT_MATERIAL;
    else if (this.rules.isThreefoldRepetition()) termination = TERMINATION.THREEFOLD;
    else if (this.rules.isDrawByFiftyMoves()) termination = TERMINATION.FIFTY_MOVE;
    return this._finish({ result: '1/2-1/2', winner: null, loser: null, termination });
  }

  _finish({ result, winner, loser, termination }) {
    this.status = 'finished';
    this.clock.stop();
    this.result = new GameResult({
      result, winner, loser, termination,
      players: { w: this.players.w?.name || 'White', b: this.players.b?.name || 'Black' },
      moves: this.history,
      plyCount: this.history.length,
      durationMs: this.startedAt ? this._now() - this.startedAt : 0,
      timeControl: this.timeControl.toJSON(),
      pgn: this.pgn(),
      finalFen: this.fen,
      startedAt: this.startedAt,
      endedAt: this._now(),
      mode: this.mode
    }).summarise();
    this.emit('end', this.result);
    return this.result;
  }

  /** Position after `ply` half-moves — the review scrubber uses this. */
  fenAtPly(ply) {
    if (ply <= 0) return this.startFen;
    const record = this.history[ply - 1];
    return record ? record.fenAfter : this.fen;
  }

  /** The opponent's free move from the current position, or null. */
  nullMoveFen() { return passTurn(this.fen); }
}

function normaliseMove(move) {
  if (typeof move === 'string') {
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
      return { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move.slice(4) || undefined };
    }
    return move;   // SAN
  }
  return { from: move.from, to: move.to, promotion: move.promotion || undefined };
}

/** Can `colour` still force mate with the material it has? */
function hasMatingMaterial(fen, colour) {
  const board = fen.split(' ')[0];
  const mine = colour === WHITE ? board.replace(/[a-z]/g, '') : board.replace(/[A-Z]/g, '');
  const letters = mine.toLowerCase().replace(/[^pnbrqk]/g, '');
  if (/[pqr]/.test(letters)) return true;
  const knights = (letters.match(/n/g) || []).length;
  const bishops = (letters.match(/b/g) || []).length;
  return bishops >= 2 || (bishops >= 1 && knights >= 1) || knights >= 3;
}

export { COLOUR_NAME, WHITE, BLACK, START_FEN, MoveRecord, ChessClock, GameResult, TERMINATION };
export default ChessGame;
