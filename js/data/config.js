/**
 * config.js - EVERY tunable number in Pawn & Passport.
 *
 * Rebalancing the jam is editing this file. Nothing below is repeated in the
 * rules modules; they read it.
 */

export const GAME = Object.freeze({
  title: 'Pawn & Passport',
  subtitle: 'A Chess Career RPG',
  version: '1.1.1',
  saveVersion: 3
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
  kindMultiplier: { friendly: 0.8, challenge: 1, tournament: 1.25, star: 1.5, finale: 1.75 },
  trophy: 250,
  finaleWin: 600,
  puzzleSolved: 25,        // first solve only
  clubPuzzleSolved: 15,    // a practice-room puzzle, first solve only
  missionComplete: 120
});

/* ================================================================ practice === */
/* The club practice tree. Tiers open with campaign progress: the beginner tier
   is open from the first visit, and every Club Trophy (one per tournament
   completed) opens the next one, up to 1500 - the game's ceiling. A player is
   never required to finish a tier: any unlocked lesson can be opened, in any
   order, and earlier ones stay open forever. */
export const PRACTICE = Object.freeze({
  tiers: [
    { id: 'beginner', label: 'Beginner', bands: [0, 100, 200, 300, 400, 500, 600], trophies: 0,
      blurb: 'The board, the pieces, the rules and your first tactics.' },
    { id: 'club', label: 'Club player', bands: [700, 800], trophies: 1,
      blurb: 'Opening principles and how to calculate a short line.' },
    { id: 'endgames', label: 'Endgames and plans', bands: [900, 1000], trophies: 2,
      blurb: 'Basic mates, pawn endings, and your first strategic vocabulary.' },
    { id: 'tactics', label: 'Sharper tactics', bands: [1100, 1200], trophies: 3,
      blurb: 'The tactics behind sacrifices, and what pawn structures mean.' },
    { id: 'planning', label: 'Planning', bands: [1300], trophies: 4,
      blurb: 'Turning a position into a plan, and stopping theirs.' },
    { id: 'depth', label: 'Exact calculation', bands: [1400], trophies: 5,
      blurb: 'Candidate trees, quiet moves, only moves, visualisation.' },
    { id: 'practical', label: 'Practical play', bands: [1500], trophies: 6,
      blurb: 'Initiative, compensation, conversion, defending worse positions.' }
  ],
  xpChallenge: 6,   // first solve of one challenge
  xpLesson: 40      // first time a lesson is fully complete
});

/* ====================================================================== elo ===
 *
 * TWO ratings live here and they are not the same number.
 *
 * ELO is the PLAYER's: where a career starts, how far it can fall, and the K
 * factor each kind of game is rated at. It has no ceiling, because the player
 * is allowed to outgrow the tour.
 *
 * BOT_ELO is the range of OPPONENT strength this game knows how to build. 250
 * is the weakest opponent BOT_STRENGTH can describe; 1500 is the strongest the
 * campaign is designed around (the Madrid final), and no campaign opponent may
 * be asked for above it. They used to be one `ELO.cap`, which meant a change
 * to the opponent ceiling silently moved the player's rating rules too.
 */
export const ELO = Object.freeze({
  start: 600,
  floor: 100,
  /* Friendlies are practice: unrated (K = 0). */
  k: { friendly: 0, challenge: 16, tournament: 32, star: 32, finale: 32 }
});

export const BOT_ELO = Object.freeze({
  min: 250,
  max: 1500
});

/* ================================================================ difficulty ===
 *
 * ONE place decides how hard the campaign is. A mode owns the whole ladder -
 * the regular opponents' band per campaign TIER (trophies already won, 0..5,
 * not per club: the player picks the order, so the sixth club VISITED is the
 * hard one), the Star Player who guards each trophy, and the three finale
 * rounds. Nothing else in the game branches on the difficulty; everything
 * asks difficultyMode() for the curve and goes through the same
 * js/core/difficulty.js pipeline into a bot profile.
 *
 * THE RULE: Elo is absolute. A mode's numbers are literal opponent Elo and
 * nothing else. Difficulty decides WHICH Elos a player meets, never how an
 * opponent of a given Elo plays - a 900 in Easy, a 900 in Normal and a 900 in
 * Hard are the same bot, because all three go through the one
 * `strengthForElo(elo)` and it is not told which mode asked. Style
 * (aggressive, positional, ...) chooses between REASONABLE moves and is a
 * character trait, not a strength knob. tests/run.js asserts both halves.
 *
 * These numbers are PLAYING STRENGTH, checked with tools/dev/calibrate_bots.mjs
 * (average centipawn loss against a depth-12 reference), not labels. The
 * BOT_STRENGTH table below is what turns one into an opponent.
 */
export const DIFFICULTY = Object.freeze({
  default: 'normal',
  modes: Object.freeze([
    Object.freeze({
      id: 'easy',
      label: 'Easy',
      tagline: 'Learning the ropes',
      blurb: 'For complete beginners. Your opponents still get stronger as you travel, but they miss much more and leave you room to come back.',
      /* Easy starts where somebody who has just learned how the pieces move
         actually starts. A 250-400 opponent develops badly, hangs pieces and
         misses what you are threatening - but it still takes what you leave
         hanging, because a beginner who refuses a free queen is not a
         beginner, it is a random move generator. See BOT_STRENGTH. */
      regularBands: Object.freeze([[250, 400], [400, 500], [500, 600], [600, 700], [700, 800], [800, 900]]),
      starByTier: Object.freeze([400, 500, 600, 700, 800, 900]),
      finaleRounds: Object.freeze([900, 950, 1000])
    }),
    Object.freeze({
      id: 'normal',
      label: 'Normal',
      tagline: 'Chess career',
      blurb: 'The intended Pawn & Passport progression. A club player should finish it, and the last cities should still make them work.',
      regularBands: Object.freeze([[500, 650], [650, 800], [800, 900], [900, 1000], [1000, 1100], [1100, 1200]]),
      starByTier: Object.freeze([650, 800, 900, 1000, 1100, 1250]),
      finaleRounds: Object.freeze([1300, 1375, 1450])
    }),
    Object.freeze({
      id: 'hard',
      label: 'Hard',
      tagline: 'Club challenge',
      blurb: 'For experienced club players who want the opposition to punish them. Every city is a step up from Normal.',
      regularBands: Object.freeze([[700, 800], [800, 900], [900, 1000], [1000, 1100], [1100, 1250], [1250, 1400]]),
      starByTier: Object.freeze([850, 950, 1050, 1150, 1300, 1400]),
      finaleRounds: Object.freeze([1400, 1450, 1500])
    })
  ])
});

/** A mode by id, falling back to the default rather than throwing on an old save. */
export function difficultyMode(id) {
  return DIFFICULTY.modes.find((m) => m.id === id)
    || DIFFICULTY.modes.find((m) => m.id === DIFFICULTY.default);
}

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
  /* A hint is a handful of ROLLS, one per candidate move. The engine ranks
     the playable moves (MultiPV); roll 1 is for the best one, roll 2 for the
     runner-up, roll 3 for the third. Each roll succeeds or fails on its own:
     a failed roll shows nothing for that move, a successful one shows it in
     the quality it rolled, and the quality is how far the idea reaches:
       green   the move                                  (1 of your moves)
       purple  the move, then the next one               (2)
       gold    the move and two more                     (3)
     Later moves are not shown in advance: after the opponent replies, the
     engine draws the next move of the plan you followed, like the opening guide. */
  rollsByLevel: [
    { from: 1, rolls: 1, label: '1 roll' },
    { from: 5, rolls: 2, label: '2 rolls' },
    { from: 10, rolls: 3, label: '3 rolls' }
  ],
  /* Chances per roll, by level. Each row sums to 1. */
  oddsByLevel: [
    { from: 1, fail: 0.30, green: 0.55, purple: 0.12, gold: 0.03 },
    { from: 5, fail: 0.25, green: 0.50, purple: 0.18, gold: 0.07 },
    { from: 10, fail: 0.20, green: 0.42, purple: 0.26, gold: 0.12 },
    { from: 15, fail: 0.10, green: 0.35, purple: 0.35, gold: 0.20 }
  ],
  movesByQuality: { green: 1, purple: 2, gold: 3 },
  /* A candidate only gets a roll if it is playable: at most this many
     win-probability points (0..100) worse than the engine's best. With one
     playable move there is one roll, whatever the level. */
  playableLoss: 8,
  candidates: 3,
  rollsMultiplier: { 1: 1.0, 2: 1.3, 3: 1.6 },
  /* Focus given back, as a share of what the hint cost. Paid on your NEXT
     move only (a plan's later, free moves pay nothing):
       lesser   playing the 2nd or 3rd suggestion instead of the best
       ignored  playing none of the suggestions: you trusted yourself
       blank    every roll failed and nothing was shown */
  refund: { lesser: [0, 0.3, 0.5], ignored: 0.75, blank: 0.75 },
  /* Inside a known opening line: 1 - familiarityDiscount * mastery (0..1). */
  familiarityDiscount: 0.6,
  specialtyMultiplier: 0.9,          // extra for your starting club's opening
  phaseMultiplier: { opening: 1.0, middlegame: 1.2, endgame: 1.4 },
  complexityThreshold: 0.55,
  complexityMultiplier: 1.15,
  /* Hints use the same strong engine as grading. Level changes how many rolls
     and how good they are, never the engine's strength. */
  search: { depth: 14, movetime: 1500, nodes: 1500000 }
});

/* ================================================================ guide === */
/* The opening guide is the player's own preparation, drawn from the book.
   A MASTERED opening (100%) is known well enough that an opponent leaving the
   book does not leave the player lost: until the game passes the opening's
   longest prepared line, the guide keeps going with the engine's move. */
export const GUIDE = Object.freeze({
  masteredFillIn: true,
  masteredAt: 100,
  /* Only once the game has really been in the opening: the guide was showing
     it at this ply or later (1.e4 c5 against an Italian player is simply a
     different opening, not a deviation from the Italian). */
  minBookPlies: 2
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
  /* Each club runs one format. Swiss: 16 players, everyone plays all 5 rounds,
     and the leader after round 5 (tiebreak Buchholz, then rating) meets the
     Star Player in the final. Knockout: 32 players, lose once and you are out;
     the bracket winner meets the Star. Either way the TROPHY needs a win in
     the final. Anyone who falls short enters a fresh event next time. */
  format: { nyc: 'swiss', lon: 'knockout', vie: 'swiss', ist: 'knockout', che: 'swiss', wen: 'knockout' },
  rounds: 5,
  field: { swiss: 16, knockout: 32 },
  /* A knockout game cannot end level: a draw goes to Black (Armageddon rule). */
  knockoutDrawGoesTo: 'b',
  /* Mastery of the club opening per tournament game played (the final too),
     never past failedRunCap: only the trophy makes it 100. */
  masteryPerGame: { win: 6, draw: 4, loss: 3 },
  masteryCap: 60
});

/* ============================================================== members === */
/* A member's Elo: its club strength `rel` (0..1) laid over the tier's regular
   band, widened so a field has real underdogs and real favourites. Visitors
   (the rest of a tournament field) sit in the lower part of the same range. */
export const MEMBERS = Object.freeze({
  belowBand: 100,          // weakest member = band low - this
  aboveBand: 60,           // strongest member = band high + this
  visitorRel: [0, 0.7]
});

/* ============================================================ simulation === */
/* NPC games are played out on Elo: expected score on a logistic with this
   SCALE (steeper than the usual 400, so a 400-point gap is a real mismatch:
   the underdog wins ~4%, but 100 points apart it is roughly 1 in 4), and a
   draw rate that falls as the gap grows. */
export const SIM = Object.freeze({
  scale: 300,
  drawAtEqual: 0.16,
  drawFalloff: 250         // draw share = drawAtEqual * exp(-|gap| / drawFalloff)
});

/* ================================================================= coins === */
export const COINS = Object.freeze({
  start: 100,
  /* A challenge stake by the opponent's Elo: stakeMin at stakeFromElo[0],
     stakeMax at stakeFromElo[1], rounded to 5. A draw returns the stake. */
  stakeMin: 10,
  stakeMax: 40,
  stakeFromElo: [450, 1350],
  /* Tournament prize money: per point scored, and for the final. */
  perTournamentPoint: 8,
  finalist: 40,
  champion: 120,
  puzzle: 5,               // first solve of any puzzle
  missionComplete: 25
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
/* A target Elo, as an opponent. js/core/difficulty.js interpolates this table
 * and hands the result to the bot; nothing else decides how strong anyone is.
 *
 * MEASURED, NOT ASSUMED. tools/dev/calibrate_bots.mjs prints the average
 * centipawn loss each row actually produces against a depth-12 reference.
 * At --samples=40 this table measures 269 / 242 / 188 / 160 / 120 / 94 / 75
 * ACPL at labels 300 / 500 / 700 / 900 / 1100 / 1300 / 1500: strictly
 * monotone, evenly separated. Read the ladder, not the absolute number - the
 * tool's ACPL-to-Elo anchors are approximate and its estimate runs about 130
 * points under the label all the way up, which is an offset in the anchors,
 * not a step in the table.
 *
 * Stockfish will not limit itself below UCI_Elo 1320, so under about 1200 the
 * strength does not come from the engine at all. It comes from `blunderChance`
 * (how often an unforced error happens) and `blunderSeverityCp` (how much that
 * error may hand over - a hung queen at the bottom, a dropped pawn near the
 * top). That pair is what makes a beginner opponent feel like a beginner
 * rather than like a strong engine playing quickly.
 *
 * Two of the columns exist to keep a weak bot BAD rather than RANDOM:
 *
 *   seesFreeMaterialCp  how much material has to be hanging, in centipawns,
 *                       before this opponent notices. At 250 it takes a loose
 *                       knight or better; at 1500 a loose pawn is enough.
 *   greed               how often it takes what it noticed. Weak players are
 *                       greedy: they grab the piece first and find out
 *                       afterwards that the capture walked into a fork. That
 *                       is a far more believable 300 than one that leaves a
 *                       queen standing because a dice roll said so.
 *
 * Together they mean the unforced-error roll can never skip an obviously free
 * capture, which is what "human-like, not random" comes down to in practice.
 * Stockfish itself is never asked to play below UCI_Elo 1320 (it refuses):
 * every rung under that is this table and the bot layer on top of it.
 */
export const BOT_STRENGTH = Object.freeze([
  /* elo   strength  blunder  severity  wild  pool  maxLoss  seesFree  greed  level */
  { elo: 250,  strength: 0.020, blunderChance: 0.850, blunderSeverityCp: 1100, wildness: 0.620, candidatePool: 6, maxEvalLossCp: 2000, seesFreeMaterialCp: 320, greed: 0.72, level: 'novice' },
  { elo: 400,  strength: 0.035, blunderChance: 0.780, blunderSeverityCp: 980,  wildness: 0.530, candidatePool: 6, maxEvalLossCp: 1800, seesFreeMaterialCp: 300, greed: 0.76, level: 'novice' },
  { elo: 550,  strength: 0.055, blunderChance: 0.715, blunderSeverityCp: 860,  wildness: 0.450, candidatePool: 6, maxEvalLossCp: 1560, seesFreeMaterialCp: 280, greed: 0.79, level: 'novice' },
  { elo: 700,  strength: 0.082, blunderChance: 0.650, blunderSeverityCp: 740,  wildness: 0.375, candidatePool: 5, maxEvalLossCp: 1300, seesFreeMaterialCp: 250, greed: 0.82, level: 'novice' },
  { elo: 850,  strength: 0.115, blunderChance: 0.580, blunderSeverityCp: 640,  wildness: 0.305, candidatePool: 5, maxEvalLossCp: 1100, seesFreeMaterialCp: 220, greed: 0.85, level: 'novice' },
  { elo: 1000, strength: 0.160, blunderChance: 0.490, blunderSeverityCp: 545,  wildness: 0.240, candidatePool: 5, maxEvalLossCp: 900,  seesFreeMaterialCp: 190, greed: 0.87, level: 'novice' },
  { elo: 1150, strength: 0.210, blunderChance: 0.410, blunderSeverityCp: 460,  wildness: 0.185, candidatePool: 5, maxEvalLossCp: 790,  seesFreeMaterialCp: 160, greed: 0.89, level: 'novice' },
  { elo: 1300, strength: 0.280, blunderChance: 0.320, blunderSeverityCp: 370,  wildness: 0.125, candidatePool: 5, maxEvalLossCp: 670,  seesFreeMaterialCp: 130, greed: 0.91, level: 'novice' },
  { elo: 1400, strength: 0.345, blunderChance: 0.255, blunderSeverityCp: 315,  wildness: 0.090, candidatePool: 4, maxEvalLossCp: 560,  seesFreeMaterialCp: 115, greed: 0.92, level: 'beginner' },
  { elo: 1500, strength: 0.420, blunderChance: 0.195, blunderSeverityCp: 265,  wildness: 0.060, candidatePool: 4, maxEvalLossCp: 470,  seesFreeMaterialCp: 100, greed: 0.94, level: 'beginner' }
]);

export const BOOK = Object.freeze({
  /* How often a club regular reaches for the club opening when the line allows. */
  regularPreference: 0.9,
  starPreference: 1.0
});

export default { GAME, LEVELS, XP, ELO, BOT_ELO, DIFFICULTY, difficultyMode, FOCUS, HINTS, GUIDE, UNDO, MASTERY, REPERTOIRE, TOURNAMENT, MEMBERS, SIM, COINS, GRADING, CLUTCH, SCORE, BOT_STRENGTH, BOOK, PRACTICE };
