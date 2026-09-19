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
import { FOCUS, MASTERY, BOOK, GRADING, UNDO, HINTS, GUIDE } from '../data/config.js';
import { rollHint, refundFor, QUALITY_META } from '../core/focusHints.js';
import { legalMoves } from '../chess/core/rules.js';
import { PIECE_VALUE } from '../chess/core/constants.js';

/* Opponent recovery: how long one engine move may take, and how many tries
   before a safe fallback move is played instead. */
export const BOT_RECOVERY = { timeoutMs: 30000, attempts: 2 };

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});
const uciOf = (m) => m.from + m.to + (m.promotion || '');
const legalUcis = (fen) => new Set(legalMoves(fen).map(uciOf));

/**
 * A sensible move without an engine: mate if there is one, else the most
 * valuable capture, a check, development toward the centre - never the
 * engine's strength, but never a softlock either. Deterministic.
 */
export function fallbackMove(fen) {
  const moves = legalMoves(fen);
  if (!moves.length) return null;
  const value = (p) => (p ? PIECE_VALUE[p] || 0 : 0);
  let best = null;
  for (const m of moves) {
    let score = 0;
    if (m.san?.includes('#')) score += 100000;
    if (m.captured) score += value(m.captured) * 10 - Math.min(value(m.piece), 900);
    if (m.san?.includes('+')) score += 30;
    if (m.promotion) score += value(m.promotion);
    const file = m.to.charCodeAt(0) - 97; const rank = Number(m.to[1]) - 1;
    score += 6 - (Math.abs(3.5 - file) + Math.abs(3.5 - rank));
    if (!best || score > best.score) best = { uci: uciOf(m), score };
  }
  return best.uci;
}
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
    /* The Focus hint in play: { cost, fresh, plans:[{rank, quality, total, step, uci, san, fen, awaiting}] }.
       `fresh` until the player's next move, which settles any refund. */
    this.hint = null;
    this.lastGuided = null;   // { openingIds, ply }: the last position the book guide covered
    this.thinking = false;
    this.hintBusy = false;
    this._pending = [];
    this._listeners = new Set();
    this._botToken = 0;
    this.status = 'idle';
    /* One id per game: career.commitMatchResult pays a game out once only. */
    this.gameId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

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
    const plan = this._settleHint(record);
    this.playerMovesSinceUndo += 1;
    this._pending.push(this._grade(record, plan));
    await this.maybePlayBot();
    return record;
  }

  /**
   * The player moved while a hint was showing. Playing a plan's move follows
   * that plan (the others end); anything else ends them all. The first move
   * after buying a hint settles the refund: a lesser plan or no plan at all
   * gives some Focus back.
   * @returns {Object|null} the plan followed
   */
  _settleHint(record) {
    const hint = this.hint;
    if (!hint) return null;
    const showing = hint.plans.filter((p) => !p.awaiting && p.uci);
    const plan = showing.find((p) => p.uci === record.uci) || null;
    let refund = 0;
    if (hint.fresh) refund = plan ? refundFor({ cost: hint.cost, rank: plan.rank }) : showing.length ? refundFor({ cost: hint.cost, rank: null }) : 0;
    hint.fresh = false;
    if (refund) this.focus = Math.min(this.focusMax, this.focus + refund);
    if (plan) {
      plan.step += 1;
      record.hintQuality = plan.quality;
      if (plan.step < plan.total) {
        plan.awaiting = true;
        plan.uci = null;
        hint.plans = [plan];
      } else {
        this.hint = null;
      }
      this.emit('hint-follow', { plan, refund, done: plan.step >= plan.total });
    } else {
      this.hint = null;
      if (showing.length) this.emit('hint-ignored', { refund });
    }
    return plan;
  }

  /** After the opponent's reply: the next move of the plan being followed, drawn automatically. */
  async _continueHint() {
    const hint = this.hint;
    const plan = hint?.plans.find((p) => p.awaiting);
    if (!plan || !this.isPlayersTurn) return;
    const fen = this.game.fen;
    const ply = this.game.ply;
    try {
      const result = await this.service.analyze(fen, { ...HINTS.search, multiPv: 1, useCache: true });
      const uci = result.lines?.[0]?.pv?.[0];
      if (this.hint !== hint || this.game.ply !== ply || !uci) return;
      plan.uci = uci;
      plan.san = pvToSan(fen, [uci])[0];
      plan.fen = fen;
      plan.awaiting = false;
      this.emit('hint', { plans: [plan], rolls: null, continuation: true, quote: null });
    } catch {
      if (this.hint === hint) this.hint = null;
    }
  }

  /**
   * The opponent's move. It must ALWAYS arrive while the game is on: a
   * failed or hung engine is retried once, then a safe legal move is played
   * instead (bot-fallback), so the player can never be left waiting forever.
   * A call made stale by Undo or a newer call leaves the state to that one.
   */
  async maybePlayBot() {
    if (!this.game.waitingOnBot || this.game.status !== 'active') return null;
    const token = ++this._botToken;
    const stale = () => token !== this._botToken || this.game.status !== 'active';
    this.thinking = true;
    this.emit('thinking', true);
    try {
      const fen = this.game.fen;
      let uci = null;
      let lastError = null;
      for (let attempt = 0; attempt < BOT_RECOVERY.attempts && !uci; attempt += 1) {
        try {
          const choice = await withTimeout(this.bot.chooseMove(fen, { ply: this.game.ply }), BOT_RECOVERY.timeoutMs);
          if (stale()) return null;
          if (choice?.uci && legalUcis(fen).has(choice.uci)) uci = choice.uci;
          else lastError = new Error(`no legal move from the bot (${choice?.uci ?? 'none'})`);
        } catch (error) {
          if (stale()) return null;
          lastError = error;
          console.warn('[PapMatch] bot move failed', attempt + 1, error);
        }
      }
      const fallback = !uci;
      if (fallback) {
        uci = fallbackMove(fen);
        if (!uci) return null;                 // no legal moves: the game is already over
        this.emit('bot-error', lastError);
        this.emit('bot-fallback', { uci, error: lastError?.message || String(lastError) });
      } else {
        // A beat of "thinking" so an instant book reply does not feel robotic.
        await new Promise((r) => setTimeout(r, 250 + Math.random() * 350));
      }
      if (stale() || this.game.fen !== fen) return null;
      const record = this.game.move(uci);
      if (record) this._noteOpening(record);
      if (record && this.hint?.plans.some((p) => p.awaiting)) this._continueHint();
      return record;
    } catch (error) {
      console.error('[PapMatch] bot turn failed', error);
      this.emit('bot-error', error);
      return null;
    } finally {
      if (token === this._botToken) {
        this.thinking = false;
        this.emit('thinking', false);
      }
    }
  }

  /** Is the game waiting on an opponent move that nobody is computing? (the screen's watchdog asks) */
  get botStalled() {
    return this.status === 'active' && this.game.status === 'active' && this.game.waitingOnBot && !this.thinking;
  }

  _noteOpening(record) {
    for (const opening of this.book.reached(record.fenAfter)) {
      if (this.openingsReached.has(opening.id)) continue;
      this.openingsReached.add(opening.id);
      this.emit('opening', { opening, mastery: this.career.openings[opening.id] ?? 0 });
    }
  }

  async _grade(record, plan = null) {
    const followedHint = !!plan;
    try {
      await this.reviewer.annotate(record);
      if (record.undone) return;
      // Same position, same MultiPV: this is a cache hit, not a second search.
      const before = await this.service.review(record.fenBefore, { multiPv: REVIEW_LEVEL.multiPv, ...this.gradingSearch });
      let verdict = gradeMove(record, before.lines);
      if (!verdict.grade || record.undone) return;
      verdict = this._noRepeatSpecial(record, verdict);
      /* A move the hint showed is the hint's, not the player's find: it reads
         FOCUS in the plan's colour and earns nothing back. */
      if (followedHint) {
        record.shownGrade = verdict.grade;
        verdict = { ...verdict, grade: 'FOCUS', tier: QUALITY_META[plan.quality].tier, meta: GRADE_META.FOCUS, quality: plan.quality };
      }
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

  /**
   * Buy a hint: the engine's playable candidates, one roll each (see
   * core/focusHints.js). Plans that succeed are drawn at once, one move each;
   * the rest of a purple or gold plan follows after the opponent replies.
   */
  async requestHint(random = Math.random) {
    if (!this.isPlayersTurn || this.hintBusy) return { ok: false, reason: 'not-now' };
    const quote = this.quoteHint();
    if (this.focus < quote.cost) return { ok: false, reason: 'focus', quote };
    if (this.service.available === false) return { ok: false, reason: 'engine', quote };
    this.hintBusy = true;
    const fen = this.game.fen;
    const ply = this.game.ply;
    try {
      let result;
      try {
        result = await this.service.analyze(fen, { ...quote.search, multiPv: HINTS.candidates, useCache: true });
      } catch (error) {
        console.warn('[PapMatch] hint search failed', error);
        return { ok: false, reason: 'engine', quote };      // nothing was spent
      }
      if (!result.lines?.[0]?.pv?.length) return { ok: false, reason: this.service.available === false ? 'engine' : 'no-line' };
      if (this.game.ply !== ply) return { ok: false, reason: 'stale' };
      const { rolls, plans } = rollHint(result.lines, this.career.level, random);
      this.focus -= quote.cost;
      this.hintsUsed += 1;
      const drawn = plans.map((p) => ({ ...p, step: 0, fen, san: pvToSan(fen, [p.uci])[0], awaiting: false }));
      for (const r of rolls) r.san = pvToSan(fen, [r.uci])[0];
      // Nothing came to mind: most of the Focus comes straight back.
      let refund = 0;
      if (!drawn.length) {
        refund = refundFor({ cost: quote.cost, shown: false });
        this.focus = Math.min(this.focusMax, this.focus + refund);
        this.hint = null;
      } else {
        this.hint = { cost: quote.cost, fresh: true, plans: drawn };
      }
      const payload = { plans: drawn, rolls, continuation: false, quote, refund };
      this.emit('hint', payload);
      return { ok: true, hint: payload };
    } finally {
      this.hintBusy = false;
    }
  }

  /**
   * The guide past the book, for a MASTERED opening only: when the opponent
   * leaves the prepared lines, the player who knows the opening completely
   * still knows what to do, until the game passes the opening's longest line.
   * Free. @returns {Promise<Object[]>} guide entries, like guide()
   */
  async masteredGuide() {
    if (!GUIDE.masteredFillIn || !this.isPlayersTurn) return [];
    const mastery = equippedMastery(this.career);
    const ply = this.game.ply;
    const last = this.lastGuided;
    if (!last || last.ply < GUIDE.minBookPlies) return [];
    const opening = last.openingIds.map((id) => this.book.byId.get(id))
      .find((o) => o && (mastery[o.id] ?? 0) >= GUIDE.masteredAt && ply < Math.max(...o.lines.map((l) => l.length)));
    if (!opening || this.service.available === false) return [];
    const fen = this.game.fen;
    try {
      const result = await this.service.analyze(fen, { ...HINTS.search, multiPv: 1, useCache: true });
      const uci = result.lines?.[0]?.pv?.[0];
      if (!uci || this.game.ply !== ply || !this.isPlayersTurn) return [];
      return [{ from: uci.slice(0, 2), to: uci.slice(2, 4), uci, san: pvToSan(fen, [uci])[0], openingId: opening.id, main: true, mastered: true }];
    } catch {
      return [];
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
    this.hint = null;
    this.thinking = false;
    this.emit('thinking', false);
    this.emit('undo', { undone, state: this.undoState() });
    return { ok: true, undone };
  }

  /** Guide arrows from what the player already knows. Free, never the engine. */
  guide() {
    if (!this.isPlayersTurn) return [];
    const out = this.book.guide(this.game.fen, equippedMastery(this.career), { allBranchesAt: MASTERY.allBranchesAt });
    if (out.length) this.lastGuided = { openingIds: [...new Set(out.map((g) => g.openingId))], ply: this.game.ply };
    return out;
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
    // Grading is best-effort: a hung engine must not hold the result screen.
    await Promise.race([Promise.allSettled(this._pending), new Promise((r) => setTimeout(r, 8000))]);
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
