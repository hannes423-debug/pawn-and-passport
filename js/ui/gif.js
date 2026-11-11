/**
 * gif.js - a small animated-GIF encoder (GIF89a), for "Animated GIF" in the
 * game viewer. No dependencies and no DOM: the frames come in as RGBA pixels
 * (a canvas's ImageData), so the Node tests round-trip it.
 *
 *   palette   one for the whole animation (a game's frames share the board,
 *             the pieces and the highlight colours): median cut over a
 *             15-bit histogram of a few sample frames, 255 colours; index
 *             255 is kept for "transparent".
 *   frames    after the first, only the box round what changed is written,
 *             and inside it the pixels that did not change are transparent
 *             (disposal 1: "leave in place"). A move changes two squares and
 *             the move text, so a 60-move game stays around a megabyte.
 *   LZW       the standard GIF variable-width LZW (8-bit minimum code size).
 */

export const TRANSPARENT = 255;

/* ------------------------------------------------------------ palette -- */

const bin = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/**
 * Median cut over a 5-bit-per-channel histogram.
 * @param {Array<Uint8ClampedArray|Uint8Array>} samples  RGBA pixel arrays
 * @param {number} [max]   colours wanted (at most 255)
 * @param {number} [step]  sample every Nth pixel
 * @returns {number[][]} [[r, g, b], ...]
 */
export function buildPalette(samples, max = 255, step = 1) {
  const hist = new Uint32Array(32768);
  for (const data of samples) {
    for (let i = 0; i < data.length; i += 4 * step) {
      if (data[i + 3] < 128) continue;
      hist[bin(data[i], data[i + 1], data[i + 2])] += 1;
    }
  }
  const used = [];
  for (let k = 0; k < 32768; k += 1) if (hist[k]) used.push(k);
  if (!used.length) return [[0, 0, 0]];
  const ch = (k, c) => (c === 0 ? (k >> 10) & 31 : c === 1 ? (k >> 5) & 31 : k & 31);
  const describe = (bins) => {
    let best = 0; let range = -1;
    for (let c = 0; c < 3; c += 1) {
      let lo = 31; let hi = 0;
      for (const k of bins) { const v = ch(k, c); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > range) { range = hi - lo; best = c; }
    }
    let count = 0;
    for (const k of bins) count += hist[k];
    return { bins, channel: best, range, count };
  };
  const boxes = [describe(used)];
  while (boxes.length < Math.min(max, 255)) {
    // Split the box that is both wide and well used.
    let pick = -1; let score = 0;
    boxes.forEach((b, i) => {
      if (b.bins.length < 2 || b.range === 0) return;
      const s = b.range * Math.sqrt(b.count);
      if (s > score) { score = s; pick = i; }
    });
    if (pick < 0) break;
    const box = boxes[pick];
    const c = box.channel;
    box.bins.sort((a, b) => ch(a, c) - ch(b, c));
    let half = box.count / 2; let cut = 0;
    for (let i = 0; i < box.bins.length - 1; i += 1) { half -= hist[box.bins[i]]; cut = i + 1; if (half <= 0) break; }
    boxes.splice(pick, 1, describe(box.bins.slice(0, cut)), describe(box.bins.slice(cut)));
  }
  return boxes.map(({ bins }) => {
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (const k of bins) {
      const w = hist[k];
      r += (((k >> 10) & 31) * 8 + 4) * w; g += (((k >> 5) & 31) * 8 + 4) * w; b += ((k & 31) * 8 + 4) * w; n += w;
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

/** RGBA pixels -> palette indices (nearest colour, cached per 15-bit bin). */
export function createIndexer(palette) {
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r, g, b) => {
    let best = 0; let dist = Infinity;
    for (let i = 0; i < palette.length; i += 1) {
      const [pr, pg, pb] = palette[i];
      // weighted towards green, as the eye is
      const d = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2;
      if (d < dist) { dist = d; best = i; }
    }
    return best;
  };
  return (rgba, out = new Uint8Array(rgba.length / 4)) => {
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) {
      const k = bin(rgba[i], rgba[i + 1], rgba[i + 2]);
      let idx = cache[k];
      if (idx < 0) { idx = nearest((k >> 10) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4); cache[k] = idx; }
      out[j] = idx;
    }
    return out;
  };
}

/* -------------------------------------------------------------- bytes -- */

class Bytes {
  constructor(size = 1 << 16) { this.buf = new Uint8Array(size); this.n = 0; }
  grow(extra) {
    if (this.n + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + extra) size *= 2;
    const next = new Uint8Array(size); next.set(this.buf.subarray(0, this.n)); this.buf = next;
  }
  byte(v) { this.grow(1); this.buf[this.n++] = v & 255; }
  word(v) { this.byte(v); this.byte(v >> 8); }
  bytes(arr) { this.grow(arr.length); this.buf.set(arr, this.n); this.n += arr.length; }
  ascii(s) { for (const c of s) this.byte(c.charCodeAt(0)); }
  result() { return this.buf.slice(0, this.n); }
}

/* ---------------------------------------------------------------- LZW -- */

/** GIF LZW of an index stream with an 8-bit minimum code size, as raw bytes. */
export function lzw(indices) {
  const out = new Bytes(indices.length + 64);
  const CLEAR = 256; const EOI = 257;
  let size = 9; let next = 258;
  let cur = 0; let shift = 0;
  const table = new Int16Array(4096 * 256).fill(-1);
  const keys = [];
  const emit = (code) => {
    cur |= code << shift; shift += size;
    while (shift >= 8) { out.byte(cur & 255); cur >>>= 8; shift -= 8; }
  };
  emit(CLEAR);
  if (!indices.length) { emit(EOI); if (shift > 0) out.byte(cur & 255); return out.result(); }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = table[key];
    if (code >= 0) { prefix = code; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(CLEAR);
      for (const used of keys) table[used] = -1;
      keys.length = 0;
      size = 9; next = 258;
    } else {
      if (next >= (1 << size)) size += 1;
      table[key] = next; keys.push(key); next += 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(EOI);
  if (shift > 0) out.byte(cur & 255);
  return out.result();
}

/* ------------------------------------------------------------- writer -- */

export class GifWriter {
  /**
   * @param {number} width
   * @param {number} height
   * @param {number[][]} palette  at most 255 colours (index 255 is transparent)
   * @param {{loop?: number}} [o] 0 = loop forever
   */
  constructor(width, height, palette, { loop = 0 } = {}) {
    if (palette.length > 255) throw new Error('at most 255 colours');
    this.width = width; this.height = height;
    this.prev = null;
    this.frames = 0;
    const b = this.out = new Bytes(1 << 20);
    b.ascii('GIF89a');
    b.word(width); b.word(height);
    b.byte(0xf7); b.byte(0); b.byte(0);                 // global table, 256 entries
    for (let i = 0; i < 256; i += 1) {
      const [r, g, bl] = palette[i] || [0, 0, 0];
      b.byte(r); b.byte(g); b.byte(bl);
    }
    b.byte(0x21); b.byte(0xff); b.byte(11); b.ascii('NETSCAPE2.0');
    b.byte(3); b.byte(1); b.word(loop); b.byte(0);
  }

  /**
   * Add a frame of palette indices (width x height).
   * @param {Uint8Array} indexed
   * @param {number} delayCs  how long it shows, in hundredths of a second
   */
  addFrame(indexed, delayCs) {
    const { width: W, height: H } = this;
    if (indexed.length !== W * H) throw new Error('frame size');
    let x0 = 0; let y0 = 0; let x1 = W - 1; let y1 = H - 1;
    const prev = this.prev;
    if (prev) {
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y += 1) {
        const row = y * W;
        for (let x = 0; x < W; x += 1) {
          if (indexed[row + x] !== prev[row + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }   // nothing changed: a 1-px see-through frame holds the delay
    }
    const w = x1 - x0 + 1; const h = y1 - y0 + 1;
    const rect = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y + y0) * W + x + x0;
        rect[y * w + x] = prev && indexed[i] === prev[i] ? TRANSPARENT : indexed[i];
      }
    }
    const b = this.out;
    b.byte(0x21); b.byte(0xf9); b.byte(4);
    b.byte((1 << 2) | (prev ? 1 : 0));                  // disposal 1 (leave), transparency after the first
    b.word(Math.max(2, Math.round(delayCs))); b.byte(TRANSPARENT); b.byte(0);
    b.byte(0x2c); b.word(x0); b.word(y0); b.word(w); b.word(h); b.byte(0);
    b.byte(8);
    const data = lzw(rect);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, Math.min(data.length, i + 255));
      b.byte(chunk.length); b.bytes(chunk);
    }
    b.byte(0);
    this.prev = prev ? prev.set(indexed) || prev : indexed.slice();
    this.frames += 1;
  }

  /** The finished file. */
  finish() { this.out.byte(0x3b); return this.out.result(); }
}

export default { buildPalette, createIndexer, lzw, GifWriter, TRANSPARENT };
