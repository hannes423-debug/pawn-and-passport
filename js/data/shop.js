/**
 * shop.js - what the coin shop sells (prices: SHOP in config.js).
 *
 * Looks only: a piece set or a board never changes how a game plays. The
 * first of each kind is what every career starts with, free. `ref` is the id
 * in js/chess/render/pieceSets.js (PIECE_SETS / BOARD_THEMES); the painted
 * club board ('marble') is the board art itself, not a theme.
 */

import { SHOP } from './config.js';

export const SHOP_ITEMS = Object.freeze([
  { id: 'pieces:pixel', kind: 'pieces', ref: 'pixel', label: 'Passport Pixel', price: 0,
    blurb: 'The set you started your career with.' },
  { id: 'pieces:tokens', kind: 'pieces', ref: 'tokens', label: 'Travel Tokens', price: SHOP.pieces.tokens,
    blurb: 'Round pieces on brass rims, seen from above, like a travel board game.' },
  { id: 'pieces:chessnut', kind: 'pieces', ref: 'chessnut', label: 'Chessnut Classic', price: SHOP.pieces.chessnut,
    blurb: 'Clean tournament outlines, the way a scoresheet diagram draws them.' },
  { id: 'board:marble', kind: 'board', ref: 'marble', label: 'Club Marble', price: 0,
    blurb: 'The painted board every club plays on.' },
  { id: 'board:green', kind: 'board', ref: 'green', label: 'Tournament Green', price: SHOP.boards.green,
    blurb: 'Cream and green, as at every weekend open.' },
  { id: 'board:walnut', kind: 'board', ref: 'walnut', label: 'Walnut', price: SHOP.boards.walnut,
    blurb: 'Warm wood, like the café boards in Vienna.' },
  { id: 'board:ocean', kind: 'board', ref: 'ocean', label: 'Ocean', price: SHOP.boards.ocean,
    blurb: 'Sea blues, for the long flights.' },
  { id: 'board:slate', kind: 'board', ref: 'slate', label: 'Slate', price: SHOP.boards.slate,
    blurb: 'Cool grey-blue, easy on the eyes at night.' },
  { id: 'board:mono', kind: 'board', ref: 'mono', label: 'Newsprint', price: SHOP.boards.mono,
    blurb: 'Plain greys, like a diagram in the morning paper.' }
]);

export const DEFAULT_STYLE = Object.freeze({ pieces: 'pixel', board: 'marble' });

export const shopItem = (id) => SHOP_ITEMS.find((item) => item.id === id) || null;

export default { SHOP_ITEMS, DEFAULT_STYLE, shopItem };
