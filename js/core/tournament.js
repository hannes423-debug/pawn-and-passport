/**
 * tournament.js - a club tournament as data: the field, the pairings, the
 * simulated games between NPCs, the standings. Pure: no DOM, no engine, no
 * career (career.js wraps it and pays out). Every random choice goes through
 * the `random` argument, so tests replay an event exactly.
 *
 * Two formats (config.TOURNAMENT.format per club):
 *   swiss     16 players, 5 rounds, everyone plays every round. Pairings
 *             inside score groups, top half against bottom half, never the
 *             same opponent twice. The leader after round 5 goes to the final.
 *   knockout  32 players seeded by rating (1 v 32, 16 v 17, ...), 5 rounds.
 *             A drawn game goes to Black (Armageddon rule).
 * Then the FINAL against the club's Star Player: only a win takes the trophy.
 *
 * A game result is always stored from WHITE's point of view: 1, 0.5 or 0.
 * The player is the entrant with id YOU.
 */

import { TOURNAMENT, SIM } from '../data/config.js';

export const YOU = 'you';

/* ------------------------------------------------------------ simulation -- */

/** Win / draw / loss chances for White against Black, from Elo alone. */
export function outcomeOdds(eloW, eloB) {
  const gap = eloW - eloB;
  const expected = 1 / (1 + 10 ** (-gap / SIM.scale));
  const draw = Math.min(SIM.drawAtEqual * Math.exp(-Math.abs(gap) / SIM.drawFalloff), 2 * Math.min(expected, 1 - expected));
  return { win: expected - draw / 2, draw, loss: 1 - expected - draw / 2 };
}

/** Play one NPC game out: 1, 0.5 or 0 for White. */
export function simulateGame(eloW, eloB, random = Math.random) {
  const odds = outcomeOdds(eloW, eloB);
  const r = random();
  return r < odds.win ? 1 : r < odds.win + odds.draw ? 0.5 : 0;
}

/* ------------------------------------------------------------- helpers -- */

const pairingOf = (round, id) => round.pairings.find((p) => p.w === id || p.b === id) || null;

/** Points a result gives `id` in pairing `p` (Swiss scoring). */
const pointsFor = (p, id) => (p.result === null ? 0 : p.w === id ? p.result : 1 - p.result);

/** Who goes through a knockout pairing (a draw goes to Black). */
export function knockoutWinner(p) {
  if (p.result === null) return null;
  if (p.result === 0.5) return TOURNAMENT.knockoutDrawGoesTo === 'w' ? p.w : p.b;
  return p.result === 1 ? p.w : p.b;
}

export const playerById = (run, id) => run.players.find((x) => x.id === id) || null;

/* ------------------------------------------------------------ creation -- */

/**
 * @param {Object} o
 * @param {'swiss'|'knockout'} o.format
 * @param {Array} o.players  the whole field, the player (id YOU) included
 * @param {Object} o.star    { id, name, elo, style, openingId, look }
 */
export function createEvent({ clubId, format, players, star, tier = 0, random = Math.random, now = Date.now() }) {
  const run = {
    clubId, format, tier, startedAt: now,
    players: players.map((p) => ({ ...p })),
    star: { ...star },
    rounds: [],
    round: 0,
    stage: 'rounds',          // 'rounds' -> 'final' -> 'done'
    final: null,              // { w, b, result, playerIn }
    outcome: null,            // 'champion' | 'runner-up' | 'eliminated' | 'placed'
    place: null,
    completed: false
  };
  run.rounds.push(format === 'swiss' ? { pairings: pairSwiss(run, random) } : { pairings: firstKnockoutRound(run, random) });
  return run;
}

/* --------------------------------------------------------------- swiss -- */

export function swissPoints(run, id) {
  let total = 0;
  for (const round of run.rounds) { const p = pairingOf(round, id); if (p) total += pointsFor(p, id); }
  return total;
}

const opponentsOf = (run, id) => run.rounds.map((r) => pairingOf(r, id)).filter(Boolean).map((p) => (p.w === id ? p.b : p.w));
const whitesOf = (run, id) => run.rounds.filter((r) => pairingOf(r, id)?.w === id).length;
const lastColour = (run, id) => {
  for (let i = run.rounds.length - 1; i >= 0; i -= 1) {
    const p = pairingOf(run.rounds[i], id);
    if (p) return p.w === id ? 'w' : 'b';
  }
  return null;
};

/** Standings, best first: points, then Buchholz (opponents' points), then rating. */
export function standings(run) {
  const rows = run.players.map((pl) => {
    const points = swissPoints(run, pl.id);
    const buchholz = opponentsOf(run, pl.id).reduce((sum, o) => sum + swissPoints(run, o), 0);
    return { id: pl.id, name: pl.name, elo: pl.elo, points, buchholz, played: opponentsOf(run, pl.id).length };
  });
  rows.sort((a, b) => b.points - a.points || b.buchholz - a.buchholz || b.elo - a.elo || (a.id === YOU ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/**
 * Pair the next Swiss round. Score groups top-down; inside a group the top
 * half meets the bottom half. Backtracking guarantees nobody meets the same
 * opponent twice (with 16 players and 5 rounds there is always a way).
 */
export function pairSwiss(run, random = Math.random) {
  const table = run.players.map((pl) => ({ id: pl.id, elo: pl.elo, points: swissPoints(run, pl.id) }))
    .sort((a, b) => b.points - a.points || b.elo - a.elo);
  const rank = new Map(table.map((t, i) => [t.id, i]));
  const groupSize = new Map();
  for (const t of table) groupSize.set(t.points, (groupSize.get(t.points) || 0) + 1);
  const played = new Map(table.map((t) => [t.id, new Set(opponentsOf(run, t.id))]));

  const preference = (a, rest) => {
    const half = Math.max(1, Math.floor((groupSize.get(a.points) || 2) / 2));
    return [...rest].sort((x, y) =>
      Math.abs(x.points - a.points) - Math.abs(y.points - a.points)
      || Math.abs(rank.get(x.id) - rank.get(a.id) - half) - Math.abs(rank.get(y.id) - rank.get(a.id) - half));
  };
  const solve = (left) => {
    if (!left.length) return [];
    const [a, ...rest] = left;
    for (const b of preference(a, rest)) {
      if (played.get(a.id).has(b.id)) continue;
      const tail = solve(rest.filter((x) => x !== b));
      if (tail) return [[a, b], ...tail];
    }
    return null;
  };
  const pairs = solve(table) || solve(table.map((t) => t).reverse()) || [];
  return pairs.map(([a, b]) => {
    const colourA = swissColour(run, a.id, b.id, random);
    return colourA === 'w' ? { w: a.id, b: b.id, result: null } : { w: b.id, b: a.id, result: null };
  });
}

/** White goes to whoever has had fewer Whites, then whoever had Black last. */
function swissColour(run, a, b, random) {
  const diff = whitesOf(run, a) - whitesOf(run, b);
  if (diff) return diff < 0 ? 'w' : 'b';
  const la = lastColour(run, a); const lb = lastColour(run, b);
  if (la && la !== lb) return la === 'b' ? 'w' : 'b';
  return random() < 0.5 ? 'w' : 'b';
}

/* ------------------------------------------------------------ knockout -- */

/** Bracket order for n seeds (a power of two): 1 v n, and the top seeds meet last. */
export function bracketOrder(n) {
  let order = [1, 2];
  while (order.length < n) {
    const size = order.length * 2;
    order = order.flatMap((x) => [x, size + 1 - x]);
  }
  return order;
}

function firstKnockoutRound(run, random) {
  const seeded = [...run.players].sort((a, b) => b.elo - a.elo);
  const order = bracketOrder(seeded.length);
  const pairings = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = seeded[order[i] - 1]; const b = seeded[order[i + 1] - 1];
    pairings.push(random() < 0.5 ? { w: a.id, b: b.id, result: null } : { w: b.id, b: a.id, result: null });
  }
  return pairings;
}

function nextKnockoutRound(run, random) {
  const winners = run.rounds.at(-1).pairings.map(knockoutWinner);
  const pairings = [];
  for (let i = 0; i < winners.length; i += 2) {
    const [a, b] = [winners[i], winners[i + 1]];
    pairings.push(random() < 0.5 ? { w: a, b, result: null } : { w: b, b: a, result: null });
  }
  return pairings;
}

/** Still in a knockout: never lost a finished game. */
export function stillIn(run, id) {
  const last = run.rounds.at(-1);
  const p = last && pairingOf(last, id);
  return !!p && (p.result === null || knockoutWinner(p) === id);
}

/* ----------------------------------------------------------- the rounds -- */

/** The game the player has to play next, or null. */
export function playerGame(run) {
  if (run.completed) return null;
  if (run.stage === 'final') {
    return run.final?.playerIn ? { final: true, colour: run.final.w === YOU ? 'w' : 'b', opponent: run.star } : null;
  }
  const p = pairingOf(run.rounds[run.round], YOU);
  if (!p || p.result !== null) return null;
  const oppId = p.w === YOU ? p.b : p.w;
  return { final: false, colour: p.w === YOU ? 'w' : 'b', opponent: playerById(run, oppId), roundIndex: run.round };
}

function simulateRound(run, round, random) {
  for (const p of round.pairings) {
    if (p.result !== null) continue;
    p.result = simulateGame(playerById(run, p.w).elo, playerById(run, p.b).elo, random);
    p.simulated = true;
  }
}

function openFinal(run, challengerId, random) {
  const playerIn = challengerId === YOU;
  const starWhite = random() < 0.5;
  run.final = { w: starWhite ? run.star.id : challengerId, b: starWhite ? challengerId : run.star.id, result: null, playerIn };
  run.stage = 'final';
  if (!playerIn) {
    // The player is out: the final still happens, between the NPCs.
    const eloOf = (id) => (id === run.star.id ? run.star.elo : playerById(run, id).elo);
    run.final.result = simulateGame(eloOf(run.final.w), eloOf(run.final.b), random);
    run.final.simulated = true;
    finish(run);
  }
}

function finish(run) {
  run.stage = 'done';
  run.completed = true;
}

/**
 * Record the player's game (score 1 / 0.5 / 0 for the PLAYER), play every
 * other game of the round, and move the event on.
 * @returns {{stage:string, outcome:string|null, eliminated:boolean, toFinal:boolean}}
 */
export function recordPlayerGame(run, score, random = Math.random) {
  if (run.completed) return { stage: run.stage, outcome: run.outcome, eliminated: false, toFinal: false };
  const rounds = TOURNAMENT.rounds;

  if (run.stage === 'final') {
    const f = run.final;
    f.result = f.w === YOU ? score : 1 - score;
    run.outcome = score === 1 ? 'champion' : 'runner-up';
    run.place = score === 1 ? 1 : 2;
    finish(run);
    return { stage: run.stage, outcome: run.outcome, eliminated: false, toFinal: false };
  }

  const current = run.rounds[run.round];
  const mine = pairingOf(current, YOU);
  mine.result = mine.w === YOU ? score : 1 - score;
  simulateRound(run, current, random);

  if (run.format === 'swiss') {
    if (run.round < rounds - 1) {
      run.round += 1;
      run.rounds.push({ pairings: pairSwiss(run, random) });
      return { stage: run.stage, outcome: null, eliminated: false, toFinal: false };
    }
    const table = standings(run);
    const me = table.find((r) => r.id === YOU);
    if (me.rank === 1) {
      openFinal(run, YOU, random);
      return { stage: run.stage, outcome: null, eliminated: false, toFinal: true };
    }
    run.outcome = 'placed';
    run.place = me.rank;
    openFinal(run, table[0].id, random);
    return { stage: run.stage, outcome: run.outcome, eliminated: false, toFinal: false };
  }

  // Knockout.
  const through = knockoutWinner(mine) === YOU;
  if (!through) {
    run.outcome = 'eliminated';
    run.place = run.rounds[run.round].pairings.length * 2;   // "last 32", "last 16", ...
    // Play the rest of the bracket out, so the event has a real winner.
    while (run.round < rounds - 1) {
      run.round += 1;
      run.rounds.push({ pairings: nextKnockoutRound(run, random) });
      simulateRound(run, run.rounds[run.round], random);
    }
    openFinal(run, knockoutWinner(run.rounds.at(-1).pairings[0]), random);
    return { stage: run.stage, outcome: run.outcome, eliminated: true, toFinal: false };
  }
  if (run.round < rounds - 1) {
    run.round += 1;
    run.rounds.push({ pairings: nextKnockoutRound(run, random) });
    return { stage: run.stage, outcome: null, eliminated: false, toFinal: false };
  }
  openFinal(run, YOU, random);
  return { stage: run.stage, outcome: null, eliminated: false, toFinal: true };
}

/** The knockout round the player lost in, or -1. */
export function exitRound(run) {
  return run.rounds.findIndex((r) => {
    const p = pairingOf(r, YOU);
    return p && p.result !== null && knockoutWinner(p) !== YOU;
  });
}

/** The player's tournament points so far (a knockout counts games won through). */
export function playerPoints(run) {
  if (run.format === 'swiss') return swissPoints(run, YOU);
  let pts = 0;
  for (const r of run.rounds) {
    const p = pairingOf(r, YOU);
    if (p && p.result !== null) pts += pointsFor(p, YOU);
  }
  return pts;
}

/** Every finished game in a round, for the round report. */
export function roundResults(run, index) {
  const round = run.rounds[index];
  if (!round) return [];
  return round.pairings.map((p) => ({
    white: playerById(run, p.w), black: playerById(run, p.b), result: p.result,
    through: run.format === 'knockout' ? knockoutWinner(p) : null, mine: p.w === YOU || p.b === YOU
  }));
}

/** "Last 16", "Quarter-final"... for a knockout round index. */
export function knockoutRoundName(run, index) {
  const left = run.players.length / 2 ** index;
  return left === 2 ? 'Bracket final' : left === 4 ? 'Semi-finals' : left === 8 ? 'Quarter-finals' : `Last ${left}`;
}

export default {
  YOU, outcomeOdds, simulateGame, createEvent, pairSwiss, standings, swissPoints, bracketOrder, knockoutWinner,
  stillIn, playerGame, recordPlayerGame, playerPoints, roundResults, knockoutRoundName, playerById
};
