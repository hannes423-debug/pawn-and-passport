/**
 * hints.js - the one active ability: Ask for Hint.
 *
 *   cost = baseCost
 *        x opening familiarity   (inside a known line: 1 - 0.6 x mastery)
 *        x specialty             (your starting club's opening: x0.9)
 *        x game phase            (opening 1.0 / middlegame 1.2 / endgame 1.4)
 *        x complexity            (x1.15 in a sharp position)
 *        x rolls                 (1 roll 1.0 / 2 rolls 1.3 / 3 rolls 1.6)
 *
 * Every number comes from config.HINTS. Pure: the engine search itself lives
 * in js/game/match.js.
 */

import { HINTS } from '../data/config.js';
import { phaseOf } from '../chess/core/rules.js';
import { positionComplexity } from '../chess/analysis/moveClassifier.js';
import { hintBand } from './focusHints.js';

/**
 * @param {Object} o
 * @param {number} o.level
 * @param {string} o.fen
 * @param {Object} o.mastery          openingId -> percent, EQUIPPED openings only
 * @param {string|null} o.specialty  the starting club's opening id
 * @param {import('./openingBook.js').ClubBook} o.book
 */
export function hintQuote({ level, fen, mastery, specialty = null, book }) {
  const band = hintBand(level);
  const fam = book.familiarity(fen, mastery);
  const familiarity = fam.inBook && fam.mastery > 0
    ? Math.max(1 - HINTS.familiarityDiscount, 1 - HINTS.familiarityDiscount * (fam.mastery / 100))
    : 1;
  const specialtyMul = fam.inBook && fam.openingId && fam.openingId === specialty ? HINTS.specialtyMultiplier : 1;
  // Inside a known line the position is "the opening" whatever the move count says.
  const phase = fam.inBook ? 'opening' : phaseOf(fen);
  const phaseMul = HINTS.phaseMultiplier[phase] ?? 1;
  const complexity = positionComplexity(fen);
  const complexityMul = complexity >= HINTS.complexityThreshold ? HINTS.complexityMultiplier : 1;
  const rollsMul = HINTS.rollsMultiplier[band.rolls] ?? 1;
  const raw = HINTS.baseCost * familiarity * specialtyMul * phaseMul * complexityMul * rollsMul;
  const cost = Math.max(HINTS.minCost, Math.round(raw));
  return {
    cost, rolls: band.rolls, label: band.label, odds: band.odds, phase,
    inBook: fam.inBook, openingId: fam.openingId,
    breakdown: {
      base: HINTS.baseCost,
      familiarity: +familiarity.toFixed(2),
      specialty: specialtyMul,
      phase: phaseMul,
      complexity: complexityMul,
      rolls: rollsMul
    },
    search: HINTS.search
  };
}

export default { hintQuote };
