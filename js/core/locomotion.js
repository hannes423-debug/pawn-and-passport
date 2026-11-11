/**
 * locomotion.js - which way a character faces, and when its legs move.
 * Pure: no DOM, no sprites (js/ui/sprites.js draws what this decides), so
 * the Node tests run it.
 *
 * FACING. Movement resolves to one of eight directions,
 *
 *     up-left    up    up-right
 *        left          right
 *   down-left   down   down-right
 *
 * in SCREEN space (dy > 0 is down the picture). A sheet draws only some of
 * them: today every sheet has the four cardinal rows (down, left, right, up;
 * tools/build_characters.py). facingFor() picks the best direction the sheet
 * CAN show, in this order:
 *
 *   1. the direction itself, if the sheet has a row for it;
 *   2. its mirror image (left <-> right), if the sheet allows mirroring;
 *   3. a cardinal neighbour. On a diagonal the character KEEPS the cardinal it
 *      already faces when that is one of the diagonal's two halves, so a path
 *      at about 45 degrees no longer flips between two rows every few frames
 *      (it did: the old rule was |dx| > |dy| with no memory). With no usable
 *      previous facing, the dominant axis wins, which is the old rule.
 *
 * Nothing here invents a sprite: an eight-direction sheet only changes what
 * step 1 finds. See docs/CHARACTER_SPEC.md.
 *
 * WALK CYCLE. A frame advances per DISTANCE walked, not per unit of time, so
 * the feet stay planted: half a joystick tilt walks at half speed with legs
 * at half pace, and a character pushed against a wall stands still instead
 * of walking on the spot.
 */

export const DIRECTIONS = Object.freeze(['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left']);
export const CARDINALS = Object.freeze(['down', 'left', 'right', 'up']);

const MIRROR = Object.freeze({
  left: 'right', right: 'left',
  'up-left': 'up-right', 'up-right': 'up-left',
  'down-left': 'down-right', 'down-right': 'down-left',
  up: 'up', down: 'down'
});

/** The two cardinal halves of a direction: 'up-right' -> ['up', 'right']. */
export function components(dir) {
  return dir.includes('-') ? dir.split('-') : [dir];
}

export const mirrorOf = (dir) => MIRROR[dir] || dir;

/**
 * The eight-way direction of a screen-space vector, or null for no movement.
 * Each direction owns a 45-degree sector centred on it.
 */
export function direction8(dx, dy) {
  if (!(Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9)) return null;
  // 0 = right, counter-clockwise on screen (so up is +90: dy is negated).
  const angle = Math.atan2(-dy, dx);
  const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return ['right', 'up-right', 'up', 'up-left', 'left', 'down-left', 'down', 'down-right'][sector];
}

/**
 * Which directions a sheet can show.
 * @param {string[]} rows  the sheet's rows (manifest), e.g. ['down','left','right','up']
 * @param {boolean} [mirror]  may a missing row be drawn as its flipped mirror?
 */
export function showable(rows, mirror = false) {
  const set = new Set(rows);
  if (mirror) for (const r of rows) set.add(mirrorOf(r));
  return set;
}

/**
 * The direction a character should face for a movement.
 * @param {number} dx  screen-space x (right positive)
 * @param {number} dy  screen-space y (down positive)
 * @param {Object} [o]
 * @param {string|null} [o.previous]  what it faces now (keeps diagonals steady)
 * @param {Iterable<string>} [o.available]  directions the sheet can show (see showable)
 * @returns {string|null} null when there is no movement: keep the old facing
 */
export function facingFor(dx, dy, { previous = null, available = CARDINALS } = {}) {
  const dir = direction8(dx, dy);
  if (!dir) return null;
  const can = available instanceof Set ? available : new Set(available);
  if (can.has(dir)) return dir;
  const halves = components(dir).filter((d) => can.has(d));
  if (previous && halves.includes(previous)) return previous;
  const dominant = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  if (can.has(dominant)) return dominant;
  return halves[0] || previous || dominant;
}

/**
 * How a sheet draws a direction: its own row, or a mirrored one.
 * @returns {{row:string, flip:boolean}}
 */
export function rowFor(dir, rows, mirror = false) {
  if (rows.includes(dir)) return { row: dir, flip: false };
  const m = mirrorOf(dir);
  if (mirror && rows.includes(m)) return { row: m, flip: true };
  // A diagonal on a cardinal sheet (an NPC placed facing 'up-left' in data):
  // its horizontal half reads best, then the vertical one.
  for (const half of components(dir).reverse()) {
    if (rows.includes(half)) return { row: half, flip: false };
    if (mirror && rows.includes(mirrorOf(half))) return { row: mirrorOf(half), flip: true };
  }
  return { row: rows[0], flip: false };
}

/**
 * A distance-locked walk cycle.
 * @param {number} frameDistance  distance walked per frame, in the caller's units
 */
export function createStride(frameDistance) {
  let carried = 0;
  return {
    /** Walked `distance`; returns how many frames to advance (0, 1, rarely 2). */
    advance(distance) {
      if (!(distance > 0)) return 0;
      carried += distance;
      const frames = Math.floor(carried / frameDistance);
      carried -= frames * frameDistance;
      return frames;
    },
    reset() { carried = 0; }
  };
}

export default { DIRECTIONS, CARDINALS, direction8, facingFor, rowFor, showable, mirrorOf, components, createStride };
