/**
 * botConduct.js - an opponent's manners: when it offers a draw, when it
 * resigns. Pure: js/game/match.js feeds it the bot's own view of each
 * position and acts on the answer (after a confirming search).
 *
 *   bluff   clearly lost (CONDUCT.bluff.cp behind for `turns` of its own
 *           turns in a row): a hopeful draw offer, as club players make.
 *           Only when a draw is worth more to the bot than a loss.
 *   resign  hopeless (CONDUCT.resign.cp behind, or being mated, for
 *           `turns` turns): after its bluff was turned down, or when no
 *           bluff makes sense, or after twice as long anyway. Not below
 *           CONDUCT.resign.minElo (beginners play on to the end), not before
 *           move CONDUCT.resign.minPly/2, and not while the player is short
 *           of time (it plays on for the flag).
 *   fair    a dead-level endgame (within CONDUCT.fair.cp for `turns` turns):
 *           a genuine offer. Never when a draw decides the match for the bot
 *           (a final it wins on a draw): that would be a trap, not an offer.
 *
 * The evaluation is the bot's own, from its side (positive = good for it),
 * one per bot turn where it searched; turns without a search (book, a free
 * capture, an unforced error) add nothing and break nothing.
 */

import { CONDUCT } from '../data/config.js';

export const newConduct = () => ({ evals: [], bluffs: 0, fairs: 0, lastOfferPly: -Infinity });

const streak = (evals, n, test) => evals.length >= n && evals.slice(-n).every(test);

/**
 * One bot turn.
 * @param {Object} state   newConduct(), kept by the match
 * @param {Object} o
 * @param {number|null} o.evalCp      the bot's view, centipawns from its side (mates as large values)
 * @param {number} o.ply              plies played so far
 * @param {string} o.phase            opening | middlegame | endgame (rules.phaseOf)
 * @param {'w'|'b'|null} o.drawWinner who a draw sends through; null = half a point
 * @param {'w'|'b'} o.botColour
 * @param {number} o.botElo
 * @param {number|null} o.playerClockMs  null with no time limit
 * @param {() => number} [o.random]
 * @returns {null|'resign'|'bluff'|'fair'}
 */
export function conductStep(state, { evalCp, ply, phase, drawWinner, botColour, botElo, playerClockMs = null, random = Math.random }) {
  if (typeof evalCp === 'number' && Number.isFinite(evalCp)) state.evals.push(evalCp);
  if (state.evals.length > 40) state.evals.splice(0, state.evals.length - 40);
  const c = CONDUCT;
  const playerColour = botColour === 'w' ? 'b' : 'w';
  const drawHelpsBot = drawWinner !== playerColour;        // a draw that knocks the bot out is no better than losing
  const canOffer = ply - state.lastOfferPly >= c.offerGapPlies;

  const lost = streak(state.evals, c.bluff.turns, (e) => e <= -c.bluff.cp);
  const hopeless = streak(state.evals, c.resign.turns, (e) => e <= -c.resign.cp);
  const longHopeless = streak(state.evals, c.resign.turns * 2, (e) => e <= -c.resign.cp);

  if (lost && drawHelpsBot && canOffer && state.bluffs < c.bluff.max && ply >= c.bluff.minPly && random() < c.bluff.chance) return 'bluff';

  if (hopeless && ply >= c.resign.minPly && botElo >= c.resign.minElo
      && (playerClockMs === null || playerClockMs >= c.resign.playOnIfPlayerUnderMs)
      && (state.bluffs >= c.bluff.max || !drawHelpsBot || longHopeless)) return 'resign';

  const level = streak(state.evals, c.fair.turns, (e) => Math.abs(e) <= c.fair.cp);
  if (level && phase === 'endgame' && drawWinner === null && canOffer && state.fairs < c.fair.max && ply >= c.fair.minPly) return 'fair';
  return null;
}

/** Note an offer made (it was confirmed and shown). */
export function noteOffer(state, kind, ply) {
  if (kind === 'bluff') state.bluffs += 1;
  if (kind === 'fair') state.fairs += 1;
  state.lastOfferPly = ply;
}

export default { newConduct, conductStep, noteOffer };
