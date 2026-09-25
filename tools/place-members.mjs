#!/usr/bin/env node
/**
 * place-members.mjs - stand every club member somewhere sensible.
 *
 *   node tools/place-members.mjs          writes js/data/memberSpots.js
 *
 * For each member's scene (members.js `where`) it bakes the same walk grid the
 * game uses (js/core/freeWalk.js, at the scene's own character size) and picks
 * a spot that is:
 *   - on free floor, with free floor just in front of it (where the player
 *     stands to talk),
 *   - reachable from the scene's spawn,
 *   - clear of every hotspot, spawn point and existing NPC, and of the other
 *     members, by distances measured in character heights,
 *   - low enough that the name label above the head stays on the art.
 * Choices are seeded, so a re-run gives the same room. A member can be pinned
 * by hand with PINS below (scene percent), which wins over the search.
 */

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLUBS } from '../js/data/clubs.js';
import { MEMBERS } from '../js/data/members.js';
import { SCENES } from '../js/data/scenes.js';
import { SCENE_LAYERS } from '../js/data/sceneLayers.js';
import { createWalkGrid, walkerFor } from '../js/core/freeWalk.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'js/data/memberSpots.js');

/* Hand placements: memberId -> [x, y]. */
const PINS = {
  // vie-venue's walk mask (2026-09-25) leaves the close-up cafe little open
  // floor: Can keeps the spot by the counter that the search can no longer fit.
  'vie-can': [67.85, 48]
};

function imageAspects() {
  const files = Object.values(SCENES).map((s) => path.join(ROOT, s.image));
  const out = execFileSync('python3', ['-c', `
import sys
from PIL import Image
for f in sys.argv[1:]:
    w, h = Image.open(f).size
    print(f, w / h)
`, ...files], { encoding: 'utf8' });
  const map = {};
  for (const line of out.trim().split('\n')) {
    const i = line.lastIndexOf(' ');
    map[line.slice(0, i)] = Number(line.slice(i + 1));
  }
  return Object.fromEntries(Object.values(SCENES).map((s) => [s.id, map[path.join(ROOT, s.image)]]));
}

let seed = 20260918;
const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

export function sceneFor(club, where) {
  if (where === 'up') return club.scenes.upstairs || club.scenes.interior;
  return { ext: club.scenes.exterior, int: club.scenes.interior, venue: club.scenes.venue }[where] || null;
}

function main() {
  const aspects = imageAspects();
  const spots = {};
  let total = 0;
  for (const club of CLUBS) {
    const byScene = {};
    for (const member of MEMBERS[club.clubId]) {
      if (!member.where) continue;
      const sceneId = sceneFor(club, member.where);
      (byScene[sceneId] = byScene[sceneId] || []).push(member);
    }
    for (const [sceneId, members] of Object.entries(byScene)) {
      const scene = SCENES[sceneId];
      const layers = SCENE_LAYERS[sceneId];
      if (!layers) throw new Error(`${sceneId}: no layers, cannot place members`);
      const aspect = aspects[sceneId];
      const actorH = scene.actorHeight ?? 0.1;
      const H = actorH * 100;                        // a character's height, in scene-height percent
      const grid = createWalkGrid(layers, { aspect, walker: walkerFor(actorH) });
      const dist = ([ax, ay], [bx, by]) => Math.hypot((ax - bx) * aspect, ay - by);
      const spawn = scene.nodes[scene.spawn.default];
      const avoid = [
        ...scene.hotspots.map((h) => ({ p: scene.nodes[h.node], r: H * 1.0 })),
        ...scene.hotspots.filter((h) => h.npc?.at).map((h) => ({ p: h.npc.at, r: H * 0.9 })),
        ...Object.values(scene.spawn).map((id) => ({ p: scene.nodes[id], r: H * 1.2 }))
      ];
      const placed = [];
      spots[sceneId] = spots[sceneId] || {};
      // The centre of the free floor, where people gather.
      let sx = 0; let sy = 0; let n = 0;
      for (let y = 5; y < 95; y += 2) for (let x = 5; x < 95; x += 2) if (grid.free(x, y)) { sx += x; sy += y; n += 1; }
      const centre = n ? [sx / n, sy / n] : [50, 60];
      const standOff = H * 0.35;
      const candidates = [];
      for (let y = Math.max(H + 6, 12); y <= 92; y += 0.75) {
        for (let x = 8; x <= 92; x += 0.75 / aspect * 1.33) {
          if (!grid.free(x, y)) continue;
          const stand = [x, Math.min(99, y + standOff)];
          if (!grid.free(...stand)) continue;
          if (avoid.some((a) => dist(a.p, [x, y]) < a.r)) continue;
          // A club garden's floor runs out onto the street: members stay inside the gate.
          if (scene.kind === 'exterior' && scene.nodes.gate && y > scene.nodes.gate[1] - H * 0.8) continue;
          // Open floor only: free all round, so nobody is wedged into a corner,
          // against a wall or on a thin strip of pavement. Half a body height,
          // but capped: in a close-up venue a body is a quarter of the picture
          // and half of one is wider than any real standing spot there.
          const ring = Math.min(H * 0.5, 6);
          let open = 0;
          for (let k = 0; k < 8; k += 1) {
            const t = (k / 8) * Math.PI * 2;
            if (grid.free(x + (Math.cos(t) * ring) / aspect, y + Math.sin(t) * ring * 0.6)) open += 1;
          }
          if (open < 5) continue;
          candidates.push({ p: [x, y], open });
        }
      }
      // Close-up scenes (big characters) have little fully open floor: relax there only.
      let need = 8;
      while (need > 4 && candidates.filter((c) => c.open >= need).length < members.length * 20) need -= 1;
      const pool = candidates.filter((c) => c.open >= need).map((c) => c.p);
      for (const member of members) {
        let at = PINS[member.id] || null;
        if (!at) {
          /* Spread out: as far as possible from the other members and the
             hotspots. Candidates are already open floor (see above), which is
             what keeps this from sending everyone into the corners; the
             centre only breaks near-ties. */
          /* A close-up scene with little floor (vie-venue's walk mask) may not
             fit everyone a body apart: only then close the gap, a step at a time. */
          let pick = null;
          for (const gap of [0.9, 0.7, 0.55]) {
            const ranked = [];
            for (const c of pool) {
              if (placed.some((p) => dist(p, c) < H * gap)) continue;
              const near = Math.min(...placed.map((p) => dist(p, c)), ...avoid.map((a) => dist(a.p, c) - a.r + H), 60);
              ranked.push({ c, score: near * (0.85 + 0.15 * random()) - dist(c, centre) * 0.05 });
            }
            ranked.sort((a, b) => b.score - a.score);
            // Floor islands the player cannot reach (behind a counter) are skipped.
            pick = ranked.find(({ c }) => grid.path(spawn, grid.nearestFree(c[0], Math.min(99, c[1] + standOff)) || c));
            if (pick) break;
          }
          if (!pick) throw new Error(`${sceneId}: no room left for ${member.id}`);
          at = pick.c;
        }
        const stand = grid.nearestFree(at[0], Math.min(99, at[1] + standOff)) || at;
        if (!grid.path(spawn, stand)) throw new Error(`${sceneId}: ${member.id} unreachable`);
        placed.push(at);
        const dir = at[0] < 35 ? 'right' : at[0] > 65 ? 'left' : 'down';
        spots[sceneId][member.id] = { at: at.map((v) => +v.toFixed(2)), stand: stand.map((v) => +v.toFixed(2)), dir };
        total += 1;
      }
    }
  }
  const body = `/**
 * memberSpots.js - GENERATED by tools/place-members.mjs. Do not edit by hand:
 * pin a member in that tool's PINS instead.
 *
 * sceneId -> memberId -> { at: where they stand, stand: where the player
 * stands to talk to them, dir: which way they face }. Percent of the scene.
 */
export const MEMBER_SPOTS = ${JSON.stringify(spots, null, 1)};

export default MEMBER_SPOTS;
`;
  writeFileSync(OUT, body);
  console.log(`placed ${total} members in ${Object.keys(spots).length} scenes -> ${path.relative(ROOT, OUT)}`);
}

main();
