/**
 * config.js - EVERY tunable number in Pawn & Passport.
 *
 * Rebalancing the jam is editing this file. Nothing below is repeated in the
 * rules modules; they read it.
 */

export const GAME = Object.freeze({
  title: 'Pawn & Passport',
  subtitle: 'A Chess Career RPG',
  version: '0.1.0-jam',
  saveVersion: 2
});

/* ================================================================ levels === */
export const LEVELS = Object.freeze({
  cap: 15,
  /* Cumulative XP needed to BE each level (index = level). Level 1 is free.
     Paced so the main path (six clubs + finale, no side content) lands around
     level 13, and the side missions carry a completionist to 15. */
  xpToReach: [0, 0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250, 3850, 4500, 5200, 6000]
});

/* ======================================================================= xp === */
export const XP = Object.freeze({
  game: { base: 30, win: 60, draw: 30, loss: 10 },
  perGrade: { EPIC: 60, BRILLIANT: 40, CLUTCH: 30, BEST: 4, EXCELLENT: 2 },
  kindMultiplier: { friendly: 0.8, tournament: 1.25, star: 1.5, finale: 1.75 },
  trophy: 250,
  finaleWin: 600,
  puzzleSolved: 25,        // first solve only
  clubPuzzleSolved: 15,    // a practice-room puzzle, first solve only
  missionComplete: 120
});

/* ====================================================================== elo === */
export const ELO = Object.freeze({
  start: 600,
  floor: 100,
  /* Friendlies are practice: unrated (K = 0). */
  k: { friendly: 0, tournament: 32, star: 32, finale: 32 },
  /* Regular opponents by campaign TIER (trophies already won, 0..5), not by
     club: the player picks the order, so the sixth club visited is the hard one. */
  regularBands: [[500, 700], [600, 800], [700, 900], [800, 1050], [900, 1150], [1000, 1250]],
  starByTier: [800, 900, 1000, 1150, 1250, 1375],
  /* The returning Star Players, one per finale round. */
  finaleRounds: [1400, 1450, 1500],
  cap: 1500
});

/* ==================================================================== focus === */
export const FOCUS = Object.freeze({
  base: 30,
  perLevel: 6,             // max = base + perLevel * (level - 1): 30 at L1, 114 at L15
  refillEachGame: true,
  /* Earned back mid-game by finding strong moves YOURSELF (not the hinted one). */
  regen: { BEST: 2, EXCELLENT: 1, BRILLIANT: 5, EPIC: 6, CLUTCH: 5 }
});

/* ==================================================================== hints === */
export const HINTS = Object.freeze({
  baseCost: 10,
  minCost: 2,
  /* Plies drawn by level band. 1 = the move; 2 = move + expected reply;
     3 = move, reply, your next move; 5 = three of your own moves. */
  pliesByLevel: [
    { from: 1, plies: 1, label: 'Best move' },
    { from: 5, plies: 2, label: 'Move + reply' },
    { from: 10, plies: 3, label: 'Two-move plan' },
    { from: 15, plies: 5, label: 'Three-move plan' }
  ],
  depthMultiplier: { 1: 1.0, 2: 1.2, 3: 1.4, 5: 1.7 },
  /* Inside a known opening line: 1 - familiarityDiscount * mastery (0..1). */
  familiarityDiscount: 0.6,
  specialtyMultiplier: 0.9,          // extra for your starting club's opening
  phaseMultiplier: { opening: 1.0, middlegame: 1.2, endgame: 1.4 },
  complexityThreshold: 0.55,
  complexityMultiplier: 1.15,
  /* Hints use the same strong engine as grading. Level changes how much of
     the line is SHOWN, never how good the suggestion is. */
  search: { depth: 14, movetime: 1500, nodes: 1500000 }
});

/* ================================================================= undo === */
/* The second Focus ability: take back your last move (and the reply to it).
   It costs a level-1 player's ENTIRE Focus pool, is capped per game even at
   max level, and has a cooldown counted in your own moves. */
export const UNDO = Object.freeze({
  cost: 30,                          // = FOCUS.base: a beginner's whole pool
  usesByLevel: [                     // hard cap per game, whatever Focus you have
    { from: 1, uses: 1 },
    { from: 6, uses: 2 },
    { from: 12, uses: 3 }
  ],
  cooldownMoves: 5,                  // your moves before it can be used again
  scorePenalty: 150                  // Match Score, per undo
});

/* ======================================================= opening mastery === */
export const MASTERY = Object.freeze({
  starting: 40,
  perGameReached: 4,       // playing the line teaches a little...
  playCap: 90,             // ...but only a trophy makes it 100
  trophy: 100,
  allBranchesAt: 100,      // mastered: every prepared branch, not just the current line
  /* The practice room. The tutorial unlocks an opening you have never met;
     a passed drill set teaches like a game does, under the same playCap. */
  tutorialGrant: 25,       // the tutorial raises mastery to at least this
  drillSetSize: 8,         // positions per drill set
  drillPassShare: 0.75,    // share of first-try answers that passes a set
  drillGain: 3,            // mastery per passed set, never past playCap
  states: [
    { from: 0, id: 'unknown', label: 'Unknown' },
    { from: 1, id: 'glimpsed', label: 'Glimpsed' },
    { from: 25, id: 'partial', label: 'Partially known' },
    { from: 40, id: 'studied', label: 'Studied' },
    { from: 100, id: 'mastered', label: 'Mastered' }
  ]
});

/* ============================================================ repertoire === */
/* Openings the player has EQUIPPED. Only equipped openings draw guide arrows
   and discount hints. Any opening known at all (mastery > 0) can be equipped;
   mastery decides how many plies of it the guide arrows know. */
export const REPERTOIRE = Object.freeze({
  slotsByLevel: [
    { from: 1, slots: 1 }, { from: 3, slots: 2 }, { from: 5, slots: 3 },
    { from: 8, slots: 4 }, { from: 11, slots: 5 }, { from: 13, slots: 6 }
  ]
});

/* ============================================================ tournament === */
export const TOURNAMENT = Object.freeze({
  regularRounds: 2,
  /* A regular round is cleared by a win or a draw; the Star Player must be beaten.
     A lost round can be challenged again, it does not reset the event. */
  regularClearScore: 0.5,
  starClearScore: 1
});

/* ============================================================== grading === */
/* Bands in win-probability points lost (0..100), on the 0.00368208 logistic.
   BEST now means the engine's own move (or a move it scores within 0.3). */
export const GRADING = Object.freeze({
  best: 0.3,
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
  complexityTolerance: 0.1,
  brilliantMinWinProb: 45,
  brilliantMinSacrifice: 180,
  missAdvantage: 250,
  /* The gentle centipawn floor under win probability (see moveClassifier):
     loss = max(winProbLoss, min(cpLoss, cpLossCap) / cpLossDivisor). */
  cpLossDivisor: 20,
  cpLossCap: 800,
  /* The grading search: depth 14 is far above 2000 strength; movetime is a
     ceiling so a slow machine still answers. */
  search: { depth: 14, movetime: 1500, nodes: 1500000, multiPv: 3 }
});

export const CLUTCH = Object.freeze({
  /* An only-move under pressure: the played move is the engine's choice (or
     within the BEST band), the runner-up was at least this much worse in win
     probability, the mover was not already cruising, and the move holds. */
  minGapWinProb: 15,
  maxWinProbBefore: 62,
  minWinProbAfter: 30
});

/* ============================================================ match score === */
export const SCORE = Object.freeze({
  result: { win: 1000, draw: 500, loss: 150 },
  accuracyPoints: 15,                // per accuracy percent
  grade: { EPIC: 450, BRILLIANT: 300, CLUTCH: 250, BEST: 40, EXCELLENT: 25, GOOD: 10, BOOK: 5,
           INACCURACY: -20, MISTAKE: -60, MISS: -60, BLUNDER: -120 },
  checkmateBonus: 150,
  upsetPerElo: 1,                    // a win against a stronger opponent
  upsetCap: 300,
  hintPenalty: 40,
  undoPenalty: 150,
  letters: [
    { from: 3200, letter: 'S' }, { from: 2600, letter: 'A' }, { from: 2000, letter: 'B' },
    { from: 1400, letter: 'C' }, { from: 0, letter: 'D' }
  ]
});

/* ======================================================= bot strength map === */
/* Stockfish's own UCI_Elo stops at 1320, so amateur strength is made the way
   the World Tour bots already make it: a noisy pick from a wide candidate pool
   plus an unforced-error roll. Interpolated between these anchors. */
export const BOT_STRENGTH = Object.freeze([
  { elo: 400, strength: 0.06, blunderChance: 0.34, candidatePool: 5, maxEvalLossCp: 1400, level: 'beginner' },
  { elo: 700, strength: 0.18, blunderChance: 0.22, candidatePool: 5, maxEvalLossCp: 900, level: 'beginner' },
  { elo: 1000, strength: 0.32, blunderChance: 0.13, candidatePool: 4, maxEvalLossCp: 550, level: 'beginner' },
  { elo: 1250, strength: 0.44, blunderChance: 0.08, candidatePool: 4, maxEvalLossCp: 380, level: 'club' },
  { elo: 1500, strength: 0.56, blunderChance: 0.045, candidatePool: 4, maxEvalLossCp: 260, level: 'club' }
]);

export const BOOK = Object.freeze({
  /* How often a club regular reaches for the club opening when the line allows. */
  regularPreference: 0.9,
  starPreference: 1.0
});

export default { GAME, LEVELS, XP, ELO, FOCUS, HINTS, UNDO, MASTERY, REPERTOIRE, TOURNAMENT, GRADING, CLUTCH, SCORE, BOT_STRENGTH, BOOK };
