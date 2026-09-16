/**
 * scoring.js - the post-game Match Score.
 *
 * A sports-style number for one game, itemised so the result card can show
 * where every point came from. All weights live in config.SCORE.
 */

import { SCORE } from '../data/config.js';

/**
 * @param {Object} g
 * @param {number} g.score          1 / 0.5 / 0
 * @param {number|null} g.accuracy  0..100
 * @param {Object} g.grades         grade key -> count, player's moves only
 * @param {boolean} [g.checkmate]   the player delivered mate
 * @param {number} g.playerElo
 * @param {number} g.opponentElo
 * @param {number} [g.hintsUsed]
 * @returns {{total:number, letter:string, lines:{label:string, points:number}[]}}
 */
export function matchScore(g) {
  const lines = [];
  const add = (label, points) => { if (points) lines.push({ label, points: Math.round(points) }); };

  const result = g.score === 1 ? 'win' : g.score === 0.5 ? 'draw' : 'loss';
  add(result === 'win' ? 'Victory' : result === 'draw' ? 'Draw' : 'Played it out', SCORE.result[result]);
  if (typeof g.accuracy === 'number') add(`Accuracy ${g.accuracy}%`, g.accuracy * SCORE.accuracyPoints);

  for (const [grade, points] of Object.entries(SCORE.grade)) {
    const n = g.grades?.[grade] || 0;
    if (n) add(`${label(grade)} x${n}`, n * points);
  }
  if (g.checkmate) add('Checkmate finish', SCORE.checkmateBonus);
  if (g.score === 1 && g.opponentElo > g.playerElo) {
    add('Upset bonus', Math.min(SCORE.upsetCap, (g.opponentElo - g.playerElo) * SCORE.upsetPerElo));
  }
  if (g.hintsUsed) add(`Hints used x${g.hintsUsed}`, -g.hintsUsed * SCORE.hintPenalty);

  const total = Math.max(0, lines.reduce((sum, line) => sum + line.points, 0));
  const letter = SCORE.letters.find((entry) => total >= entry.from)?.letter || 'D';
  return { total, letter, lines };
}

function label(grade) {
  return grade.charAt(0) + grade.slice(1).toLowerCase().replace('Miss', 'Missed win');
}

export default { matchScore };
