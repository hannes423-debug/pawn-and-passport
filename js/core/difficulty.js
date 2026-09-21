/**
 * difficulty.js - a target Elo becomes a BotProfile.
 *
 * The World Tour bot already separates STRENGTH (how good the candidate pool
 * is and how noisily it is sampled) from STYLE (which candidate a personality
 * prefers). This file only sets the strength knobs from an Elo, by
 * interpolating config.BOT_STRENGTH, and hands the rest to BotProfile.
 */

import { BOT_STRENGTH, ELO } from '../data/config.js';
import { BotProfile } from '../chess/bots/botProfile.js';

const lerp = (a, b, t) => a + (b - a) * t;

export function strengthForElo(elo) {
  const target = Math.max(BOT_STRENGTH[0].elo, Math.min(ELO.cap, elo));
  let lo = BOT_STRENGTH[0];
  let hi = BOT_STRENGTH[BOT_STRENGTH.length - 1];
  for (let i = 0; i < BOT_STRENGTH.length - 1; i += 1) {
    if (target >= BOT_STRENGTH[i].elo && target <= BOT_STRENGTH[i + 1].elo) {
      lo = BOT_STRENGTH[i]; hi = BOT_STRENGTH[i + 1]; break;
    }
  }
  const t = hi.elo === lo.elo ? 0 : (target - lo.elo) / (hi.elo - lo.elo);
  return {
    elo: Math.round(target),
    strength: +lerp(lo.strength, hi.strength, t).toFixed(3),
    blunderChance: +lerp(lo.blunderChance, hi.blunderChance, t).toFixed(3),
    blunderSeverityCp: Math.round(lerp(lo.blunderSeverityCp, hi.blunderSeverityCp, t)),
    wildness: +lerp(lo.wildness, hi.wildness, t).toFixed(3),
    candidatePool: Math.round(lerp(lo.candidatePool, hi.candidatePool, t)),
    maxEvalLossCp: Math.round(lerp(lo.maxEvalLossCp, hi.maxEvalLossCp, t)),
    level: t < 0.5 ? lo.level : hi.level
  };
}

/**
 * @param {{id?:string, name:string, elo:number, style?:string, openingPreference?:number}} spec
 * @returns {BotProfile}
 */
export function profileForOpponent({ id = null, name, elo, style = 'balanced', openingPreference = 0.9 }) {
  const s = strengthForElo(elo);
  const profile = new BotProfile({
    id, name, style, rating: s.elo,
    difficulty: s.level === 'club' ? 'club' : 'beginner',
    traits: { openingPreference }
  });
  profile.analysisLevel = s.level;
  profile.limitStrength = true;
  profile.strength = s.strength;
  profile.blunderChance = s.blunderChance;
  profile.blunderSeverityCp = s.blunderSeverityCp;
  profile.wildness = s.wildness;
  profile.candidatePool = s.candidatePool;
  profile.maxEvalLossCp = s.maxEvalLossCp;
  return profile;
}

export default { strengthForElo, profileForOpponent };
