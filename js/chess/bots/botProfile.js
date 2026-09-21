/**
 * botProfile.js — BotProfile, BotStyle, BotDifficulty.
 *
 * A bot is NOT "Stockfish at depth N". Two 1750-rated opponents should feel
 * different, so strength and personality are separate axes: strength decides
 * how good the candidate pool is, personality decides which candidate gets
 * played out of that pool.
 *
 * Every trait is 0..1. They are game-design dials, not measurements of any
 * real player.
 */

import { LEVELS } from '../engine/analysisLevels.js';

/** Difficulty presets: what the ENGINE is allowed to do. */
export const BOT_DIFFICULTY = Object.freeze({
  RANDOM_BEGINNER: 'random-beginner',
  BEGINNER: 'beginner',
  CLUB: 'club',
  ADVANCED: 'advanced',
  MASTER: 'master',
  GRANDMASTER: 'grandmaster',
  ENGINE: 'engine'
});

/**
 * @typedef {Object} DifficultySpec
 * @property {string} analysisLevel      which AnalysisLevel to search at
 * @property {boolean} limitStrength     apply Skill Level / UCI_Elo
 * @property {number} strength           0..1, how tightly it hugs the best move
 * @property {number} blunderChance      0..1, chance of ignoring the pool entirely
 * @property {number} candidatePool      MultiPV width to choose from
 * @property {number} maxEvalLossCp      candidates worse than this are discarded
 * @property {number} blunderSeverityCp   the most an unforced error may hand over
 * @property {number} wildness            0..1, how aimless an unforced error is
 */
export const DIFFICULTY_SPECS = Object.freeze({
  [BOT_DIFFICULTY.RANDOM_BEGINNER]: {
    label: 'Random Beginner', analysisLevel: LEVELS.BEGINNER, limitStrength: true,
    strength: 0.02, blunderChance: 0.55, candidatePool: 2, maxEvalLossCp: 100000,
    note: 'Mostly random legal moves. Will hang pieces.'
  },
  [BOT_DIFFICULTY.BEGINNER]: {
    label: 'Beginner', analysisLevel: LEVELS.BEGINNER, limitStrength: true,
    strength: 0.2, blunderChance: 0.22, candidatePool: 3, maxEvalLossCp: 900,
    note: 'Sees one-move threats sometimes.'
  },
  [BOT_DIFFICULTY.CLUB]: {
    label: 'Club', analysisLevel: LEVELS.CLUB, limitStrength: true,
    strength: 0.45, blunderChance: 0.08, candidatePool: 4, maxEvalLossCp: 400,
    note: 'Reliable on short tactics.'
  },
  [BOT_DIFFICULTY.ADVANCED]: {
    label: 'Advanced', analysisLevel: LEVELS.ADVANCED, limitStrength: true,
    strength: 0.65, blunderChance: 0.03, candidatePool: 4, maxEvalLossCp: 220,
    note: 'Solid all round.'
  },
  [BOT_DIFFICULTY.MASTER]: {
    label: 'Master', analysisLevel: LEVELS.MASTER, limitStrength: true,
    strength: 0.82, blunderChance: 0.01, candidatePool: 3, maxEvalLossCp: 120,
    note: 'Punishes most errors.'
  },
  [BOT_DIFFICULTY.GRANDMASTER]: {
    label: 'Grandmaster', analysisLevel: LEVELS.GRANDMASTER, limitStrength: true,
    strength: 0.93, blunderChance: 0, candidatePool: 3, maxEvalLossCp: 60,
    note: 'Very close to the engine line.'
  },
  [BOT_DIFFICULTY.ENGINE]: {
    label: 'Engine', analysisLevel: LEVELS.MAXIMUM, limitStrength: false,
    strength: 1, blunderChance: 0, candidatePool: 1, maxEvalLossCp: 0,
    note: 'No handicap and no personality — the raw first choice.'
  }
});

/** Personality archetypes: which candidate gets chosen out of the pool. */
export const BOT_STYLE = Object.freeze({
  BALANCED: 'balanced',
  AGGRESSIVE: 'aggressive',
  DEFENSIVE: 'defensive',
  TACTICAL: 'tactical',
  POSITIONAL: 'positional',
  PRACTICAL: 'practical',
  SPEED: 'speed',
  ENDGAME: 'endgame'
});

/**
 * @typedef {Object} BotStyleSpec  every field 0..1
 * @property {number} tacticalBias            prefers forcing, concrete moves
 * @property {number} aggression              plays toward the enemy king
 * @property {number} riskTolerance           accepts unclear positions
 * @property {number} simplificationPreference prefers trades
 * @property {number} openingPreference       follows book longer
 * @property {number} complexityPreference    keeps the position sharp
 * @property {number} endgamePreference       steers toward endings
 * @property {number} timeManagement          how well it paces the clock
 */
export const STYLE_SPECS = Object.freeze({
  [BOT_STYLE.BALANCED]:   { tacticalBias: .5, aggression: .5, riskTolerance: .5, simplificationPreference: .5, openingPreference: .5, complexityPreference: .5, endgamePreference: .5, timeManagement: .6 },
  [BOT_STYLE.AGGRESSIVE]: { tacticalBias: .8, aggression: .95, riskTolerance: .8, simplificationPreference: .15, openingPreference: .4, complexityPreference: .85, endgamePreference: .25, timeManagement: .45 },
  [BOT_STYLE.DEFENSIVE]:  { tacticalBias: .3, aggression: .15, riskTolerance: .15, simplificationPreference: .8, openingPreference: .6, complexityPreference: .2, endgamePreference: .7, timeManagement: .6 },
  [BOT_STYLE.TACTICAL]:   { tacticalBias: .95, aggression: .7, riskTolerance: .7, simplificationPreference: .3, openingPreference: .35, complexityPreference: .9, endgamePreference: .3, timeManagement: .5 },
  [BOT_STYLE.POSITIONAL]: { tacticalBias: .25, aggression: .35, riskTolerance: .3, simplificationPreference: .5, openingPreference: .8, complexityPreference: .3, endgamePreference: .65, timeManagement: .7 },
  [BOT_STYLE.PRACTICAL]:  { tacticalBias: .45, aggression: .45, riskTolerance: .35, simplificationPreference: .7, openingPreference: .55, complexityPreference: .25, endgamePreference: .6, timeManagement: .85 },
  [BOT_STYLE.SPEED]:      { tacticalBias: .7, aggression: .6, riskTolerance: .65, simplificationPreference: .35, openingPreference: .45, complexityPreference: .6, endgamePreference: .35, timeManagement: .95 },
  [BOT_STYLE.ENDGAME]:    { tacticalBias: .35, aggression: .3, riskTolerance: .25, simplificationPreference: .9, openingPreference: .5, complexityPreference: .2, endgamePreference: .95, timeManagement: .75 }
});

export class BotProfile {
  /**
   * @param {Object} spec
   * @param {string} spec.name
   * @param {string} [spec.difficulty]  a BOT_DIFFICULTY key
   * @param {string} [spec.style]       a BOT_STYLE key
   * @param {number} [spec.rating]      display only
   * @param {Object} [spec.traits]      overrides on top of the style spec
   */
  constructor({
    id = null, name = 'Opponent', difficulty = BOT_DIFFICULTY.CLUB,
    style = BOT_STYLE.BALANCED, rating = null, federation = null, traits = {},
    openingPreferences = [], avatar = null, bio = null
  } = {}) {
    this.id = id || `bot-${name.toLowerCase().replace(/\W+/g, '-')}`;
    this.name = name;
    this.difficulty = difficulty;
    this.style = style;
    this.rating = rating;
    this.federation = federation;
    this.avatar = avatar;
    this.bio = bio;
    this.openingPreferences = openingPreferences;

    const difficultySpec = DIFFICULTY_SPECS[difficulty] || DIFFICULTY_SPECS[BOT_DIFFICULTY.CLUB];
    const styleSpec = STYLE_SPECS[style] || STYLE_SPECS[BOT_STYLE.BALANCED];

    this.analysisLevel = difficultySpec.analysisLevel;
    this.limitStrength = difficultySpec.limitStrength;
    this.strength = difficultySpec.strength;
    this.blunderChance = difficultySpec.blunderChance;
    this.candidatePool = difficultySpec.candidatePool;
    this.maxEvalLossCp = difficultySpec.maxEvalLossCp;
    this.blunderSeverityCp = difficultySpec.blunderSeverityCp ?? 100000;
    this.wildness = difficultySpec.wildness ?? 0;

    /** The personality dials the spec asks for, all 0..1. */
    this.tacticalBias = pick(traits.tacticalBias, styleSpec.tacticalBias);
    this.aggression = pick(traits.aggression, styleSpec.aggression);
    this.riskTolerance = pick(traits.riskTolerance, styleSpec.riskTolerance);
    this.simplificationPreference = pick(traits.simplificationPreference, styleSpec.simplificationPreference);
    this.openingPreference = pick(traits.openingPreference, styleSpec.openingPreference);
    this.complexityPreference = pick(traits.complexityPreference, styleSpec.complexityPreference);
    this.endgamePreference = pick(traits.endgamePreference, styleSpec.endgamePreference);
    this.timeManagement = pick(traits.timeManagement, styleSpec.timeManagement);
  }

  get difficultyLabel() { return DIFFICULTY_SPECS[this.difficulty]?.label || this.difficulty; }
  get styleLabel() { return this.style[0].toUpperCase() + this.style.slice(1); }

  get traits() {
    return {
      tacticalBias: this.tacticalBias, aggression: this.aggression,
      riskTolerance: this.riskTolerance, simplificationPreference: this.simplificationPreference,
      openingPreference: this.openingPreference, complexityPreference: this.complexityPreference,
      endgamePreference: this.endgamePreference, timeManagement: this.timeManagement
    };
  }

  describe() {
    const strong = Object.entries(this.traits)
      .filter(([, value]) => value >= 0.75)
      .map(([key]) => key.replace(/([A-Z])/g, ' $1').toLowerCase());
    return `${this.difficultyLabel} · ${this.styleLabel}${strong.length ? ` · high ${strong.slice(0, 2).join(' and ')}` : ''}`;
  }

  toJSON() {
    return {
      id: this.id, name: this.name, difficulty: this.difficulty, style: this.style,
      rating: this.rating, federation: this.federation, traits: this.traits,
      openingPreferences: this.openingPreferences
    };
  }
}

function pick(override, fallback) {
  return typeof override === 'number' ? Math.max(0, Math.min(1, override)) : fallback;
}

export default BotProfile;
