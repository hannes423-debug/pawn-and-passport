/**
 * pieceSets.js - the one piece set Chess Match Profile ships: Chessnut
 * (Alexis Luengas, Apache-2.0; its licence and NOTICE sit beside the SVGs in
 * ./pieces/). Same interface as Pawn & Passport's pieceSets.js, which
 * board2d.js was written against.
 */

const BASE = new URL('./pieces/', import.meta.url).href;

export const PIECE_SETS = Object.freeze({
  chessnut: { id: 'chessnut', label: 'Chessnut', author: 'Alexis Luengas', license: 'Apache-2.0', url: 'https://github.com/LexLuengas/chessnut-pieces' }
});
export const DEFAULT_PIECE_SET = 'chessnut';

export const pieceUrl = (setId, colour, type) => `${BASE}${colour}${type.toUpperCase()}.svg`;

export const BOARD_THEMES = Object.freeze({
  green: { id: 'green', label: 'Green', light: '#eeeed2', dark: '#769656', border: '#4b6236' }
});
export const DEFAULT_BOARD_THEME = 'green';

export default { PIECE_SETS, DEFAULT_PIECE_SET, pieceUrl, BOARD_THEMES, DEFAULT_BOARD_THEME };
