/**
 * constants.js — vocabulary shared by every chess subsystem.
 *
 * Renderer-independent, engine-independent. Anything that needs to name a
 * piece, a colour or a square imports it from here so there is exactly one
 * spelling of each concept in the codebase.
 */

export const WHITE = 'w';
export const BLACK = 'b';

export const PAWN = 'p';
export const KNIGHT = 'n';
export const BISHOP = 'b';
export const ROOK = 'r';
export const QUEEN = 'q';
export const KING = 'k';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

/** All 64 squares, a1..h8. */
export const SQUARES = RANKS.flatMap((r) => FILES.map((f) => f + r));

/**
 * Centipawn values. Deliberately NOT Stockfish's internal values — these are
 * used for material counting, hanging-piece severity and sacrifice detection,
 * where a human-legible scale matters more than engine precision.
 */
export const PIECE_VALUE = Object.freeze({
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000
});

export const PIECE_NAME = Object.freeze({
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
});

export const PIECE_NAME_CAPITALISED = Object.freeze({
  p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King'
});

/** SAN letter for a piece type ('' for a pawn). */
export const PIECE_SAN = Object.freeze({ p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' });

export const COLOUR_NAME = Object.freeze({ w: 'White', b: 'Black' });

export function otherColour(colour) {
  return colour === WHITE ? BLACK : WHITE;
}

export function fileOf(square) { return square[0]; }
export function rankOf(square) { return Number(square[1]); }
export function fileIndex(square) { return square.charCodeAt(0) - 97; }
export function rankIndex(square) { return Number(square[1]) - 1; }

export function squareAt(fileIdx, rankIdx) {
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return FILES[fileIdx] + RANKS[rankIdx];
}

/** Chebyshev distance between two squares. */
export function squareDistance(a, b) {
  return Math.max(Math.abs(fileIndex(a) - fileIndex(b)), Math.abs(rankIndex(a) - rankIndex(b)));
}

/** 'light' | 'dark' without needing a board instance. */
export function squareShade(square) {
  return (fileIndex(square) + rankIndex(square)) % 2 === 0 ? 'dark' : 'light';
}

export function isSlider(type) {
  return type === BISHOP || type === ROOK || type === QUEEN;
}

/** Which of the 8 ray directions a slider of `type` can travel. */
export const RAYS = Object.freeze({
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  q: [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]
});

export const KNIGHT_STEPS = Object.freeze(
  [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
);

export const KING_STEPS = Object.freeze(
  [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]]
);
