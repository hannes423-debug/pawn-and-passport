/**
 * tools/dev/clearance.mjs - where does the walker's body not fit?
 *
 *   node tools/dev/clearance.mjs [scene ...]
 *
 * Erosion always trims a thin band along every wall - that is the point of it,
 * and it is not a defect. What IS a defect is floor the walker can stand on but
 * can never walk to: an ISLAND cut off from the spawn by a passage too narrow
 * for a body. This prints those islands as percent-space boxes, biggest first,
 * plus anything required (spawns, hotspot nodes, member spots) left unreachable.
 */
import { SCENE_LAYERS } from '../../js/data/sceneLayers.js';
import { createWalkGrid, walkerFor } from '../../js/core/freeWalk.js';
import { sceneById } from '../../js/data/scenes.js';
import { MEMBER_SPOTS } from '../../js/data/memberSpots.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sizes = JSON.parse(readFileSync(path.join(ROOT, 'assets/manifest.json'), 'utf8')).scenes;
const only = process.argv.slice(2);

function reach(grid, from) {
  const { cols, rows, cells } = grid;
  const cw = 100 / cols; const ch = 100 / rows;
  const seen = new Uint8Array(cols * rows);
  const start = grid.nearestFree(from[0], from[1]);
  if (!start) return { seen, cw, ch };
  const si = Math.floor(start[0] / cw); const sj = Math.floor(start[1] / ch);
  const stack = [sj * cols + si];
  seen[stack[0]] = 1;
  while (stack.length) {
    const n = stack.pop();
    const i = n % cols; const j = (n - i) / cols;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di; const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const m = nj * cols + ni;
      if (seen[m] || cells[m] !== 1) continue;
      seen[m] = 1; stack.push(m);
    }
  }
  return { seen, cw, ch };
}

/** Group lost cells into boxes, so the report is readable. */
function clump(lost, cols, rows, cw, ch) {
  const seen = new Uint8Array(cols * rows);
  const out = [];
  for (let n = 0; n < lost.length; n += 1) {
    if (!lost[n] || seen[n]) continue;
    const stack = [n]; seen[n] = 1;
    let x0 = 1e9; let y0 = 1e9; let x1 = -1e9; let y1 = -1e9; let area = 0;
    while (stack.length) {
      const c = stack.pop();
      const i = c % cols; const j = (c - i) / cols;
      area += 1;
      x0 = Math.min(x0, i * cw); x1 = Math.max(x1, (i + 1) * cw);
      y0 = Math.min(y0, j * ch); y1 = Math.max(y1, (j + 1) * ch);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di; const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const m = nj * cols + ni;
        if (!seen[m] && lost[m]) { seen[m] = 1; stack.push(m); }
      }
    }
    out.push({ area, box: [x0, y0, x1, y1] });
  }
  return out.sort((a, b) => b.area - a.area);
}

/* A pocket this small is the inside of a ring of armchairs or the strip behind
   a display case: floor nobody can reach because furniture surrounds it, which
   is how a room looks. Anything bigger is a doorway a body no longer fits. */
const NOOK = 600;
/* Named exceptions, the same as tests/run.js: the strip behind lon-venue's
   telephone box is standable in the walk mask but has no way round the box. */
const NOOK_FOR = { 'lon-venue': 1200 };
let problems = 0;
let failures = 0;
for (const [id, layers] of Object.entries(SCENE_LAYERS)) {
  if (only.length && !only.includes(id)) continue;
  const scene = sceneById(id);
  const [w, h] = sizes[id];
  const aspect = w / h;
  const walker = walkerFor(scene.actorHeight ?? 0.1);
  const body = createWalkGrid(layers, { aspect, walker });
  const from = scene.nodes[scene.spawn.default];
  const b = reach(body, from);
  const lost = new Uint8Array(body.cells.length);
  for (let n = 0; n < lost.length; n += 1) lost[n] = body.cells[n] === 1 && !b.seen[n] ? 1 : 0;
  const clumps = clump(lost, body.cols, body.rows, b.cw, b.ch).filter((c) => c.area > 25);
  const limit = NOOK_FOR[id] ?? NOOK;
  const tooBig = clumps.filter((c) => c.area > limit);

  const needed = [];
  for (const [name, node] of Object.entries(scene.spawn)) needed.push([`spawn:${name}`, scene.nodes[node]]);
  for (const s of scene.hotspots) needed.push([`spot:${s.id}`, scene.nodes[s.node]]);
  for (const [mid, spot] of Object.entries(MEMBER_SPOTS[id] || {})) needed.push([`member:${mid}`, spot.stand || spot.at]);
  const unreachable = needed.filter(([, p]) => !body.path(from, p));

  if (!clumps.length && !unreachable.length) continue;
  problems += 1;
  if (tooBig.length || unreachable.length) failures += 1;
  console.log(`\n${id}  (walker pad ${(walker.halfWidth / aspect).toFixed(2)} x ${walker.halfDepth.toFixed(2)})`);
  for (const [name] of unreachable) console.log(`   UNREACHABLE  ${name}`);
  for (const c of clumps.slice(0, 6)) {
    const mark = c.area > limit ? 'ISLAND' : 'nook  ';
    console.log(`   ${mark} ${String(c.area).padStart(5)} cells  box [${c.box.map((v) => v.toFixed(1)).join(', ')}]`);
  }
}
if (!failures) {
  console.log(problems
    ? `\nevery scene: everything reachable; ${problems} scene(s) have furniture nooks, which is fine`
    : '\nevery scene: all walkable floor is reachable from the spawn');
} else {
  console.log(`\n${failures} scene(s) with a doorway a body cannot fit through, or an unreachable target`);
}
process.exit(failures ? 1 : 0);
