/**
 * focusTime.js - the clock time a Focus ability takes.
 *
 * Using Focus is the character thinking harder, and that thinking happens on
 * the clock: Hint and Undo take a share of the game's STARTING time off the
 * player's clock every time they are used - even when every hint roll fails,
 * because the thinking was done. The share is config.CLOCK.focusTime; a
 * hint's grows with its rolls (config.HINTS.rollsMultiplier: a deeper look
 * takes longer). With no time limit an ability costs no time.
 *
 * `modifiers` is the hook for the RPG stats to come: a multiplier per ability
 * (0.8 = thinks 20% faster), defaulting to 1. Nothing sets them yet.
 *
 * Pure: js/game/match.js asks, the clock (ChessClock.spend) is charged there.
 */

import { CLOCK, HINTS } from '../data/config.js';

/**
 * @param {'hint'|'undo'} ability
 * @param {Object} o
 * @param {{baseSeconds:number|null}} o.timeControl
 * @param {number} [o.rolls]      a hint's rolls at the player's level
 * @param {Object<string, number>} [o.modifiers]  per-ability multipliers (RPG stats, later)
 * @returns {number} milliseconds, whole seconds; 0 without a time limit
 */
export function focusTimeCost(ability, { timeControl, rolls = 1, modifiers = {} } = {}) {
  const base = timeControl?.baseSeconds;
  if (base === null || base === undefined) return 0;
  const share = CLOCK.focusTime[ability] ?? 0;
  const deeper = ability === 'hint' ? (HINTS.rollsMultiplier[rolls] ?? 1) : 1;
  const stat = Number.isFinite(modifiers[ability]) ? Math.max(0, modifiers[ability]) : 1;
  return Math.round(base * share * deeper * stat) * 1000;
}

/** Is there time on the clock for it? (Focus must never flag the player by itself.) */
export function hasTimeFor(costMs, remainingMs) {
  if (!costMs || remainingMs === null || remainingMs === undefined) return true;
  return remainingMs - costMs >= CLOCK.focusReserveMs;
}

/** "18 s" / "1 min 5 s". */
export function formatSeconds(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`;
}

export default { focusTimeCost, hasTimeFor, formatSeconds };
