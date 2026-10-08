/**
 * fen.js - the piece placement of a FEN, in the shape board2d.js reads.
 *
 *   boardFromFen(fen) -> 8 rows, rank 8 first, each 8 cells of
 *                        { square: 'e4', type: 'p', color: 'w' } or null
 *
 * The browser never needs the rules: the server sends the legal moves.
 */

const FILES = 'abcdefgh';

export function boardFromFen(fen) {
  const placement = String(fen).split(' ')[0];
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new Error(`fen.js: not a FEN: ${fen}`);
  return ranks.map((row, i) => {
    const rank = 8 - i;
    const cells = [];
    for (const ch of row) {
      if (/[1-8]/.test(ch)) { for (let k = 0; k < Number(ch); k += 1) cells.push(null); continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      cells.push({ square: `${FILES[cells.length]}${rank}`, type: ch.toLowerCase(), color });
    }
    if (cells.length !== 8) throw new Error(`fen.js: rank ${rank} has ${cells.length} squares`);
    return cells;
  });
}

export default { boardFromFen };
