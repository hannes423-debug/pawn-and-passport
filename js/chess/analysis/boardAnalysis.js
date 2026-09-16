/**
 * boardAnalysis.js — deterministic board-state primitives.
 *
 * Everything the tactical layer needs that does NOT require an engine:
 * attack maps, defenders, static exchange evaluation, alignment/ray geometry,
 * hanging pieces, mobility and king safety. Stockfish is used later to VERIFY
 * significance, but detection starts here so the game works with the engine
 * off, offline and on a phone.
 *
 * Every function takes a FEN and returns plain data.
 */

import { at, attackersOf, kingSquare, legalMoves, passTurn } from '../core/rules.js';
import {
  PIECE_VALUE, PIECE_NAME, WHITE, BLACK, otherColour, KING, PAWN, QUEEN, ROOK, BISHOP, KNIGHT,
  fileIndex, rankIndex, squareAt, isSlider, RAYS
} from '../core/constants.js';

/* --------------------------------------------------------------- geometry */

/**
 * Direction from `a` to `b` if they share a rank, file or diagonal.
 * @returns {[number,number]|null} unit step in [file, rank]
 */
export function directionBetween(a, b) {
  const df = fileIndex(b) - fileIndex(a);
  const dr = rankIndex(b) - rankIndex(a);
  if (df === 0 && dr === 0) return null;
  if (df === 0) return [0, Math.sign(dr)];
  if (dr === 0) return [Math.sign(df), 0];
  if (Math.abs(df) === Math.abs(dr)) return [Math.sign(df), Math.sign(dr)];
  return null;
}

/** Squares strictly between two aligned squares; [] when not aligned. */
export function squaresBetween(a, b) {
  const dir = directionBetween(a, b);
  if (!dir) return [];
  const out = [];
  let f = fileIndex(a) + dir[0];
  let r = rankIndex(a) + dir[1];
  while (true) {
    const sq = squareAt(f, r);
    if (!sq || sq === b) break;
    out.push(sq);
    f += dir[0]; r += dir[1];
  }
  return out;
}

/** Walk a ray from `square`, returning every square until (and including) the first piece. */
export function rayFrom(board, square, dir) {
  const path = [];
  let f = fileIndex(square) + dir[0];
  let r = rankIndex(square) + dir[1];
  while (true) {
    const sq = squareAt(f, r);
    if (!sq) break;
    const piece = board.get(sq);
    path.push({ square: sq, piece: piece || null });
    if (piece) break;
    f += dir[0]; r += dir[1];
  }
  return path;
}

/** Every piece a slider on `square` sees along `dir`, in order, ignoring nothing. */
export function piecesAlongRay(board, square, dir) {
  const out = [];
  let f = fileIndex(square) + dir[0];
  let r = rankIndex(square) + dir[1];
  while (true) {
    const sq = squareAt(f, r);
    if (!sq) break;
    const piece = board.get(sq);
    if (piece) out.push({ square: sq, ...piece });
    f += dir[0]; r += dir[1];
  }
  return out;
}

/* ------------------------------------------------------------ occupancy */

/** [{square, type, color, value}] for every piece on the board. */
export function pieceList(fen) {
  const board = at(fen);
  const out = [];
  for (const row of board.board()) {
    for (const cell of row) {
      if (cell) out.push({ square: cell.square, type: cell.type, color: cell.color, value: PIECE_VALUE[cell.type] });
    }
  }
  return out;
}

/**
 * Attackers and defenders of every occupied square.
 * @returns {Map<string, {piece, attackers:string[], defenders:string[], attackedBy:'w'|'b'}>}
 */
export function contactMap(fen) {
  const board = at(fen);
  const map = new Map();
  for (const piece of pieceList(fen)) {
    const enemy = otherColour(piece.color);
    map.set(piece.square, {
      ...piece,
      attackers: board.attackers(piece.square, enemy),
      defenders: board.attackers(piece.square, piece.color)
    });
  }
  return map;
}

/* --------------------------------------------- static exchange evaluation */

/**
 * Static exchange evaluation: material `side` nets by initiating a capture
 * sequence on `square`, in centipawns. Positive = winning material, 0 = the
 * exchange is not worth starting.
 *
 * Runs the swap on a real board and re-queries attackers after every capture,
 * so x-ray discoveries (a rook behind a rook, a queen behind a bishop) are
 * handled correctly rather than approximated. Each side may stand pat, which
 * is what the Math.max(0, ...) expresses.
 */
export function see(fen, square, side) {
  return seeCapture(at(fen), square, side);
}

/** The value of `side` capturing on `square`, assuming best play by both. */
function seeCapture(board, square, side) {
  const occupant = board.get(square);
  if (!occupant || occupant.color === side) return 0;
  const attacker = leastValuableAttacker(board, square, side);
  if (!attacker) return 0;
  const gain = PIECE_VALUE[occupant.type];
  const undo = applyCapture(board, attacker.square, square, attacker);
  const value = Math.max(0, gain - seeCapture(board, square, otherColour(side)));
  undo();
  return value;
}

function leastValuableAttacker(board, square, side) {
  const squares = board.attackers(square, side);
  let best = null;
  for (const from of squares) {
    const piece = board.get(from);
    if (!piece) continue;
    if (!best || PIECE_VALUE[piece.type] < PIECE_VALUE[best.type]) best = { square: from, ...piece };
  }
  return best;
}

function applyCapture(board, from, to, attacker) {
  const captured = board.get(to);
  board.remove(from);
  board.remove(to);
  board.put({ type: attacker.type, color: attacker.color }, to);
  return () => {
    board.remove(to);
    if (captured) board.put({ type: captured.type, color: captured.color }, to);
    board.put({ type: attacker.type, color: attacker.color }, from);
  };
}

/* ------------------------------------------------------ hanging & loose */

/**
 * Pieces of `colour` that lose material if the opponent simply takes them.
 * `severity` is 0..1 scaled by the value at stake.
 */
export function hangingPieces(fen, colour) {
  const board = at(fen);
  const enemy = otherColour(colour);
  const out = [];
  for (const piece of pieceList(fen)) {
    if (piece.color !== colour || piece.type === KING) continue;
    const attackers = board.attackers(piece.square, enemy);
    if (!attackers.length) continue;
    const defenders = board.attackers(piece.square, colour);
    const exchange = seeCapture(at(fen), piece.square, enemy);
    if (exchange <= 0) continue;
    out.push({
      square: piece.square,
      type: piece.type,
      name: PIECE_NAME[piece.type],
      color: colour,
      value: piece.value,
      attackers, defenders,
      undefended: defenders.length === 0,
      materialAtRisk: exchange,
      severity: clamp01(exchange / 900)
    });
  }
  return out.sort((a, b) => b.materialAtRisk - a.materialAtRisk);
}

/** Undefended pieces, whether or not currently attacked ("loose pieces drop off"). */
export function loosePieces(fen, colour) {
  const board = at(fen);
  return pieceList(fen)
    .filter((p) => p.color === colour && p.type !== KING && p.type !== PAWN)
    .filter((p) => board.attackers(p.square, colour).length === 0)
    .map((p) => ({ square: p.square, type: p.type, name: PIECE_NAME[p.type], value: p.value }));
}

/* ----------------------------------------------------------- pins/skewers */

/**
 * Pins and skewers against `colour`, found geometrically.
 *
 * Walking every enemy slider ray: the first friendly piece is the front piece,
 * the next piece on the same ray is the rear piece. If the rear piece is worth
 * more (or is the king) it is a PIN; if the front piece is worth more it is a
 * SKEWER.
 */
export function pinsAndSkewers(fen, colour) {
  const board = at(fen);
  const enemy = otherColour(colour);
  const out = [];
  for (const piece of pieceList(fen)) {
    if (piece.color !== enemy || !isSlider(piece.type)) continue;
    for (const dir of RAYS[piece.type]) {
      const line = piecesAlongRay(board, piece.square, dir);
      if (line.length < 2) continue;
      const [front, rear] = line;
      if (front.color !== colour || rear.color !== colour) continue;
      const frontValue = PIECE_VALUE[front.type];
      const rearValue = PIECE_VALUE[rear.type];
      const absolute = rear.type === KING;
      if (absolute || rearValue > frontValue) {
        out.push({
          type: 'PIN', absolute,
          attacker: { square: piece.square, type: piece.type, name: PIECE_NAME[piece.type] },
          pinned: { square: front.square, type: front.type, name: PIECE_NAME[front.type] },
          behind: { square: rear.square, type: rear.type, name: PIECE_NAME[rear.type] },
          line: squaresBetween(piece.square, rear.square),
          value: absolute ? frontValue : rearValue - frontValue
        });
      } else if (frontValue > rearValue) {
        out.push({
          type: 'SKEWER',
          attacker: { square: piece.square, type: piece.type, name: PIECE_NAME[piece.type] },
          front: { square: front.square, type: front.type, name: PIECE_NAME[front.type] },
          behind: { square: rear.square, type: rear.type, name: PIECE_NAME[rear.type] },
          line: squaresBetween(piece.square, rear.square),
          value: rearValue
        });
      }
    }
  }
  return out;
}

/** Is the piece on `square` pinned against its own king? */
export function isAbsolutelyPinned(fen, square) {
  const piece = at(fen).get(square);
  if (!piece) return false;
  return pinsAndSkewers(fen, piece.color)
    .some((p) => p.type === 'PIN' && p.absolute && p.pinned.square === square);
}

/* ------------------------------------------------------------ overload */

/**
 * Defenders carrying more than one job. Removing or deflecting them wins
 * material somewhere. A defender is overloaded when it is the sole defender of
 * two or more attacked friendly pieces.
 */
export function overloadedDefenders(fen, colour) {
  const board = at(fen);
  const enemy = otherColour(colour);
  const duties = new Map();
  for (const piece of pieceList(fen)) {
    if (piece.color !== colour || piece.type === KING) continue;
    const attackers = board.attackers(piece.square, enemy);
    if (!attackers.length) continue;
    const defenders = board.attackers(piece.square, colour);
    if (defenders.length !== 1) continue;
    const defender = defenders[0];
    if (!duties.has(defender)) duties.set(defender, []);
    duties.get(defender).push({ square: piece.square, type: piece.type, name: PIECE_NAME[piece.type] });
  }
  const out = [];
  for (const [square, protecting] of duties) {
    if (protecting.length < 2) continue;
    const piece = board.get(square);
    out.push({
      type: 'OVERLOAD',
      defender: { square, type: piece.type, name: PIECE_NAME[piece.type] },
      protecting,
      severity: clamp01(protecting.length / 3)
    });
  }
  return out;
}

/* ----------------------------------------------------------- king safety */

/**
 * King safety for `colour`. Not an engine evaluation — a set of countable
 * facts the explanation layer can quote.
 */
export function kingSafety(fen, colour) {
  const board = at(fen);
  const square = kingSquare(fen, colour);
  if (!square) return null;
  const enemy = otherColour(colour);
  const ring = neighbours(square);
  const attackedRing = ring.filter((sq) => board.isAttacked(sq, enemy));
  const shieldFiles = [fileIndex(square) - 1, fileIndex(square), fileIndex(square) + 1].filter((f) => f >= 0 && f <= 7);
  const forward = colour === WHITE ? 1 : -1;
  let shield = 0;
  for (const f of shieldFiles) {
    for (let step = 1; step <= 2; step += 1) {
      const sq = squareAt(f, rankIndex(square) + forward * step);
      if (!sq) continue;
      const piece = board.get(sq);
      if (piece && piece.type === PAWN && piece.color === colour) { shield += 1; break; }
    }
  }
  const openFiles = shieldFiles.filter((f) => !fileHasPawn(board, f, colour));
  return {
    square,
    ringSize: ring.length,
    attackedRing,
    attackedRingCount: attackedRing.length,
    pawnShield: shield,
    pawnShieldMax: shieldFiles.length,
    openFilesNearKing: openFiles.length,
    inCheck: board.isAttacked(square, enemy),
    /** 0 (safe) .. 1 (very exposed) */
    exposure: clamp01(
      attackedRing.length / Math.max(1, ring.length) * 0.6 +
      (shieldFiles.length - shield) / Math.max(1, shieldFiles.length) * 0.25 +
      openFiles.length / Math.max(1, shieldFiles.length) * 0.15
    )
  };
}

function fileHasPawn(board, fileIdx, colour) {
  for (let r = 0; r < 8; r += 1) {
    const sq = squareAt(fileIdx, r);
    const piece = board.get(sq);
    if (piece && piece.type === PAWN && piece.color === colour) return true;
  }
  return false;
}

export function neighbours(square) {
  const out = [];
  for (const [df, dr] of [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]]) {
    const sq = squareAt(fileIndex(square) + df, rankIndex(square) + dr);
    if (sq) out.push(sq);
  }
  return out;
}

/* ------------------------------------------------------------ structure */

/** Passed, isolated, doubled and backward pawns for `colour`. */
export function pawnStructure(fen, colour) {
  const board = at(fen);
  const mine = pieceList(fen).filter((p) => p.color === colour && p.type === PAWN);
  const theirs = pieceList(fen).filter((p) => p.color !== colour && p.type === PAWN);
  const forward = colour === WHITE ? 1 : -1;
  const byFile = new Map();
  for (const pawn of mine) {
    const f = fileIndex(pawn.square);
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(pawn);
  }
  const passed = [];
  const isolated = [];
  const doubled = [];
  for (const pawn of mine) {
    const f = fileIndex(pawn.square);
    const r = rankIndex(pawn.square);
    const blockers = theirs.filter((enemyPawn) => {
      const ef = fileIndex(enemyPawn.square);
      const er = rankIndex(enemyPawn.square);
      return Math.abs(ef - f) <= 1 && (er - r) * forward > 0;
    });
    if (!blockers.length) passed.push({ square: pawn.square, distanceToPromotion: colour === WHITE ? 7 - r : r });
    if (!byFile.has(f - 1) && !byFile.has(f + 1)) isolated.push({ square: pawn.square });
    if ((byFile.get(f) || []).length > 1) doubled.push({ square: pawn.square });
  }
  return { count: mine.length, passed, isolated, doubled };
}

/**
 * Outposts: squares in enemy territory a knight or bishop occupies that no
 * enemy pawn can ever attack.
 */
export function outposts(fen, colour) {
  const board = at(fen);
  const enemyPawns = pieceList(fen).filter((p) => p.color !== colour && p.type === PAWN);
  const forward = colour === WHITE ? 1 : -1;
  const out = [];
  for (const piece of pieceList(fen)) {
    if (piece.color !== colour) continue;
    if (piece.type !== KNIGHT && piece.type !== BISHOP) continue;
    const r = rankIndex(piece.square);
    const advanced = colour === WHITE ? r >= 4 : r <= 3;
    if (!advanced) continue;
    const f = fileIndex(piece.square);
    const canBeKicked = enemyPawns.some((p) => {
      const pf = fileIndex(p.square);
      const pr = rankIndex(p.square);
      return Math.abs(pf - f) === 1 && (r - pr) * forward > 0;
    });
    if (canBeKicked) continue;
    const supported = board.attackers(piece.square, colour)
      .some((sq) => board.get(sq)?.type === PAWN);
    out.push({ square: piece.square, type: piece.type, name: PIECE_NAME[piece.type], supported });
  }
  return out;
}

/* ----------------------------------------------------------- mobility */

/** Legal-move count for `colour`, using a null move when it is not their turn. */
export function mobility(fen, colour) {
  if (fen.split(' ')[1] === colour) return legalMoves(fen).length;
  const passed = passTurn(fen);
  return passed ? legalMoves(passed).length : 0;
}

/**
 * Pieces with almost nowhere to go and an enemy attack incoming — the
 * trapped-piece motif.
 */
export function trappedPieces(fen, colour) {
  const board = at(fen);
  const enemy = otherColour(colour);
  const source = fen.split(' ')[1] === colour ? fen : passTurn(fen);
  if (!source) return [];
  const moves = legalMoves(source);
  const out = [];
  for (const piece of pieceList(fen)) {
    if (piece.color !== colour) continue;
    if (piece.type === KING || piece.type === PAWN) continue;
    if (!board.attackers(piece.square, enemy).length) continue;
    const escapes = moves.filter((m) => m.from === piece.square).filter((m) => {
      const after = at(source);
      try { after.move({ from: m.from, to: m.to, promotion: m.promotion }); } catch { return false; }
      return seeCapture(after, m.to, enemy) < PIECE_VALUE[piece.type] * 0.5;
    });
    if (escapes.length === 0) {
      out.push({
        square: piece.square, type: piece.type, name: PIECE_NAME[piece.type],
        value: piece.value, severity: clamp01(piece.value / 900)
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------- helpers */

export function clamp01(n) { return Math.max(0, Math.min(1, n)); }

export function materialCount(fen) {
  const totals = { w: 0, b: 0 };
  for (const piece of pieceList(fen)) {
    if (piece.type === KING) continue;
    totals[piece.color] += piece.value;
  }
  return { ...totals, balance: totals.w - totals.b };
}

/** One call that fills the debug panel and feeds every downstream detector. */
export function analysePosition(fen) {
  const turn = fen.split(' ')[1] === 'b' ? BLACK : WHITE;
  const them = otherColour(turn);
  return {
    fen, turn, them,
    material: materialCount(fen),
    hanging: { w: hangingPieces(fen, WHITE), b: hangingPieces(fen, BLACK) },
    loose: { w: loosePieces(fen, WHITE), b: loosePieces(fen, BLACK) },
    pins: { w: pinsAndSkewers(fen, WHITE), b: pinsAndSkewers(fen, BLACK) },
    overloads: { w: overloadedDefenders(fen, WHITE), b: overloadedDefenders(fen, BLACK) },
    kingSafety: { w: kingSafety(fen, WHITE), b: kingSafety(fen, BLACK) },
    pawns: { w: pawnStructure(fen, WHITE), b: pawnStructure(fen, BLACK) },
    outposts: { w: outposts(fen, WHITE), b: outposts(fen, BLACK) },
    mobility: { w: mobility(fen, WHITE), b: mobility(fen, BLACK) }
  };
}

export { seeCapture };
export default {
  directionBetween, squaresBetween, rayFrom, piecesAlongRay, pieceList, contactMap,
  see, seeCapture, hangingPieces, loosePieces, pinsAndSkewers, isAbsolutelyPinned,
  overloadedDefenders, kingSafety, neighbours, pawnStructure, outposts, mobility,
  trappedPieces, materialCount, analysePosition, clamp01
};
