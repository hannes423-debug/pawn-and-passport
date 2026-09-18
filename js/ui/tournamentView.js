/**
 * tournamentView.js - how a club tournament looks: the Swiss standings, the
 * knockout bracket's current round, one round's results. Used by the
 * tournament desk (scene.js) and the report after every tournament game
 * (match.js). Reads js/core/tournament.js, changes nothing.
 */

import { h } from './dom.js';
import { TOURNAMENT } from '../data/config.js';
import { YOU, standings, roundResults, knockoutRoundName, stillIn, playerPoints } from '../core/tournament.js';

const fmt = (points) => (points % 1 ? `${Math.floor(points)}½` : String(points)).replace(/^0½$/, '½');

/** "1-0", "½-½", "0-1" from White's side. */
const score = (result) => (result === 1 ? '1-0' : result === 0 ? '0-1' : result === 0.5 ? '½-½' : 'vs');

export function formatBlurb(run, starName) {
  return run.format === 'swiss'
    ? `Swiss: ${run.players.length} players, ${TOURNAMENT.rounds} rounds, everyone plays every round. Finish first and you meet ${starName} in the final.`
    : `Knockout: ${run.players.length} players, ${TOURNAMENT.rounds} rounds, one loss and you are out. A drawn game goes to Black. Win the bracket and you meet ${starName} in the final.`;
}

export function roundLabel(run, index) {
  if (index >= TOURNAMENT.rounds) return 'Final';
  return run.format === 'knockout' ? knockoutRoundName(run, index) : `Round ${index + 1}`;
}

/** The Swiss table. `limit` rows around the top, plus the player's own row. */
export function standingsTable(run, { limit = 16 } = {}) {
  const rows = standings(run);
  const shown = rows.filter((r, i) => i < limit || r.id === YOU);
  return h('table.pp-standings', null,
    h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Player' }), h('th', { text: 'Elo' }), h('th', { text: 'Pts' }), h('th', { text: 'Buch.' }))),
    h('tbody', null, shown.map((r) => h('tr', { class: r.id === YOU ? 'is-you' : '' },
      h('td', { text: r.rank }), h('td', { text: r.id === YOU ? `${r.name} (you)` : r.name }),
      h('td', { text: r.elo }), h('td', { text: fmt(r.points) }), h('td', { text: fmt(r.buchholz) })))));
}

/** One round's games, the player's first. */
export function resultsList(run, index) {
  const games = roundResults(run, index).sort((a, b) => Number(b.mine) - Number(a.mine));
  return h('ul.pp-results', null, games.map((g) => {
    const name = (p) => (p.id === YOU ? `${p.name} (you)` : p.name);
    const through = g.through ? (g.through === g.white.id ? 'w' : 'b') : null;
    return h('li', { class: g.mine ? 'is-you' : '' },
      h('span', { class: through === 'w' ? 'is-through' : '' }, name(g.white), h('small', { text: ` ${g.white.elo}` })),
      h('b', { text: score(g.result) }),
      h('span', { class: through === 'b' ? 'is-through' : '' }, name(g.black), h('small', { text: ` ${g.black.elo}` })));
  }));
}

/** The final, as a line: who meets the Star Player, and how it went. */
export function finalLine(run) {
  const f = run.final;
  if (!f) return null;
  const nameOf = (id) => (id === run.star.id ? `★ ${run.star.name}` : id === YOU ? 'You' : run.players.find((p) => p.id === id)?.name);
  return h('p.pp-small', null, h('b', { text: 'Final: ' }), `${nameOf(f.w)} ${score(f.result)} ${nameOf(f.b)}`);
}

/** The whole event at a glance, for the tournament desk. */
export function eventView(run) {
  const latest = run.rounds.length - 1;
  const parts = [];
  if (run.format === 'swiss') {
    parts.push(h('div.pp-event__scroll', null, standingsTable(run)));
  } else {
    const still = run.players.filter((p) => stillIn(run, p.id)).length;
    parts.push(h('p.pp-small', null, h('b', { text: roundLabel(run, latest) }), run.completed ? '' : ` · ${still} still in`,
      stillIn(run, YOU) ? ' · you are through so far' : ''));
    parts.push(h('div.pp-event__scroll', null, resultsList(run, latest)));
  }
  parts.push(finalLine(run));
  parts.push(h('p.pp-small.pp-muted', { text: `Your points: ${fmt(playerPoints(run))}` }));
  return h('div.pp-event', null, parts.filter(Boolean));
}

/** What happened in the round the player just played, then where they stand. */
export function roundReport(run, index) {
  const parts = [h('h3.pp-h3', { text: `${roundLabel(run, index)}: results` })];
  if (index < run.rounds.length) parts.push(h('div.pp-event__scroll', null, resultsList(run, index)));
  if (run.format === 'swiss' && index < TOURNAMENT.rounds) {
    parts.push(h('h3.pp-h3', { text: 'Standings' }), h('div.pp-event__scroll', null, standingsTable(run, { limit: 5 })));
  }
  parts.push(finalLine(run));
  return h('div.pp-event', null, parts.filter(Boolean));
}

export default { formatBlurb, roundLabel, standingsTable, resultsList, finalLine, eventView, roundReport };
