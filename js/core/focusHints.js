/**
 * focusHints.js - what a Focus hint turns into: rolls, plans and refunds.
 * Pure: the engine lines come in, the plans go out (js/game/match.js runs the
 * search and keeps the state).
 *
 *   rolls    one per PLAYABLE candidate, up to the level's count
 *            (config.HINTS.rollsByLevel). Candidate 1 is the engine's best.
 *   quality  each roll: fail | green | purple | gold, by the level's odds.
 *            A fail shows nothing for that candidate. The quality is how many
 *            of your own moves the plan reaches (green 1, purple 2, gold 3).
 *   refund   Focus back on the next move: a lesser suggestion played, or
 *            none of them (config.HINTS.refund).
 */

import { HINTS } from '../data/config.js';
import { winProbability, scoreToCp } from '../chess/analysis/moveClassifier.js';

export const QUALITIES = Object.freeze(['green', 'purple', 'gold']);

/** Display words and the feedback tier each quality borrows its colour from. */
export const QUALITY_META = Object.freeze({
  green: { label: 'Green', tier: 'good', colour: '#55c53c' },
  purple: { label: 'Purple', tier: 'brilliant', colour: '#c94ffb' },
  gold: { label: 'Gold', tier: 'epic', colour: '#fdba01' }
});

const band = (table, level) => {
  let row = table[0];
  for (const entry of table) if (level >= entry.from) row = entry;
  return row;
};

/** How many rolls and what odds a level gets. */
export function hintBand(level) {
  const rolls = band(HINTS.rollsByLevel, level);
  const odds = band(HINTS.oddsByLevel, level);
  return { rolls: rolls.rolls, label: rolls.label, odds };
}

/** One roll: 'fail' | 'green' | 'purple' | 'gold'. */
export function rollQuality(level, random = Math.random) {
  const { odds } = hintBand(level);
  let r = random();
  for (const q of ['fail', 'green', 'purple', 'gold']) {
    r -= odds[q];
    if (r < 0) return q;
  }
  return 'green';
}

/**
 * The engine's candidates worth a roll: distinct first moves, best first,
 * no more than playableLoss win-probability points below the best.
 * @param {{pv:string[], score:Object}[]} lines  MultiPV, mover's point of view
 */
export function playableCandidates(lines) {
  const out = [];
  const seen = new Set();
  let best = null;
  for (const line of lines || []) {
    const uci = line?.pv?.[0];
    if (!uci || seen.has(uci)) continue;
    const wp = line.score ? winProbability(scoreToCp(line.score)) : null;
    if (best === null) best = wp;
    if (best !== null && wp !== null && best - wp > HINTS.playableLoss) continue;
    seen.add(uci);
    out.push({ uci, pv: line.pv, winProb: wp });
    if (out.length >= HINTS.candidates) break;
  }
  return out;
}

/**
 * Roll a hint. Every candidate the level can reach gets its own roll.
 * @returns {{rolls:{rank:number, uci:string, quality:string}[], plans:{rank, uci, quality, total}[]}}
 */
export function rollHint(lines, level, random = Math.random) {
  const candidates = playableCandidates(lines).slice(0, hintBand(level).rolls);
  const rolls = candidates.map((c, rank) => ({ rank, uci: c.uci, quality: rollQuality(level, random) }));
  const plans = rolls.filter((r) => r.quality !== 'fail')
    .map((r) => ({ rank: r.rank, uci: r.uci, quality: r.quality, total: HINTS.movesByQuality[r.quality] }));
  return { rolls, plans };
}

/** Focus back, as a whole number. `rank` of the plan played, or null when none was. */
export function refundFor({ cost, rank = null, shown = true }) {
  if (!shown) return Math.round(cost * HINTS.refund.blank);
  if (rank === null) return Math.round(cost * HINTS.refund.ignored);
  return Math.round(cost * (HINTS.refund.lesser[rank] || 0));
}

export default { QUALITIES, QUALITY_META, hintBand, rollQuality, playableCandidates, rollHint, refundFor };
