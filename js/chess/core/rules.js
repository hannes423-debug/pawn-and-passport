/**
 * rules.js — THE ONLY module in the project that imports chess.js.
 *
 * Everything else talks to chess through this facade, so swapping the rules
 * library (or compiling one into WASM later) is a single-file change. The
 * facade deliberately exposes plain data — FEN strings, square names, verbose
 * move objects — never a chess.js instance, so no caller can accidentally take
 * a dependency on the library's own API surface.
 *
 * chess.js 1.4.0, BSD-2-Clause. See docs/LICENSE_TRACKER.md.
 */

import { Chess } from '../../../vendor/chessjs/chess.js';
import { START_FEN, WHITE, BLACK, otherColour, PIECE_VALUE } from './constants.js';

/** Construct a rules instance. Throws on an invalid FEN. */
export function createRules(fen = START_FEN) {
  return new Chess(fen);
}

/** A throwaway instance for one-shot questions about a position. */
export function at(fen) {
  return new Chess(fen);
}

export { Chess };

/* ------------------------------------------------------------- queries */

export function legalMoves(fen, { square = undefined } = {}) {
  const c = at(fen);
  return square ? c.moves({ square, verbose: true }) : c.moves({ verbose: true });
}

export function isLegalUci(fen, uci) {
  return legalMoves(fen).some((m) => m.from + m.to + (m.promotion || '') === uci);
}

/** Apply a UCI move to a FEN. @returns {{fen:string, move:Object}|null} */
export function applyUci(fen, uci) {
  const c = at(fen);
  const move = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
  if (!move) return null;
  return { fen: c.fen(), move };
}

/** SAN for a UCI move in a position, or null if illegal. */
export function sanFor(fen, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    const applied = applyUci(fen, uci);
    return applied ? applied.move.san : null;
  } catch { return null; }
}

/** Convert a whole PV (array of UCI) into SAN, following the line. */
export function pvToSan(fen, uciLine) {
  const c = at(fen);
  const out = [];
  for (const uci of uciLine) {
    try {
      const move = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
      if (!move) break;
      out.push(move.san);
    } catch { break; }
  }
  return out;
}

export function uciFor(fen, san) {
  const c = at(fen);
  try {
    const move = c.move(san);
    return move ? move.from + move.to + (move.promotion || '') : null;
  } catch { return null; }
}

export function turnOf(fen) { return fen.split(' ')[1] === 'b' ? BLACK : WHITE; }

export function pieceAt(fen, square) { return at(fen).get(square) || null; }

/** [{square, type, color}] for every occupied square. */
export function occupied(fen) {
  const out = [];
  for (const row of at(fen).board()) {
    for (const cell of row) if (cell) out.push({ square: cell.square, type: cell.type, color: cell.color });
  }
  return out;
}

/** Squares of `attackedBy`'s pieces that attack `square`. */
export function attackersOf(fen, square, attackedBy) {
  return at(fen).attackers(square, attackedBy);
}

export function isAttacked(fen, square, attackedBy) {
  return at(fen).isAttacked(square, attackedBy);
}

export function kingSquare(fen, colour) {
  const found = at(fen).findPiece({ type: 'k', color: colour });
  return found[0] || null;
}

export function inCheck(fen) { return at(fen).inCheck(); }
export function isCheckmate(fen) { return at(fen).isCheckmate(); }
export function isStalemate(fen) { return at(fen).isStalemate(); }
export function isGameOver(fen) { return at(fen).isGameOver(); }
export function isInsufficientMaterial(fen) { return at(fen).isInsufficientMaterial(); }

/**
 * The same position with the other side to move, or null when that would be
 * illegal (the side that just moved would be left in check).
 *
 * This is the "null move" trick the threat analyser runs on: what would the
 * opponent do if they were handed a free move right now?
 */
export function passTurn(fen) {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';                        // an en-passant square cannot survive a null move
  const candidate = parts.join(' ');
  try {
    const c = new Chess(candidate);
    // Illegal if the side that just "passed" is now in check from the mover.
    if (c.isAttacked(kingSquare(candidate, otherColour(c.turn())), c.turn())) return null;
    return candidate;
  } catch { return null; }
}

/** Material balance in centipawns, positive = White ahead. */
export function materialBalance(fen) {
  let balance = 0;
  for (const ch of fen.split(' ')[0]) {
    const lower = ch.toLowerCase();
    if (lower === 'k' || !PIECE_VALUE[lower]) continue;
    balance += (ch === lower ? -1 : 1) * PIECE_VALUE[lower];
  }
  return balance;
}

/** Total non-king material on the board — the endgame trigger. */
export function totalMaterial(fen) {
  let total = 0;
  for (const ch of fen.split(' ')[0]) {
    const lower = ch.toLowerCase();
    if (lower === 'k' || !PIECE_VALUE[lower]) continue;
    total += PIECE_VALUE[lower];
  }
  return total;
}

/**
 * 'opening' | 'middlegame' | 'endgame' from the position alone.
 *
 * The move counter alone is not enough: a composed puzzle position carries
 * "1" whatever is on the board, which labelled scattered middlegames as
 * openings. So a position only counts as an opening if the pieces still LOOK
 * like one — most of them on their starting squares.
 */
export function phaseOf(fen) {
  const nonPawn = totalMaterial(fen) - 100 * countPawns(fen);
  if (nonPawn <= 1400) return 'endgame';
  const fullMoves = Number(fen.split(' ')[5] || 1);
  if (fullMoves <= 12 && developmentRatio(fen) >= 0.6) return 'opening';
  return 'middlegame';
}

/** Fraction of the 32 starting squares still holding the piece that begins there. */
export function developmentRatio(fen) {
  const board = fen.split(' ')[0].split('/');
  if (board.length !== 8) return 0;
  const rows = { 0: 'rnbqkbnr', 1: 'pppppppp', 6: 'PPPPPPPP', 7: 'RNBQKBNR' };
  let matched = 0;
  for (const [index, expected] of Object.entries(rows)) {
    const expanded = expandRank(board[Number(index)]);
    for (let file = 0; file < 8; file += 1) {
      if (expanded[file] === expected[file]) matched += 1;
    }
  }
  return matched / 32;
}

function expandRank(rank) {
  let out = '';
  for (const ch of rank) out += /\d/.test(ch) ? '.'.repeat(Number(ch)) : ch;
  return out.padEnd(8, '.');
}

export function countPawns(fen) {
  return (fen.split(' ')[0].match(/p/gi) || []).length;
}

export default {
  createRules, at, legalMoves, isLegalUci, applyUci, sanFor, uciFor, pvToSan,
  turnOf, pieceAt, occupied, attackersOf, isAttacked, kingSquare,
  inCheck, isCheckmate, isStalemate, isGameOver, isInsufficientMaterial,
  passTurn, materialBalance, totalMaterial, phaseOf, countPawns
};
