/**
 * brilliance.js — is that sacrifice actually brilliant, and how brilliant?
 *
 * A brilliant move is not "a good move that happened to hang something". Most
 * hanging material is not a sacrifice at all: it is a fork you win back next
 * move, a piece that was trapped anyway and might as well go somewhere useful,
 * or a queen that is safe because taking it is mate. Calling those brilliant is
 * how a classifier ends up printing !! four times a game and meaning nothing.
 *
 * So the test here is a series of ways a candidate can FAIL, and the move is
 * brilliant only if it survives all of them:
 *
 *   1. the moment has to matter        — not already winning, not escaping check
 *   2. the position has to survive it  — a sacrifice into a lost game is a blunder
 *   3. material has to be offered      — and MORE than was already hanging
 *   4. taking has to be possible       — if every capture is punished at once by
 *                                        a bigger threat or mate, nothing was
 *                                        ever really given away
 *   5. the piece has to have a future  — a trapped piece is not sacrificed, it
 *                                        is spent, and if everything on offer
 *                                        was trapped there is no generosity in it
 *
 * The SCORE that comes out is not the engine's evaluation and deliberately has
 * nothing to do with it. Two sound sacrifices are equally correct; they are not
 * equally impressive. It measures the nerve the move took:
 *
 *   how much material  ×  how many ways it can be taken
 *                      ×  1.3 when a capture comes with check
 *                      ×  more when a small piece can take a big one
 *
 * A queen left en prise to a pawn scores far above a knight offered to a rook,
 * because it looks more like a mistake, and looking like a mistake is most of
 * what makes a brilliant move feel brilliant. The RPG pays out on this number,
 * not on the label.
 *
 * The shape of the test follows the public work of WintrCat (wintrchess-lib and
 * brilliant-moves-search); the thresholds, the centipawn scale and the code are
 * ours. Everything here is PURE: fens in, findings out, no engine and no DOM.
 * The caller supplies the two evaluations it already had.
 */

import { at, legalMoves } from '../core/rules.js';
import { see, seeCapture } from './boardAnalysis.js';
import { PIECE_VALUE, PIECE_NAME, KING, otherColour } from '../core/constants.js';
import { winProbability, scoreToCp } from './moveClassifier.js';

/** Tunables. Centipawns, and win probability in points out of 100. */
export const BRILLIANCE = Object.freeze({
  /** Material that has to be at stake before a piece counts as offered. */
  minimumOffer: 200,
  /** Above this the game is already won, and nothing in a won game is brilliant. */
  winningCp: 700,
  /** Below this after the move, the sacrifice did not work. */
  minimumWinProbability: 50,
  /* Score bands, for the label and for what the RPG pays. Calibrated against
     the scale the formula actually produces: a knight offered to a pawn is
     about 4, a rook about 7, a queen offered to one piece about 11, and only a
     queen with several ways to take it - or a queen and a piece at once, which
     is what both Fischer's Be6 and Legall's Nxe5 come out as - reaches the
     high teens. If the top band is not rare it is not a top band. */
  bands: Object.freeze([
    { id: 'sound',      from: 0,   label: 'Sound sacrifice' },
    { id: 'sharp',      from: 5,   label: 'Sharp sacrifice' },
    { id: 'spectacular',from: 10,  label: 'Spectacular sacrifice' },
    { id: 'immortal',   from: 16,  label: 'Immortal' }
  ])
});

/* ------------------------------------------------------------- hanging */

/**
 * Pieces of `colour` that the side to move can win material from.
 *
 * Not the same thing as boardAnalysis.hangingPieces: this one takes a minimum,
 * and it can hand back the CAPTURES themselves, which the danger test needs to
 * play out. `fen` must have the opponent of `colour` to move when
 * `withAttackerMoves` is asked for, which after a sacrifice it always is.
 *
 * @returns {{square, type, name, value, loss, attackerMoves}[]}
 */
export function offeredPieces(fen, colour, { minimumLoss = BRILLIANCE.minimumOffer,
                                             withAttackerMoves = false } = {}) {
  /* ONE board for the whole sweep.
     
     `see(fen, ...)` parses the FEN every time it is called, and this used to
     call it once per piece - then capturePunished called this whole function
     again per attacker, so a single sharp position cost hundreds of FEN
     parses and the detector ran for half a second after a move. seeCapture
     undoes every capture it plays, so one board is safe to reuse. */
  const board = at(fen);
  const enemy = otherColour(colour);
  const captures = withAttackerMoves
    ? legalMoves(fen).filter((m) => m.color === enemy && m.captured)
    : [];
  const out = [];
  for (const row of board.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== colour || cell.type === KING) continue;
      /* Nothing is at risk from nobody, and this is far cheaper than a swap. */
      if (!board.attackers(cell.square, enemy).length) continue;
      const loss = seeCapture(board, cell.square, enemy);
      if (loss < minimumLoss) continue;
      out.push({
        square: cell.square, type: cell.type, name: PIECE_NAME[cell.type],
        value: PIECE_VALUE[cell.type], loss,
        attackerMoves: captures.filter((m) => m.to === cell.square)
      });
    }
  }
  return out.sort((a, b) => b.loss - a.loss);
}

/** Total material `colour` currently has on offer. */
function offeredTotal(fen, colour) {
  return offeredPieces(fen, colour).reduce((sum, p) => sum + p.loss, 0);
}

/* ------------------------------------------------------------- trapped */

/**
 * Has this piece anywhere to go that does not simply lose it?
 *
 * A trapped piece is not sacrificed. Throwing a knight that was going to fall
 * anyway into the enemy camp may well be the best move on the board, but the
 * player did not give anything up to play it, and the whole point of the label
 * is the giving up.
 *
 * @param {string} fen  with `colour` to move, or it is passed for you
 */
function isTrapped(fen, square, { ignoreFrom = null } = {}) {
  const board = at(fen);
  const piece = board.get(square);
  if (!piece || piece.type === KING) return false;
  const source = fen.split(' ')[1] === piece.color ? fen : passTurn(fen);
  if (!source) return false;
  const enemy = otherColour(piece.color);
  for (const m of legalMoves(source)) {
    if (m.from !== square) continue;
    if (ignoreFrom && m.to === ignoreFrom) continue;
    const after = at(source);
    try {
      after.move({ from: m.from, to: m.to, promotion: m.promotion });
      /* A square where it survives, or a capture that pays for it. This runs
         after every move of a real game, so it may never be the thing that
         throws: a position it cannot read is one it has no opinion about. */
      if (see(after.fen(), m.to, enemy) < PIECE_VALUE[piece.type] * 0.5) return false;
    } catch { continue; }
  }
  return true;
}

/**
 * The same position with the other side to move; null when that is illegal.
 *
 * Illegal when the side that is GIVING UP the move is in check - it would be
 * leaving its king en prise, and the position that comes out is one where the
 * king can be captured. The guard used to test the wrong king (whether the NEW
 * mover was in check), and a sacrifice played while the opponent was in check
 * produced a position whose legal moves included taking the king. The move
 * generator happily returns it, the resulting FEN has no king in it, and the
 * next thing to parse that FEN throws - in the middle of a live game.
 */
function passTurn(fen) {
  try {
    if (at(fen).inCheck()) return null;
    const parts = fen.split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-';                     // an en-passant square belongs to the mover
    return at(parts.join(' ')).fen();
  } catch { return null; }
}

/* ---------------------------------------------------------------- score */

/**
 * How impressive is it? See the header: material, ways to take it, check, and
 * how small the piece that can take it is.
 *
 * Returned in PAWNS rather than centipawns, so the numbers read the way a
 * player talks: "that was a nine".
 */
export function brillianceScore(fenAfter, offered) {
  let total = 0;
  for (const piece of offered) {
    /* One capture per attacking SQUARE: two rooks on a file both taking on the
       same square is one idea, not two. */
    const seen = new Set();
    for (const attack of piece.attackerMoves) {
      if (seen.has(attack.from)) continue;
      seen.add(attack.from);
      const after = at(fenAfter);
      let move;
      /* `promotion` only when the capture ACTUALLY promotes. Passing a default
         'q' on an ordinary capture is rejected outright, which silently scored
         every sacrifice at zero. */
      try { move = after.move(capture(attack)); }
      catch { continue; }
      if (!move) continue;
      const attackerPawns = (attack.piece === 'k' ? 200 : PIECE_VALUE[attack.piece]) / 100;
      total += (piece.value / 100)
             * (after.inCheck() ? 1.3 : 1)
             * (1 + (10 - attackerPawns) / 30);
    }
  }
  return Math.round(total * 100) / 100;
}

/** A capture, in the shape chess.js accepts: no promotion unless it promotes. */
function capture(attack) {
  return attack.promotion
    ? { from: attack.from, to: attack.to, promotion: attack.promotion }
    : { from: attack.from, to: attack.to };
}

/** The band a score falls in. */
export function brillianceBand(score) {
  let band = BRILLIANCE.bands[0];
  for (const b of BRILLIANCE.bands) if (score >= b.from) band = b;
  return band;
}

/* ------------------------------------------------------------ the test */

/**
 * Was this move brilliant?
 *
 * @param {Object} input
 * @param {string} input.fenBefore
 * @param {string} input.fenAfter
 * @param {Object} input.move            chess.js verbose move that was played
 * @param {Object} input.playedScore     engine score after the move, MOVER's POV
 * @param {Object} [input.beforeScore]   engine score of the position before the
 *   move, mover's POV. A sacrifice in an already-won game is not brilliant.
 * @param {Object} [input.secondBestScore] score of the mover's second-best move
 *   BEFORE playing, mover's POV. Without it the "already winning anyway" test
 *   cannot run, and a move in a position with several winning ideas can be
 *   called brilliant when nothing was risked.
 * @param {boolean} [input.isBestMove]   the classifier's verdict. A move that is
 *   not the engine's choice is never brilliant, however pretty.
 * @returns {{brilliant:boolean, score:number, band:Object|null,
 *            offered:Array, reason:string}}
 */
export function evaluateBrilliance({
  fenBefore, fenAfter, move, playedScore,
  beforeScore = null, secondBestScore = null, isBestMove = true
}) {
  const no = (reason) => ({ brilliant: false, score: 0, band: null, offered: [], reason });
  const mover = move.color;

  if (!isBestMove) return no('not the engine move');

  /* 1. Does the moment matter? */
  if (at(fenBefore).inCheck()) return no('escaping check is not a sacrifice');
  if (move.promotion === 'q') return no('a queen promotion is its own reward');

  /* The game has to have been IN THE BALANCE. Note this asks about the
     position BEFORE, not after: the reference implementation disqualifies a
     move whose own result is winning, which is correct for mining a dataset of
     quiet brilliancies but throws away the whole Legall's Mate family - every
     sacrifice that ends the game on the spot scores +7 the moment it lands, and
     those are exactly the moves a player wants the game to shout about.
     What must not be brilliant is a sacrifice in a position that was already
     won, or one where an ordinary move won just as well. */
  if (secondBestScore && scoreToCp(secondBestScore) >= BRILLIANCE.winningCp) {
    return no('another move won just as easily');
  }
  if (beforeScore && scoreToCp(beforeScore) >= BRILLIANCE.winningCp) {
    return no('the game was already won');
  }
  const playedCp = scoreToCp(playedScore);

  /* 2. Did the position survive it? */
  if (winProbability(playedCp) < BRILLIANCE.minimumWinProbability) {
    return no('the position is worse after it');
  }

  /* 3. Was material actually offered, and MORE than already was? */
  const offered = offeredPieces(fenAfter, mover, { withAttackerMoves: true });
  if (!offered.length) return no('nothing is hanging');
  const before = offeredTotal(fenBefore, mover);
  const after = offered.reduce((sum, p) => sum + p.loss, 0);
  if (after < before) return no('less material hanging than before the move');

  /* 4. Did the pieces have anywhere else to be? Cheaper than the danger sweep
        below - one piece's escape squares against every capture of every
        offered piece - so it goes first. */
  if (isTrapped(fenBefore, move.from, { ignoreFrom: move.to })) {
    return no('the piece that moved was trapped anyway');
  }
  if (offered.every((p) => isTrapped(fenAfter, p.square))) {
    return no('everything on offer was trapped anyway');
  }

  /* 5. Can it be taken? If EVERY capture of EVERY offered piece runs into mate
        or hands back at least as much, the material was never really given. */
  const takeable = offered.some((piece) => piece.attackerMoves.some(
    (attack) => !capturePunished(fenAfter, attack, piece)));
  if (!takeable) return no('taking it loses more than it wins');

  const score = brillianceScore(fenAfter, offered);
  return {
    brilliant: true, score, band: brillianceBand(score), offered,
    reason: `offers ${offered.map((p) => p.name).join(' and ')} and holds`
  };
}

/**
 * After they take, do they immediately lose at least as much back, or get
 * mated? Then it was a trap, not a sacrifice.
 */
function capturePunished(fenAfter, attack, piece) {
  const board = at(fenAfter);
  let played;
  try { played = board.move(capture(attack)); }
  catch { return true; }
  if (!played) return true;
  const fen = board.fen();

  /* Mate in one for the sacrificer. Read off the SAN rather than by playing
     every reply on a cloned board: this runs for every capture of every
     offered piece after every move of a live game, and the clone-per-reply
     version was most of the time the whole detector took. chess.js writes the
     '#' while generating the move, so it is already paid for. */
  if (board.moves().some((san) => san.endsWith('#'))) return true;
  /* Or the taker is now the one hanging something this big. */
  const back = offeredPieces(fen, played.color, {
    minimumLoss: Math.max(BRILLIANCE.minimumOffer, piece.loss - 100)
  });
  return back.length > 0;
}

/**
 * What the RPG pays for it. Kept HERE rather than in the reward code so the
 * two numbers a player compares - the score they were shown and the xp they
 * were given - come from one place.
 *
 * Flat plus proportional: finding any sound sacrifice is worth something, and
 * the spectacular ones are worth several times as much without running away.
 */
export function brillianceRewards(score, { xpPerPoint = 15, baseXp = 50 } = {}) {
  const band = brillianceBand(score);
  return {
    band: band.id, label: band.label, score,
    xp: Math.round(baseXp + score * xpPerPoint),
    /* Focus back, because a sacrifice is the moment concentration pays for
       itself. Capped so it can never be a free refill. */
    focus: Math.min(20, Math.round(3 + score)),
    reputation: score >= 16 ? 2 : score >= 10 ? 1 : 0
  };
}

export default {
  BRILLIANCE, offeredPieces, brillianceScore, brillianceBand,
  evaluateBrilliance, brillianceRewards
};
