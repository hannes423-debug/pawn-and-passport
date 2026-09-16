/**
 * career.js - the campaign rules, with no DOM and no engine.
 *
 * A career is one plain JSON object (it is exactly what gets saved). Every
 * function here takes it and changes it in place, returning a small report of
 * what happened so the UI can celebrate it. tests/career.test.js drives the
 * whole campaign through these functions in Node.
 *
 * Two progression tracks, kept apart on purpose:
 *   Club Trophies  main story, 6, unlock the Grand Finale
 *   Postcards      optional, 6, unlock the Beyond the Tour page
 */

import { LEVELS, XP, ELO, FOCUS, HINTS, MASTERY, REPERTOIRE, TOURNAMENT, GAME } from '../data/config.js';
import { CLUBS, FINALE, clubById } from '../data/clubs.js';
import { OPENINGS } from '../data/openings.js';
import { STAR_PLAYERS, starForClub, starById } from '../data/starPlayers.js';
import { POSTCARDS } from '../data/postcards.js';
import { MISSIONS, missionById } from '../data/missions.js';
import { PUZZLES } from '../data/puzzles.js';

/* ------------------------------------------------------------- creation -- */

export function newCareer({ name, avatar, startClubId, now = Date.now() }) {
  const club = clubById(startClubId);
  if (!club) throw new Error(`unknown starting club ${startClubId}`);
  const trimmed = String(name || '').trim().slice(0, 16) || 'Rookie';
  const openings = Object.fromEntries(OPENINGS.map((o) => [o.id, 0]));
  openings[club.openingId] = MASTERY.starting;
  return {
    game: GAME.title,
    version: GAME.saveVersion,
    createdAt: now,
    savedAt: now,
    name: trimmed,
    avatar: avatar === 'girl' ? 'girl' : 'boy',
    startClubId: club.clubId,
    location: { clubId: club.clubId, sceneId: club.scenes.exterior },
    visited: { [club.clubId]: true },
    level: 1,
    xp: 0,
    elo: ELO.start,
    openings,
    equipped: [club.openingId],   // the repertoire: see equipOpening
    trophies: {},            // clubId -> { wonAt, starElo, tier }
    postcards: {},           // postcardId -> { collectedAt, read }
    secretRevealSeen: false,
    puzzlesSolved: {},       // puzzleId -> true
    tournaments: {},         // clubId -> run state, see enterTournament
    finale: { unlocked: false, round: 0, opponents: null, results: [], won: false },
    stars: {},               // starId -> { met, beaten, losses }
    stats: {
      games: 0, wins: 0, draws: 0, losses: 0,
      grades: { EPIC: 0, BRILLIANT: 0, CLUTCH: 0, BEST: 0, EXCELLENT: 0, GOOD: 0, BOOK: 0, INACCURACY: 0, MISTAKE: 0, MISS: 0, BLUNDER: 0 },
      careerScore: 0, bestScore: null, accuracyTotal: 0, accuracyGames: 0, bestAccuracy: null,
      hintsUsed: 0, puzzlesSolved: 0, peakElo: ELO.start
    },
    completed: false,
    completedAt: null
  };
}

/* --------------------------------------------------------- level and xp -- */

export function levelForXp(xp) {
  let level = 1;
  for (let l = 2; l <= LEVELS.cap; l += 1) if (xp >= LEVELS.xpToReach[l]) level = l;
  return level;
}

export function xpProgress(career) {
  const { level, xp } = career;
  if (level >= LEVELS.cap) return { level, into: 0, needed: 0, fraction: 1, max: true };
  const floor = LEVELS.xpToReach[level];
  const next = LEVELS.xpToReach[level + 1];
  return { level, into: xp - floor, needed: next - floor, fraction: (xp - floor) / (next - floor), max: false };
}

export function grantXp(career, amount) {
  const before = career.level;
  career.xp = Math.max(0, career.xp + Math.round(amount));
  career.level = levelForXp(career.xp);
  return { xp: Math.round(amount), levelsGained: career.level - before, level: career.level };
}

export const maxFocus = (level) => FOCUS.base + FOCUS.perLevel * (Math.min(level, LEVELS.cap) - 1);

export function hintPlies(level) {
  let band = HINTS.pliesByLevel[0];
  for (const entry of HINTS.pliesByLevel) if (level >= entry.from) band = entry;
  return band;
}

/* ---------------------------------------------------------- the opening -- */

export function masteryState(percent) {
  let state = MASTERY.states[0];
  for (const entry of MASTERY.states) if (percent >= entry.from) state = entry;
  return state;
}

/** A game that reached the opening teaches a little, never past playCap. */
export function learnFromPlay(career, openingId) {
  const before = career.openings[openingId] ?? 0;
  if (before >= MASTERY.playCap) return 0;
  const after = Math.min(MASTERY.playCap, before + MASTERY.perGameReached);
  career.openings[openingId] = after;
  return after - before;
}

export const specialtyOpening = (career) => clubById(career.startClubId)?.openingId || null;

/* ----------------------------------------------------------- repertoire -- */

export function repertoireSlots(level) {
  let slots = REPERTOIRE.slotsByLevel[0].slots;
  for (const band of REPERTOIRE.slotsByLevel) if (level >= band.from) slots = band.slots;
  return slots;
}

export const isUnlocked = (career, openingId) => (career.openings[openingId] ?? 0) > 0;

/** Mastery of equipped openings only: what guide arrows and hint discounts may use. */
export function equippedMastery(career) {
  return Object.fromEntries((career.equipped || []).map((id) => [id, career.openings[id] ?? 0]));
}

/** @returns {{ok:boolean, reason?:string}} */
export function equipOpening(career, openingId) {
  career.equipped = career.equipped || [];
  if (career.equipped.includes(openingId)) return { ok: true };
  if (!isUnlocked(career, openingId)) return { ok: false, reason: 'locked' };
  if (career.equipped.length >= repertoireSlots(career.level)) return { ok: false, reason: 'full' };
  career.equipped.push(openingId);
  return { ok: true };
}

export function unequipOpening(career, openingId) {
  career.equipped = (career.equipped || []).filter((id) => id !== openingId);
  return { ok: true };
}

/**
 * Bring an older save up to date. Idempotent.
 * v1 -> v2: adds the repertoire, equipping the home opening first and then
 * the best-known openings while slots remain.
 */
export function migrateCareer(career) {
  if (!career) return career;
  if (!Array.isArray(career.equipped)) {
    const home = specialtyOpening(career);
    const ranked = Object.entries(career.openings || {}).filter(([, m]) => m > 0)
      .sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const order = [home, ...ranked.filter((id) => id !== home)].filter(Boolean);
    career.equipped = order.slice(0, repertoireSlots(career.level || 1));
  }
  const slots = repertoireSlots(career.level || 1);
  career.equipped = career.equipped.filter((id, i, all) => all.indexOf(id) === i && (career.openings[id] ?? 0) > 0).slice(0, slots);
  career.version = GAME.saveVersion;
  return career;
}

/* ------------------------------------------------------------- campaign -- */

/** Campaign tier = Club Trophies already won. Sets every difficulty band. */
export const tier = (career) => Object.keys(career.trophies).length;
export const trophyCount = tier;
export const postcardCount = (career) => Object.keys(career.postcards).length;
export const hasAllTrophies = (career) => CLUBS.every((c) => career.trophies[c.clubId]);
export const hasAllPostcards = (career) => POSTCARDS.every((p) => career.postcards[p.id]);

export function regularElo(tierIndex, random = Math.random) {
  const [lo, hi] = ELO.regularBands[Math.min(tierIndex, ELO.regularBands.length - 1)];
  return Math.round((lo + (hi - lo) * random()) / 5) * 5;
}
export const starElo = (tierIndex) => ELO.starByTier[Math.min(tierIndex, ELO.starByTier.length - 1)];

export function travelTo(career, clubId, sceneId) {
  career.location = { clubId, sceneId };
  if (clubId !== FINALE.id) career.visited[clubId] = true;
}

export function meetStar(career, starId) {
  const entry = career.stars[starId] || (career.stars[starId] = { met: false, beaten: false, losses: 0 });
  const first = !entry.met;
  entry.met = true;
  return first;
}

/* ----------------------------------------------------------- tournament -- */

/**
 * Enter (or look at) a club's tournament.
 *
 * Strength is FIXED when the run starts, from the tier at that moment, so a
 * trophy won elsewhere mid-run cannot make a half-played event harder.
 */
export function enterTournament(career, clubId, random = Math.random) {
  const club = clubById(clubId);
  const existing = career.tournaments[clubId];
  if (existing && !existing.completed) return existing;
  if (career.trophies[clubId]) return existing || null;
  const t = tier(career);
  const pool = [...club.regularOpponentPool];
  const picked = [];
  while (picked.length < TOURNAMENT.regularRounds && pool.length) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  const elos = picked.map(() => regularElo(t, random)).sort((a, b) => a - b);
  const star = starForClub(clubId);
  const run = {
    clubId, tier: t, round: 0, completed: false, results: [],
    rounds: [
      ...picked.map((opponent, i) => ({ kind: 'regular', opponentId: opponent.id, name: opponent.name, style: opponent.style, elo: elos[i] })),
      { kind: 'star', opponentId: star.id, name: star.name, style: star.style, elo: starElo(t) }
    ],
    colours: picked.map((_, i) => (random() < 0.5 ? 'w' : 'b')).concat(random() < 0.5 ? 'w' : 'b')
  };
  career.tournaments[clubId] = run;
  return run;
}

export function currentRound(career, clubId) {
  const run = career.tournaments[clubId];
  if (!run || run.completed) return null;
  return { index: run.round, total: run.rounds.length, colour: run.colours[run.round], ...run.rounds[run.round] };
}

/**
 * Record a tournament game. A regular round clears on a win or draw, the Star
 * Player only on a win. A failed round stays current and can be replayed.
 * @returns {{cleared:boolean, completed:boolean, trophy:Object|null}}
 */
export function recordTournamentGame(career, clubId, score, now = Date.now()) {
  const run = career.tournaments[clubId];
  if (!run || run.completed) return { cleared: false, completed: false, trophy: null };
  const round = run.rounds[run.round];
  const needed = round.kind === 'star' ? TOURNAMENT.starClearScore : TOURNAMENT.regularClearScore;
  const cleared = score >= needed;
  run.results.push({ round: run.round, score, at: now });
  if (round.kind === 'star') {
    const entry = career.stars[round.opponentId] || (career.stars[round.opponentId] = { met: true, beaten: false, losses: 0 });
    if (cleared) entry.beaten = true; else entry.losses += 1;
  }
  if (!cleared) return { cleared: false, completed: false, trophy: null };
  run.round += 1;
  if (run.round < run.rounds.length) return { cleared: true, completed: false, trophy: null };
  run.completed = true;
  return { cleared: true, completed: true, trophy: awardTrophy(career, clubId, round.elo, now) };
}

/** Trophy + full opening mastery + XP, exactly once. */
export function awardTrophy(career, clubId, starEloValue, now = Date.now()) {
  if (career.trophies[clubId]) return null;
  const club = clubById(clubId);
  career.trophies[clubId] = { wonAt: now, starElo: starEloValue, tier: tier(career) };
  const masteryBefore = career.openings[club.openingId] ?? 0;
  career.openings[club.openingId] = MASTERY.trophy;
  const xp = grantXp(career, XP.trophy);
  const autoEquipped = equipOpening(career, club.openingId).ok && career.equipped.includes(club.openingId);
  const finaleUnlocked = hasAllTrophies(career) && !career.finale.unlocked;
  if (finaleUnlocked) career.finale.unlocked = true;
  return {
    clubId, trophyName: club.trophyName, openingId: club.openingId,
    masteryBefore, masteryAfter: MASTERY.trophy, xp, finaleUnlocked, equipped: autoEquipped
  };
}

/* ------------------------------------------------------------ the finale -- */

export function enterFinale(career, random = Math.random) {
  if (!hasAllTrophies(career)) return null;
  career.finale.unlocked = true;
  if (!career.finale.opponents) {
    const home = starForClub(career.startClubId);
    const others = STAR_PLAYERS.filter((s) => s.id !== home.id).map((s) => s.id);
    const pick = () => others.splice(Math.floor(random() * others.length), 1)[0];
    career.finale.opponents = [pick(), pick(), home.id];
    career.finale.colours = [0, 1, 2].map(() => (random() < 0.5 ? 'w' : 'b'));
  }
  return career.finale;
}

export function currentFinaleRound(career) {
  const f = career.finale;
  if (!f.opponents || f.won) return null;
  const star = starById(f.opponents[f.round]);
  return {
    index: f.round, total: FINALE.rounds.length, label: FINALE.rounds[f.round].label,
    kind: 'finale', opponentId: star.id, name: star.name, style: star.style,
    openingId: star.openingId, elo: ELO.finaleRounds[f.round], colour: f.colours[f.round]
  };
}

/** A finale round is won or it is replayed. Winning round 3 ends the campaign. */
export function recordFinaleGame(career, score, now = Date.now()) {
  const f = career.finale;
  if (!f.opponents || f.won) return { cleared: false, won: false };
  f.results.push({ round: f.round, score, at: now });
  if (score < 1) return { cleared: false, won: false };
  f.round += 1;
  if (f.round < FINALE.rounds.length) return { cleared: true, won: false };
  f.won = true;
  career.completed = true;
  career.completedAt = now;
  const xp = grantXp(career, XP.finaleWin);
  return { cleared: true, won: true, xp };
}

/* -------------------------------------------------------- game rewards -- */

/**
 * Pay out one finished game.
 *
 * @param {Object} g
 * @param {'friendly'|'tournament'|'star'|'finale'} g.kind
 * @param {number} g.score        1 / 0.5 / 0
 * @param {number} g.opponentElo
 * @param {Object} g.grades       { EPIC, BRILLIANT, CLUTCH, BEST, ... } for the player's moves
 * @param {number|null} g.accuracy
 * @param {Object} g.matchScore   from scoring.js
 * @param {number} g.hintsUsed
 * @param {string[]} g.openingsReached  opening ids whose line the game reached
 */
export function applyGameResult(career, g, now = Date.now()) {
  const s = career.stats;
  s.games += 1;
  if (g.score === 1) s.wins += 1; else if (g.score === 0.5) s.draws += 1; else s.losses += 1;
  for (const [grade, n] of Object.entries(g.grades || {})) s.grades[grade] = (s.grades[grade] || 0) + n;
  s.hintsUsed += g.hintsUsed || 0;
  if (typeof g.accuracy === 'number') {
    s.accuracyTotal += g.accuracy; s.accuracyGames += 1;
    if (s.bestAccuracy === null || g.accuracy > s.bestAccuracy) s.bestAccuracy = g.accuracy;
  }
  const total = g.matchScore?.total || 0;
  s.careerScore += total;
  if (!s.bestScore || total > s.bestScore.score) {
    s.bestScore = { score: total, letter: g.matchScore?.letter || null, opponent: g.opponentName || null, at: now };
  }

  // Elo. Expected score on the usual 400-point logistic.
  const expected = 1 / (1 + 10 ** ((g.opponentElo - career.elo) / 400));
  const k = ELO.k[g.kind] ?? ELO.k.friendly;
  const eloDelta = Math.round(k * (g.score - expected));
  career.elo = Math.max(ELO.floor, career.elo + eloDelta);
  s.peakElo = Math.max(s.peakElo, career.elo);

  // XP.
  const resultXp = g.score === 1 ? XP.game.win : g.score === 0.5 ? XP.game.draw : XP.game.loss;
  let gradeXp = 0;
  for (const [grade, points] of Object.entries(XP.perGrade)) gradeXp += (g.grades?.[grade] || 0) * points;
  const multiplier = XP.kindMultiplier[g.kind] ?? 1;
  const xp = grantXp(career, (XP.game.base + resultXp + gradeXp) * multiplier);

  // Openings learned by playing them.
  const mastery = {};
  for (const id of g.openingsReached || []) {
    const gained = learnFromPlay(career, id);
    if (gained) mastery[id] = gained;
  }
  return { eloDelta, elo: career.elo, xp, mastery };
}

/* ------------------------------------------------------------- missions -- */

export function missionProgress(career, missionId) {
  const puzzles = PUZZLES.filter((p) => p.mission === missionId.replace(/^m-/, ''));
  const solved = puzzles.filter((p) => career.puzzlesSolved[p.id]).length;
  return { solved, total: puzzles.length, complete: puzzles.length > 0 && solved === puzzles.length, puzzles };
}

/**
 * A puzzle solved. The last one of a mission pays the postcard, once.
 * @returns {{firstSolve:boolean, xp:Object|null, missionComplete:boolean, postcard:Object|null, allPostcards:boolean}}
 */
export function recordPuzzleSolved(career, puzzleId, now = Date.now()) {
  const puzzle = PUZZLES.find((p) => p.id === puzzleId);
  if (!puzzle) return { firstSolve: false, xp: null, missionComplete: false, postcard: null, allPostcards: false };
  const firstSolve = !career.puzzlesSolved[puzzleId];
  let xp = null;
  if (firstSolve) {
    career.puzzlesSolved[puzzleId] = true;
    career.stats.puzzlesSolved += 1;
    xp = grantXp(career, XP.puzzleSolved);
  }
  const mission = MISSIONS.find((m) => m.clubId === puzzle.mission);
  const progress = missionProgress(career, mission.id);
  let postcard = null;
  if (progress.complete && !career.postcards[mission.postcardId]) {
    career.postcards[mission.postcardId] = { collectedAt: now, read: false };
    postcard = POSTCARDS.find((p) => p.id === mission.postcardId);
    grantXp(career, XP.missionComplete);
  }
  return { firstSolve, xp, missionComplete: progress.complete, postcard, allPostcards: !!postcard && hasAllPostcards(career) };
}

export { missionById };

export default {
  newCareer, levelForXp, xpProgress, grantXp, maxFocus, hintPlies, masteryState, learnFromPlay,
  tier, trophyCount, postcardCount, hasAllTrophies, hasAllPostcards, regularElo, starElo, travelTo, meetStar,
  enterTournament, currentRound, recordTournamentGame, awardTrophy,
  enterFinale, currentFinaleRound, recordFinaleGame, applyGameResult, missionProgress, recordPuzzleSolved,
  repertoireSlots, isUnlocked, equippedMastery, equipOpening, unequipOpening, migrateCareer
};
