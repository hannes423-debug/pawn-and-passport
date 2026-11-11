/**
 * freeWalk.js - free movement inside a layered scene.
 *
 * Pure logic, no DOM (tests/run.js drives it). Coordinates are percent of the
 * scene: x right, y down, the same space as js/data/scenes.js and
 * js/data/sceneLayers.js.
 *
 * The walkable area is baked once into a grid in two passes:
 *
 *   1. SOLID: the artist's walk mask (tools/build_occlusion.py stores it in
 *      js/data/sceneLayers.js as run lengths per grid row). A cell is solid
 *      where no foot may stand. The mask is the whole truth about the floor:
 *      walls, furniture footprints, water and doorways are all drawn into it.
 *   2. ERODE: the solid mask is grown by the walker's own half-size, so a cell
 *      is free only when the walker's whole body fits there.
 *
 * Step 2 is what keeps a character's body out of walls: the mask marks where
 * FEET may be, and a body is wider than a point.
 *
 * Distances are measured in screen space (x scaled by the scene's aspect
 * ratio) so moving sideways costs the same as moving up.
 *
 *   const walk = createWalkGrid(layers, { aspect })   layers = SCENE_LAYERS[id] (needs .walk)
 *   walk.free(x, y)             is this point walkable
 *   walk.nearestFree(x, y)      the closest walkable point
 *   walk.move(x, y, dx, dy)     slide along obstacles: { x, y, moved }
 *   walk.path(from, to)         [[x, y], ...] smoothed, or null when unreachable
 */

export const GRID = Object.freeze({ cols: 300, rows: 225 });
/* The walker's feet: half-width in screen-space percent of the scene height,
   and half-depth (the feet are a flat ellipse, not a tall box). */
export const WALKER = Object.freeze({ halfWidth: 1.6, halfDepth: 0.9 });

/** Feet size for a character drawn at `actorHeight` (share of the scene height). */
export function walkerFor(actorHeight = 0.1) {
  const h = actorHeight * 100;
  return { halfWidth: Math.max(1.0, h * 0.11), halfDepth: Math.max(0.6, h * 0.04) };
}

/** The walk mask's run-length rows -> 1 = solid, 0 = floor, at cols x rows. */
export function solidFromWalk(walk, cols, rows) {
  const solid = new Uint8Array(cols * rows).fill(1);
  if (!walk || !walk.rle) return solid;
  for (let j = 0; j < rows; j += 1) {
    // The stored grid may differ from the requested one: sample it by cell centre.
    const sj = Math.min(walk.rows - 1, Math.floor(((j + 0.5) / rows) * walk.rows));
    const runs = walk.rle[sj].split(',').map(Number);
    const row = new Uint8Array(walk.cols);
    let at = 0;
    runs.forEach((n, k) => { if (k % 2 === 1) row.fill(1, at, at + n); at += n; });
    for (let i = 0; i < cols; i += 1) {
      const si = Math.min(walk.cols - 1, Math.floor(((i + 0.5) / cols) * walk.cols));
      solid[j * cols + i] = row[si] ? 0 : 1;
    }
  }
  return solid;
}

export function createWalkGrid(layers, { aspect = 4 / 3, cols = GRID.cols, rows = GRID.rows, walker = WALKER } = {}) {
  const cw = 100 / cols;
  const ch = 100 / rows;
  const padX = walker.halfWidth / aspect;   // screen-space width back to percent of scene width
  const padY = walker.halfDepth;

  /* 1. Solid: wherever the walk mask says no foot may stand. Unpadded - the
     walker's size is applied once, in the erosion below. */
  const solid = solidFromWalk(layers.walk, cols, rows);

  /* 2. Erode by the walker's half-size (separable, and outside the grid counts
     as solid). The feet are treated as a box rather than the ellipse they are
     drawn as: a box is the conservative superset and keeps this a two-pass
     min-filter instead of a distance transform. */
  /* Nearest whole cell, not the next one up: the walk masks were drawn for a
     body of exactly this size (tools/walkmask/check_walkmask.py erodes at the
     pixel), and rounding up made it about 30% fatter - enough to seal
     nyc-int's tournament hall doorway. */
  const rx = Math.max(1, Math.round(padX / cw));
  const ry = Math.max(1, Math.round(padY / ch));
  const wide = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      let blocked = i < rx || i >= cols - rx;
      for (let k = -rx; !blocked && k <= rx; k += 1) blocked = solid[j * cols + i + k] === 1;
      wide[j * cols + i] = blocked ? 1 : 0;
    }
  }
  const cells = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      let blocked = j < ry || j >= rows - ry;
      for (let k = -ry; !blocked && k <= ry; k += 1) blocked = wide[(j + k) * cols + i] === 1;
      cells[j * cols + i] = blocked ? 0 : 1;
    }
  }

  const cellOf = (x, y) => [Math.floor(x / cw), Math.floor(y / ch)];
  const freeCell = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && cells[j * cols + i] === 1;
  const free = (x, y) => { const [i, j] = cellOf(x, y); return freeCell(i, j); };
  const centre = (i, j) => [(i + 0.5) * cw, (j + 0.5) * ch];

  function nearestFree(x, y) {
    if (free(x, y)) return [x, y];
    const [ci, cj] = cellOf(x, y);
    let best = null;
    for (let r = 1; r < Math.max(cols, rows); r += 1) {
      for (let j = cj - r; j <= cj + r; j += 1) {
        for (let i = ci - r; i <= ci + r; i += 1) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !freeCell(i, j)) continue;
          const [px, py] = centre(i, j);
          const d = Math.hypot((px - x) * aspect, py - y);
          if (!best || d < best.d) best = { p: [px, py], d };
        }
      }
      if (best) return best.p;
    }
    return null;
  }

  /** Move by (dx, dy), sliding along whatever blocks the way. Sub-stepped so nothing thin is skipped. */
  function move(x, y, dx, dy) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx) / cw, Math.abs(dy) / ch) * 2));
    const sx = dx / steps;
    const sy = dy / steps;
    let nx = x;
    let ny = y;
    let moved = false;
    for (let k = 0; k < steps; k += 1) {
      if (free(nx + sx, ny + sy)) { nx += sx; ny += sy; moved = true; continue; }
      if (sx && free(nx + sx, ny)) { nx += sx; moved = true; continue; }
      if (sy && free(nx, ny + sy)) { ny += sy; moved = true; continue; }
      break;
    }
    return { x: nx, y: ny, moved };
  }

  function lineFree(ax, ay, bx, by) {
    const dist = Math.hypot((bx - ax) / cw, (by - ay) / ch);
    const n = Math.max(1, Math.ceil(dist * 2));
    for (let k = 1; k <= n; k += 1) {
      if (!free(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)) return false;
    }
    return true;
  }

  /** A* over the grid (8 directions), then string-pulled into straight runs. */
  function path(from, to) {
    const start = nearestFree(from[0], from[1]);
    const goal = nearestFree(to[0], to[1]);
    if (!start || !goal) return null;
    if (lineFree(start[0], start[1], goal[0], goal[1])) return [goal];
    const [si, sj] = cellOf(start[0], start[1]);
    const [gi, gj] = cellOf(goal[0], goal[1]);
    const idx = (i, j) => j * cols + i;
    const g = new Float32Array(cols * rows).fill(Infinity);
    const came = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    const cost = (di, dj) => Math.hypot(di * cw * aspect, dj * ch);
    const h = (i, j) => Math.hypot((gi - i) * cw * aspect, (gj - j) * ch);
    // A small binary heap keyed on f.
    const heap = [];
    const push = (node, f) => {
      heap.push([f, node]);
      let c = heap.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1; const r = l + 1; let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]]; c = m;
        }
      }
      return top[1];
    };
    g[idx(si, sj)] = 0;
    push(idx(si, sj), h(si, sj));
    const goalIdx = idx(gi, gj);
    while (heap.length) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goalIdx) break;
      const ci = cur % cols;
      const cj = (cur - ci) / cols;
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (!freeCell(ni, nj)) continue;
          // No squeezing diagonally between two blocked corners.
          if (di && dj && (!freeCell(ci + di, cj) || !freeCell(ci, cj + dj))) continue;
          const n = idx(ni, nj);
          const ng = g[cur] + cost(di, dj);
          if (ng < g[n]) { g[n] = ng; came[n] = cur; push(n, ng + h(ni, nj)); }
        }
      }
    }
    if (came[goalIdx] === -1 && goalIdx !== idx(si, sj)) return null;
    const cellsPath = [];
    for (let n = goalIdx; n !== -1; n = came[n]) cellsPath.unshift(centre(n % cols, (n - (n % cols)) / cols));
    cellsPath[cellsPath.length - 1] = goal;
    // String pulling: from each anchor, jump to the farthest point still in sight.
    const out = [];
    let anchor = start;
    let k = 0;
    while (k < cellsPath.length) {
      let far = k;
      for (let m = cellsPath.length - 1; m > k; m -= 1) {
        if (lineFree(anchor[0], anchor[1], cellsPath[m][0], cellsPath[m][1])) { far = m; break; }
      }
      out.push(cellsPath[far]);
      anchor = cellsPath[far];
      k = far + 1;
    }
    return out;
  }

  return { cols, rows, cells, free, nearestFree, move, path, lineFree };
}

export default createWalkGrid;
