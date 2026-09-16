#!/usr/bin/env node
/**
 * check-lines.mjs - does every line in js/data/openings.js follow what the
 * researched games actually play? Flags any move chosen by under MIN_SHARE of
 * the games that reached its position (when at least MIN_GAMES reached it),
 * and shows what those games preferred.
 *
 *   node tools/opening-research/check-lines.mjs
 */
import { readFileSync } from 'node:fs';
import { OPENINGS } from '../../js/data/openings.js';

const MIN_SHARE = 0.10;
/* Deliberate sidelines: the move that leaves the main road is rare in SHARE
   but common in absolute games (hundreds each), or a club-level classic.
   openingId:lineIndex:ply */
const SIDELINES = new Set([
  'london:8:3',    // 1...Nf6 2.Bf4 c5: 8% of 632
  'vienna:10:4',   // 3.f4 against 2...Nc6: the club-level Hamppe-Allgaier
  'sicilian:6:9',  // the Dragon: 385 games
  'sicilian:19:2', 'sicilian:20:2', // the Alapin: 1,238 games
  'sicilian:21:2', 'sicilian:22:2', // 2.Nc3: 1,616 games
  'caro:13:4',     // the Fantasy: 244 games
  'french:15:4',   // the Exchange: 510 games
  'french:16:5'    // the Rubinstein: 290 games
]);
const MIN_GAMES = 40;
const data = JSON.parse(readFileSync(new URL('tree.json', import.meta.url), 'utf8'));
let flags = 0;
for (const o of OPENINGS) {
  o.lines.forEach((line, i) => {
    let node = data.trees[o.id];
    for (let ply = 0; ply < line.length && node; ply += 1) {
      const total = Object.values(node).reduce((s, c) => s + c.n, 0);
      const mine = node[line[ply]];
      const share = mine ? mine.n / total : 0;
      if (total >= MIN_GAMES && share < MIN_SHARE && !SIDELINES.has(`${o.id}:${i}:${ply}`)) {
        const top = Object.entries(node).sort((a, b) => b[1].n - a[1].n).slice(0, 4).map(([s, c]) => `${s} ${Math.round(100 * c.n / total)}%`).join(', ');
        console.log(`${o.id} ${i} "${o.lineNames[i]}" ply ${ply} ${line[ply]}: ${Math.round(share * 100)}% of ${total}. Played: ${top}`);
        flags += 1;
      }
      node = mine?.c;
    }
  });
}
console.log(`${flags} flag(s)`);
process.exitCode = flags ? 1 : 0;
