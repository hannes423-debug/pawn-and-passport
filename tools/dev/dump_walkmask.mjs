/**
 * tools/dev/dump_walkmask.mjs - dump each scene's walkable mask for the audit.
 *
 *   node tools/dev/dump_walkmask.mjs <outDir> [scene ...]
 *
 * Writes <outDir>/<scene>.pgm (P5, 0 = blocked, 255 = walkable) straight from
 * js/core/freeWalk.js, so the picture tools/dev/audit_layers.py draws is the
 * grid the GAME walks on, not a second implementation of it.
 */
import { SCENE_LAYERS } from '../../js/data/sceneLayers.js';
import { createWalkGrid, walkerFor } from '../../js/core/freeWalk.js';
import { sceneById } from '../../js/data/scenes.js';
import { SCENES } from '../../js/data/scenes.js';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = process.argv[2] || path.join(ROOT, 'tools', 'shots', 'collision');
const only = process.argv.slice(3);
mkdirSync(outDir, { recursive: true });
const sizes = JSON.parse(readFileSync(path.join(ROOT, 'assets/manifest.json'), 'utf8')).scenes;

const meta = {};
for (const [id, layers] of Object.entries(SCENE_LAYERS)) {
  if (only.length && !only.includes(id)) continue;
  const scene = sceneById(id);
  const [w, h] = sizes[id];
  const aspect = w / h;
  const walker = walkerFor(scene.actorHeight ?? 0.1);
  const grid = createWalkGrid(layers, { aspect, walker });
  const head = Buffer.from(`P5\n${grid.cols} ${grid.rows}\n255\n`, 'ascii');
  const body = Buffer.alloc(grid.cols * grid.rows);
  for (let k = 0; k < body.length; k += 1) body[k] = grid.cells[k] ? 255 : 0;
  writeFileSync(path.join(outDir, `${id}.pgm`), Buffer.concat([head, body]));
  // Spawns and hotspots, so the audit can show what must stay reachable.
  const nodes = {};
  for (const [name, node] of Object.entries(scene.spawn)) nodes[`spawn:${name}`] = scene.nodes[node];
  for (const s of scene.hotspots) nodes[`spot:${s.id}`] = scene.nodes[s.node];
  meta[id] = { aspect, walker, cols: grid.cols, rows: grid.rows, nodes };
}
writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`${Object.keys(meta).length} scene(s) -> ${outDir}`);
void SCENES;
