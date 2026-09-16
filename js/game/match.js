/**
 * match.js - one Pawn & Passport game, wired end to end.
 *
 * The jam's replacement for Chess: World Tour's MatchSession. It keeps the
 * same core pieces (ChessGame, ChessBot, GameReview on the shared Stockfish
 * worker) and drops everything the jam removed: no skills, perks, abilities,
 * guidance sliders or loadouts. What it adds is small:
 *
 *   Focus   a per-game pool, refilled at the start, earned back by strong moves
 *   Hint    the single active ability; cost and depth from js/core/hints.js
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
import { pvToSan } from '../chess/core/rules.js';
import { otherColour } from '../chess/core/constants.js';
import { FOCUS, MASTERY, BOOK, GRADING } from '../data/config.js';
import { profileForOpponent } from '../core/difficulty.js';
import { fullBook, bookForOpening } from '../core/openingBook.js';
import { hintQuote } from '../core/hints.js';
import { gradeMove, emptyGradeCounts } from '../core/grading.js';
import { matchScore } from '../core/scoring.js';
import { maxFocus, specialtyOpening, equippedMastery } from '../core/career.js';

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
    await this.service.ready().catch(() => {});
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
      // Same position, same MultiPV: this is a cache hit, not a second search.
      const before = await this.service.review(record.fenBefore, { multiPv: REVIEW_LEVEL.multiPv, ...this.gradingSearch });
      const verdict = gradeMove(record, before.lines);
      if (!verdict.grade) return;
      record.grade = verdict.grade;
      this.grades[verdict.grade] = (this.grades[verdict.grade] || 0) + 1;
      let focusGain = 0;
      if (!followedHint && FOCUS.regen[verdict.grade] && this.status !== 'finished') {
        focusGain = Math.min(FOCUS.regen[verdict.grade], this.focusMax - this.focus);
        this.focus += focusGain;
      }
      this.emit('graded', { record, ...verdict, focusGain, followedHint });
    } catch (error) {
      /* Live grading is best-effort: with no engine the game is still chess. */
    }
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
    this.hintBusy = true;
    const fen = this.game.fen;
    const ply = this.game.ply;
    try {
      const result = await this.service.analyze(fen, { ...quote.search, multiPv: 1, useCache: true });
      const line = result.lines?.[0];
      if (!line?.pv?.length || this.game.ply !== ply) return { ok: false, reason: 'no-line' };
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
      playerElo: this.career.elo, opponentElo: this.opponent.elo, hintsUsed: this.hintsUsed
    });
    return {
      kind: this.kind, score, accuracy, grades, checkmate, hintsUsed: this.hintsUsed,
      opponentElo: this.opponent.elo, opponentName: this.opponent.name,
      matchScore: ms, openingsReached: [...this.openingsReached],
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
