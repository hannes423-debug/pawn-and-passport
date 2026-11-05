/**
 * boardImage.js - a position as a PNG: "Copy board" and "Save board".
 *
 * The match board is DOM (js/chess/render/board2d.js), so it is not captured
 * from the page: the position is drawn again from its FEN onto a canvas with
 * the same art the board uses - the painted frame (assets/board/board.webp),
 * the career's piece set and board colours (js/core/shop.js) - at the art's
 * own size, with the square geometry css/board.css puts on .pp-boardframe.
 * The result is the same picture at any screen size, with no browser chrome,
 * cursor or hover card in it.
 *
 * Copying uses the async clipboard with a PROMISE inside the ClipboardItem,
 * created in the click itself (Safari requires that); where image copying is
 * not offered the PNG is downloaded instead, so the button always does
 * something.
 */

import { pieceUrl, BOARD_THEMES } from '../chess/render/pieceSets.js';

const FRAME = { w: 1040, h: 1022, src: new URL('../../assets/board/board.webp', import.meta.url).href };
// .pp-boardframe .cwt-board in css/board.css
const INSET = { left: 0.11538, top: 0.10665, width: 0.76923, height: 0.78278 };
// .pp-boardframe .cwt-piece: background-size / -position, per set
const PIECE_FIT = { default: { size: 0.96, x: 0.5, y: 0.7 }, chessnut: { size: 0.86, x: 0.5, y: 0.55 } };
const LAST_MOVE = 'rgba(255, 214, 90, 0.42)';

const images = new Map();
function image(src) {
  if (!images.has(src)) {
    images.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => { images.delete(src); reject(new Error(`could not load ${src}`)); };
      img.src = src;
    }));
  }
  return images.get(src);
}

/** Pieces of a FEN's board field: [{ square, colour, type }]. */
export function piecesOf(fen) {
  const out = [];
  const rows = String(fen || '').split(' ')[0].split('/');
  if (rows.length !== 8) throw new Error('not a FEN');
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      if (!/[pnbrqk]/i.test(ch) || f > 7) throw new Error('not a FEN');
      out.push({ square: `${'abcdefgh'[f]}${8 - r}`, colour: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() });
      f += 1;
    }
    if (f !== 8) throw new Error('not a FEN');
  });
  return out;
}

/** Board square -> its cell [column, row] on screen for an orientation. */
export function cellOf(square, orientation = 'w') {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return orientation === 'w' ? [file, 7 - rank] : [7 - file, rank];
}

/**
 * Draw a position. Resolves with the canvas.
 * @param {Object} o
 * @param {string} o.fen
 * @param {'w'|'b'} [o.orientation]
 * @param {string} [o.pieces]    piece set id (pieceSets.js)
 * @param {string} [o.board]     'marble' (the painted board) or a BOARD_THEMES id
 * @param {{from:string,to:string}|null} [o.lastMove]
 * @param {boolean} [o.coordinates]
 * @param {number} [o.scale]     1 = the board art's own 1040 x 1022 px
 */
export async function drawBoardImage({ fen, orientation = 'w', pieces = 'pixel', board = 'marble', lastMove = null, coordinates = true, scale = 1 }) {
  const placed = piecesOf(fen);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(FRAME.w * scale);
  canvas.height = Math.round(FRAME.h * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;              // the frame is pixel art (image-rendering: pixelated)
  ctx.drawImage(await image(FRAME.src), 0, 0, canvas.width, canvas.height);

  const bx = INSET.left * canvas.width; const by = INSET.top * canvas.height;
  const sw = (INSET.width * canvas.width) / 8; const sh = (INSET.height * canvas.height) / 8;
  const theme = board !== 'marble' ? BOARD_THEMES[board] : null;
  for (let c = 0; c < 8; c += 1) {
    for (let r = 0; r < 8; r += 1) {
      const x = bx + c * sw; const y = by + r * sh;
      if (theme) {
        ctx.globalAlpha = 0.92;                   // the marble's grain shows through, as on screen
        ctx.fillStyle = (c + r) % 2 === 0 ? theme.light : theme.dark;
        ctx.fillRect(x, y, sw, sh);
        ctx.globalAlpha = 1;
      }
    }
  }
  if (lastMove?.from && lastMove?.to) {
    ctx.fillStyle = LAST_MOVE;
    for (const sq of [lastMove.from, lastMove.to]) {
      const [c, r] = cellOf(sq, orientation);
      ctx.fillRect(bx + c * sw, by + r * sh, sw, sh);
    }
  }
  if (coordinates) {
    // As .cwt-coord: files at the foot of each column, ranks on the right edge.
    const px = Math.max(8, Math.round(sh * 0.13));
    const font = `${px}px "Press Start 2P", "Courier New", monospace`;
    try { await document.fonts?.load(font); } catch { /* a fallback font is fine */ }
    ctx.fillStyle = theme ? 'rgba(30, 20, 10, 0.75)' : 'rgba(60, 35, 15, 0.7)';
    ctx.font = font;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    for (let c = 0; c < 8; c += 1) {
      const file = orientation === 'w' ? 'abcdefgh'[c] : 'hgfedcba'[c];
      ctx.fillText(file, bx + c * sw + sw * 0.08, by + 8 * sh - sh * 0.03);
    }
    ctx.textAlign = 'right';
    for (let r = 0; r < 8; r += 1) {
      const rank = orientation === 'w' ? 8 - r : r + 1;
      ctx.fillText(String(rank), bx + 8 * sw - sw * 0.06, by + (r + 1) * sh - sh * 0.08);
    }
  }

  const fit = PIECE_FIT[pieces] || PIECE_FIT.default;
  ctx.imageSmoothingEnabled = true;               // .cwt-piece: image-rendering: auto
  ctx.imageSmoothingQuality = 'high';
  const art = await Promise.all(placed.map((p) => image(pieceUrl(pieces, p.colour, p.type)).catch(() => null)));
  placed.forEach((p, i) => {
    const img = art[i];
    if (!img) return;
    const [c, r] = cellOf(p.square, orientation);
    // background-size: N% N% stretches the image to N% of the square.
    const w = sw * fit.size; const hgt = sh * fit.size;
    const x = bx + c * sw + (sw - w) * fit.x; const y = by + r * sh + (sh - hgt) * fit.y;
    ctx.save();
    ctx.shadowColor = 'rgba(20, 10, 5, 0.55)';     // drop-shadow(0 2px 0 ...)
    ctx.shadowOffsetY = 2 * scale * (sh / 80);
    ctx.drawImage(img, x, y, w, hgt);
    ctx.restore();
  });
  return canvas;
}

const toBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));

/** The position as a PNG Blob. */
export async function boardPng(options) { return toBlob(await drawBoardImage(options)); }

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const canCopyImage = () => typeof window !== 'undefined' && !!(navigator.clipboard?.write && window.ClipboardItem) && window.isSecureContext !== false;

/**
 * Copy the position to the clipboard as a PNG, or save it as a file where
 * the browser cannot copy images. Call it from the click itself.
 * @returns {Promise<'copied'|'saved'>}
 */
export async function copyOrSaveBoard(options, { filename = 'pawn-and-passport-board.png', prefer = 'copy' } = {}) {
  const pending = boardPng(options);
  if (prefer === 'copy' && canCopyImage()) {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': pending })]);
      return 'copied';
    } catch { /* refused (permissions, an old Safari): fall back to a file */ }
  }
  download(await pending, filename);
  return 'saved';
}

export default { drawBoardImage, boardPng, copyOrSaveBoard, canCopyImage, piecesOf, cellOf };
