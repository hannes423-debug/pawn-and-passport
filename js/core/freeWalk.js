/**
 * freeWalk.js - free movement inside a layered scene.
 *
 * Pure logic, no DOM (tests/run.js drives it). Coordinates are percent of the
 * scene: x right, y down, the same space as js/data/scenes.js and
 * js/data/sceneLayers.js.
 *
 * The walkable area is baked once into a grid: a cell is free when its centre
 * lies inside a floor polygon and outside every block and prop footprint,
 * grown by the walker's own half-size so a character's body never overlaps an
 * object. Distances are measured in screen space (x scaled by the scene's
 * aspect ratio) so moving sideways costs the same as moving up.
 *
 *   const walk = createWalkGrid(layers, { aspect })
 *   walk.free(x, y)             is this point walkable
 *   walk.nearestFree(x, y)      the closest walkable point
 *   walk.move(x, y, dx, dy)     slide along obstacles: { x, y, moved }
 *   walk.path(from, to)         [[x, y], ...] smoothed, or null when unreachable
 */

export const GRID = Object.freeze({ cols: 200, rows: 150 });
/* The walker's feet: half-width in screen-space percent of the scene height,
   and half-depth (the feet are a flat ellipse, not a tall box). */
export const WALKER = Object.freeze({ halfWidth: 1.6, halfDepth: 0.9 });

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function createWalkGrid(layers, { aspect = 4 / 3, cols = GRID.cols, rows = GRID.rows } = {}) {
  const cw = 100 / cols;
  const ch = 100 / rows;
  const padX = WALKER.halfWidth / aspect;   // screen-space width back to percent of scene width
  const padY = WALKER.halfDepth;
  const rects = [
    ...(layers.blocks || []),
    ...(layers.props || []).map((p) => p.foot).filter(Boolean)
  ].map(([x0, y0, x1, y1]) => [x0 - padX, y0 - padY, x1 + padX, y1 + padY]);

  const cells = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = (i + 0.5) * cw;
      const y = (j + 0.5) * ch;
      const onFloor = (layers.floor || []).some((poly) => pointInPolygon(x, y, poly));
      const hit = onFloor && rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
      cells[j * cols + i] = onFloor && !hit ? 1 : 0;
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
