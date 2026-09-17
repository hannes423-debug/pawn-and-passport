/**
 * match.js - one Pawn & Passport game, wired end to end.
 *
 * The jam's replacement for Chess: World Tour's MatchSession. It keeps the
 * same core pieces (ChessGame, ChessBot, GameReview on the shared Stockfish
 * worker) and drops everything the jam removed: no skills, perks, abilities,
 * guidance sliders or loadouts. What it adds is small:
 *
 *   Focus   a per-game pool, refilled at the start, earned back by strong moves
 *   Hint    an active ability; cost and depth from js/core/hints.js
 *   Undo    an active ability: take back your last move and the reply
 *           (config UNDO: expensive, capped per game, cooldown in moves)
 *   Grades  every PLAYER move is annotated live and graded (incl. CLUTCH)
 *   Guide   arrows from the player's own opening knowledge
 *
 * Renderer-free: the match screen subscribes to events and draws.
 */

import { ChessGame } from '../chess/core/chessGame.js';
import { TIME_CONTROLS } from '../chess/core/timeControl.js';
import { engineService } from '../chess/engine/engineService.js';
import { REVIEW_LEVEL } from '../chess/engine/analysisLevels.js';
import { ChessBot } from '../chess/bots/chessBot.js';
import { GameReview } from '../chess/analysis/gameReview.js';
import { accuracyFromWinProbLoss } from '../chess/core/gameResult.js';
import { pvToSan, applyUci } from '../chess/core/rules.js';
import { otherColour } from '../chess/core/constants.js';
import { FOCUS, MASTERY, BOOK, GRADING, UNDO } from '../data/config.js';
import { profileForOpponent } from '../core/difficulty.js';
import { fullBook, bookForOpening } from '../core/openingBook.js';
import { hintQuote } from '../core/hints.js';
import { gradeMove, emptyGradeCounts, GRADE_META } from '../core/grading.js';
import { offeredPieces } from '../chess/analysis/brilliance.js';
import { matchScore } from '../core/scoring.js';
import { maxFocus, specialtyOpening, equippedMastery, undoUses } from '../core/career.js';

export class PapMatch {
  /**
   * @param {Object} o
   * @param {Object} o.career
   * @param {'friendly'|'tournament'|'star'|'finale'} o.kind
   * @param {{id,name,elo,style,openingId}} o.opponent
   * @param {'w'|'b'} o.playerColour
   */
  constructor({ career, kind, opponent, playerColour = 'w', service = engineService }) {
    this.career = career;
    this.kind = kind;
    this.opponent = opponent;
    this.playerColour = playerColour;
    this.service = service;
    this.book = fullBook;

    const preference = kind === 'star' || kind === 'finale' ? BOOK.starPreference : BOOK.regularPreference;
    this.profile = profileForOpponent({ ...opponent, openingPreference: preference });
    this.bot = new ChessBot(this.profile, {
      service,
      openingBook: opponent.openingId ? bookForOpening(opponent.openingId) : null
    });

    this.game = new ChessGame({
      timeControl: TIME_CONTROLS.find((tc) => tc.id === 'unlimited'),
      mode: 'career',
      allowUndo: true,          // gated by the Undo ability below, never free
      players: {
        [playerColour]: { name: career.name, kind: 'human', rating: career.elo },
        [otherColour(playerColour)]: { name: opponent.name, kind: 'bot', rating: opponent.elo }
      }
    });
    const { search, ...thresholds } = GRADING;
    this.gradingSearch = search;
    this.reviewer = new GameReview({ service, openingBook: this.book, thresholds, search });

    this.focusMax = maxFocus(career.level);
    this.focus = this.focusMax;
    this.hintsUsed = 0;
    /* Pieces the player had hanging when a special grade was awarded. Leaving
       the same piece en prise move after move (a fishing-pole trap the bot
       never takes) must not earn Brilliant/Epic/Clutch every move: only the
       move that first offered it does. */
    this.specialOffers = new Set();
    this.undosUsed = 0;
    this.undoMax = undoUses(career.level);
    this.playerMovesSinceUndo = Infinity;   // no cooldown before the first undo
    this.grades = emptyGradeCounts();
    this.openingsReached = new Set();
    this.lastHint = null;
    this.thinking = false;
    this.hintBusy = false;
    this._pending = [];
    this._listeners = new Set();
    this._botToken = 0;
    this.status = 'idle';

    this.game.on(({ type, payload }) => {
      if (type === 'end') this.status = 'finished';
      this.emit(type, payload);
    });
  }

  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit(type, payload = null) {
    for (const fn of [...this._listeners]) {
      try { fn({ type, payload, match: this }); } catch (error) { console.error('[PapMatch]', type, error); }
    }
  }

  get fen() { return this.game.fen; }
  get isPlayersTurn() { return this.game.status === 'active' && this.game.turn === this.playerColour; }

  async start() {
    if (this.status !== 'idle') return;
    this.status = 'active';
    await (this.service.retryIfUnavailable ? this.service.retryIfUnavailable() : this.service.ready()).catch(() => {});
    await this.service.newGame?.().catch(() => {});
    this.game.start();
    this.emit('ready');
    await this.maybePlayBot();
  }

  /* --------------------------------------------------------------- moves */

  async playMove(move) {
    if (!this.isPlayersTurn || this.thinking) return null;
    const record = this.game.move(move);
    if (!record) return null;
    this._noteOpening(record);
    const followedHint = !!this.lastHint && this.lastHint.uci === record.uci;
    this.lastHint = null;
    this.playerMovesSinceUndo += 1;
    this._pending.push(this._grade(record, followedHint));
    await this.maybePlayBot();
    return record;
  }

  async maybePlayBot() {
    if (!this.game.waitingOnBot || this.game.status !== 'active') return null;
    const token = ++this._botToken;
    this.thinking = true;
    this.emit('thinking', true);
    try {
      const choice = await this.bot.chooseMove(this.game.fen, { ply: this.game.ply });
      if (token !== this._botToken || this.game.status !== 'active' || !choice.uci) return null;
      // A beat of "thinking" so an instant book reply does not feel robotic.
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 350));
      if (token !== this._botToken || this.game.status !== 'active') return null;
      const record = this.game.move(choice.uci);
      if (record) this._noteOpening(record);
      return record;
    } catch (error) {
      console.error('[PapMatch] bot failed', error);
      this.emit('bot-error', error);
      return null;
    } finally {
      this.thinking = false;
      this.emit('thinking', false);
    }
  }

  _noteOpening(record) {
    for (const opening of this.book.reached(record.fenAfter)) {
      if (this.openingsReached.has(opening.id)) continue;
      this.openingsReached.add(opening.id);
      this.emit('opening', { opening, mastery: this.career.openings[opening.id] ?? 0 });
    }
  }

  async _grade(record, followedHint) {
    try {
      await this.reviewer.annotate(record);
      if (record.undone) return;
      // Same position, same MultiPV: this is a cache hit, not a second search.
      const before = await this.service.review(record.fenBefore, { multiPv: REVIEW_LEVEL.multiPv, ...this.gradingSearch });
      let verdict = gradeMove(record, before.lines);
      if (!verdict.grade || record.undone) return;
      verdict = this._noRepeatSpecial(record, verdict);
      record.grade = verdict.grade;
      this.grades[verdict.grade] = (this.grades[verdict.grade] || 0) + 1;
      let focusGain = 0;
      if (!followedHint && FOCUS.regen[verdict.grade] && this.status !== 'finished') {
        focusGain = Math.min(FOCUS.regen[verdict.grade], this.focusMax - this.focus);
        this.focus += focusGain;
      }
      record.focusGain = focusGain;
      this.emit('graded', { record, ...verdict, focusGain, followedHint });
    } catch (error) {
      /* Live grading is best-effort: with no engine the game is still chess. */
    }
  }

  /**
   * A special grade (EPIC, BRILLIANT, CLUTCH) only counts when the move offers
   * something NEW: if every piece the player has hanging after the move was
   * already hanging when an earlier special grade was given, it is the same
   * sacrifice still standing, and the move is graded by its plain quality.
   */
  _noRepeatSpecial(record, verdict) {
    if (!['EPIC', 'BRILLIANT', 'CLUTCH'].includes(verdict.grade)) return verdict;
    let hanging = [];
    try {
      const after = record.fenAfter || applyUci(record.fenBefore, record.uci)?.fen;
      hanging = offeredPieces(after, this.playerColour).map((p) => `${p.type}@${p.square}`);
    } catch { hanging = []; }
    const fresh = hanging.filter((key) => !this.specialOffers.has(key));
    if (hanging.length && !fresh.length) {
      const plain = record.mistakeClassification === 'EXCELLENT' ? 'EXCELLENT' : 'BEST';
      return { grade: plain, tier: GRADE_META[plain].tier, meta: GRADE_META[plain], repeatOffer: true };
    }
    for (const key of hanging) this.specialOffers.add(key);
    return verdict;
  }

  /* ---------------------------------------------------------------- hints */

  quoteHint() {
    return hintQuote({
      level: this.career.level, fen: this.game.fen, mastery: equippedMastery(this.career),
      specialty: specialtyOpening(this.career), book: this.book
    });
  }

  async requestHint() {
    if (!this.isPlayersTurn || this.hintBusy) return { ok: false, reason: 'not-now' };
    const quote = this.quoteHint();
    if (this.focus < quote.cost) return { ok: false, reason: 'focus', quote };
    if (this.service.available === false) return { ok: false, reason: 'engine', quote };
    this.hintBusy = true;
    const fen = this.game.fen;
    const ply = this.game.ply;
    try {
      const result = await this.service.analyze(fen, { ...quote.search, multiPv: 1, useCache: true });
      const line = result.lines?.[0];
      if (!line?.pv?.length) return { ok: false, reason: this.service.available === false ? 'engine' : 'no-line' };
      if (this.game.ply !== ply) return { ok: false, reason: 'stale' };
      this.focus -= quote.cost;
      this.hintsUsed += 1;
      const pv = line.pv.slice(0, quote.plies);
      const hint = { pv, san: pvToSan(fen, pv), ply, quote, uci: pv[0] };
      this.lastHint = hint;
      this.emit('hint', hint);
      return { ok: true, hint };
    } finally {
      this.hintBusy = false;
    }
  }

  /* ----------------------------------------------------------------- undo */

  /** Can Undo be used right now, and if not, why. */
  undoState() {
    const mine = this.game.history.filter((m) => m.color === this.playerColour);
    const left = Math.max(0, this.undoMax - this.undosUsed);
    const cooldown = Number.isFinite(this.playerMovesSinceUndo) ? Math.max(0, UNDO.cooldownMoves - this.playerMovesSinceUndo) : 0;
    let reason = null;
    if (this.game.status !== 'active') reason = 'over';
    else if (!left) reason = 'used';
    else if (cooldown) reason = 'cooldown';
    else if (!mine.length) reason = 'nothing';
    else if (this.focus < UNDO.cost) reason = 'focus';
    else if (this.hintBusy) reason = 'busy';
    return { ok: !reason, reason, cost: UNDO.cost, left, max: this.undoMax, cooldown };
  }

  /** Take back the player's last move (and the bot's reply, or its search). */
  undo() {
    const state = this.undoState();
    if (!state.ok) return { ok: false, ...state };
    this._botToken += 1;                   // a bot reply in flight is abandoned (its search is not stopped: that could cut a grading search short)
    const undone = [];
    // Pop until the player's own last move is gone and it is the player's turn.
    while (this.game.history.length) {
      const last = this.game.lastMove;
      const r = this.game.undo();
      if (!r.ok) break;
      undone.push(last);
      if (last.color === this.playerColour) break;
    }
    if (!undone.some((m) => m.color === this.playerColour)) return { ok: false, reason: 'nothing' };
    for (const record of undone) {
      record.undone = true;
      if (record.color !== this.playerColour) continue;
      if (record.grade && this.grades[record.grade]) this.grades[record.grade] -= 1;
      if (record.focusGain) this.focus = Math.max(0, this.focus - record.focusGain);
    }
    this.focus -= UNDO.cost;
    this.undosUsed += 1;
    this.playerMovesSinceUndo = 0;
    this.lastHint = null;
    this.thinking = false;
    this.emit('thinking', false);
    this.emit('undo', { undone, state: this.undoState() });
    return { ok: true, undone };
  }

  /** Guide arrows from what the player already knows. Free, never the engine. */
  guide() {
    if (!this.isPlayersTurn) return [];
    return this.book.guide(this.game.fen, equippedMastery(this.career), { allBranchesAt: MASTERY.allBranchesAt });
  }

  /* ------------------------------------------------------------- control */

  resign() { this._botToken += 1; return this.game.resign(this.playerColour); }

  /** The bot takes a draw only in a long, materially level game. */
  offerDraw() {
    const level = Math.abs(this._materialFor('w') - this._materialFor('b')) <= 100;
    if (this.game.ply >= 40 && level && !this.game.waitingOnBot) {
      this.game.offerDraw?.(this.playerColour);
      return this.game.acceptDraw();
    }
    return null;
  }

  _materialFor(colour) {
    const board = this.game.fen.split(' ')[0];
    const values = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
    let sum = 0;
    for (const ch of board) {
      const lower = ch.toLowerCase();
      if (!(lower in values)) continue;
      if ((ch === lower ? 'b' : 'w') === colour) sum += values[lower];
    }
    return sum;
  }

  /* -------------------------------------------------------------- summary */

  /** Everything the result screen and the career need, once grading settles. */
  async summary() {
    await Promise.allSettled(this._pending);
    const result = this.game.result;
    const score = result ? result.scoreFor(this.playerColour) : 0;
    const mine = this.game.history.filter((m) => m.color === this.playerColour);
    const losses = mine.map((m) => m.winProbLoss).filter((x) => typeof x === 'number');
    const accuracy = losses.length ? accuracyFromWinProbLoss(losses) : null;
    const checkmate = result?.termination === 'checkmate' && result.winner === this.playerColour;
    const grades = Object.fromEntries(Object.entries(this.grades).filter(([, n]) => n));
    const ms = matchScore({
      score, accuracy, grades, checkmate,
      playerElo: this.career.elo, opponentElo: this.opponent.elo, hintsUsed: this.hintsUsed, undosUsed: this.undosUsed
    });
    return {
      kind: this.kind, score, accuracy, grades, checkmate, hintsUsed: this.hintsUsed,
      opponentElo: this.opponent.elo, opponentName: this.opponent.name,
      matchScore: ms, openingsReached: [...this.openingsReached], undosUsed: this.undosUsed,
      headline: result?.headline || 'Game over', termination: result?.termination || null,
      plies: this.game.ply, pgn: result?.pgn || ''
    };
  }

  dispose() {
    this._botToken += 1;
    this.status = 'disposed';
    this.reviewer.cancel();
    this._listeners.clear();
  }
}

export default PapMatch;
