/**
 * sprites.js - every character in the game: drawn sheets, procedural fallback.
 *
 * Two kinds of character, one API:
 *
 *   look.sprite = 'boy' | 'girl-red' | ...   a drawn sprite sheet from
 *       assets/characters/ (sliced by tools/build_characters.py): 12 columns
 *       (0-3 idle, 4-11 walk) x 4 rows (down, left, right, up), 72x108 cells.
 *   no sprite                                 the procedural 16x24 fallback,
 *       painted from the look's colours. Kept so a missing sheet degrades
 *       to a character instead of a hole.
 *
 * Sheets are preloaded once at boot (loadCharacterSprites) so every draw and
 * portrait below can stay synchronous.
 */

const W = 16;
const H = 24;
const OUTLINE = '#1b1420';
const SHOE = '#2b2226';
const EYE = '#1b1420';

export const PLAYER_LOOKS = Object.freeze({
  boy: { sprite: 'boy', skin: '#e8b98f', hair: '#5a3620', hairStyle: 'short', top: '#3d7fd9', bottom: '#2f3a52', accent: '#f3c34a' },
  girl: { sprite: 'girl', skin: '#e8b98f', hair: '#7a3b1e', hairStyle: 'ponytail', top: '#3d7fd9', bottom: '#2f3a52', accent: '#f3c34a', skirt: true }
});

/* ------------------------------------------------------- drawn sheets -- */

export const CELL = Object.freeze({ W: 72, H: 108, idle: 4, walk: 8 });
const ROW = { down: 0, left: 1, right: 2, up: 3 };
const images = new Map();

/** Load every sheet named in assets/characters/manifest.json. Never rejects. */
export async function loadCharacterSprites(base = 'assets/characters/') {
  let ids = [];
  try {
    const manifest = await fetch(`${base}manifest.json`).then((r) => r.json());
    ids = Object.keys(manifest.sprites || {});
  } catch { return images; }
  await Promise.all(ids.map((id) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { images.set(id, img); resolve(); };
    img.onerror = () => resolve();
    img.src = `${base}${id}.png`;
  })));
  return images;
}

export const hasSheet = (look) => !!(look?.sprite && images.get(look.sprite));

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function grid() { return Array.from({ length: H }, () => new Array(W).fill(null)); }

function paint(g, x, y, w, h, colour) {
  for (let j = y; j < y + h; j += 1) for (let i = x; i < x + w; i += 1) {
    if (i >= 0 && i < W && j >= 0 && j < H) g[j][i] = colour;
  }
}

function outline(g) {
  const out = g.map((row) => row.slice());
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (g[y][x]) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx]);
    if (near) out[y][x] = OUTLINE;
  }
  return out;
}

/** One pose. dir: 'down' | 'left' | 'right' | 'up'; frame 0..2. */
function pose(look, dir, frame) {
  const g = grid();
  const skin = look.skin;
  const hair = look.hair;
  const top = look.top;
  const topDark = shade(top, -38);
  const bottom = look.bottom;
  const side = dir === 'left' || dir === 'right';
  const stride = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  const bob = frame === 0 ? 0 : 1;

  // Legs and shoes (drawn first so the torso overlaps).
  if (look.skirt) paint(g, 4, 17, 8, 3, bottom);
  if (side) {
    paint(g, 6, 18, 2, 4 + Math.max(0, stride), bottom);
    paint(g, 8, 18, 2, 4 + Math.max(0, -stride), shade(bottom, -20));
    paint(g, 5 + (stride > 0 ? -1 : 0), 22 + Math.max(0, stride) - 1, 3, 2, SHOE);
    paint(g, 8 + (stride < 0 ? 1 : 0), 22 + Math.max(0, -stride) - 1, 3, 2, SHOE);
  } else {
    paint(g, 5, 18, 2, 4 + (stride > 0 ? 0 : -1 * (stride !== 0)), bottom);
    paint(g, 9, 18, 2, 4 + (stride < 0 ? 0 : -1 * (stride !== 0)), bottom);
    if (look.skirt) { paint(g, 5, 18, 2, 3, skin); paint(g, 9, 18, 2, 3, skin); }
    paint(g, 4, 21 + (stride > 0 ? 1 : 0), 3, 2, SHOE);
    paint(g, 9, 21 + (stride < 0 ? 1 : 0), 3, 2, SHOE);
  }

  const y0 = bob;
  // Torso.
  if (side) {
    paint(g, 5, 10 + y0, 6, 8, top);
    paint(g, 5, 16 + y0, 6, 2, topDark);
    // One arm swinging.
    const armX = dir === 'left' ? 7 + stride : 8 - stride;
    paint(g, armX, 11 + y0, 2, 5, topDark);
    paint(g, armX, 16 + y0, 2, 1, skin);
  } else {
    paint(g, 4, 10 + y0, 8, 8, top);
    paint(g, 4, 16 + y0, 8, 2, topDark);
    paint(g, 3, 11 + y0 + (stride > 0 ? 1 : 0), 1, 5, topDark);
    paint(g, 12, 11 + y0 + (stride < 0 ? 1 : 0), 1, 5, topDark);
    paint(g, 3, 16 + y0 + (stride > 0 ? 1 : 0), 1, 1, skin);
    paint(g, 12, 16 + y0 + (stride < 0 ? 1 : 0), 1, 1, skin);
    if (look.accent && dir === 'down') paint(g, 7, 11 + y0, 2, 2, look.accent);
  }

  // Head.
  paint(g, 4, 2 + y0, 8, 8, skin);
  paint(g, 7, 10 + y0, 2, 1, shade(skin, -30));

  // Hair by style.
  const style = look.hairStyle || 'short';
  if (style !== 'bald') paint(g, 4, 1 + y0, 8, 3, hair);
  if (style === 'bald') { paint(g, 4, 3 + y0, 1, 3, hair); paint(g, 11, 3 + y0, 1, 3, hair); }
  if (dir === 'up') {
    if (style !== 'bald') paint(g, 4, 1 + y0, 8, 8, hair);
  } else if (side) {
    const back = dir === 'left' ? 9 : 4;
    if (style !== 'bald') paint(g, back, 2 + y0, 3, 6, hair);
  } else if (style !== 'bald') {
    paint(g, 4, 2 + y0, 1, 4, hair);
    paint(g, 11, 2 + y0, 1, 4, hair);
  }
  if (style === 'long' || style === 'braid') {
    if (dir === 'up') paint(g, 4, 8 + y0, 8, 4, hair);
    else if (side) paint(g, dir === 'left' ? 9 : 4, 7 + y0, 3, 5, hair);
    else { paint(g, 3, 4 + y0, 2, 8, hair); paint(g, 11, 4 + y0, 2, 8, hair); }
  }
  if (style === 'ponytail') {
    if (dir === 'up') paint(g, 7, 8 + y0, 2, 5, hair);
    else if (side) paint(g, dir === 'left' ? 12 : 2, 3 + y0, 2, 6, hair);
    else paint(g, 11, 2 + y0, 2, 3, hair);
  }
  if (style === 'bun') paint(g, 6, 0 + y0, 4, 2, hair);
  if (style === 'bob') {
    if (!side && dir !== 'up') { paint(g, 3, 3 + y0, 2, 6, hair); paint(g, 11, 3 + y0, 2, 6, hair); }
    else if (dir === 'up') paint(g, 3, 3 + y0, 10, 6, hair);
    else paint(g, dir === 'left' ? 9 : 3, 2 + y0, 4, 7, hair);
  }
  if (style === 'curly') {
    paint(g, 3, 0 + y0, 10, 3, hair);
    if (!side && dir !== 'up') { paint(g, 3, 3 + y0, 1, 4, hair); paint(g, 12, 3 + y0, 1, 4, hair); }
  }

  // Face.
  if (dir === 'down') {
    paint(g, 6, 5 + y0, 1, 2, EYE);
    paint(g, 9, 5 + y0, 1, 2, EYE);
    paint(g, 7, 8 + y0, 2, 1, shade(skin, -45));
  } else if (side) {
    paint(g, dir === 'left' ? 5 : 10, 5 + y0, 1, 2, EYE);
    paint(g, dir === 'left' ? 3 : 12, 6 + y0, 1, 2, skin);   // nose
  }
  return outline(g);
}

const cache = new Map();

/** @returns {HTMLCanvasElement} 3 frames x 4 rows at 1 pixel per grid cell */
export function characterSheet(look) {
  const key = JSON.stringify(look);
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = W * 3; canvas.height = H * 4;
  const c = canvas.getContext('2d');
  ['down', 'left', 'right', 'up'].forEach((dir, row) => {
    for (let frame = 0; frame < 3; frame += 1) {
      const g = pose(look, dir, frame);
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
        if (!g[y][x]) continue;
        c.fillStyle = g[y][x];
        c.fillRect(frame * W + x, row * H + y, 1, 1);
      }
    }
  });
  cache.set(key, canvas);
  return canvas;
}

export const SPRITE = Object.freeze({ W, H, rows: { down: 0, left: 1, right: 2, up: 3 } });

/**
 * Draw one frame of a character.
 * @param {Object} o
 * @param {'down'|'left'|'right'|'up'} o.dir
 * @param {number} o.frame    animation counter (wraps per animation)
 * @param {boolean} o.walking walk cycle instead of idle
 * @param {number} [o.height] target height in px (defaults to 24 x scale)
 */
export function drawCharacter(ctx, look, { dir = 'down', frame = 0, walking = false, x = 0, y = 0, scale = 3, height = null } = {}) {
  const h = height || SPRITE.H * scale;
  const w = Math.round(h * CELL.W / CELL.H);
  ctx.imageSmoothingEnabled = false;
  const sheet = hasSheet(look) ? images.get(look.sprite) : null;
  if (sheet) {
    // Downscaling a 108px cell with nearest-neighbour drops whole pixel rows
    // unevenly; smooth when shrinking, stay crisp when enlarging.
    ctx.imageSmoothingEnabled = h < CELL.H;
    ctx.imageSmoothingQuality = 'high';
    const col = walking ? CELL.idle + (frame % CELL.walk) : frame % CELL.idle;
    ctx.drawImage(sheet, col * CELL.W, ROW[dir] * CELL.H, CELL.W, CELL.H, x, y, w, h);
    return;
  }
  const procFrame = walking ? (frame % 2 ? 1 : 2) : 0;
  ctx.drawImage(characterSheet(look), procFrame * W, SPRITE.rows[dir] * H, W, H, x, y, w, h);
}

/** A standalone canvas element showing one pose (used for previews). */
export function spriteCanvas(look, { dir = 'down', frame = 0, walking = false, scale = 4, cls = 'pp-sprite' } = {}) {
  const canvas = document.createElement('canvas');
  const height = SPRITE.H * scale;
  canvas.height = height;
  canvas.width = Math.round(height * CELL.W / CELL.H);
  canvas.className = cls;
  drawCharacter(canvas.getContext('2d'), look, { dir, frame, walking, height });
  return canvas;
}

/** Head-and-shoulders portrait on a round medallion, as a data URL. */
export function portraitUrl(look, { size = 96, ring = '#e8b04a', ground = '#f3e3bf' } = {}) {
  const key = `portrait:${JSON.stringify(look)}:${size}:${ring}:${ground}:${hasSheet(look)}`;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = ring; c.beginPath(); c.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); c.fill();
  c.fillStyle = ground; c.beginPath(); c.arc(size / 2, size / 2, size / 2 - size * 0.06, 0, Math.PI * 2); c.fill();
  c.save();
  c.beginPath(); c.arc(size / 2, size / 2, size / 2 - size * 0.06, 0, Math.PI * 2); c.clip();
  if (hasSheet(look)) {
    // Head and shoulders of the front-facing first idle frame.
    c.drawImage(images.get(look.sprite), 8, 4, 56, 56, size * 0.06, size * 0.1, size * 0.88, size * 0.88);
  } else {
    const scale = Math.floor(size / 13);
    // Crop rows 0..15 (head and shoulders) of the front-facing stand frame.
    c.drawImage(characterSheet(look), 0, 0, W, 16, (size - W * scale) / 2, size * 0.12, W * scale, 16 * scale);
  }
  c.restore();
  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}

export default { characterSheet, drawCharacter, spriteCanvas, portraitUrl, loadCharacterSprites, hasSheet, PLAYER_LOOKS, SPRITE, CELL };
