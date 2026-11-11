/**
 * ratingScale.js - the game's Elo is FIDE's; the human games the opponents
 * are measured against are Lichess games. This converts, from the ChessGoals
 * survey rows in config.RATING_SCALE (linear between rows, clamped at the
 * ends: there is no survey data outside FIDE 1260-1780).
 */
import { RATING_SCALE } from '../data/config.js';

const rows = RATING_SCALE.fideToLichessBlitz;
const lerp = (x, pts) => {
  if (x <= pts[0][0]) return pts[0][1] + (x - pts[0][0]);
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i]; const [x1, y1] = pts[i + 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  const [xl, yl] = pts.at(-1);
  return yl + (x - xl);
};

/** FIDE -> the Lichess blitz rating of a player that strong. */
export const lichessForFide = (fide) => Math.round(lerp(fide, rows));
/** Lichess blitz -> FIDE. */
export const fideForLichess = (lichess) => Math.round(lerp(lichess, rows.map(([f, l]) => [l, f])));

export default { lichessForFide, fideForLichess };
