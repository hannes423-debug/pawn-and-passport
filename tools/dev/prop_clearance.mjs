/**
 * tools/dev/prop_clearance.mjs - can the player stand inside the furniture?
 *
 *   node tools/dev/prop_clearance.mjs [scene ...]
 *   node tools/dev/prop_clearance.mjs --json      machine-readable
 *
 * tools/dev/audit_layers.py draws the walk grid against the FOOTPRINTS we
 * declared. This checks the footprints themselves, against the ART: every prop
 * is its own PNG, so the pixels where it meets the floor are known exactly,
 * and no walkable cell should sit among them.
 *
 * For each prop it takes the bottom BASE_BAND of the drawing's opaque pixels -
 * the part that rests on the ground, not the back of a chair or the leaves of
 * a plant, which a character may legitimately be drawn in front of - and asks
 * js/core/freeWalk.js whether those points are walkable. Anything over a few
 * percent means the footprint is missing, too small, or in the wrong place,
 * and the player will walk through that piece of furniture.
 *
 * A prop the player is MEANT to walk over (a rug, a floor inlay) has no
 * business being a prop with a foot; those are painted into the background.
 */
import { SCENE_LAYERS } from '../../js/data/sceneLayers.js';
import { createWalkGrid, walkerFor } from '../../js/core/freeWalk.js';
import { sceneById } from '../../js/data/scenes.js';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sizes = JSON.parse(readFileSync(path.join(ROOT, 'assets/manifest.json'), 'utf8')).scenes;

/**
 * How far up from a prop's lowest pixel counts as "touching the floor", in
 * percent of the SCENE height - an ankle, not a share of the object. A share
 * would scale with the object: 22% of a tall lamp is most of its post, which
 * is thin and stands well clear of its own base, so every lamp in the game
 * looked like a failure while its base blocked perfectly well.
 */
const BASE_BAND_PCT = 1.5;
/** Report a prop when more than this share of its base pixels are walkable. */
const TOLERANCE = 0.05;
/**
 * ...but only FAIL over --fail-over (percent). A prop with no footprint at all
 * measures near 100; the ones left in the 10-46% band are a lamp's flared base
 * or an armchair's arm sticking past the rect that blocks it, which is the
 * ordinary overlap of a three-quarter view and not "I walked through the
 * furniture". tools/predeploy.sh runs this at 50.
 */
const failOver = Number((process.argv.find((a) => a.startsWith('--fail-over=')) || '').split('=')[1]);

/* --- a minimal PNG alpha reader (no dependencies; these are all RGBA/8-bit) --- */
function pngAlpha(file) {
  const buf = readFileSync(file);
  let pos = 8;
  let w = 0; let h = 0; let depth = 0; let colour = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; colour = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += len + 12;
  }
  if (depth !== 8 || colour !== 6) throw new Error(`${path.basename(file)}: need 8-bit RGBA, got depth ${depth} colour ${colour}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = raw[p]; p += 1;
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = i >= bpp && prev ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
  }
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) alpha[i] = out[i * 4 + 3];
  return { w, h, alpha };
}

/* The props tools/build_layers.py marks OVER: the player walks under or
   behind them on purpose (an archway, a hanging sign, a wall banner, and a
   handful of decorations that stand in a passage the level cannot spare).
   Read from the generator so the two can never drift apart. */
function overhead() {
  const src = readFileSync(path.join(ROOT, 'tools', 'build_layers.py'), 'utf8');
  const out = new Set();
  let scene = null;
  for (const line of src.split('\n')) {
    const head = line.match(/^ {4}'([a-z-]+)': \{/);
    if (head) { scene = head[1]; continue; }
    const prop = line.match(/^ *\('([a-z0-9-]+)', \([^)]*\), [0-9.]+, OVER\)/);
    if (prop && scene) out.add(`${scene}/${prop[1]}`);
  }
  return out;
}
const OVERHEAD = overhead();

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const asJson = process.argv.includes('--json');
const report = [];

for (const [id, layers] of Object.entries(SCENE_LAYERS)) {
  if (only.length && !only.includes(id)) continue;
  const scene = sceneById(id);
  const size = sizes[id];
  if (!scene || !size) continue;
  const aspect = size[0] / size[1];
  const grid = createWalkGrid(layers, { aspect, walker: walkerFor(scene.actorHeight ?? 0.1) });
  for (const prop of layers.props || []) {
    if (OVERHEAD.has(`${id}/${prop.id}`)) continue;   // walk-through on purpose
    const file = path.join(ROOT, prop.src);
    if (!existsSync(file)) continue;
    let img;
    try { img = pngAlpha(file); } catch { continue; }
    // Opaque bounding box, in the prop image's own pixels.
    let minY = img.h; let maxY = -1;
    for (let y = 0; y < img.h; y += 1) {
      for (let x = 0; x < img.w; x += 1) {
        if (img.alpha[y * img.w + x] > 32) { if (y < minY) minY = y; if (y > maxY) maxY = y; break; }
      }
    }
    if (maxY < 0) continue;
    // The band, converted from scene percent into this prop image's own rows.
    const rowsPerPct = img.h / prop.h;
    const bandTop = maxY - Math.max(1, Math.round(BASE_BAND_PCT * rowsPerPct));
    let total = 0; let walkable = 0;
    for (let y = Math.max(minY, bandTop); y <= maxY; y += 1) {
      for (let x = 0; x < img.w; x += 1) {
        if (img.alpha[y * img.w + x] <= 32) continue;
        total += 1;
        const sx = prop.x + (x / img.w) * prop.w;
        const sy = prop.y + (y / img.h) * prop.h;
        if (grid.free(sx, sy)) walkable += 1;
      }
    }
    if (!total) continue;
    const share = walkable / total;
    if (share > TOLERANCE) {
      report.push({ scene: id, prop: prop.id, share: +(share * 100).toFixed(1), foot: prop.foot, base: prop.base });
    }
  }
}

report.sort((a, b) => b.share - a.share || a.scene.localeCompare(b.scene));
if (asJson) {
  console.log(JSON.stringify(report, null, 1));
} else if (!report.length) {
  console.log('every prop base is solid');
} else {
  console.log(`${report.length} prop(s) the player can stand inside:\n`);
  let scene = null;
  for (const r of report) {
    if (r.scene !== scene) { scene = r.scene; console.log(`  ${scene}`); }
    console.log(`    ${r.prop.padEnd(18)} ${String(r.share).padStart(5)}% of its base is walkable   foot=${JSON.stringify(r.foot)}`);
  }
}
if (!Number.isFinite(failOver)) process.exit(report.length ? 1 : 0);
const bad = report.filter((r) => r.share > failOver);
if (bad.length) console.error(`\n${bad.length} prop(s) over ${failOver}% - they block nothing at all`);
process.exit(bad.length ? 1 : 0);
