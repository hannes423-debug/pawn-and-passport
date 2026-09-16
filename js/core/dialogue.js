/**
 * dialogue.js - which short, linear line a character says right now.
 *
 * No trees and no player choices. A handful of conditions pick ONE sequence
 * from the character's `lines` table, in priority order; the UI then plays it
 * line by line.
 */

import { starById } from '../data/starPlayers.js';
import { clubById } from '../data/clubs.js';
import { hasAllPostcards } from './career.js';
import { MASTERY } from '../data/config.js';

/**
 * @param {Object} career
 * @param {string} starId
 * @param {'office'|'challenge'|'won'|'lost'|'finale'} moment
 * @returns {string[]}
 */
export function starLines(career, starId, moment) {
  const star = starById(starId);
  if (!star) return [];
  const L = star.lines;
  const record = career.stars[starId] || { met: false, beaten: false, losses: 0 };
  const knows = (career.openings[star.openingId] ?? 0) >= MASTERY.starting;

  if (moment === 'won') return L.playerWon;
  if (moment === 'lost') return L.playerLost;
  if (moment === 'finale') {
    return hasAllPostcards(career) ? [...L.finale, ...L.postcards] : L.finale;
  }
  if (moment === 'challenge') {
    if (record.losses > 0) return L.rematch;
    return knows ? L.knowsOpening : L.challenge;
  }
  // In their office, outside a match.
  if (record.beaten) return L.beaten;
  if (!record.met) return L.intro;
  if (hasAllPostcards(career) && L.postcards) return L.postcards;
  if (record.losses > 0) return L.rematch;
  return knows ? L.knowsOpening : L.challenge;
}

/** Flavour for the members' lounge, which names the club's opening. */
export function loungeLines(career, clubId) {
  const club = clubById(clubId);
  const star = starById(club.starPlayerId);
  const won = !!career.trophies[clubId];
  return won
    ? [`Everyone here is still talking about your game against ${star.name.split(' ')[0]}.`, `The ${club.trophyName} looks good on you.`]
    : [`Welcome to the ${club.clubName}. Around here, everybody plays one opening.`, `Beat ${star.name} and it will be yours too.`];
}

export default { starLines, loungeLines };
