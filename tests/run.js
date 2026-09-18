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
import { createWalkGrid, walkerFor } from '../js/core/freeWalk.js';
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
import { LEVELS, ELO, HINTS } from '../js/data/config.js';
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

function test(name, fn) {
  try { fn(); passed += 1; } catch (error) { failures.push(`${name}: ${error.message}`); }
}
function assert(cond, message = 'assertion failed') { if (!cond) throw new Error(message); }
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

test('focus grows with level, hint depth reaches 5 plies at the cap', () => {
  assert(Career.maxFocus(15) > Career.maxFocus(1));
  eq(Career.hintPlies(1).plies, 1); eq(Career.hintPlies(5).plies, 2); eq(Career.hintPlies(10).plies, 3); eq(Career.hintPlies(15).plies, 5);
});

test('new career: starting club opening at 40%, others at 0', () => {
  const c = Career.newCareer({ name: 'Ada', avatar: 'girl', startClubId: 'vie' });
  eq(c.openings.vienna, 40);
  for (const o of OPENINGS) if (o.id !== 'vienna') eq(c.openings[o.id], 0, o.id);
  eq(c.elo, ELO.start); eq(c.level, 1); eq(c.avatar, 'girl');
});

test('star Elo climbs with tier and the finale reaches 1500', () => {
  eq(Career.starElo(0), 800); eq(Career.starElo(5), 1375);
  eq(ELO.finaleRounds.at(-1), 1500);
  assert(ELO.finaleRounds.every((e) => e >= 1400 && e <= 1500));
});

test('bot strength is monotone in Elo and capped', () => {
  let prev = null;
  for (const elo of [400, 600, 800, 1000, 1200, 1400, 1500, 2400]) {
    const s = strengthForElo(elo);
    if (prev) { assert(s.strength >= prev.strength); assert(s.blunderChance <= prev.blunderChance); }
    prev = s;
  }
  eq(strengthForElo(2400).elo, 1500);
  const p = profileForOpponent({ name: 'X', elo: 900, style: 'aggressive' });
  assert(p.blunderChance > 0.05 && p.style === 'aggressive');
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

test('hint cost: known opening < unknown opening < endgame, depth costs more', () => {
  const afterE4 = applyUci(START_FEN, 'e2e4').fen;
  const known = hintQuote({ level: 1, fen: afterE4, mastery: { sicilian: 100 }, book: fullBook });
  const unknown = hintQuote({ level: 1, fen: afterE4, mastery: {}, book: fullBook });
  const endgame = hintQuote({ level: 1, fen: '8/5k2/8/8/8/8/5K2/4R3 w - - 0 60', mastery: {}, book: fullBook });
  assert(known.cost < unknown.cost, `${known.cost} < ${unknown.cost}`);
  assert(unknown.cost < endgame.cost, `${unknown.cost} < ${endgame.cost}`);
  const deep = hintQuote({ level: 15, fen: afterE4, mastery: {}, book: fullBook });
  assert(deep.cost > unknown.cost); eq(deep.plies, 5);
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
  assert(Career.currentFinaleRound(c).elo >= 1400);
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

/* ------------------------------------------------ tournaments and coins */

import * as Event from '../js/core/tournament.js';
import { MEMBERS, membersForClub, VISITORS } from '../js/data/members.js';
import { MEMBER_SPOTS } from '../js/data/memberSpots.js';
import { TOURNAMENT, COINS } from '../js/data/config.js';

const seeded = (s0) => { let s = s0; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

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

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
