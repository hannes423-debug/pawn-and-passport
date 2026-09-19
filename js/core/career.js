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

import { LEVELS, XP, ELO, FOCUS, HINTS, MASTERY, REPERTOIRE, TOURNAMENT, GAME, UNDO, MEMBERS, COINS } from '../data/config.js';
import { membersForClub, VISITORS } from '../data/members.js';
import * as Event from './tournament.js';
import { hintBand } from './focusHints.js';
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
    tournaments: {},         // clubId -> the current or last event, see enterTournament
    coins: COINS.start,
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

/** How many undos a game allows at this level. */
export function undoUses(level) {
  let uses = UNDO.usesByLevel[0].uses;
  for (const band of UNDO.usesByLevel) if (level >= band.from) uses = band.uses;
  return uses;
}

/** The level's Focus hint: how many rolls, and their odds (focusHints.js). */
export const hintPlies = (level) => hintBand(level);

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

/** Finishing an opening's tutorial: known at least a little, so it can be equipped. */
export function learnFromTutorial(career, openingId) {
  const before = career.openings[openingId] ?? 0;
  const after = Math.max(before, MASTERY.tutorialGrant);
  career.openings[openingId] = after;
  career.tutorialsDone = { ...(career.tutorialsDone || {}), [openingId]: true };
  return after - before;
}

/** A drill set: `firstTry` correct answers out of `total`. Passing teaches like a game. */
export function learnFromDrill(career, openingId, firstTry, total) {
  const passed = total > 0 && firstTry / total >= MASTERY.drillPassShare;
  const stats = career.stats;
  stats.drillSets = (stats.drillSets || 0) + 1;
  if (!passed) return { passed, gained: 0 };
  const before = career.openings[openingId] ?? 0;
  const after = before >= MASTERY.playCap ? before : Math.min(MASTERY.playCap, before + MASTERY.drillGain);
  career.openings[openingId] = after;
  return { passed, gained: after - before };
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
  // v2 -> v3: coins, and the old three-game tournaments restart as real events.
  if (typeof career.coins !== 'number') career.coins = COINS.start;
  for (const [clubId, run] of Object.entries(career.tournaments || {})) {
    if (!run || !run.format) delete career.tournaments[clubId];
  }
  // Repairs: a run that cannot continue restarts, an unknown place becomes the club's garden.
  for (const [clubId, run] of Object.entries(career.tournaments || {})) {
    let ok = true;
    try { ok = run.completed || !!currentRound(career, clubId); } catch { ok = false; }
    if (!ok) delete career.tournaments[clubId];
  }
  const place = clubById(career.location?.clubId) || (career.location?.clubId === FINALE.id ? FINALE : null);
  const scenes = place ? Object.values(place.scenes).filter(Boolean) : [];
  if (!place || !scenes.includes(career.location.sceneId)) {
    const home = place || clubById(career.startClubId) || CLUBS[0];
    career.location = { clubId: home.clubId || home.id, sceneId: home.scenes.exterior };
  }
  if (typeof career.xp === 'number') career.level = levelForXp(career.xp);
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

/* ---------------------------------------------------------------- coins -- */

/** A challenge stake, from the opponent's Elo: COINS.stakeMin .. stakeMax. */
export function stakeFor(elo) {
  const [lo, hi] = COINS.stakeFromElo;
  const t = Math.max(0, Math.min(1, (elo - lo) / (hi - lo)));
  return Math.round((COINS.stakeMin + t * (COINS.stakeMax - COINS.stakeMin)) / 5) * 5;
}

export const canAfford = (career, amount) => (career.coins ?? 0) >= amount;

export function earnCoins(career, amount) {
  career.coins = Math.max(0, (career.coins ?? COINS.start) + Math.round(amount));
  if (amount > 0) career.stats.coinsEarned = (career.stats.coinsEarned || 0) + Math.round(amount);
  return Math.round(amount);
}

/** A won challenge pays the stake, a lost one costs it, a draw returns it. */
export function settleChallenge(career, score, stake) {
  const delta = score === 1 ? stake : score === 0 ? -Math.min(stake, career.coins ?? 0) : 0;
  earnCoins(career, delta);
  const s = career.stats;
  s.challenges = (s.challenges || 0) + 1;
  return delta;
}

/* ----------------------------------------------------------- tournament -- */

/** A member's Elo at a campaign tier: their club strength laid over the tier's band. */
export function memberElo(rel, tierIndex) {
  const [lo, hi] = ELO.regularBands[Math.min(tierIndex, ELO.regularBands.length - 1)];
  const from = lo - MEMBERS.belowBand;
  const to = hi + MEMBERS.aboveBand;
  return Math.round((from + (to - from) * rel) / 5) * 5;
}

export const tournamentFormat = (clubId) => TOURNAMENT.format[clubId] || 'swiss';

/** The field: the player, every club member, then visitors up to the format's size. */
export function tournamentField(career, clubId, tierIndex, random = Math.random) {
  const club = clubById(clubId);
  const size = TOURNAMENT.field[tournamentFormat(clubId)];
  const members = membersForClub(clubId).map((mb) => ({
    id: mb.id, name: mb.name, elo: memberElo(mb.rel, tierIndex), style: mb.style,
    openingId: mb.openingId || club.openingId, look: mb.look, member: true
  }));
  const guests = VISITORS[clubId] || { names: [], sprites: ['young-blue'] };
  const names = [...guests.names];
  const styles = ['aggressive', 'positional', 'tactical', 'balanced', 'practical', 'defensive'];
  const visitors = [];
  for (let i = 0; members.length + visitors.length + 1 < size; i += 1) {
    const name = names.length ? names.splice(Math.floor(random() * names.length), 1)[0] : `Guest ${i + 1}`;
    const [a, b] = MEMBERS.visitorRel;
    visitors.push({
      id: `${clubId}-v${i}`, name, elo: memberElo(a + (b - a) * random(), tierIndex),
      style: styles[Math.floor(random() * styles.length)], openingId: club.openingId,
      look: { sprite: guests.sprites[i % guests.sprites.length] }, visitor: true
    });
  }
  const you = { id: Event.YOU, name: career.name, elo: career.elo, you: true };
  return [you, ...members, ...visitors];
}

/**
 * Enter (or look at) a club's tournament. A finished event without a trophy
 * is replaced by a fresh one: a new draw, the same club.
 *
 * Strength is FIXED when the event starts, from the tier at that moment, so a
 * trophy won elsewhere mid-event cannot make it harder.
 */
export function enterTournament(career, clubId, random = Math.random, now = Date.now()) {
  const existing = career.tournaments[clubId];
  if (existing && !existing.completed) return existing;
  if (career.trophies[clubId]) return existing || null;
  const t = tier(career);
  const star = starForClub(clubId);
  const run = Event.createEvent({
    clubId, format: tournamentFormat(clubId), tier: t, now, random,
    players: tournamentField(career, clubId, t, random),
    star: { id: star.id, name: star.name, elo: starElo(t), style: star.style, openingId: star.openingId, look: star.look }
  });
  run.attempt = (existing?.attempt || 0) + 1;
  career.tournaments[clubId] = run;
  return run;
}

/** A finished event that did not end in the trophy: the desk offers a new one. */
export const canReenter = (career, clubId) => {
  const run = career.tournaments[clubId];
  return !career.trophies[clubId] && (!run || run.completed);
};

export function currentRound(career, clubId) {
  const run = career.tournaments[clubId];
  if (!run || run.completed) return null;
  const game = Event.playerGame(run);
  if (!game) return null;
  const o = game.opponent;
  const club = clubById(clubId);
  return {
    index: game.final ? TOURNAMENT.rounds : run.round,
    total: TOURNAMENT.rounds + 1,
    label: game.final ? 'Final' : run.format === 'knockout' ? Event.knockoutRoundName(run, run.round) : `Round ${run.round + 1}`,
    kind: game.final ? 'star' : 'regular',
    colour: game.colour,
    opponentId: o.id, name: o.name, elo: o.elo, style: o.style, look: o.look,
    openingId: o.openingId || club.openingId
  };
}

/** Mastery of the club's opening from one tournament game, under masteryCap. */
function learnFromTournament(career, openingId, score) {
  const before = career.openings[openingId] ?? 0;
  if (before >= TOURNAMENT.masteryCap) return 0;
  const gain = TOURNAMENT.masteryPerGame[score === 1 ? 'win' : score === 0.5 ? 'draw' : 'loss'];
  career.openings[openingId] = Math.min(TOURNAMENT.masteryCap, before + gain);
  return career.openings[openingId] - before;
}

/**
 * Record the player's tournament game. The rest of the round is played out
 * (simulated on Elo), the event moves on, and a finished event pays: prize
 * coins always, the trophy only for beating the Star Player in the final.
 * @returns {{roundIndex:number, final:boolean, outcome:string|null, completed:boolean, toFinal:boolean,
 *            eliminated:boolean, mastery:number, coins:number, trophy:Object|null}}
 */
export function recordTournamentGame(career, clubId, score, now = Date.now(), random = Math.random) {
  const run = career.tournaments[clubId];
  const none = { roundIndex: -1, final: false, outcome: null, completed: false, toFinal: false, eliminated: false, mastery: 0, coins: 0, trophy: null };
  if (!run || run.completed) return none;
  const club = clubById(clubId);
  const final = run.stage === 'final';
  const roundIndex = run.round;
  const me = run.players.find((p) => p.id === Event.YOU);
  if (me) me.elo = career.elo;
  const step = Event.recordPlayerGame(run, score, random);
  const mastery = learnFromTournament(career, club.openingId, score);
  if (final) {
    const entry = career.stars[run.star.id] || (career.stars[run.star.id] = { met: true, beaten: false, losses: 0 });
    if (score === 1) entry.beaten = true; else entry.losses += 1;
  }
  let coins = 0;
  let trophy = null;
  if (run.completed) {
    coins = Event.playerPoints(run) * COINS.perTournamentPoint;
    if (run.outcome === 'runner-up') coins += COINS.finalist;
    if (run.outcome === 'champion') coins += COINS.champion;
    earnCoins(career, coins);
    run.prize = coins;
    career.stats.tournaments = (career.stats.tournaments || 0) + 1;
    if (run.outcome === 'champion') trophy = awardTrophy(career, clubId, run.star.elo, now);
  }
  return { roundIndex, final, outcome: run.outcome, completed: run.completed, toFinal: step.toFinal, eliminated: step.eliminated, mastery, coins, trophy };
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

/**
 * Commit EVERYTHING a finished game earns, exactly once per game.
 *
 * `gameId` is unique per match; a second call with the same id (a doubled
 * end event, a retried finale after a presentation error) changes nothing
 * and returns the first result again. Elo, XP, opening mastery, coins,
 * tournament progress and the finale are all inside this one guard.
 *
 * @returns {{duplicate:boolean, rewards:Object, progress:Object|null, coinDelta:number}}
 */
export function commitMatchResult(career, { gameId, kind, clubId, summary, opponent = {} }, now = Date.now(), random = Math.random) {
  career.committedGames = career.committedGames || {};
  const done = career.committedGames[gameId];
  if (done) return { ...done, duplicate: true };
  const rewards = applyGameResult(career, summary, now);
  let progress = null;
  let coinDelta = 0;
  if (kind === 'tournament' || kind === 'star') { progress = recordTournamentGame(career, clubId, summary.score, now, random); coinDelta = progress.coins; }
  if (kind === 'finale') progress = recordFinaleGame(career, summary.score, now);
  if (kind === 'challenge') {
    coinDelta = settleChallenge(career, summary.score, opponent.stake || 0);
    const records = career.memberRecords = career.memberRecords || {};
    const rec = records[opponent.id] || (records[opponent.id] = { w: 0, d: 0, l: 0 });
    rec[summary.score === 1 ? 'w' : summary.score === 0.5 ? 'd' : 'l'] += 1;
  }
  const out = { rewards, progress, coinDelta };
  // Keep the last few ids only: the guard is for THIS game's end, not history.
  career.committedGames[gameId] = out;
  const ids = Object.keys(career.committedGames);
  for (const id of ids.slice(0, Math.max(0, ids.length - 5))) delete career.committedGames[id];
  return { ...out, duplicate: false };
}

/* --------------------------------------------------- resume and repair -- */

/**
 * The player's next useful action, from the career alone. What the title's
 * Continue, the HUD and the tests all agree on.
 * @returns {{type:'ending'|'finale'|'tournament'|'final'|'enter'|'travel', clubId?:string, label:string}}
 */
export function nextStep(career) {
  if (career.completed) return { type: 'ending', label: 'The tour is complete.' };
  if (career.finale.unlocked) {
    const round = currentFinaleRound(career);
    return { type: 'finale', clubId: FINALE.id, label: `Madrid: ${round ? round.label : 'the Grand Finale'}` };
  }
  const here = career.location.clubId;
  const club = clubById(here);
  if (club && !career.trophies[here]) {
    const round = currentRound(career, here);
    if (round) return { type: round.kind === 'star' ? 'final' : 'tournament', clubId: here, label: `${club.tournamentConfig.name}: ${round.label} vs ${round.name}` };
    return { type: 'enter', clubId: here, label: `Enter the ${club.tournamentConfig.name}` };
  }
  const next = CLUBS.find((c) => !career.trophies[c.clubId]);
  return { type: 'travel', clubId: next.clubId, label: `Travel to ${next.city} for the next trophy` };
}

/**
 * Everything a saved career must satisfy for the game to resume on a valid
 * screen with a valid next action. [] when all is well.
 */
export function validateCareer(career, { sceneExists = () => true } = {}) {
  const problems = [];
  if (!career || typeof career !== 'object') return ['no career'];
  const { clubId, sceneId } = career.location || {};
  if (!(clubById(clubId) || clubId === FINALE.id)) problems.push(`unknown location club ${clubId}`);
  if (!sceneExists(sceneId)) problems.push(`unknown scene ${sceneId}`);
  if (career.level !== levelForXp(career.xp)) problems.push(`level ${career.level} does not match ${career.xp} XP`);
  if (typeof career.coins !== 'number' || career.coins < 0) problems.push(`coins ${career.coins}`);
  for (const id of Object.keys(career.trophies)) if (!clubById(id)) problems.push(`trophy for unknown club ${id}`);
  for (const id of career.equipped || []) if (!((career.openings[id] ?? 0) > 0)) problems.push(`equipped unknown opening ${id}`);
  for (const [id, run] of Object.entries(career.tournaments || {})) {
    if (!run) continue;
    let round = null;
    try { round = currentRound(career, id); } catch { round = null; }
    if (!run.completed && !round) problems.push(`${id}: event running but no game to play`);
    if (run.completed && !run.outcome) problems.push(`${id}: event finished without an outcome`);
  }
  const f = career.finale;
  if (f.opponents && !f.won && !currentFinaleRound(career)) problems.push('finale running but no round to play');
  if (f.won && !career.completed) problems.push('finale won but the campaign is not complete');
  if (f.unlocked && !hasAllTrophies(career)) problems.push('Madrid unlocked without six trophies');
  return problems;
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
/** A club practice-room puzzle: its own record, never a postcard. */
export function recordClubPuzzleSolved(career, puzzleId) {
  career.clubPuzzlesSolved = career.clubPuzzlesSolved || {};
  const firstSolve = !career.clubPuzzlesSolved[puzzleId];
  let xp = null;
  if (firstSolve) {
    career.clubPuzzlesSolved[puzzleId] = true;
    career.stats.practicePuzzles = (career.stats.practicePuzzles || 0) + 1;
    xp = grantXp(career, XP.clubPuzzleSolved);
    earnCoins(career, COINS.puzzle);
  }
  return { firstSolve, xp, coins: firstSolve ? COINS.puzzle : 0 };
}

export function recordPuzzleSolved(career, puzzleId, now = Date.now()) {
  const puzzle = PUZZLES.find((p) => p.id === puzzleId);
  if (!puzzle) return { firstSolve: false, xp: null, missionComplete: false, postcard: null, allPostcards: false };
  const firstSolve = !career.puzzlesSolved[puzzleId];
  let xp = null;
  if (firstSolve) {
    career.puzzlesSolved[puzzleId] = true;
    career.stats.puzzlesSolved += 1;
    xp = grantXp(career, XP.puzzleSolved);
    earnCoins(career, COINS.puzzle);
  }
  const mission = MISSIONS.find((m) => m.clubId === puzzle.mission);
  const progress = missionProgress(career, mission.id);
  let postcard = null;
  if (progress.complete && !career.postcards[mission.postcardId]) {
    career.postcards[mission.postcardId] = { collectedAt: now, read: false };
    postcard = POSTCARDS.find((p) => p.id === mission.postcardId);
    grantXp(career, XP.missionComplete);
    earnCoins(career, COINS.missionComplete);
  }
  return { firstSolve, xp, missionComplete: progress.complete, postcard, allPostcards: !!postcard && hasAllPostcards(career) };
}

export { missionById };

export default {
  newCareer, levelForXp, xpProgress, grantXp, maxFocus, hintPlies, masteryState, learnFromPlay,
  tier, trophyCount, postcardCount, hasAllTrophies, hasAllPostcards, regularElo, starElo, travelTo, meetStar,
  enterTournament, currentRound, recordTournamentGame, awardTrophy, canReenter, tournamentField, memberElo,
  stakeFor, canAfford, earnCoins, settleChallenge, nextStep, validateCareer, commitMatchResult,
  enterFinale, currentFinaleRound, recordFinaleGame, applyGameResult, missionProgress, recordPuzzleSolved,
  repertoireSlots, isUnlocked, equippedMastery, equipOpening, unequipOpening, migrateCareer
};
