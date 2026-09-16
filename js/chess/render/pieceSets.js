/**
 * pieceSets.js — the bundled 2D piece sets and their licences.
 *
 * Both sets are open-licensed and redistributable. Attribution lives here as
 * data (not just in a document) so the in-game credits screen renders the
 * required notices from the same source of truth as docs/LICENSE_TRACKER.md.
 */

const BASE = new URL('../../../assets/pieces/', import.meta.url).href;

export const PIECE_SETS = Object.freeze({
  pixel: {
    id: 'pixel',
    label: 'Passport Pixel',
    dir: 'pixel',
    ext: 'png',
    author: 'Pawn & Passport project art',
    license: 'project art (see docs/LICENSES.md)',
    url: null,
    attributionRequired: false,
    note: 'Sliced from the supplied pixel piece sheet by tools/build_assets.py.'
  },
  chessnut: {
    id: 'chessnut',
    label: 'Chessnut',
    dir: 'chessnut',
    author: 'Alexis Luengas',
    license: 'Apache-2.0',
    url: 'https://github.com/LexLuengas/chessnut-pieces',
    attributionRequired: true,
    note: 'Clean outline Staunton set. Apache-2.0 requires the licence text and NOTICE to travel with it.'
  },
  rhosgfx: {
    id: 'rhosgfx',
    label: 'RhosGFX',
    dir: 'rhosgfx',
    author: 'RhosGFX',
    license: 'CC0-1.0',
    url: 'https://rhosgfx.itch.io/',
    attributionRequired: false,
    note: 'Public domain dedication — no obligations at all. Kept as the zero-risk fallback set.'
  }
});

export const DEFAULT_PIECE_SET = 'pixel';

/** URL of one piece image. `code` is like 'wK' or 'bQ'. */
export function pieceUrl(setId, colour, type) {
  const set = PIECE_SETS[setId] || PIECE_SETS[DEFAULT_PIECE_SET];
  return `${BASE}${set.dir}/${colour}${type.toUpperCase()}.${set.ext || 'svg'}`;
}

export const BOARD_THEMES = Object.freeze({
  slate:  { id: 'slate',  label: 'Slate',  light: '#c9d3e0', dark: '#5d6b80', border: '#39445a' },
  walnut: { id: 'walnut', label: 'Walnut', light: '#e8d7b8', dark: '#a37651', border: '#6f4f35' },
  ocean:  { id: 'ocean',  label: 'Ocean',  light: '#cfe4e8', dark: '#4d7f8c', border: '#2f5560' },
  mono:   { id: 'mono',   label: 'Mono',   light: '#e6e6e6', dark: '#8c8c8c', border: '#4a4a4a' }
});

export const DEFAULT_BOARD_THEME = 'slate';

export default { PIECE_SETS, DEFAULT_PIECE_SET, pieceUrl, BOARD_THEMES, DEFAULT_BOARD_THEME };
