/**
 * chessBot.js — the opponent.
 *
 * The engine supplies a POOL of candidate moves (MultiPV). The personality
 * decides which one gets played. That split is the whole design: a 1750
 * aggressive attacker and a 1750 defensive grinder can share an engine level
 * and still produce different games, because they weight the same pool
 * differently.
 *
 * The bot never cheats: every move is legal, and it only ever sees the same
 * position the human sees.
 */

import { engineService } from '../engine/engineService.js';
import { levelById } from '../engine/analysisLevels.js';
import { legalMoves, at, phaseOf, totalMaterial, kingSquare } from '../core/rules.js';
import { detectMoveMotifs } from '../analysis/motifDetector.js';
import { scoreToCp, positionComplexity, sacrificeValue } from '../analysis/moveClassifier.js';
import { see, squaresBetween, clamp01 } from '../analysis/boardAnalysis.js';
import { BotProfile, BOT_DIFFICULTY } from './botProfile.js';
import { squareDistance, otherColour, PIECE_VALUE, KING } from '../core/constants.js';

/** A stable seed per opponent, so the same character replays identically. */
function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class ChessBot {
  /**
   * @param {BotProfile} profile
   * @param {{ service?:Object, random?:()=>number, openingBook?:Object }} [deps]
   */
  constructor(profile, { service = engineService, random = Math.random, openingBook = null,
                        } = {}) {
    this.profile = profile instanceof BotProfile ? profile : new BotProfile(profile);
    this.service = service;
    this.random = random;
    this.openingBook = openingBook;
    /** Populated on every move so the debug panel can show the bot's reasoning. */
    this.lastDecision = null;

    /* Pawn & Passport: the Chess DNA / real-player style layer is removed from
       this fork. Opponents are a target Elo, an archetype and a club opening. */
  }

  get name() { return this.profile.name; }

  /**
   * Choose a move.
   * @param {string} fen
   * @param {{ clockMs?:number|null, incrementMs?:number, signal?:AbortSignal, ply?:number }} [context]
   * @returns {Promise<{uci:string|null, san:string|null, reason:string, candidates:Array}>}
   */
  async chooseMove(fen, context = {}) {
    const legal = legalMoves(fen);
    if (!legal.length) return { uci: null, san: null, reason: 'no-legal-moves', candidates: [] };
    if (legal.length === 1) {
      const only = legal[0];
      return this._decide(only, [], 'only legal move', fen);
    }

    // 1. Opening book, if the bot follows one and the line is still in it.
    const book = this._bookMove(fen, context);
    if (book) return this._decide(book.move, [], `book: ${book.name}`, fen, { book });

    // 3. Random-beginner and blunder rolls happen BEFORE the engine is asked,
    //    so a weak bot genuinely plays weak moves rather than filtered strong ones.
    if (this.profile.difficulty === BOT_DIFFICULTY.RANDOM_BEGINNER || this.random() < this.profile.blunderChance) {
      const move = this._humanLikeRandom(fen, legal);
      return this._decide(move, [], 'personality: unforced error', fen);
    }

    // 4. Candidate pool from the engine.
    const level = levelById(this.profile.analysisLevel);
    const movetime = this._movetime(context, level);
    const result = await this.service.analyze(fen, {
      level: this.profile.analysisLevel,
      multiPv: Math.max(1, this.profile.candidatePool),
      movetime,
      limitStrength: this.profile.limitStrength,
      signal: context.signal,
      useCache: this.profile.difficulty === BOT_DIFFICULTY.ENGINE
    });

    if (!result.lines?.length) {
      const fallback = result.bestMove
        ? legal.find((m) => m.from + m.to + (m.promotion || '') === result.bestMove)
        : this._humanLikeRandom(fen, legal);
      return this._decide(fallback || legal[0], [], 'engine fallback', fen);
    }

    // 5. Engine's raw first choice, no personality.
    if (this.profile.difficulty === BOT_DIFFICULTY.ENGINE) {
      const best = legal.find((m) => m.from + m.to + (m.promotion || '') === result.lines[0].move);
      return this._decide(best || legal[0], result.lines, 'engine first choice', fen);
    }

    // 6. Score every candidate through the personality.
    const topCp = scoreToCp(result.lines[0].score);
    const candidates = [];
    for (const line of result.lines) {
      const move = legal.find((m) => m.from + m.to + (m.promotion || '') === line.move);
      if (!move) continue;
      const cp = scoreToCp(line.score);
      const loss = topCp - cp;
      if (loss > this.profile.maxEvalLossCp) continue;
      const style = this._styleScore(fen, move, { cp, loss, complexity: null });
      candidates.push({
        move, line, cp, loss,
        styleScore: style.total, styleReasons: style.reasons,
        // Objective quality, then personality. `strength` sets how heavily an
        // evaluation loss is punished: a weak bot barely notices, a strong one
        // will not pay more than a few centipawns for a style preference.
        // The style weight is deliberately smaller than the loss weight, so
        // personality breaks TIES and nudges close calls rather than choosing
        // materially worse moves.
        total: -loss * (0.6 + this.profile.strength * 1.9) + style.total * (55 * (1.1 - this.profile.strength))
      });
    }
    if (!candidates.length) {
      const best = legal.find((m) => m.from + m.to + (m.promotion || '') === result.lines[0].move);
      return this._decide(best || legal[0], result.lines, 'no candidate survived filtering', fen);
    }

    // 6. Softmax selection — a weaker bot is noisier about its own preferences.
    const chosen = this._sample(candidates);
    const reason = chosen.styleReasons.length
      ? `${this.profile.styleLabel.toLowerCase()}: ${chosen.styleReasons.slice(0, 2).join(', ')}`
      : `${this.profile.styleLabel.toLowerCase()} pick (−${chosen.loss}cp)`;
    return this._decide(chosen.move, result.lines, reason, fen, { candidates, chosen });
  }

  /* --------------------------------------------------------- personality */

  /**
   * How much does this bot WANT to play this move, ignoring how good it is?
   * @returns {{ total:number, reasons:string[] }}
   */
  _styleScore(fen, move, { cp, loss }) {
    const p = this.profile;
    const reasons = [];
    let total = 0;
    const add = (amount, why) => { if (Math.abs(amount) >= 0.08) { total += amount; if (amount > 0) reasons.push(why); } };

    const board = at(fen);
    const side = move.color;
    const enemy = otherColour(side);
    const enemyKing = kingSquare(fen, enemy);
    const phase = phaseOf(fen);
    const motifs = detectMoveMotifs(fen, move);
    const motifTypes = new Set(motifs.map((m) => m.type));

    // Forcing, concrete play.
    const forcing = motifTypes.has('CHECK') || motifTypes.has('MATE') ||
                    motifTypes.has('DOUBLE_CHECK') || motifTypes.has('DISCOVERED_CHECK') || !!move.captured;
    if (forcing) add((p.tacticalBias - 0.5) * 1.2, 'forcing move');
    if (motifTypes.has('FORK') || motifTypes.has('DOUBLE_ATTACK')) add(p.tacticalBias * 0.9, 'double attack');
    if (motifTypes.has('PIN') || motifTypes.has('SKEWER')) add(p.tacticalBias * 0.5, 'pin or skewer');

    // Attacking the king. Only pieces count, and only inside the king's zone —
    // otherwise a rook-file pawn push scores as an "attack" purely because the
    // straight-line distance shrank.
    if (enemyKing && move.piece !== 'p' && move.piece !== KING) {
      const closer = squareDistance(move.from, enemyKing) - squareDistance(move.to, enemyKing);
      const inZone = squareDistance(move.to, enemyKing) <= 3;
      if (closer > 0 && inZone) add((p.aggression - 0.4) * 0.45 * closer, 'moves toward the king');
      if (motifTypes.has('MATING_ATTACK')) add(p.aggression * 0.8, 'builds an attack');
    }
    // A pawn storm only counts when the pawn is on the king's side of the board.
    if (enemyKing && move.piece === 'p' && squareDistance(move.to, enemyKing) <= 3) {
      add((p.aggression - 0.5) * 0.5, 'pawn storm');
    }

    // Risk: does this move offer material or invite complications?
    const sacrifice = sacrificeValue(fen, move);
    if (sacrifice.isSacrifice) {
      add((p.riskTolerance - 0.5) * 1.6 * clamp01(sacrifice.offered / 500), 'offers material');
    }

    // Trades and simplification.
    if (move.captured) {
      const evenTrade = PIECE_VALUE[move.captured] >= PIECE_VALUE[move.piece] * 0.9;
      if (evenTrade) add((p.simplificationPreference - 0.5) * 0.9, 'trades pieces');
    }

    // Complexity: how sharp is the position it leaves behind?
    const after = at(fen);
    try { after.move({ from: move.from, to: move.to, promotion: move.promotion }); } catch { /* impossible: it is legal */ }
    const complexity = positionComplexity(after.fen());
    add((p.complexityPreference - 0.5) * (complexity - 0.45) * 2.2,
      p.complexityPreference > 0.5 ? 'keeps it sharp' : 'keeps it simple');

    // Steering toward or away from an endgame.
    if (move.captured && phase !== 'endgame') {
      const materialAfter = totalMaterial(after.fen());
      if (materialAfter < 2000) add((p.endgamePreference - 0.5) * 1.1, 'heads for the endgame');
    }
    if (phase === 'endgame') add((p.endgamePreference - 0.5) * 0.4, 'endgame comfort');

    // Practicality: never leave a piece hanging for a style point.
    const hangs = see(after.fen(), move.to, enemy);
    if (hangs > 100 && !sacrifice.isSacrifice) add(-1.5, '');

    return { total, reasons };
  }

  /**
   * Weighted random choice. Temperature falls as strength rises, so a
   * grandmaster bot almost always takes its top pick while a beginner bot
   * genuinely wanders.
   */
  _sample(candidates) {
    const temperature = 0.3 + (1 - this.profile.strength) * 1.6;
    const max = Math.max(...candidates.map((c) => c.total));
    const weights = candidates.map((c) => Math.exp((c.total - max) / (temperature * 45)));
    const sum = weights.reduce((a, b) => a + b, 0);
    let roll = this.random() * sum;
    for (let i = 0; i < candidates.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) return candidates[i];
    }
    return candidates[0];
  }

  /**
   * A weak bot's error should look human: prefer a plausible-but-bad move
   * (a capture, a check, a developing move) over a genuinely random shuffle.
   */
  _humanLikeRandom(fen, legal) {
    if (this.profile.difficulty === BOT_DIFFICULTY.RANDOM_BEGINNER && this.random() < 0.6) {
      return legal[Math.floor(this.random() * legal.length)];
    }
    /* A weak player's mistake still LOOKS like a move: a capture, a check, a
       piece going somewhere. What separates a 400 from a 1200 is not how often
       they err but how MUCH it costs - the 400 leaves a queen hanging, the
       1200 drops a pawn. `blunderSeverityCp` is that budget, and the static
       exchange on the destination square is what it is spent on. */
    const budget = this.profile.blunderSeverityCp ?? 100000;
    /* WILDNESS is what separates a 400 from a 1200 when they both err. The
       1200's mistake is still a move with an idea behind it - a capture, a
       check, a piece going somewhere - it is just the wrong one. The 400 plays
       something with no idea behind it at all. Openings stay sensible either
       way, because the book runs before any of this. */
    const wild = this.random() < (this.profile.wildness ?? 0);
    const plausible = legal.filter((m) => m.captured || m.san.includes('+') || m.piece !== 'p');
    let pool = wild || !plausible.length ? legal : plausible;
    // A king wandering out for no reason is not a mistake a human makes; every
    // other kind is. Only when nothing else is legal does the king go.
    const notKing = pool.filter((m) => m.piece !== KING);
    if (notKing.length) pool = notKing;
    const affordable = pool.filter((m) => this._moveRisk(fen, m) <= budget);
    const choosable = affordable.length ? affordable : pool;
    return choosable[Math.floor(this.random() * choosable.length)];
  }

  /**
   * Centipawns this move hands over on the spot: what the piece it moves is
   * worth if the square it lands on is simply taken, minus whatever it took.
   * Static and cheap - it is the "you just hung that" a beginner misses, not
   * an evaluation.
   */
  _moveRisk(fen, move) {
    const after = at(fen);
    const played = after.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
    if (!played) return 0;
    const taken = move.captured ? (PIECE_VALUE[move.captured] || 0) : 0;
    const exposed = see(after.fen(), move.to, otherColour(move.color));
    return Math.max(0, exposed - taken);
  }

  /* ------------------------------------------------------------- timing */

  /** Milliseconds to think, shaped by the clock and the bot's time management. */
  _movetime(context, level) {
    const base = level.movetime || 400;
    const remaining = context.clockMs;
    if (remaining === null || remaining === undefined) return base;
    // Budget roughly 1/30th of the remaining time, then let timeManagement
    // decide how disciplined the bot is about that budget.
    const budget = remaining / 30 + (context.incrementMs || 0) * 0.7;
    const discipline = 0.5 + this.profile.timeManagement * 0.5;
    const target = Math.min(base, budget * discipline);
    return Math.max(60, Math.round(target));
  }

  /* --------------------------------------------------------------- book */

  _bookMove(fen, context) {
    if (!this.openingBook) return null;
    if (this.random() > this.profile.openingPreference) return null;
    const entry = this.openingBook.lookup?.(fen, { preferences: this.profile.openingPreferences });
    if (!entry?.moves?.length) return null;
    const choice = entry.moves[Math.floor(this.random() * Math.min(entry.moves.length, 2))];
    const move = legalMoves(fen).find((m) => m.san === choice.san || m.from + m.to === choice.uci);
    return move ? { move, name: entry.name } : null;
  }

  /* -------------------------------------------------------------- output */

  _decide(move, lines, reason, fen, extra = {}) {
    const uci = move.from + move.to + (move.promotion || '');
    this.lastDecision = {
      fen, uci, san: move.san, reason,
      profile: this.profile.toJSON(),
      poolSize: lines.length,
      pool: lines.map((line) => ({ san: line.san, score: line.score })),
      ...extra
    };
    return { uci, san: move.san, reason, candidates: lines, decision: this.lastDecision };
  }
}

export default ChessBot;
