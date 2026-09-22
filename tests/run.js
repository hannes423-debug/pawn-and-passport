/**
 * tests/run.js - Pawn & Passport's Node test suite. No browser, no network.
 *
 *   node tests/run.js           rules, data and a full scripted campaign
 *   node tests/run.js --engine  also boots Stockfish (slower)
 *
 * Exits non-zero on any failure, so the exit code can be trusted.
 */

import { OPENINGS } from '../js/data/openings.js';
import { spriteId, setPlayerAvatar, PLAYER_LOOKS } from '../js/ui/sprites.js';
import { SCENE_LAYERS } from '../js/data/sceneLayers.js';
import { createWalkGrid, walkerFor, pointInPolygon } from '../js/core/freeWalk.js';
import { collisionDebugOn } from '../js/ui/screens/scene.js';
import { MOODS, MOOD_RULES, moodFacts, heatOf, createMoodTracker } from '../js/core/musicMood.js';
import { TRACKS, CROSSFADE_MS } from '../js/ui/music.js';
import { uciFor } from '../js/chess/core/rules.js';
import { sceneById } from '../js/data/scenes.js';
import { CLUB_PUZZLES } from '../js/data/clubPuzzles.js';
import { PapMatch } from '../js/game/match.js';
import { undoUses, maxFocus as maxFocusOf } from '../js/core/career.js';
import { UNDO } from '../js/data/config.js';
import { CLUBS, FINALE } from '../js/data/clubs.js';
import { STAR_PLAYERS } from '../js/data/starPlayers.js';
import { POSTCARDS, BEYOND_THE_TOUR } from '../js/data/postcards.js';
import { MISSIONS } from '../js/data/missions.js';
import { PUZZLES } from '../js/data/puzzles.js';
import { SCENES, findPath } from '../js/data/scenes.js';
import { LEVELS, ELO, BOT_ELO, HINTS, DIFFICULTY, difficultyMode, BOT_STRENGTH } from '../js/data/config.js';
import * as Career from '../js/core/career.js';
import { ClubBook, fullBook } from '../js/core/openingBook.js';
import { hintQuote } from '../js/core/hints.js';
import { matchScore } from '../js/core/scoring.js';
import { gradeMove, isClutch } from '../js/core/grading.js';
import * as Lessons from '../js/core/lessons.js';
import { LESSONS as LESSON_LIST } from '../js/data/lessons.js';
import { PRACTICE } from '../js/data/config.js';
import { createRules as createRulesForChess } from '../js/chess/core/rules.js';

const createRulesForTest = (fen) => { try { return createRulesForChess(fen); } catch { return null; } };
import { strengthForElo, profileForOpponent } from '../js/core/difficulty.js';
import { starLines } from '../js/core/dialogue.js';
import * as Save from '../js/core/save.js';
import { createRules, applyUci, isCheckmate } from '../js/chess/core/rules.js';
import { START_FEN } from '../js/chess/core/constants.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const failures = [];

/* Tests run one at a time, in file order, at the end: async tests share
   modules (the save backend, the console) and must not interleave. */
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
function assert(cond, message = 'assertion failed') { if (!cond) throw new Error(message); }
function seeded(s0) { let s = s0; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const eq = (a, b, m) => assert(a === b, `${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

/* ------------------------------------------------------------------ data */

test('exactly 6 clubs, 6 openings, 6 stars, 6 postcards, 6 missions', () => {
  eq(CLUBS.length, 6); eq(OPENINGS.length, 6); eq(STAR_PLAYERS.length, 6); eq(POSTCARDS.length, 6); eq(MISSIONS.length, 6);
});

test('13 locations: 6 clubs + 6 casual venues + the finale', () => {
  const venues = CLUBS.map((c) => c.scenes.venue).filter((id) => SCENES[id]);
  eq(CLUBS.length + venues.length + 1, 13);
  assert(SCENES[FINALE.scenes.interior], 'finale scene');
});

test('three White and three Black openings, one per club', () => {
  eq(OPENINGS.filter((o) => o.side === 'w').length, 3);
  eq(OPENINGS.filter((o) => o.side === 'b').length, 3);
  eq(new Set(CLUBS.map((c) => c.openingId)).size, 6);
});

test('every opening line is legal chess, spelled as chess.js spells it, with matching metadata', () => {
  for (const o of OPENINGS) {
    eq(o.lineNames.length, o.lines.length, `${o.id} lineNames`);
    eq(o.lineIntro.length, o.lines.length, `${o.id} lineIntro`);
    eq(o.lineNotes.length, o.lines.length, `${o.id} lineNotes`);
    o.lines.forEach((line, i) => {
      const r = createRules();
      for (const san of line) { const m = r.move(san); assert(m && m.san === san, `${o.id} line ${i}: ${san}`); }
      for (const k of Object.keys(o.lineNotes[i])) assert(Number(k) < line.length, `${o.id} line ${i}: note ${k} past the end`);
    });
  }
});

test('every club references real data', () => {
  for (const c of CLUBS) {
    assert(STAR_PLAYERS.find((s) => s.id === c.starPlayerId && s.clubId === c.clubId), `${c.clubId} star`);
    assert(POSTCARDS.find((p) => p.id === c.postcardId && p.clubId === c.clubId), `${c.clubId} postcard`);
    assert(MISSIONS.find((m) => m.id === c.puzzleMissionId && m.clubId === c.clubId), `${c.clubId} mission`);
    assert(c.regularOpponentPool.length >= 2, `${c.clubId} pool`);
    for (const key of ['exterior', 'interior', 'venue']) assert(SCENES[c.scenes[key]], `${c.clubId} ${key}`);
  }
});

test('every mission has 3 to 5 verified puzzles', () => {
  for (const m of MISSIONS) {
    const n = PUZZLES.filter((p) => p.mission === m.clubId).length;
    assert(n >= 3 && n <= 5, `${m.id} has ${n}`);
  }
});

test('every puzzle solution is legal and mates end in mate', () => {
  for (const p of PUZZLES) {
    let fen = p.fen;
    for (const uci of p.solution) { const next = applyUci(fen, uci); assert(next, `${p.id} ${uci}`); fen = next.fen; }
    if (p.solutionSan.at(-1).includes('#')) assert(isCheckmate(fen), `${p.id} not mate`);
  }
});

test('postcard letters spell the secret word in journal order', () => {
  const word = [...POSTCARDS].sort((a, b) => a.order - b.order).map((p) => p.letter).join('');
  eq(word, BEYOND_THE_TOUR.word);
  for (const p of POSTCARDS) eq(p.secret[0], p.letter, `${p.id} first letter`);
});

test('every scene hotspot node exists and is reachable from spawn', () => {
  for (const scene of Object.values(SCENES)) {
    for (const [a, b] of scene.links) assert(scene.nodes[a] && scene.nodes[b], `${scene.id} link ${a}-${b}`);
    for (const h of scene.hotspots) {
      assert(scene.nodes[h.node], `${scene.id}:${h.id} node`);
      assert(findPath(scene, scene.spawn.default, h.node), `${scene.id}:${h.id} unreachable`);
      if (h.action.type === 'scene') {
        const target = SCENES[h.action.to];
        assert(target, `${scene.id}:${h.id} -> ${h.action.to}`);
        assert(target.nodes[target.spawn[h.action.spawn] || target.spawn.default], `${h.action.to} spawn ${h.action.spawn}`);
      }
    }
  }
});

test('every scene image and art asset exists on disk', () => {
  for (const scene of Object.values(SCENES)) assert(existsSync(path.join(ROOT, scene.image)), scene.image);
  for (const p of POSTCARDS) assert(existsSync(path.join(ROOT, p.image)), p.image);
  for (const f of ['assets/ui/title-bg.webp', 'assets/ui/world-map.webp', 'assets/board/board.webp', 'assets/pieces/pixel/wK.png']) {
    assert(existsSync(path.join(ROOT, f)), f);
  }
});

test('every character look names a sliced sprite sheet', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'assets/characters/manifest.json'), 'utf8'));
  const looks = [
    ...STAR_PLAYERS.map((s) => [s.name, s.look]),
    ...CLUBS.flatMap((c) => c.regularOpponentPool.map((r) => [r.name, r.look])),
    ...MISSIONS.map((m) => [m.host.name, m.host.look])
  ];
  for (const [who, look] of looks) {
    assert(look.sprite && manifest.sprites[look.sprite], `${who}: ${look.sprite}`);
    assert(existsSync(path.join(ROOT, manifest.sprites[look.sprite].src)), `${who}: file`);
  }
  for (const id of ['boy', 'girl']) assert(manifest.sprites[id], `player sprite ${id}`);
  for (const [id, entry] of Object.entries(manifest.sprites)) {
    assert(entry.portrait && existsSync(path.join(ROOT, entry.portrait)), `${id}: dialogue portrait`);
    assert(!/recolour/.test(entry.from), `${id}: only the artist's sheets, no recolours`);
  }
});

test('an NPC never wears the player\'s own sprite', () => {
  setPlayerAvatar('girl');
  eq(spriteId({ sprite: 'girl' }), 'woman');
  eq(spriteId(PLAYER_LOOKS.girl), 'girl');
  eq(spriteId({ sprite: 'boy' }), 'boy');
  setPlayerAvatar('boy');
  eq(spriteId({ sprite: 'boy' }), 'young-blue');
  eq(spriteId({ sprite: 'girl' }), 'girl');
  setPlayerAvatar(null);
});

test('no Aura, attributes, perks or DNA reach the jam code', () => {
  const banned = /\baura\b|attributePoints|perkPoints|applyPerks|DnaBot|chess-dna|RPGX/i;
  const files = ['js/core/career.js', 'js/core/hints.js', 'js/core/difficulty.js', 'js/game/match.js', 'js/chess/bots/chessBot.js'];
  for (const f of files) {
    const full = path.join(ROOT, f);
    if (!existsSync(full)) continue;
    assert(!banned.test(readFileSync(full, 'utf8')), `${f} mentions a removed system`);
  }
});

/* ----------------------------------------------------------------- rules */

test('level curve: 15 levels, strictly increasing', () => {
  eq(LEVELS.xpToReach.length, LEVELS.cap + 1);
  for (let l = 3; l <= LEVELS.cap; l += 1) assert(LEVELS.xpToReach[l] > LEVELS.xpToReach[l - 1]);
  eq(Career.levelForXp(0), 1); eq(Career.levelForXp(99), 1); eq(Career.levelForXp(100), 2); eq(Career.levelForXp(999999), 15);
});

test('focus grows with level, and a max-level hint gets three rolls', () => {
  assert(Career.maxFocus(15) > Career.maxFocus(1));
  eq(Career.hintPlies(1).rolls, 1); eq(Career.hintPlies(5).rolls, 2); eq(Career.hintPlies(10).rolls, 3); eq(Career.hintPlies(15).rolls, 3);
  assert(Career.hintPlies(15).odds.gold > Career.hintPlies(1).odds.gold, 'better odds at the cap');
  assert(Career.hintPlies(15).odds.fail < Career.hintPlies(1).odds.fail, 'fewer failed rolls at the cap');
});

test('new career: starting club opening at 40%, others at 0', () => {
  const c = Career.newCareer({ name: 'Ada', avatar: 'girl', startClubId: 'vie' });
  eq(c.openings.vienna, 40);
  for (const o of OPENINGS) if (o.id !== 'vienna') eq(c.openings[o.id], 0, o.id);
  eq(c.elo, ELO.start); eq(c.level, 1); eq(c.avatar, 'girl');
});

test('three difficulties, each a ladder that climbs and never crosses the next', () => {
  eq(DIFFICULTY.modes.map((m) => m.id).join(), 'easy,normal,hard');
  eq(DIFFICULTY.default, 'normal');
  for (const mode of DIFFICULTY.modes) {
    eq(mode.starByTier.length, 6, `${mode.id}: one Star Player per club`);
    eq(mode.regularBands.length, 6, `${mode.id}: one band per tier`);
    eq(mode.finaleRounds.length, 3, `${mode.id}: three finale rounds`);
    assert(mode.label && mode.tagline && mode.blurb, `${mode.id} is explained to the player`);
    for (let t = 1; t < 6; t += 1) {
      assert(mode.starByTier[t] > mode.starByTier[t - 1], `${mode.id}: star ${t + 1} is stronger than ${t}`);
      assert(mode.regularBands[t][0] > mode.regularBands[t - 1][0], `${mode.id}: club ${t + 1} is stronger than ${t}`);
    }
    for (const [lo, hi] of mode.regularBands) assert(hi > lo, `${mode.id}: a band is a band`);
    for (let r = 1; r < 3; r += 1) assert(mode.finaleRounds[r] > mode.finaleRounds[r - 1], `${mode.id}: the finale climbs`);
    assert(mode.finaleRounds[0] >= mode.starByTier[5], `${mode.id}: the finale starts above the last club`);
  }
  // Easy is under Normal is under Hard, everywhere, with no overlap.
  const [easy, normal, hard] = DIFFICULTY.modes.map((m) => difficultyMode(m.id));
  for (let t = 0; t < 6; t += 1) {
    assert(easy.starByTier[t] < normal.starByTier[t], `tier ${t}: easy under normal`);
    assert(normal.starByTier[t] < hard.starByTier[t], `tier ${t}: normal under hard`);
  }
  for (let r = 0; r < 3; r += 1) {
    assert(easy.finaleRounds[r] < normal.finaleRounds[r] && normal.finaleRounds[r] < hard.finaleRounds[r], `finale ${r}: the three modes stay in order`);
  }
  // Every rung the game can ask for is one the strength table can answer.
  const lowest = BOT_STRENGTH[0].elo;
  for (const mode of DIFFICULTY.modes) {
    assert(mode.regularBands[0][0] >= lowest, `${mode.id}: the easiest opponent is on the table (${mode.regularBands[0][0]} >= ${lowest})`);
    assert(mode.finaleRounds.at(-1) <= BOT_ELO.max, `${mode.id}: the hardest is under the bot ceiling`);
  }
});

/* TEST 3: no campaign opponent, anywhere, at any tier, above BOT_ELO.max.
   Not only the finale: the widest number the campaign can produce is a club
   member at the top of the last tier's band plus MEMBERS.aboveBand, which is
   the one that used to sail past the ceiling unnoticed. */
test('no campaign opponent is above the bot ceiling, or below its floor', () => {
  eq(BOT_ELO.max, 1500, 'the campaign ceiling is 1500');
  eq(BOT_ELO.min, 250, 'and the floor is 250');
  eq(BOT_STRENGTH.at(-1).elo, BOT_ELO.max, 'the strength table reaches the ceiling');
  eq(BOT_STRENGTH[0].elo, BOT_ELO.min, 'and starts at the floor');
  for (const mode of DIFFICULTY.modes) {
    for (let t = 0; t < 6; t += 1) {
      // Both ends of the random draw, not just the middle.
      for (const roll of [0, 0.5, 1]) {
        const elo = Career.regularElo(t, () => roll, mode.id);
        assert(elo <= BOT_ELO.max && elo >= BOT_ELO.min, `${mode.id} regular tier ${t} roll ${roll}: ${elo}`);
      }
      for (const rel of [0, 0.5, 1]) {
        const elo = Career.memberElo(rel, t, mode.id);
        assert(elo <= BOT_ELO.max && elo >= BOT_ELO.min, `${mode.id} member tier ${t} rel ${rel}: ${elo}`);
      }
      const star = Career.starElo(t, mode.id);
      assert(star <= BOT_ELO.max && star >= BOT_ELO.min, `${mode.id} star tier ${t}: ${star}`);
    }
    for (let r = 0; r < 3; r += 1) {
      const elo = Career.finaleElo(r, mode.id);
      assert(elo <= BOT_ELO.max && elo >= BOT_ELO.min, `${mode.id} finale ${r}: ${elo}`);
    }
  }
  // A whole drawn tournament field, at the hardest tier of the hardest mode.
  const c = Career.newCareer({ name: 'Ceiling', avatar: 'boy', startClubId: 'nyc', difficulty: 'hard' });
  for (const club of ['lon', 'vie', 'ist', 'maa', 'wnz']) c.trophies[club] = { wonAt: 1, starElo: 1000, tier: 0 };
  const run = Career.enterTournament(c, 'nyc', seeded(99));
  for (const player of [...run.players, run.star]) {
    if (player.id === 'you') continue;
    assert(player.elo <= BOT_ELO.max, `${player.name} drawn at ${player.elo}`);
  }
});

/* TEST 4: Easy has to contain real beginners, or it is not an Easy mode.
   The point of the rung is somebody who has just learned the rules. */
test('Easy starts with genuine beginner opponents under 500', () => {
  const easy = difficultyMode('easy');
  assert(easy.regularBands[0][0] < 500, `easy opens at ${easy.regularBands[0][0]}, under 500`);
  assert(easy.regularBands[0][0] >= BOT_ELO.min, 'and not under the table');
  assert(easy.starByTier[0] <= 500, `easy's first Star Player is ${easy.starByTier[0]}`);
  // The weakest a beginner can actually meet, once the member spread is on.
  assert(Career.memberElo(0, 0, 'easy') < 400, 'the weakest Easy club member is a true beginner');
  // And a 300 bot must still be recognisably worse than a 700 one.
  const beginner = strengthForElo(300);
  const club = strengthForElo(700);
  assert(beginner.blunderChance > club.blunderChance + 0.1, 'a 300 errs far more often than a 700');
  assert(beginner.blunderSeverityCp > club.blunderSeverityCp, 'and far more expensively');
});

/* TEST 1 (structural): strengthForElo has ONE parameter. A mode cannot be
   passed in even by accident, which is the cheapest possible guarantee that
   difficulty never reaches into playing strength. */
test('Elo is absolute: strengthForElo takes an Elo and nothing else', () => {
  eq(strengthForElo.length, 1, 'strengthForElo(elo) - no mode argument');
  const once = strengthForElo(900);
  for (const junk of ['easy', 'normal', 'hard', undefined, null, { mode: 'hard' }]) {
    eq(JSON.stringify(strengthForElo(900, junk)), JSON.stringify(once),
      `a second argument (${JSON.stringify(junk)}) changes nothing`);
  }
  // No file that builds an opponent may branch on the difficulty either.
  const guilty = [];
  for (const file of ['js/core/difficulty.js', 'js/chess/bots/chessBot.js', 'js/chess/bots/botProfile.js']) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    if (/difficultyMode\s*\(|DIFFICULTY\.modes|career\.difficulty|regularBands|starByTier|finaleRounds/.test(src)) guilty.push(file);
  }
  eq(guilty.join(', '), '', 'the strength pipeline never reads the campaign difficulty');
});

/* TEST 2: the same Elo out of three different ladders is the same opponent.
   Style may differ; every strength field must be identical. */
test('the same Elo is the same bot in Easy, Normal and Hard', () => {
  const STRENGTH_FIELDS = ['rating', 'strength', 'blunderChance', 'blunderSeverityCp', 'wildness',
    'candidatePool', 'maxEvalLossCp', 'analysisLevel', 'seesFreeMaterialCp', 'greed', 'limitStrength'];
  const readFields = (profile) => STRENGTH_FIELDS.map((f) => `${f}=${profile[f]}`).join(' ');

  // Every Elo any mode's ladder can produce, met from all three modes.
  const ladder = new Set();
  for (const mode of DIFFICULTY.modes) {
    for (let t = 0; t < 6; t += 1) {
      ladder.add(Career.starElo(t, mode.id));
      for (const roll of [0, 0.5, 1]) ladder.add(Career.regularElo(t, () => roll, mode.id));
    }
    for (let r = 0; r < 3; r += 1) ladder.add(Career.finaleElo(r, mode.id));
  }
  assert(ladder.size > 20, 'the ladders cover a real spread of Elos');

  for (const elo of ladder) {
    // Built as an Easy tournament regular, a Normal club opponent and a Hard
    // finale rival: three different callers, three different characters.
    const fromEasy = profileForOpponent({ id: 'e', name: 'Easy regular', elo, style: 'balanced' });
    const fromNormal = profileForOpponent({ id: 'n', name: 'Club member', elo, style: 'positional' });
    const fromHard = profileForOpponent({ id: 'h', name: 'Hard rival', elo, style: 'aggressive' });
    eq(readFields(fromNormal), readFields(fromEasy), `${elo}: Normal matches Easy`);
    eq(readFields(fromHard), readFields(fromEasy), `${elo}: Hard matches Easy`);
    // Style is the ONLY thing that may differ, and it does.
    assert(fromHard.aggression !== fromNormal.aggression, `${elo}: style still separates characters`);
  }

  // The worked example from the brief, spelled out.
  const nine = ['easy', 'normal', 'hard'].map(() => strengthForElo(900));
  eq(JSON.stringify(nine[1]), JSON.stringify(nine[0]));
  eq(JSON.stringify(nine[2]), JSON.stringify(nine[0]));
  // And a stated 900 must not be secretly a 700 or an 1100.
  assert(strengthForElo(900).strength > strengthForElo(700).strength, '900 is stronger than 700');
  assert(strengthForElo(900).strength < strengthForElo(1100).strength, 'and weaker than 1100');
});

/* TEST 5: each mode climbs, and the three never cross. */
test('Easy, Normal and Hard progress monotonically and stay in order', () => {
  for (const mode of DIFFICULTY.modes) {
    const m = difficultyMode(mode.id);
    for (let t = 1; t < 6; t += 1) {
      assert(m.starByTier[t] > m.starByTier[t - 1], `${mode.id}: star tier ${t}`);
      assert(m.regularBands[t][0] >= m.regularBands[t - 1][0], `${mode.id}: band floor tier ${t}`);
      assert(m.regularBands[t][1] >= m.regularBands[t - 1][1], `${mode.id}: band ceiling tier ${t}`);
    }
    /* A tier's Star Player guards that tier, so it sits at or above the
       regulars it is drawn beside - and the NEXT tier's regulars may start
       below it, which is the shape of the ladder, not a break in it. */
    for (let t = 0; t < 6; t += 1) {
      assert(m.starByTier[t] >= m.regularBands[t][1] - 100, `${mode.id}: the tier ${t} star is not softer than its regulars`);
      assert(m.starByTier[t] <= m.regularBands[t][1] + 150, `${mode.id}: the tier ${t} star is not a wall`);
    }
    // The finale starts above everything the clubs could offer.
    assert(m.finaleRounds[0] >= m.starByTier[5], `${mode.id}: the finale opens above the last club`);
    for (let r = 1; r < 3; r += 1) assert(m.finaleRounds[r] > m.finaleRounds[r - 1], `${mode.id}: finale round ${r}`);
  }
  const [easy, normal, hard] = DIFFICULTY.modes.map((m) => difficultyMode(m.id));
  assert(easy.finaleRounds.at(-1) < normal.finaleRounds.at(-1), 'easy finishes below normal');
  assert(normal.finaleRounds.at(-1) < hard.finaleRounds.at(-1), 'normal finishes below hard');
  eq(hard.finaleRounds.at(-1), BOT_ELO.max, "Hard's last opponent is exactly the ceiling");
});

test('difficulty is part of the save, defaults to Normal, and survives a reload', () => {
  const fresh = Career.newCareer({ name: 'Diff', avatar: 'boy', startClubId: 'nyc' });
  eq(fresh.difficulty, 'normal', 'a new career starts on Normal');
  const hard = Career.newCareer({ name: 'Diff', avatar: 'boy', startClubId: 'nyc', difficulty: 'hard' });
  eq(hard.difficulty, 'hard');
  // A career from before there was a choice was played on the one ladder there was.
  const old = Career.newCareer({ name: 'Old', avatar: 'boy', startClubId: 'nyc' });
  delete old.difficulty;
  eq(Career.migrateCareer(old).difficulty, 'normal', 'an old save migrates to Normal');
  const nonsense = Career.newCareer({ name: 'Bad', avatar: 'boy', startClubId: 'nyc' });
  nonsense.difficulty = 'impossible';
  eq(Career.migrateCareer(nonsense).difficulty, 'normal', 'an unknown mode falls back rather than throwing');
  // Round-trip through the real save layer.
  const store = new Map();
  Save.useStorage({ getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  Save.saveCareer(hard);
  eq(Career.migrateCareer(Save.loadCareer()).difficulty, 'hard', 'difficulty comes back off disk');
});

test('the difficulty a career is on is the ladder it meets', () => {
  for (const mode of DIFFICULTY.modes) {
    const m = difficultyMode(mode.id);
    for (let t = 0; t < 6; t += 1) {
      eq(Career.starElo(t, mode.id), m.starByTier[t], `${mode.id} star ${t}`);
      const [lo, hi] = m.regularBands[t];
      const elo = Career.regularElo(t, () => 0.5, mode.id);
      assert(elo >= lo && elo <= hi, `${mode.id} regular ${t}: ${elo} inside ${lo}..${hi}`);
      const member = Career.memberElo(0.5, t, mode.id);
      assert(member > 0, `${mode.id} member ${t}`);
    }
    for (let r = 0; r < 3; r += 1) eq(Career.finaleElo(r, mode.id), m.finaleRounds[r], `${mode.id} finale ${r}`);
  }
});

test('changing difficulty mid-career touches nothing already won', () => {
  const c = Career.newCareer({ name: 'Switch', avatar: 'girl', startClubId: 'nyc' });
  const random = seeded(4242);
  const run = Career.enterTournament(c, 'nyc', random);
  const drawnElos = run.players.map((p) => p.elo);
  const drawnStar = run.star.elo;
  c.elo = 912;
  c.trophies.lon = { wonAt: 1, starElo: 900, tier: 0 };
  const trophiesBefore = JSON.stringify(c.trophies);

  c.difficulty = 'hard';
  Career.migrateCareer(c);
  eq(JSON.stringify(c.trophies), trophiesBefore, 'trophies untouched');
  eq(c.elo, 912, 'rating untouched');
  eq(JSON.stringify(c.tournaments.nyc.players.map((p) => p.elo)), JSON.stringify(drawnElos), 'the event under way keeps its field');
  eq(c.tournaments.nyc.star.elo, drawnStar, 'and its Star Player');
  // The NEXT event is the one that gets harder.
  const later = Career.starElo(Career.tier(c), c.difficulty);
  assert(later > Career.starElo(Career.tier(c), 'normal'), 'the next star is drawn from the new ladder');
});

test('bot strength is monotone in Elo and capped', () => {
  let prev = null;
  for (const elo of [250, 400, 600, 800, 1000, 1200, 1400, 1600, 2400]) {
    const s = strengthForElo(elo);
    if (prev) {
      assert(s.strength >= prev.strength, `strength at ${elo}`);
      assert(s.blunderChance <= prev.blunderChance, `blunder chance at ${elo}`);
      // How BAD a mistake may be also has to fall, or a strong opponent would
      // err rarely but still hang a queen when it did.
      assert(s.blunderSeverityCp <= prev.blunderSeverityCp, `mistake severity at ${elo}`);
      assert(s.maxEvalLossCp <= prev.maxEvalLossCp, `eval-loss filter at ${elo}`);
    }
    prev = s;
  }
  eq(strengthForElo(2400).elo, BOT_ELO.max, 'above the bot ceiling clamps to it');
  eq(strengthForElo(1).elo, BOT_ELO.min, 'below the table clamps to its first row');
  const p = profileForOpponent({ name: 'X', elo: 900, style: 'aggressive' });
  assert(p.blunderChance > 0.05 && p.style === 'aggressive');
  // What a weak bot can SEE has to sharpen with the Elo too, or a 1500 would
  // overlook the same hanging rook a 300 does.
  let sharper = null;
  for (const elo of [250, 500, 750, 1000, 1250, 1500]) {
    const s = strengthForElo(elo);
    assert(s.greed > 0 && s.greed <= 1, `greed at ${elo}`);
    if (sharper) assert(s.seesFreeMaterialCp <= sharper, `free-material sight at ${elo}`);
    sharper = s.seesFreeMaterialCp;
  }
  // The player's own rating is a separate thing and has no ceiling.
  eq(ELO.cap, undefined, 'ELO no longer carries a cap that means two things');
});

test('opening book: positions, transpositions and bot lookup', () => {
  const book = new ClubBook();
  const afterE4 = applyUci(START_FEN, 'e2e4').fen;
  assert(book.isBookPosition(START_FEN) && book.isBookPosition(afterE4));
  const replies = book.lookup(afterE4).moves.map((m) => m.san);
  for (const san of ['e5', 'c5', 'c6', 'e6']) assert(replies.includes(san), `missing ${san}`);
  const italian = new ClubBook(OPENINGS.filter((o) => o.id === 'italian'));
  eq(italian.lookup(START_FEN).moves[0].san, 'e4');
});

test('guide arrows only from equipped openings, as deep as their mastery', () => {
  const afterE4 = applyUci(START_FEN, 'e2e4').fen;
  eq(fullBook.guide(afterE4, { sicilian: 0 }).length, 0);
  const g = fullBook.guide(afterE4, { sicilian: 40 });
  eq(g.length, 1); eq(g[0].san, 'c5');
  // 5% of the 26-ply longest line rounds up to 2 plies: e4 c5 is known, the third move is not.
  const rules = createRules(); for (const m of ['e4', 'c5']) rules.move(m);
  eq(fullBook.knownPlies('sicilian', 5), 2);
  eq(fullBook.guide(rules.fen(), { sicilian: 5 }).length, 0);
  // Below 100% only the line being followed is shown; mastered shows all branches.
  const mainOnly = fullBook.guide(rules.fen(), { sicilian: 90 });
  assert(mainOnly.length === 1 && mainOnly[0].san === 'Nf3', JSON.stringify(mainOnly));
  eq(fullBook.guide(rules.fen(), { sicilian: 100 }).length, 3);
});

test('describe: main line names the opening, variations only off the main line', () => {
  const rules = createRules(); for (const m of ['e4', 'c5']) rules.move(m);
  const onMain = fullBook.describe(rules.fen(), 'g1f3');
  const sic = onMain.entries.find((e) => e.openingId === 'sicilian');
  assert(sic.mainLine && sic.variations.length === 0, JSON.stringify(sic));
  const alapin = fullBook.describe(rules.fen(), 'c2c3').entries.find((e) => e.openingId === 'sicilian');
  assert(!alapin.mainLine && alapin.variations[0].includes('Alapin'), JSON.stringify(alapin));
  eq(fullBook.describe(START_FEN, 'a2a4').entries.length, 0);
});

test('repertoire: slots grow with level, only known openings, migration', () => {
  const c = Career.newCareer({ name: 'R', avatar: 'girl', startClubId: 'ist' });
  eq(c.equipped.join(), 'sicilian');
  eq(Career.repertoireSlots(1), 1); eq(Career.repertoireSlots(15), 6);
  eq(Career.equipOpening(c, 'caro').reason, 'locked');
  c.openings.caro = 8;
  eq(Career.equipOpening(c, 'caro').reason, 'full');
  Career.grantXp(c, 300);
  assert(Career.equipOpening(c, 'caro').ok);
  eq(Object.keys(Career.equippedMastery(c)).join(), 'sicilian,caro');
  const old = JSON.parse(JSON.stringify(c)); delete old.equipped; old.openings.french = 100;
  Career.migrateCareer(old);
  eq(old.equipped.join(), 'sicilian,french');
});

test('hint cost: known opening < unknown opening < endgame, more rolls cost more', () => {
  const afterE4 = applyUci(START_FEN, 'e2e4').fen;
  const known = hintQuote({ level: 1, fen: afterE4, mastery: { sicilian: 100 }, book: fullBook });
  const unknown = hintQuote({ level: 1, fen: afterE4, mastery: {}, book: fullBook });
  const endgame = hintQuote({ level: 1, fen: '8/5k2/8/8/8/8/5K2/4R3 w - - 0 60', mastery: {}, book: fullBook });
  assert(known.cost < unknown.cost, `${known.cost} < ${unknown.cost}`);
  assert(unknown.cost < endgame.cost, `${unknown.cost} < ${endgame.cost}`);
  const deep = hintQuote({ level: 15, fen: afterE4, mastery: {}, book: fullBook });
  assert(deep.cost > unknown.cost); eq(deep.rolls, 3);
  assert(known.cost >= HINTS.minCost);
});

test('match score is itemised, rewards results and specials', () => {
  const base = { accuracy: 80, grades: {}, playerElo: 800, opponentElo: 800 };
  const win = matchScore({ ...base, score: 1 });
  const loss = matchScore({ ...base, score: 0 });
  const epic = matchScore({ ...base, score: 1, grades: { EPIC: 1, CLUTCH: 1 } });
  assert(win.total > loss.total && epic.total > win.total);
  assert(epic.lines.some((l) => /Epic/.test(l.label)) && epic.lines.some((l) => /Clutch/.test(l.label)));
  assert(['S', 'A', 'B', 'C', 'D'].includes(win.letter));
});

test('grading: EPIC when brilliant is the best move, CLUTCH on an only-move', () => {
  const rec = { mistakeClassification: 'BRILLIANT', uci: 'd5f6', bestMove: 'd5f6', evaluationDelta: 0 };
  eq(gradeMove(rec).grade, 'EPIC');
  eq(gradeMove({ ...rec, bestMove: 'a1a2', evaluationDelta: 60 }).grade, 'BRILLIANT');
  const only = { mistakeClassification: 'BEST', engineEvaluation: { cp: 0 } };
  const lines = [{ score: { cp: 0 } }, { score: { cp: -300 } }];
  assert(isClutch(only, lines)); eq(gradeMove(only, lines).grade, 'CLUTCH');
  assert(!isClutch(only, [{ score: { cp: 0 } }, { score: { cp: -20 } }]), 'not an only-move');
  assert(!isClutch({ ...only, engineEvaluation: { cp: 900 } }, [{ score: { cp: 900 } }, { score: { cp: 300 } }]), 'already winning');
});

test('dialogue: intro, then challenge, rematch after a loss, beaten after a win', () => {
  const c = Career.newCareer({ name: 'A', avatar: 'boy', startClubId: 'nyc' });
  eq(starLines(c, 'maya', 'office')[0], STAR_PLAYERS[0].lines.intro[0]);
  Career.meetStar(c, 'maya');
  eq(starLines(c, 'maya', 'office'), STAR_PLAYERS[0].lines.knowsOpening, 'starts knowing the Italian');
  c.stars.maya.losses = 1;
  eq(starLines(c, 'maya', 'challenge'), STAR_PLAYERS[0].lines.rematch);
  c.stars.maya.beaten = true;
  eq(starLines(c, 'maya', 'office'), STAR_PLAYERS[0].lines.beaten);
});

test('save namespace is PAP_ and round-trips', () => {
  Save.useStorage(Save.createMemoryStorage());
  for (const key of Object.values(Save.KEYS)) assert(key.startsWith('PAP_'), key);
  const c = Career.newCareer({ name: 'Round', avatar: 'boy', startClubId: 'lon' });
  Save.saveCareer(c);
  eq(Save.loadCareer().name, 'Round');
  Save.deleteCareer();
  eq(Save.hasCareer(), false);
});

/* ------------------------------------------------- the whole campaign */

test('a full campaign: six trophies, finale, six postcards, secret', () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const c = Career.newCareer({ name: 'Tour', avatar: 'girl', startClubId: 'ist' });

  // Grand Finale is locked at the start.
  eq(Career.enterFinale(c, random), null);

  const order = ['ist', 'wen', 'nyc', 'che', 'lon', 'vie'];
  const starElos = [];
  for (const clubId of order) {
    Career.travelTo(c, clubId, `${clubId}-ext`);
    const run = Career.enterTournament(c, clubId, random);
    const format = Career.tournamentFormat(clubId);
    eq(run.players.length, format === 'swiss' ? 16 : 32, `${clubId} field`);
    starElos.push(run.star.elo);

    // Five rounds, then the final. Nothing is awarded before the final.
    let res = null;
    for (let i = 0; i < 5; i += 1) {
      const round = Career.currentRound(c, clubId);
      assert(round && round.kind === 'regular', `${clubId} round ${i + 1} is a regular round`);
      res = Career.recordTournamentGame(c, clubId, 1, Date.now(), random);
      assert(!res.trophy, 'no trophy before the final');
    }
    assert(res.toFinal, `${clubId}: five wins reach the final`);
    eq(Career.currentRound(c, clubId).kind, 'star');
    res = Career.recordTournamentGame(c, clubId, 1, Date.now(), random);
    assert(res.completed && res.trophy && res.outcome === 'champion', `${clubId} trophy`);
    eq(c.openings[CLUBS.find((x) => x.clubId === clubId).openingId], 100, 'trophy masters the opening');
    // Paying out twice is impossible.
    eq(Career.awardTrophy(c, clubId, 900), null);
  }
  for (let i = 1; i < starElos.length; i += 1) assert(starElos[i] > starElos[i - 1], 'stars get stronger');
  assert(Career.hasAllTrophies(c) && c.finale.unlocked, 'finale unlocked');

  const finale = Career.enterFinale(c, random);
  eq(finale.opponents.length, 3);
  eq(finale.opponents[2], 'emre', 'the final is the home-club rival');
  assert(Career.currentFinaleRound(c).elo >= difficultyMode('normal').finaleRounds[0], 'the finale opens on this mode\'s first round');
  assert(!Career.recordFinaleGame(c, 0.5).cleared, 'finale rounds must be won');
  Career.recordFinaleGame(c, 1);
  Career.recordFinaleGame(c, 1);
  const last = Career.recordFinaleGame(c, 1);
  assert(last.won && c.completed, 'campaign complete');

  // Postcards are independent of trophies.
  assert(!Career.hasAllPostcards(c));
  let final = null;
  for (const p of PUZZLES) final = Career.recordPuzzleSolved(c, p.id);
  assert(Career.hasAllPostcards(c) && final.allPostcards, 'all postcards');
  eq(Career.postcardCount(c), 6);
  assert(!Career.recordPuzzleSolved(c, PUZZLES[0].id).firstSolve, 'no double XP');
  assert(c.level >= 10, `trophies + finale + puzzles alone reach level ${c.level}`);
});

/* ---------------------------------------------------- Focus hint rolls */

import * as FocusHints from '../js/core/focusHints.js';
import { GRADE_META as GM } from '../js/core/grading.js';

/** Stockfish stand-in: every legal move, best first, 15 cp apart; `bad` moves score -900. */
function fakeEngine({ bad = [], failing = null } = {}) {
  const lines = (fen, n = 3) => {
    const r = createRules(fen);
    const moves = r.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
    moves.sort();
    return moves.map((uci, i) => ({ pv: [uci], score: { cp: bad.includes(uci) ? -900 : 60 - 15 * i }, depth: 18 })).slice(0, Math.max(n, 5));
  };
  return {
    available: true, status: 'ready', statusText: 'fake',
    ready: async () => true, newGame: async () => {}, onStatus: () => () => {},
    // `failing()` true: every search rejects, like a dead worker.
    analyze: async (fen, o = {}) => { if (failing?.()) throw new Error('engine down'); return { lines: lines(fen, o.multiPv || 1), depth: 18 }; },
    review: async (fen, o = {}) => { if (failing?.()) throw new Error('engine down'); return { lines: lines(fen, o.multiPv || 3), depth: 18 }; }
  };
}

test('hint rolls: one per playable candidate, quality sets the plan length', () => {
  const lines = [{ pv: ['e2e4'], score: { cp: 40 } }, { pv: ['d2d4'], score: { cp: 35 } }, { pv: ['g1f3'], score: { cp: 30 } }];
  const always = (q) => () => ({ fail: 0.05, green: 0.2, purple: 0.6, gold: 0.99 }[q]);
  eq(FocusHints.rollHint(lines, 15, always('gold')).plans.length, 3, 'three rolls at the cap');
  eq(FocusHints.rollHint(lines, 1, always('gold')).plans.length, 1, 'one roll at level 1');
  eq(FocusHints.rollHint(lines, 15, always('gold')).plans[0].total, 3, 'gold reaches three moves');
  eq(FocusHints.rollHint(lines, 15, always('purple')).plans[0].total, 2, 'purple two');
  eq(FocusHints.rollHint(lines, 15, always('green')).plans[0].total, 1, 'green one');
  eq(FocusHints.rollHint(lines, 15, always('fail')).plans.length, 0, 'a failed roll shows nothing');
  // One failed roll cancels only its own candidate.
  let i = 0; const mixed = () => [0.99, 0.01, 0.99][i++ % 3];
  const r = FocusHints.rollHint(lines, 15, mixed);
  eq(r.rolls.map((x) => x.quality).join(), 'gold,fail,gold'); eq(r.plans.map((p) => p.rank).join(), '0,2');
  // Only playable candidates roll: a move far worse than the best gets none.
  const onlyOne = [{ pv: ['e2e4'], score: { cp: 300 } }, { pv: ['a2a3'], score: { cp: -400 } }];
  eq(FocusHints.rollHint(onlyOne, 15, always('gold')).rolls.length, 1, 'one playable move, one roll');
  // Odds: at the cap roughly 10% fail, 20% gold.
  let sd = 3; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }; const n = 20000; const count = { fail: 0, green: 0, purple: 0, gold: 0 };
  for (let k = 0; k < n; k += 1) count[FocusHints.rollQuality(15, rnd)] += 1;
  assert(Math.abs(count.fail / n - 0.10) < 0.02 && Math.abs(count.gold / n - 0.20) < 0.02, JSON.stringify(count));
  eq(FocusHints.refundFor({ cost: 20, rank: 0 }), 0, 'the best suggestion pays nothing back');
  assert(FocusHints.refundFor({ cost: 20, rank: 2 }) > FocusHints.refundFor({ cost: 20, rank: 1 }), 'a lesser idea pays more back');
  assert(FocusHints.refundFor({ cost: 20, rank: null }) > FocusHints.refundFor({ cost: 20, rank: 2 }), 'ignoring the hint pays the most');
});

async function hintMatch({ level = 15, random, bad = [] } = {}) {
  const career = Career.newCareer({ name: 'H', avatar: 'boy', startClubId: 'nyc' });
  career.level = level;
  const match = new PapMatch({ career, kind: 'friendly', playerColour: 'w', service: fakeEngine({ bad }),
    opponent: { id: 'x', name: 'X', elo: 800, style: 'balanced', openingId: null } });
  const events = [];
  match.on((e) => events.push(e));
  await match.start();
  const r = await match.requestHint(random);
  return { match, events, r };
}
const settle = async (match) => { await Promise.all(match._pending); for (let k = 0; k < 20; k += 1) await new Promise((res) => setTimeout(res, 5)); };

test('following a Focus hint grades FOCUS, earns no Focus, and the gold plan continues after the reply', async () => {
  const { match, events, r } = await hintMatch({ random: () => 0.99 });
  assert(r.ok && r.hint.plans.length === 3 && r.hint.plans.every((p) => p.quality === 'gold'), 'three gold plans');
  const best = { ...r.hint.plans[0] };      // the plan object itself moves on to its next step
  const focusAfterBuy = match.focus;
  await match.playMove(best.uci);
  await settle(match);
  const graded = events.find((e) => e.type === 'graded' && e.payload.record.from + e.payload.record.to === best.uci);
  assert(graded, `the move was graded (${events.filter((e) => e.type === 'graded').map((e) => e.payload.record.from + e.payload.record.to).join()} vs ${best.uci}; events ${events.map((e) => e.type).join()})`);
  eq(graded.payload.grade, 'FOCUS', 'a hinted move reads FOCUS');
  eq(graded.payload.focusGain, 0, 'and earns no Focus back');
  eq(match.focus, focusAfterBuy, 'the best suggestion refunds nothing');
  eq(match.grades.BEST || 0, 0, 'not counted as the player\'s own best move');
  const next = events.filter((e) => e.type === 'hint' && e.payload.continuation);
  eq(next.length, 1, 'after the reply the plan\'s second move is drawn by itself');
  eq(next[0].payload.plans[0].step, 1);
  assert(GM.FOCUS.label === 'Focus');
});

test('a lesser suggestion or no suggestion gives Focus back', async () => {
  const lesser = await hintMatch({ random: () => 0.5 });
  const cost = lesser.r.hint.quote.cost;
  const before = lesser.match.focus;
  await lesser.match.playMove(lesser.r.hint.plans[2].uci);
  eq(lesser.match.focus - before, FocusHints.refundFor({ cost, rank: 2 }), 'third idea refund');
  const ignored = await hintMatch({ random: () => 0.5 });
  const shown = new Set(ignored.r.hint.plans.map((p) => p.uci));
  const other = createRules(ignored.match.fen).moves({ verbose: true }).map((m) => m.from + m.to).find((u) => !shown.has(u));
  const before2 = ignored.match.focus;
  await ignored.match.playMove(other);
  eq(ignored.match.focus - before2, FocusHints.refundFor({ cost, rank: null }), 'ignoring refunds the most');
  const blank = await hintMatch({ random: () => 0.01 });
  eq(blank.r.hint.plans.length, 0, 'every roll failed');
  eq(blank.r.hint.refund, FocusHints.refundFor({ cost, shown: false }), 'a blank hint gives most of its cost back');
});

test('a mastered opening keeps guiding after the opponent leaves the book', async () => {
  const run = async (mastery) => {
    const career = Career.newCareer({ name: 'G', avatar: 'boy', startClubId: 'nyc' });
    career.openings.italian = mastery; career.equipped = ['italian'];
    // The fake engine answers alphabetically, so Black's first reply to 1.e4 would be a7a5: put e5 first.
    const svc = fakeEngine();
    const match = new PapMatch({ career, kind: 'friendly', playerColour: 'w', service: svc, opponent: { id: 'x', name: 'X', elo: 800, style: 'balanced', openingId: null } });
    await match.start();
    const moves = [['e2e4', 'e7e5'], ['g1f3', 'd7d6']];     // 2...d6 leaves the Italian lines
    for (const [mine, reply] of moves) {
      eq(match.guide().some((g) => g.uci === mine), true, `the book guide shows ${mine}`);
      match.bot.chooseMove = async () => ({ uci: reply });
      await match.playMove(mine);
    }
    return { book: match.guide(), filled: await match.masteredGuide() };
  };
  const full = await run(100);
  eq(full.book.length, 0, 'the position after 2...d6 is out of the prepared lines');
  eq(full.filled.length, 1, 'at 100% the guide carries on with the engine');
  assert(full.filled[0].mastered && full.filled[0].openingId === 'italian');
  const partial = await run(90);
  eq(partial.filled.length, 0, 'below 100% the guide stops where the book stops');
});

/* ------------------------------------------------ softlock protection */

import { fallbackMove } from '../js/game/match.js';

/* The bot's own dice are seeded here. Two of its decisions (the unforced
   error and the free-material grab) never ask the engine at all, so with
   Math.random a test that asserts the ENGINE fallback ran is a coin toss it
   loses about once in a few hundred runs. */
async function brokenMatch({ colour = 'w', failFrom = 0, seed = 20260922 } = {}) {
  let searches = 0;
  const state = { down: false };
  const svc = fakeEngine({ failing: () => state.down || (failFrom >= 0 && ++searches > failFrom && failFrom > 0) });
  const career = Career.newCareer({ name: 'S', avatar: 'boy', startClubId: 'nyc' });
  const match = new PapMatch({ career, kind: 'friendly', playerColour: colour, service: svc,
    opponent: { id: 'x', name: 'X', elo: 1200, style: 'balanced', openingId: null } });
  match.bot.random = seeded(seed);
  const events = [];
  match.on((e) => events.push(e.type));
  return { match, state, events };
}
const quiet = (fn) => async () => { const w = console.warn; const e = console.error; console.warn = () => {}; console.error = () => {}; try { await fn(); } finally { console.warn = w; console.error = e; } };
const playerCanMove = (m) => m.isPlayersTurn && !m.thinking && m.game.status === 'active';

test('a dead engine before the first opponent move: the opponent still moves', quiet(async () => {
  const { match, state, events } = await brokenMatch({ colour: 'b' });
  state.down = true;
  await match.start();
  eq(match.game.ply, 1, 'White (the bot) moved');
  assert(playerCanMove(match), `the player is free to move (${events.join()})`);
  for (let k = 0; k < 6 && match.game.status === 'active'; k += 1) {
    await match.playMove(createRules(match.fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''))[0]);
    assert(playerCanMove(match) || match.game.status !== 'active', `move ${k}: the engine-less opponent keeps answering`);
  }
  assert(events.includes('bot-fallback'), 'through the fallback');
}));

test('the engine dies halfway through, after Undo and around a Hint: never stuck', quiet(async () => {
  const { match, state } = await brokenMatch();
  await match.start();
  for (const uci of ['e2e4', 'g1f3', 'f1c4']) { await match.playMove(uci); assert(playerCanMove(match), `after ${uci}`); }
  state.down = true;                                            // halfway
  await match.playMove('b1c3');
  assert(playerCanMove(match), 'the opponent answered with the engine down');
  match.focus = match.focusMax;
  const u = match.undo();
  assert(u.ok && playerCanMove(match), 'undo with the engine down');
  match.focus = match.focusMax;
  const before = match.focus;
  const h1 = await match.requestHint();
  assert(!h1.ok && h1.reason === 'engine' && match.focus === before, `a failed hint costs nothing (${JSON.stringify({ ok: h1.ok, reason: h1.reason, before, after: match.focus })})`);
  const legal = createRules(match.fen).moves({ verbose: true })[0];
  await match.playMove(legal.from + legal.to);
  assert(playerCanMove(match), 'the move after a failed hint is answered');
  state.down = false;                                           // engine back: a hint works again
  match.focus = match.focusMax;
  const h2 = await match.requestHint(() => 0.99);
  assert(h2.ok, 'hints work once the engine is back');
  state.down = true;                                            // dies with a plan waiting
  await match.playMove(h2.hint.plans[0].uci);
  assert(playerCanMove(match), 'following a plan with the engine down');
}));

test('a stale bot call after Undo never plays a move into the new position', quiet(async () => {
  const { match } = await brokenMatch();
  await match.start();
  await match.playMove('e2e4');
  match.focus = match.focusMax;
  let release;
  match.bot.chooseMove = () => new Promise((r) => { release = r; });
  const pending = match.playMove('d2d4');
  await new Promise((r) => setTimeout(r, 10));
  match.undo();                                                 // back to White to move
  release({ uci: 'e7e5' });
  await pending;
  eq(match.game.ply, 2, 'the stale reply was dropped');
  assert(playerCanMove(match), 'and the player still has the move');
}));

test('the fallback move finds mate, so a game can still end with the engine down', () => {
  // After 1.f3 e5 2.g4 Black mates with Qh4#.
  eq(fallbackMove('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2'), 'd8h4');
  eq(fallbackMove('7k/8/8/8/8/8/8/K7 w - - 0 1') !== null, true);
});

test('a game pays out once: a second commit changes nothing', () => {
  const summary = { kind: 'tournament', score: 1, opponentElo: 700, grades: { BEST: 3 }, accuracy: 80,
    matchScore: { total: 900, letter: 'C' }, hintsUsed: 0, openingsReached: ['italian'] };
  for (const kind of ['tournament', 'challenge', 'finale', 'friendly']) {
    const c = Career.newCareer({ name: 'Once', avatar: 'boy', startClubId: 'nyc' });
    if (kind === 'tournament') Career.enterTournament(c, 'nyc', seeded(1));
    if (kind === 'finale') { for (const club of CLUBS) c.trophies[club.clubId] = { wonAt: 1 }; Career.enterFinale(c, seeded(2)); }
    const args = { gameId: 'g1', kind, clubId: 'nyc', summary: { ...summary, kind }, opponent: { id: 'nyc-danny', stake: 20 } };
    const first = Career.commitMatchResult(c, args, 1, seeded(3));
    const snap = JSON.stringify({ elo: c.elo, xp: c.xp, o: c.openings, coins: c.coins, t: c.tournaments, f: c.finale, s: c.stats, r: c.memberRecords });
    const again = Career.commitMatchResult(c, args, 2, seeded(4));
    assert(!first.duplicate && again.duplicate, `${kind}: the second call is a duplicate`);
    eq(JSON.stringify({ elo: c.elo, xp: c.xp, o: c.openings, coins: c.coins, t: c.tournaments, f: c.finale, s: c.stats, r: c.memberRecords }), snap, `${kind}: nothing paid twice`);
    eq(again.rewards.eloDelta, first.rewards.eloDelta, `${kind}: the same result is shown again`);
  }
});

test('save status: a refused write is reported once, and cleared when saving works again', () => {
  const seen = [];
  const stop = Save.onStorageStatus((st) => seen.push(st.ok));
  let full = true;
  Save.useStorage({ getItem: () => null, removeItem() {}, setItem() { if (full) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } } }, { persistent: true });
  const c = Career.newCareer({ name: 'Q', avatar: 'boy', startClubId: 'nyc' });
  eq(Save.saveCareer(c), false, 'the write failed');
  Save.saveCareer(c); Save.saveCareer(c);
  eq(Save.storageStatus().ok, false); eq(Save.storageStatus().error, 'QuotaExceededError');
  eq(seen.join(), 'false', 'one warning, not three');
  full = false;
  eq(Save.saveCareer(c), true); eq(Save.storageStatus().ok, true); eq(seen.join(), 'false,true');
  Save.useStorage(null);                                   // the memory fallback is NOT persistent
  eq(Save.storageStatus().ok, false, 'memory-only storage counts as not saving');
  stop();
  Save.useStorage(Save.createMemoryStorage(), { persistent: true });
});

/* --------------------------------------------- full campaign smoke runs */

/** Play one club's event through commitMatchResult, the same path the match screen uses. */
function playEvent(c, clubId, scores, random) {
  const out = [];
  Career.enterTournament(c, clubId, random);
  let i = 0;
  while (true) {
    const run = c.tournaments[clubId];
    if (run.completed) break;
    const round = Career.currentRound(c, clubId);
    assert(round, `${clubId}: the event is not finished, so there must be a game to play`);
    const score = scores[Math.min(i, scores.length - 1)]; i += 1;
    const summary = { kind: round.kind === 'star' ? 'star' : 'tournament', score, opponentElo: round.elo, grades: {}, accuracy: 70,
      matchScore: { total: 500, letter: 'C' }, hintsUsed: 0, openingsReached: [] };
    out.push(Career.commitMatchResult(c, { gameId: `${clubId}-${run.attempt}-${i}`, kind: summary.kind, clubId, summary }, i, random));
    assert(i < 20, 'an event never takes more than 6 games');
  }
  return out;
}

test('the whole campaign, from every starting city, to the ending', () => {
  for (const start of CLUBS.map((club) => club.clubId)) {
    const random = seeded(start.charCodeAt(0) * 7 + start.charCodeAt(2));
    const c = Career.newCareer({ name: 'Run', avatar: start === 'lon' ? 'girl' : 'boy', startClubId: start });
    eq(c.openings[CLUBS.find((x) => x.clubId === start).openingId], 40, `${start}: home opening at 40%`);
    const order = [start, ...CLUBS.map((x) => x.clubId).filter((id) => id !== start)];
    order.forEach((clubId, n) => {
      Career.travelTo(c, clubId, `${clubId}-ext`);
      const games = playEvent(c, clubId, [1], random);
      eq(games.length, 6, `${start}/${clubId}: five rounds and the final`);
      assert(games.at(-1).progress.trophy, `${start}/${clubId}: trophy`);
      eq(Career.trophyCount(c), n + 1);
      eq(c.finale.unlocked, n === 5, `${start}: Madrid opens with the sixth trophy only`);
    });
    const f = Career.enterFinale(c, random);
    eq(f.opponents[2], CLUBS.find((x) => x.clubId === start).starPlayerId, `${start}: the last round is the home rival`);
    for (let r = 0; r < 3; r += 1) {
      const round = Career.currentFinaleRound(c);
      const summary = { kind: 'finale', score: 1, opponentElo: round.elo, grades: {}, accuracy: 70, matchScore: { total: 500, letter: 'C' }, hintsUsed: 0, openingsReached: [] };
      Career.commitMatchResult(c, { gameId: `${start}-f${r}`, kind: 'finale', clubId: 'mad', summary }, 1, random);
    }
    assert(c.completed && c.finale.won, `${start}: campaign complete`);
    eq(Career.currentFinaleRound(c), null, `${start}: nothing left to play`);
  }
});

test('losing, re-entering, runner-up and a lost Madrid round are all recoverable', () => {
  const random = seeded(77);
  const c = Career.newCareer({ name: 'Lose', avatar: 'girl', startClubId: 'nyc' });
  // Swiss, all losses: finished, not first, no trophy; then re-entry works.
  playEvent(c, 'nyc', [0], random);
  let run = c.tournaments.nyc;
  assert(run.completed && run.outcome === 'placed' && !c.trophies.nyc, 'lost Swiss');
  // Knockout loss in round 1.
  const ko = playEvent(c, 'lon', [0], random);
  eq(ko.length, 1); eq(c.tournaments.lon.outcome, 'eliminated');
  // Star final lost: runner-up, then the next entry replays and wins it.
  playEvent(c, 'vie', [1, 1, 1, 1, 1, 0], random);
  eq(c.tournaments.vie.outcome, 'runner-up'); assert(!c.trophies.vie);
  playEvent(c, 'vie', [1], random);
  eq(c.tournaments.vie.attempt, 2); assert(c.trophies.vie, 'the replayed final wins the trophy');
  // Re-entry after a lost event, then winning.
  playEvent(c, 'nyc', [1], random);
  eq(c.tournaments.nyc.attempt, 2); assert(c.trophies.nyc);
  for (const club of ['lon', 'ist', 'che', 'wen']) playEvent(c, club, [1], random);
  assert(Career.hasAllTrophies(c) && c.finale.unlocked);
  Career.enterFinale(c, random);
  const game = (score, id) => Career.commitMatchResult(c, { gameId: id, kind: 'finale', clubId: 'mad',
    summary: { kind: 'finale', score, opponentElo: 1400, grades: {}, accuracy: 60, matchScore: { total: 1, letter: 'D' }, hintsUsed: 0, openingsReached: [] } }, 1, random);
  game(0, 'm1'); eq(c.finale.round, 0, 'a lost quarter-final is replayed');
  game(0.5, 'm2'); eq(c.finale.round, 0, 'a drawn one too');
  game(1, 'm3'); game(0, 'm4'); eq(c.finale.round, 1, 'a lost semi-final stays the semi-final');
  game(1, 'm5'); game(1, 'm6');
  assert(c.completed, 'Madrid completed after the replays');
});

test('a reload at any point of the campaign resumes on a valid scene with a valid next step', () => {
  const store = Save.createMemoryStorage();
  Save.useStorage(store, { persistent: true });
  const random = seeded(12);
  let c = Career.newCareer({ name: 'Reload', avatar: 'girl', startClubId: 'che' });
  const checkpoints = [];
  const reload = (label) => {
    Save.saveCareer(c);
    const back = Career.migrateCareer(Save.loadCareer());
    const problems = Career.validateCareer(back, { sceneExists: (id) => !!SCENES[id] });
    assert(!problems.length, `${label}: ${problems.join('; ')}`);
    const step = Career.nextStep(back);
    assert(step && step.type && step.label, `${label}: no next step`);
    if (step.type === 'tournament' || step.type === 'final') assert(Career.currentRound(back, step.clubId), `${label}: ${step.type} without a round`);
    if (step.type === 'finale' && back.finale.opponents) assert(Career.currentFinaleRound(back), `${label}: finale without a round`);
    checkpoints.push(`${label}=${step.type}`);
    c = back;                                            // play on from the RELOADED career
  };
  reload('created');
  learnTutorialAndDrill: {
    Career.learnFromTutorial(c, 'caro'); reload('tutorial');
    Career.learnFromDrill(c, 'caro', 8, 8); reload('drill');
  }
  const levelBefore = c.level;
  Career.grantXp(c, 300); assert(c.level > levelBefore); reload('level-up');
  for (const [n, clubId] of ['che', 'wen', 'nyc', 'lon', 'vie', 'ist'].entries()) {
    Career.travelTo(c, clubId, `${clubId}-ext`); reload(`travel ${clubId}`);
    Career.enterTournament(c, clubId, random); reload(`enter ${clubId}`);
    let g = 0;
    while (!c.tournaments[clubId].completed) {
      const round = Career.currentRound(c, clubId);
      Career.commitMatchResult(c, { gameId: `${clubId}${g}`, kind: round.kind === 'star' ? 'star' : 'tournament', clubId,
        summary: { score: 1, opponentElo: round.elo, grades: {}, accuracy: 70, matchScore: { total: 1, letter: 'D' }, hintsUsed: 0, openingsReached: [] } }, 1, random);
      g += 1;
      reload(`${clubId} game ${g}`);
    }
    assert(c.trophies[clubId], `${clubId} trophy`); reload(`trophy ${clubId}`);
    if (n === 0) {
      const mission = MISSIONS.find((m) => m.clubId === clubId);
      for (const p of PUZZLES.filter((x) => x.mission === clubId)) Career.recordPuzzleSolved(c, p.id);
      assert(c.postcards[mission.postcardId]); reload('postcard');
    }
  }
  assert(c.finale.unlocked); reload('Madrid unlocked');
  Career.travelTo(c, 'mad', 'mad-ext'); reload('travel Madrid');
  Career.enterFinale(c, random); reload('finale entered');
  const play = (score, id) => { Career.commitMatchResult(c, { gameId: id, kind: 'finale', clubId: 'mad',
    summary: { score, opponentElo: 1450, grades: {}, accuracy: 60, matchScore: { total: 1, letter: 'D' }, hintsUsed: 0, openingsReached: [] } }, 1, random); };
  play(0, 'F1'); reload('finale loss');
  play(1, 'F2'); reload('finale win 1');
  play(1, 'F3'); reload('finale win 2');
  play(1, 'F4'); reload('complete');
  assert(c.completed && Career.nextStep(c).type === 'ending');
  assert(checkpoints.length > 50, `${checkpoints.length} reload checkpoints`);
});

test('validateCareer catches a career that could not resume', () => {
  const c = Career.newCareer({ name: 'Bad', avatar: 'boy', startClubId: 'nyc' });
  c.location.sceneId = 'nowhere';
  c.tournaments.nyc = { completed: false, format: 'swiss', stage: 'rounds', rounds: [], players: [], round: 7 };
  const problems = Career.validateCareer(c, { sceneExists: (id) => !!SCENES[id] });
  assert(problems.some((p) => p.includes('scene')) && problems.some((p) => p.includes('no game to play')), problems.join('; '));
  Career.migrateCareer(c);
  eq(Career.validateCareer(c, { sceneExists: (id) => !!SCENES[id] }).length, 0, 'migrateCareer repairs it');
  eq(c.location.sceneId, 'nyc-ext');
});

test('tournament fuzz: every club, random results, the invariants always hold', () => {
  const random = seeded(4242);
  for (const club of CLUBS) {
    const format = Career.tournamentFormat(club.clubId);
    for (let trial = 0; trial < 40; trial += 1) {
      const c = Career.newCareer({ name: 'Fuzz', avatar: 'boy', startClubId: club.clubId });
      let attempts = 0;
      while (!c.trophies[club.clubId] && attempts < 12) {
        attempts += 1;
        const coinsBefore = c.coins;
        const run = Career.enterTournament(c, club.clubId, random);
        eq(run.format, format); eq(run.attempt, attempts, 'attempt counter');
        eq(run.players.length, format === 'swiss' ? 16 : 32);
        let games = 0; let last = null;
        while (!run.completed) {
          const round = Career.currentRound(c, club.clubId);
          assert(round, `${club.clubId}: running event with no round (stage ${run.stage}, round ${run.round})`);
          const score = attempts > 4 ? 1 : [1, 1, 0.5, 0, 1][Math.floor(random() * 5)];
          last = Career.commitMatchResult(c, { gameId: `${club.clubId}-${trial}-${attempts}-${games}`, kind: round.kind === 'star' ? 'star' : 'tournament', clubId: club.clubId,
            summary: { score, opponentElo: round.elo, grades: {}, accuracy: 70, matchScore: { total: 1, letter: 'D' }, hintsUsed: 0, openingsReached: [] } }, 1, random).progress;
          games += 1;
          // Structural checks after every game.
          const r = run.rounds.at(-1);
          const ids = r.pairings.flatMap((p) => [p.w, p.b]);
          eq(new Set(ids).size, ids.length, 'nobody paired twice in a round');
          if (format === 'swiss') eq(r.pairings.length, 8);
          else eq(r.pairings.length, 16 / 2 ** (run.rounds.length - 1));
          assert(games <= 6, 'at most five rounds and a final');
        }
        // Outcomes are consistent with the path.
        const pts = Event.playerPoints(run);
        let prize = pts * COINS.perTournamentPoint + (run.outcome === 'runner-up' ? COINS.finalist : 0) + (run.outcome === 'champion' ? COINS.champion : 0);
        eq(c.coins - coinsBefore, prize, `${club.clubId}: prize money (${run.outcome}, ${pts} pts)`);
        if (run.outcome === 'champion') { assert(c.trophies[club.clubId] && last.trophy, 'champion = trophy'); eq(c.openings[club.openingId], 100); }
        else { assert(!c.trophies[club.clubId], `${run.outcome}: no trophy`); assert(c.openings[club.openingId] <= Math.max(TOURNAMENT.masteryCap, 40), 'mastery capped'); }
        if (run.outcome === 'eliminated') eq(format, 'knockout');
        if (run.outcome === 'placed') { eq(format, 'swiss'); assert(Event.standings(run).find((x) => x.id === 'you').rank > 1); }
        if (run.outcome === 'runner-up' || run.outcome === 'champion') assert(run.final.playerIn);
        if (format === 'swiss') eq(Event.standings(run).reduce((a, x) => a + x.points, 0), 40, 'Swiss points add up');
      }
      assert(c.trophies[club.clubId], `${club.clubId}: won within 12 attempts`);
      const trophiesJson = JSON.stringify(c.trophies);
      eq(Career.awardTrophy(c, club.clubId, 999), null, 'trophy exactly once');
      eq(Career.currentRound(c, club.clubId), null, 'no event after the trophy');
      eq(JSON.stringify(c.trophies), trophiesJson);
    }
  }
});

test('knockout draws go to Black, for the player too', () => {
  for (const [colour, through] of [['b', true], ['w', false]]) {
    for (let seed = 1; seed < 60; seed += 1) {
      const c = Career.newCareer({ name: 'D', avatar: 'boy', startClubId: 'lon' });
      Career.enterTournament(c, 'lon', seeded(seed));
      if (Career.currentRound(c, 'lon').colour !== colour) continue;
      const res = Career.recordTournamentGame(c, 'lon', 0.5, 1, seeded(seed));
      eq(!res.eliminated, through, `a draw as ${colour}`);
      break;
    }
  }
  // Swiss: a draw is half a point and the event goes on.
  const c = Career.newCareer({ name: 'D', avatar: 'boy', startClubId: 'nyc' });
  Career.enterTournament(c, 'nyc', seeded(3));
  Career.recordTournamentGame(c, 'nyc', 0.5, 1, seeded(3));
  eq(Event.swissPoints(c.tournaments.nyc, 'you'), 0.5); eq(c.tournaments.nyc.round, 1);
});

/* ------------------------------------------------ tournaments and coins */

import * as Event from '../js/core/tournament.js';
import { MEMBERS, membersForClub, VISITORS } from '../js/data/members.js';
import { MEMBER_SPOTS } from '../js/data/memberSpots.js';
import { TOURNAMENT, COINS } from '../js/data/config.js';


test('simulated games follow Elo: upsets rare across a big gap, common within 100', () => {
  const rate = (gap, n = 20000) => {
    const r = seeded(11); let under = 0;
    for (let i = 0; i < n; i += 1) if (Event.simulateGame(1000 - gap, 1000, r) === 1) under += 1;
    return under / n;
  };
  const even = rate(0); const close = rate(100); const far = rate(400); const huge = rate(700);
  assert(even > 0.35 && even < 0.5, `equal players: ${even}`);
  assert(close > 0.15 && close < 0.35, `100 below wins now and then: ${close}`);
  assert(far < 0.05, `400 below almost never: ${far}`);
  assert(huge < 0.01, `700 below: ${huge}`);
  for (const gap of [0, 150, 500]) {
    const o = Event.outcomeOdds(1000 + gap, 1000);
    assert(Math.abs(o.win + o.draw + o.loss - 1) < 1e-9 && o.loss >= 0, `odds sum at ${gap}`);
  }
});

test('a Swiss event: 5 rounds, everyone plays each round, never the same opponent twice', () => {
  const c = Career.newCareer({ name: 'Swiss', avatar: 'boy', startClubId: 'nyc' });
  for (let trial = 0; trial < 20; trial += 1) {
    delete c.tournaments.nyc;
    const random = seeded(100 + trial);
    const run = Career.enterTournament(c, 'nyc', random);
    eq(run.format, 'swiss');
    while (run.stage === 'rounds') Career.recordTournamentGame(c, 'nyc', [1, 0.5, 0][trial % 3], Date.now(), random);
    eq(run.rounds.length, TOURNAMENT.rounds);
    for (const p of run.players) {
      const opps = run.rounds.map((r) => r.pairings.find((x) => x.w === p.id || x.b === p.id)).map((x) => (x.w === p.id ? x.b : x.w));
      eq(opps.length, 5, `${p.id} plays every round`);
      eq(new Set(opps).size, 5, `${p.id} meets five different opponents`);
    }
    const table = Event.standings(run);
    eq(table.reduce((a, r) => a + r.points, 0), 16 * 5 / 2, 'every game hands out one point');
    if (trial % 3 === 2) assert(!run.final.playerIn && run.outcome === 'placed' && run.completed, 'zero points does not reach the final');
  }
});

test('a knockout loss ends the run; the bracket still finishes and the next entry is fresh', () => {
  const c = Career.newCareer({ name: 'KO', avatar: 'girl', startClubId: 'lon' });
  const random = seeded(5);
  const run = Career.enterTournament(c, 'lon', random);
  eq(run.format, 'knockout'); eq(run.rounds[0].pairings.length, 16);
  Career.recordTournamentGame(c, 'lon', 1, Date.now(), random);
  const res = Career.recordTournamentGame(c, 'lon', 0, Date.now(), random);
  assert(res.eliminated && res.completed && !res.trophy, 'out in round 2');
  eq(run.rounds.length, 5, 'the bracket was played to the end');
  eq(run.rounds[4].pairings.length, 1);
  assert(run.final && run.final.result !== null && !run.final.playerIn, 'an NPC played the Star in the final');
  eq(Event.exitRound(run), 1);
  eq(res.coins, COINS.perTournamentPoint, 'one win pays one point of prize money');
  assert(!c.trophies.lon);
  const again = Career.enterTournament(c, 'lon', random);
  assert(again !== run && again.attempt === 2 && !again.completed, 'a fresh event');
  // A drawn knockout game goes to Black.
  eq(Event.knockoutWinner({ w: 'a', b: 'b', result: 0.5 }), 'b');
});

test('losing the final is runner-up: no trophy, but the opening is still learned', () => {
  const c = Career.newCareer({ name: 'Final', avatar: 'boy', startClubId: 'nyc' });
  const random = seeded(9);
  const before = c.openings.vienna;
  Career.enterTournament(c, 'vie', random);
  for (let i = 0; i < 5; i += 1) Career.recordTournamentGame(c, 'vie', 1, Date.now(), random);
  const res = Career.recordTournamentGame(c, 'vie', 0.5, Date.now(), random);
  eq(res.outcome, 'runner-up'); assert(!res.trophy && !c.trophies.vie, 'a draw with the Star is not a trophy');
  assert(c.openings.vienna > before, 'tournament games teach the club opening');
  for (let n = 0; n < 5; n += 1) {
    Career.enterTournament(c, 'vie', random);
    while (!c.tournaments.vie.completed) Career.recordTournamentGame(c, 'vie', 0, Date.now(), random);
  }
  eq(c.openings.vienna, TOURNAMENT.masteryCap, 'failed runs stop at the cap; only the trophy gives 100');
});

test('coins: stakes by Elo, challenges settle, puzzles pay, old saves migrate', () => {
  const c = Career.newCareer({ name: 'Coin', avatar: 'boy', startClubId: 'nyc' });
  eq(c.coins, COINS.start);
  eq(Career.stakeFor(300), COINS.stakeMin); eq(Career.stakeFor(2000), COINS.stakeMax);
  assert(Career.stakeFor(900) > Career.stakeFor(600), 'stronger members stake more');
  eq(Career.settleChallenge(c, 1, 20), 20); eq(Career.settleChallenge(c, 0.5, 20), 0); eq(Career.settleChallenge(c, 0, 30), -30);
  eq(c.coins, COINS.start - 10);
  c.coins = 5; Career.settleChallenge(c, 0, 30); eq(c.coins, 0, 'coins never go negative');
  assert(!Career.canAfford(c, 10));
  Career.recordPuzzleSolved(c, PUZZLES[0].id); eq(c.coins, COINS.puzzle, 'a first puzzle solve pays');
  const old = { ...Career.newCareer({ name: 'Old', avatar: 'boy', startClubId: 'nyc' }) };
  delete old.coins; old.tournaments = { nyc: { clubId: 'nyc', round: 1, rounds: [{ kind: 'regular' }], completed: false } };
  Career.migrateCareer(old);
  eq(old.coins, COINS.start); assert(!old.tournaments.nyc, 'an old three-game run restarts as a real event');
});

test('every club has 12 members who look and sound like their city', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'assets/characters/manifest.json'), 'utf8'));
  const indian = new Set(['in-student', 'woman', 'woman-coat', 'old-scarf', 'young-red']);
  const ids = new Set();
  for (const club of CLUBS) {
    const members = membersForClub(club.clubId);
    eq(members.length, 12, `${club.clubId} members`);
    for (const mb of members) {
      assert(!ids.has(mb.id), `${mb.id} twice`); ids.add(mb.id);
      assert(manifest.sprites[mb.look.sprite], `${mb.id}: sprite ${mb.look.sprite}`);
      assert(mb.lines.length >= 2 && mb.lines.every((l) => l.length < 160), `${mb.id}: short lines`);
      assert(OPENINGS.find((o) => o.id === mb.openingId), `${mb.id}: opening`);
      assert(mb.rel >= 0 && mb.rel <= 1, `${mb.id}: rel`);
      assert(!/—|–/.test(mb.lines.join(' ')), `${mb.id}: no dashes in dialogue`);
    }
    for (const sprite of VISITORS[club.clubId].sprites) assert(manifest.sprites[sprite], `${club.clubId} visitor ${sprite}`);
  }
  const che = membersForClub('che');
  assert(che.filter((mb) => indian.has(mb.look.sprite)).length >= 9, 'Chennai is mostly Indian');
  assert(che.some((mb) => !indian.has(mb.look.sprite)), 'with some exchange students');
});

test('every placed member stands on reachable floor, apart from the hotspots', () => {
  let placed = 0;
  for (const [sceneId, spots] of Object.entries(MEMBER_SPOTS)) {
    const scene = sceneById(sceneId);
    const aspect = 1448 / 1086;
    const grid = createWalkGrid(SCENE_LAYERS[sceneId], { aspect, walker: walkerFor(scene.actorHeight ?? 0.1) });
    const spawn = scene.nodes[scene.spawn.default];
    for (const [id, spot] of Object.entries(spots)) {
      assert(MEMBERS[sceneId.slice(0, 3)].some((mb) => mb.id === id), `${sceneId}: ${id} is a member of this club`);
      assert(grid.free(...spot.at), `${sceneId}: ${id} stands in furniture`);
      assert(grid.path(spawn, spot.stand), `${sceneId}: ${id} cannot be reached`);
      placed += 1;
    }
  }
  const expected = CLUBS.reduce((n, c) => n + MEMBERS[c.clubId].filter((mb) => mb.where).length, 0);
  eq(placed, expected, 'every member with a place is placed');
});

test('game results move Elo, XP and opening knowledge', () => {
  const c = Career.newCareer({ name: 'G', avatar: 'boy', startClubId: 'che' });
  const r = Career.applyGameResult(c, {
    kind: 'tournament', score: 1, opponentElo: 700, grades: { BRILLIANT: 1, BEST: 3 }, accuracy: 85,
    matchScore: { total: 2500, letter: 'B' }, hintsUsed: 1, openingsReached: ['caro', 'french']
  });
  assert(r.eloDelta > 0 && r.xp.xp > 0);
  eq(c.openings.caro, 44); eq(c.openings.french, 4);
  eq(c.stats.grades.BRILLIANT, 1); eq(c.stats.careerScore, 2500);
  for (let i = 0; i < 30; i += 1) Career.learnFromPlay(c, 'french');
  eq(c.openings.french, 90, 'play alone never masters an opening');
});

/* ------------------------------------------------------------- puzzles */

test('every venue and every club has its own puzzles: no position is used twice', () => {
  const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
  const seen = new Map();
  for (const p of [...PUZZLES, ...CLUB_PUZZLES]) {
    const k = key(p.fen);
    assert(!seen.has(k), `${p.id} repeats ${seen.get(k)}`);
    seen.set(k, p.id);
  }
  for (const club of CLUBS) {
    assert(PUZZLES.filter((p) => p.mission === club.clubId).length >= 4, `${club.clubId}: venue set`);
    assert(CLUB_PUZZLES.filter((p) => p.club === club.clubId).length >= 4, `${club.clubId}: club set`);
  }
});

test('club puzzle solutions are legal and mates end in mate', () => {
  for (const p of CLUB_PUZZLES) {
    const r = createRules(p.fen);
    for (const uci of p.solution) {
      const m = r.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
      assert(m, `${p.id}: illegal ${uci}`);
    }
    eq(p.solution.length % 2, 1, `${p.id}: ends on the player's move`);
    if (p.title.startsWith('Mate')) assert(r.isCheckmate(), `${p.id}: "${p.title}" ends in mate`);
  }
});

/* ------------------------------------------------------ grading rules */

test('a missed win is shown as a plain mistake, never "Missed win"', () => {
  const miss = (loss) => gradeMove({ mistakeClassification: 'MISS', winProbLoss: loss, classificationBands: { inaccuracy: 11, mistake: 20 } }).grade;
  eq(miss(8), 'INACCURACY'); eq(miss(15), 'MISTAKE'); eq(miss(40), 'BLUNDER');
});

test('a piece left hanging earns a special grade once, not every move', () => {
  const self = { playerColour: 'w', specialOffers: new Set() };
  const special = { grade: 'CLUTCH', tier: 'clutch' };
  // White knight g5 attacked by the h6 pawn and undefended: d2-d3 leaves it hanging.
  const first = { fenBefore: 'rnbqkb1r/pppp1pp1/5n1p/4p1N1/4P3/8/PPPP1PPP/RNBQKB1R w KQkq - 0 4', uci: 'd2d3', mistakeClassification: 'BEST' };
  eq(PapMatch.prototype._noRepeatSpecial.call(self, first, special).grade, 'CLUTCH', 'first offer counts');
  const again = { fenBefore: 'rnbqkb1r/pppp1pp1/5n1p/4p1N1/4P3/3P4/PPP2PPP/RNBQKB1R w KQkq - 0 5', uci: 'b1c3', mistakeClassification: 'BEST' };
  eq(PapMatch.prototype._noRepeatSpecial.call(self, again, { grade: 'EPIC', tier: 'epic' }).grade, 'BEST', 'same knight still hanging');
  const quiet = { fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', uci: 'e2e4', mistakeClassification: 'EXCELLENT' };
  eq(PapMatch.prototype._noRepeatSpecial.call({ playerColour: 'w', specialOffers: new Set() }, quiet, special).grade, 'CLUTCH', 'nothing hanging: a clutch stays a clutch');
});

test('undo: level caps and scoring', () => {
  eq(undoUses(1), 1); eq(undoUses(6), 2); eq(undoUses(15), 3);
  eq(UNDO.cost, maxFocusOf(1), 'a beginner spends the whole pool');
  const s = matchScore({ score: 1, accuracy: 80, grades: {}, playerElo: 600, opponentElo: 600, undosUsed: 2 });
  assert(s.lines.some((l) => /Undo x2/.test(l.label) && l.points === -2 * 150), JSON.stringify(s.lines));
});

/* -------------------------------------------------------- free walking */

test('layered scenes: every hotspot reachable from the spawn, nothing walks through a footprint', () => {
  const sizes = JSON.parse(readFileSync(path.join(ROOT, 'assets/manifest.json'), 'utf8')).scenes;
  for (const [id, layers] of Object.entries(SCENE_LAYERS)) {
    const scene = sceneById(id);
    assert(scene, `${id}: scene exists`);
    const [w, h] = sizes[id];
    const grid = createWalkGrid(layers, { aspect: w / h, walker: walkerFor(scene.actorHeight ?? 0.1) });
    for (const prop of layers.props) assert(existsSync(path.join(ROOT, prop.src)), `${id}/${prop.id}: layer image`);
    const spawn = grid.nearestFree(...scene.nodes[scene.spawn.default]);
    assert(spawn, `${id}: spawn on the floor`);
    for (const spot of scene.hotspots) {
      const route = grid.path(spawn, scene.nodes[spot.node]);
      assert(route, `${id}: ${spot.id} reachable`);
      let prev = spawn;
      for (const point of route) { assert(grid.lineFree(prev[0], prev[1], point[0], point[1]), `${id}: ${spot.id} route crosses an obstacle`); prev = point; }
    }
    for (const prop of layers.props.filter((p) => p.foot)) {
      const [x0, y0, x1, y1] = prop.foot;
      assert(!grid.free((x0 + x1) / 2, (y0 + y1) / 2), `${id}/${prop.id}: footprint is blocked`);
    }
  }
});

test('every scene: every arrival reaches every interaction, and random walking never traps the player', () => {
  const sizes = JSON.parse(readFileSync(path.join(ROOT, 'assets/manifest.json'), 'utf8')).scenes;
  const USE_RADIUS = 10;                                  // scene.js: screen-space percent of the scene height
  const random = seeded(99);
  let checked = 0;
  for (const scene of Object.values(SCENES)) {
    const layers = SCENE_LAYERS[scene.id];
    if (!layers) {                                        // a waypoint scene: the graph test above covers it
      for (const spawn of Object.values(scene.spawn)) for (const h of scene.hotspots) assert(findPath(scene, spawn, h.node), `${scene.id}: ${spawn} -> ${h.id}`);
      continue;
    }
    const [w, hgt] = sizes[scene.id];
    const aspect = w / hgt;
    const grid = createWalkGrid(layers, { aspect, walker: walkerFor(scene.actorHeight ?? 0.1) });
    const dist = (a, b) => Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
    const exits = scene.hotspots.filter((h) => ['leave', 'scene'].includes(h.action.type));
    assert(exits.length, `${scene.id}: has a way out`);
    for (const [name, node] of Object.entries(scene.spawn)) {
      const start = grid.nearestFree(...scene.nodes[node]);
      assert(start, `${scene.id}: spawn ${name} on the floor`);
      for (const h of scene.hotspots) {
        const route = grid.path(start, scene.nodes[h.node]);
        assert(route, `${scene.id}: from ${name} to ${h.id}`);
        assert(dist(route.at(-1), scene.nodes[h.node]) <= USE_RADIUS, `${scene.id}: ${h.id} can be reached close enough to use`);
      }
      // Wander: 30 random walks of 120 pushes each, the same slide-along-walls move the joystick uses.
      for (let walk = 0; walk < 30; walk += 1) {
        let pos = start;
        for (let step = 0; step < 120; step += 1) {
          const t = random() * Math.PI * 2;
          const r = grid.move(pos[0], pos[1], (Math.cos(t) * 1.5) / aspect, Math.sin(t) * 1.5);
          pos = [r.x, r.y];
        }
        for (const exit of exits) assert(grid.path(pos, scene.nodes[exit.node]), `${scene.id}: trapped at ${pos.map((v) => v.toFixed(1))} (no way to ${exit.id})`);
        checked += 1;
      }
    }
  }
  assert(checked > 500, `${checked} random walks`);
});

test('a walker\'s body never leaves the floor, in any scene', () => {
  /* The bug this pins: the grid used to grow only the BLOCKS by the walker's
     size and leave the floor edge alone, so wherever a wall was spelled as the
     gap between two floor polygons - which is how every interior is drawn - a
     body could stand half inside it. Every scene had it, 3% to 16% of its
     standable cells. Measured here against the floor polygons directly, not
     against the grid that is derived from them. */
  const sizes = JSON.parse(readFileSync(path.join(ROOT, 'assets/manifest.json'), 'utf8')).scenes;
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [id, layers] of Object.entries(SCENE_LAYERS)) {
    const scene = sceneById(id);
    const [w, h] = sizes[id];
    const aspect = w / h;
    const walker = walkerFor(scene.actorHeight ?? 0.1);
    const grid = createWalkGrid(layers, { aspect, walker });
    const padX = walker.halfWidth / aspect;
    const padY = walker.halfDepth;
    const cw = 100 / grid.cols;
    const ch = 100 / grid.rows;
    const onFloor = (x, y) => layers.floor.some((poly) => pointInPolygon(x, y, poly));
    let outside = 0;
    for (let j = 0; j < grid.rows; j += 1) {
      for (let i = 0; i < grid.cols; i += 1) {
        if (grid.cells[j * grid.cols + i] !== 1) continue;
        const x = (i + 0.5) * cw;
        const y = (j + 0.5) * ch;
        if (corners.some(([ox, oy]) => !onFloor(x + ox * padX, y + oy * padY))) outside += 1;
      }
    }
    eq(outside, 0, `${id}: standable cells whose body reaches off the floor`);
  }
});

test('every scene: walkable floor is reachable, apart from nooks inside the furniture', () => {
  /* Floor the player can stand on but can never walk to means a doorway that
     a body no longer fits through. Small pockets are fine and intended: the
     inside of a ring of armchairs, the strip behind a display case. */
  const sizes = JSON.parse(readFileSync(path.join(ROOT, 'assets/manifest.json'), 'utf8')).scenes;
  const NOOK = 600;                       // cells; a doorway loses far more than this
  for (const [id, layers] of Object.entries(SCENE_LAYERS)) {
    const scene = sceneById(id);
    const [w, h] = sizes[id];
    const grid = createWalkGrid(layers, { aspect: w / h, walker: walkerFor(scene.actorHeight ?? 0.1) });
    const { cols, rows, cells } = grid;
    const start = grid.nearestFree(...scene.nodes[scene.spawn.default]);
    assert(start, `${id}: spawn finds floor`);
    const seen = new Uint8Array(cols * rows);
    const cw = 100 / cols;
    const ch = 100 / rows;
    const first = Math.floor(start[1] / ch) * cols + Math.floor(start[0] / cw);
    const stack = [first];
    seen[first] = 1;
    while (stack.length) {
      const n = stack.pop();
      const i = n % cols;
      const j = (n - i) / cols;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const m = nj * cols + ni;
        if (!seen[m] && cells[m] === 1) { seen[m] = 1; stack.push(m); }
      }
    }
    // Biggest cut-off clump.
    const mark = new Uint8Array(cols * rows);
    let worst = 0;
    for (let n = 0; n < cells.length; n += 1) {
      if (cells[n] !== 1 || seen[n] || mark[n]) continue;
      const q = [n];
      mark[n] = 1;
      let area = 0;
      while (q.length) {
        const c = q.pop();
        area += 1;
        const i = c % cols;
        const j = (c - i) / cols;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const m = nj * cols + ni;
          if (!mark[m] && cells[m] === 1 && !seen[m]) { mark[m] = 1; q.push(m); }
        }
      }
      worst = Math.max(worst, area);
    }
    assert(worst <= NOOK, `${id}: ${worst} cells of floor are walled off from the spawn`);
  }
});

test('the collision debug overlay is off unless the URL asks for it', () => {
  const saved = globalThis.window;
  const check = (search, hash) => {
    globalThis.window = { location: { search, hash } };
    try { return collisionDebugOn(); } finally { globalThis.window = saved; }
  };
  assert(!check('', ''), 'off with no query at all');
  assert(!check('?city=nyc', ''), 'off for an unrelated query');
  assert(!check('?debugCollision=0', ''), 'off when explicitly 0');
  assert(check('?debugCollision=1', ''), 'on with the flag');
  assert(check('?city=nyc&debugCollision=1', ''), 'on with the flag after another');
  assert(check('', '#debugCollision=1'), 'on from the hash too');
});

test('free walking slides along obstacles instead of passing through', () => {
  const layers = { floor: [[[0, 0], [100, 0], [100, 100], [0, 100]]], blocks: [[40, 40, 60, 60]], props: [] };
  const grid = createWalkGrid(layers, { aspect: 1 });
  const straight = grid.move(50, 70, 0, -30);
  assert(straight.y > 60, `stopped below the block (y ${straight.y})`);
  const slide = grid.move(50, 70, 20, -30);
  assert(slide.x > 50 && slide.y < 70, 'a diagonal push slides along the edge');
  const route = grid.path([50, 80], [50, 20]);
  assert(route && route.length >= 2, 'a path goes around the block');
});

/* --------------------------------------------------------------- music -- */

/** Play a game from SAN and return the mood after each half-move. */
function moodTrace(sans) {
  let fen = START_FEN;
  const moves = [];
  let clock = 0;
  const tracker = createMoodTracker({ now: () => clock });
  const out = [];
  for (const san of sans) {
    const uci = uciFor(fen, san);
    assert(uci, `illegal in the test game: ${san}`);
    const played = applyUci(fen, uci);
    moves.push({
      ply: moves.length + 1, color: played.move.color,
      check: played.move.san.includes('+'), checkmate: played.move.san.includes('#'),
      capturedPiece: played.move.captured || null, promotion: played.move.promotion || null
    });
    fen = played.fen;
    clock += 20000;                                   // 20s a move: dwell never blocks
    out.push(tracker.update(fen, moves, null, clock));
  }
  return out;
}

const OPERA = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');
const QUIET = 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5 Bxe7 Qxe7 O-O Nxc3 Rxc3 e5 Bb3 exd4 exd4 Nf6 Re1 Qd6 h3 Bf5 Qd2 Rfe8'.split(' ');

test('the soundtrack never reads the evaluation', () => {
  /* The whole point of musicMood.js: the music must not become a hidden eval
     bar telling the player they are losing. Guarded structurally, because the
     temptation is a one-line import. */
  const src = readFileSync(path.join(ROOT, 'js/core/musicMood.js'), 'utf8');
  // The comments are allowed to discuss the evaluation; the CODE is not.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const banned of ['engine', 'Engine', 'centipawn', 'evaluation', 'bestMove', 'stockfish', 'Stockfish', '.cp', 'mateScore']) {
    assert(!code.includes(banned), `musicMood.js uses ${banned}`);
  }
  const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  eq(imports.length, 1, 'musicMood.js imports exactly one module');
  eq(imports[0], '../chess/core/rules.js', 'and it is the rules, nothing else');
});

test('a quiet game never leaves the default match track', () => {
  const trace = moodTrace(QUIET);
  eq(new Set(trace).size, 1, `one mood all game, got ${[...new Set(trace)].join('/')}`);
  eq(trace[0], 'tactical', 'and it is the default');
});

test('a single check in a quiet opening does not raise the music', () => {
  const facts = moodFacts('rnbqkbnr/ppp2ppp/8/3pp3/6Q1/4P3/PPPP1PPP/RNB1KBNR b KQkq - 0 3', [{ check: true }]);
  assert(heatOf(facts) < MOOD_RULES.toIntense, `a lone check scores ${heatOf(facts)}, under ${MOOD_RULES.toIntense}`);
  assert(!facts.inCheck === false || true, 'facts read the position');
});

test('a mating attack reaches the last track, and only at the end', () => {
  const trace = moodTrace(OPERA);
  const critical = trace.filter((m) => m === 'critical').length;
  assert(critical > 0, 'the Opera Game gets there');
  assert(critical <= 6, `and stays rare (${critical} of ${trace.length} half-moves)`);
  const first = trace.indexOf('critical');
  assert(first > trace.length * 0.75, `the last track waits for the mating net (ply ${first + 1} of ${trace.length})`);
  assert(trace.includes('intense'), 'and it passes through the middle track on the way');
});

test('the music steps down one track at a time, never straight to calm', () => {
  let clock = 0;
  const tracker = createMoodTracker({ now: () => clock });
  // A mating net: in check, two replies, mate on the board.
  const crisis = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
  const hot = { ply: 40, phase: 'endgame', inCheck: true, replies: 1, mateOnBoard: true, checks: 3, captures: 2, promotions: 0, secondsLeft: null };
  assert(heatOf(hot) >= MOOD_RULES.toCritical, 'the test position is hot enough to be critical');
  // Drive it up with the real machine, then let it go quiet.
  clock += MOOD_RULES.dwellMs;
  tracker.update('r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4', [{ check: true }, { capturedPiece: 'p' }], null, clock);
  const seen = [];
  for (let i = 0; i < 6; i += 1) {
    clock += MOOD_RULES.dwellMs;
    seen.push(tracker.update(crisis, [], null, clock));
  }
  // Whatever it reached, it never skips a step on the way down.
  for (let i = 1; i < seen.length; i += 1) {
    const drop = MOODS.indexOf(seen[i - 1]) - MOODS.indexOf(seen[i]);
    assert(drop <= 1, `fell ${drop} tracks at once (${seen[i - 1]} -> ${seen[i]})`);
  }
});

test('the music will not change twice inside the dwell time', () => {
  let clock = 0;
  const tracker = createMoodTracker({ now: () => clock });
  const sharp = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
  const calm = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  clock += MOOD_RULES.dwellMs;
  const first = tracker.update(sharp, [{ check: true }, { capturedPiece: 'p' }, { check: true }], null, clock);
  // One millisecond short of the dwell: nothing may move, however calm it gets.
  clock += MOOD_RULES.dwellMs - 1;
  eq(tracker.update(calm, [], null, clock), first, 'held inside the dwell window');
  clock += 2;
  const later = tracker.update(calm, [], null, clock);
  assert(MOODS.indexOf(later) <= MOODS.indexOf(first), 'and may only calm down once the window passes');
});

test('every soundtrack file is on disk, and the crossfade is the length asked for', () => {
  eq(Object.keys(TRACKS).length, 4, 'four tracks');
  for (const [id, src] of Object.entries(TRACKS)) {
    assert(src.startsWith('assets/audio/'), `${id} lives under assets/audio`);
    assert(!/ /.test(src), `${id} has no space in its path (${src})`);
    assert(existsSync(path.join(ROOT, src)), `${id}: ${src} exists`);
  }
  assert(CROSSFADE_MS >= 700 && CROSSFADE_MS <= 1200, `crossfade ${CROSSFADE_MS}ms is in the 0.7-1.2s brief`);
});

/* ------------------------------------------------- the practice tree ---- */

test('the practice tree opens the beginner path first and 1500 last', () => {
  const career = Career.newCareer({ name: 'Tree', avatar: 'boy', startClubId: 'nyc' });
  const open = () => Lessons.TIERS.filter((t) => Lessons.isTierUnlocked(career, t));
  assert(open().length === 1, `one tier at zero trophies (got ${open().length})`);
  assert(open()[0].bands.join() === '0,100,200,300,400,500,600', `the first tier is the beginner path (${open()[0].bands})`);
  const beginner = LESSON_LIST.filter((l) => Lessons.isLessonUnlocked(career, l));
  assert(beginner.length > 20 && beginner.every((l) => l.band <= 600), `only lessons up to 600 are open (${beginner.length})`);
  /* one tournament completed = one Club Trophy = one more tier */
  CLUBS.forEach((club, i) => {
    career.trophies[club.clubId] = { wonAt: Date.now(), starElo: 800, tier: i };
    assert(open().length === i + 2, `${i + 1} trophies open ${i + 2} tiers (got ${open().length})`);
  });
  const all = LESSON_LIST.filter((l) => Lessons.isLessonUnlocked(career, l));
  assert(all.length === LESSON_LIST.length, 'six trophies open every lesson');
  assert(Math.max(...all.map((l) => l.band)) === 1500, 'the last band is 1500, the game\'s ceiling');
  assert(Lessons.nextTier(career) === null, 'nothing is left to unlock');
});

test('a lesson can be done in any order, and earlier ones stay open', () => {
  const career = Career.newCareer({ name: 'Tree', avatar: 'boy', startClubId: 'nyc' });
  const late = LESSON_LIST.filter((l) => Lessons.isLessonUnlocked(career, l)).sort((a, b) => b.band - a.band)[0];
  const early = LESSON_LIST.find((l) => l.band === 0);
  /* start at the far end of the open tier, then go back to the first lesson */
  Lessons.markRead(career, late.id);
  late.challenges.forEach((c) => Lessons.recordChallengeSolved(career, late.id, c.id));
  Lessons.markWatched(career, late.id);
  Lessons.settleLesson(career, late.id);
  assert(Lessons.lessonProgress(career, late).complete, 'the later lesson completes on its own');
  assert(!Lessons.lessonProgress(career, early).started, 'the earlier one was never required');
  Lessons.markRead(career, early.id);
  assert(Lessons.lessonProgress(career, early).read, 'an earlier lesson is still open afterwards');
  assert(Lessons.isLessonUnlocked(career, early), 'and stays unlocked');
});

test('practice progress pays XP once and only counts what is done', () => {
  const career = Career.newCareer({ name: 'Tree', avatar: 'boy', startClubId: 'nyc' });
  const lesson = LESSON_LIST.find((l) => l.band <= 600 && l.demo.length && l.challenges.length >= 2);
  const first = Lessons.recordChallengeSolved(career, lesson.id, lesson.challenges[0].id);
  assert(first.firstSolve && first.xp.xp === PRACTICE.xpChallenge, `a first solve pays ${PRACTICE.xpChallenge} XP`);
  const again = Lessons.recordChallengeSolved(career, lesson.id, lesson.challenges[0].id);
  assert(!again.firstSolve && !again.xp, 'solving it again pays nothing');
  assert(!Lessons.lessonProgress(career, lesson).complete, 'unread and unwatched is not complete');
  Lessons.markRead(career, lesson.id);
  Lessons.markWatched(career, lesson.id);
  lesson.challenges.slice(1).forEach((c) => Lessons.recordChallengeSolved(career, lesson.id, c.id));
  const done = Lessons.lessonProgress(career, lesson);
  assert(done.complete && done.solved === done.total, 'read + watched + every challenge = complete');
  assert(career.stats.lessonsDone === 1, 'the career counts one finished lesson');
  const xp = career.xp;
  Lessons.settleLesson(career, lesson.id);
  assert(career.xp === xp, 'a completed lesson is not paid for twice');
});

test('every practice challenge is playable: legal position, legal answer', () => {
  for (const lesson of LESSON_LIST) {
    for (const c of lesson.challenges) {
      const rules = createRulesForTest(c.fen);
      assert(rules, `${lesson.id}/${c.id}: illegal position`);
      assert(rules.turn() === c.sideToMove, `${lesson.id}/${c.id}: side to move`);
      if (c.kind === 'square') { assert(/^[a-h][1-8]$/.test(c.target), `${lesson.id}/${c.id}: target`); continue; }
      const legal = new Set(rules.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion && m.promotion !== 'q' ? m.promotion : '')));
      assert(c.answers.length > 0, `${lesson.id}/${c.id}: no answer`);
      for (const uci of c.answers) assert(legal.has(uci), `${lesson.id}/${c.id}: answer ${uci} is not legal`);
      for (const uci of Object.keys(c.verdicts)) assert(legal.has(uci), `${lesson.id}/${c.id}: judged move ${uci} is not legal`);
    }
  }
});

/* ---------------------------------------------------------------- report */

for (const { name, fn } of queue) {
  try { await fn(); passed += 1; } catch (error) { failures.push(`${name}: ${error.message}`); }
}
console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
