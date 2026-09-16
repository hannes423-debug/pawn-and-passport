/**
 * timeControl.js — TimeControl, ClockState and ChessClock.
 *
 * The clock knows nothing about the board: it is driven by `press(side)` and
 * a ticker. That separation is what lets the same clock run a Quick Match, a
 * career game and a puzzle timer without a single conditional.
 */

import { WHITE, BLACK, otherColour } from './constants.js';

/**
 * @typedef {Object} TimeControlSpec
 * @property {string} id
 * @property {string} label       'Rapid 10 min'
 * @property {string} short       '10+0'
 * @property {number|null} baseSeconds  null = unlimited
 * @property {number} incrementSeconds
 * @property {string} category    bullet|blitz|rapid|classical|unlimited
 */

export class TimeControl {
  /** @param {Partial<TimeControlSpec>} spec */
  constructor({ id, label, short, baseSeconds, incrementSeconds = 0, category = 'custom' } = {}) {
    this.id = id || `custom-${baseSeconds}-${incrementSeconds}`;
    this.baseSeconds = baseSeconds === null || baseSeconds === undefined ? null : Number(baseSeconds);
    this.incrementSeconds = Number(incrementSeconds) || 0;
    this.short = short || (this.baseSeconds === null
      ? '∞'
      : `${Math.round(this.baseSeconds / 60)}+${this.incrementSeconds}`);
    this.label = label || this.short;
    this.category = category;
  }

  get isUnlimited() { return this.baseSeconds === null; }

  /** Classification used for rating pools and bot time management. */
  static categoryFor(baseSeconds, incrementSeconds = 0) {
    if (baseSeconds === null) return 'unlimited';
    // The common "estimated duration" heuristic: base + 40 * increment.
    const estimate = baseSeconds + 40 * incrementSeconds;
    if (estimate < 179) return 'bullet';
    if (estimate < 479) return 'blitz';
    if (estimate < 1499) return 'rapid';
    return 'classical';
  }

  static custom(baseSeconds, incrementSeconds = 0) {
    return new TimeControl({
      baseSeconds, incrementSeconds,
      category: TimeControl.categoryFor(baseSeconds, incrementSeconds)
    });
  }

  toJSON() {
    return {
      id: this.id, label: this.label, short: this.short,
      baseSeconds: this.baseSeconds, incrementSeconds: this.incrementSeconds,
      category: this.category
    };
  }
}

/** The presets the UI offers, in the order it offers them. */
export const TIME_CONTROLS = Object.freeze([
  new TimeControl({ id: 'unlimited', label: 'Unlimited',      short: '∞',     baseSeconds: null, incrementSeconds: 0,  category: 'unlimited' }),
  new TimeControl({ id: '30m',       label: '30 minutes',     short: '30+0',  baseSeconds: 1800, incrementSeconds: 0,  category: 'classical' }),
  new TimeControl({ id: '15p10',     label: '15 min + 10 s',  short: '15+10', baseSeconds: 900,  incrementSeconds: 10, category: 'rapid' }),
  new TimeControl({ id: '10m',       label: '10 minutes',     short: '10+0',  baseSeconds: 600,  incrementSeconds: 0,  category: 'rapid' }),
  new TimeControl({ id: '5p3',       label: '5 min + 3 s',    short: '5+3',   baseSeconds: 300,  incrementSeconds: 3,  category: 'blitz' }),
  new TimeControl({ id: '5m',        label: '5 minutes',      short: '5+0',   baseSeconds: 300,  incrementSeconds: 0,  category: 'blitz' }),
  new TimeControl({ id: '3p2',       label: '3 min + 2 s',    short: '3+2',   baseSeconds: 180,  incrementSeconds: 2,  category: 'blitz' }),
  new TimeControl({ id: '3m',        label: '3 minutes',      short: '3+0',   baseSeconds: 180,  incrementSeconds: 0,  category: 'blitz' }),
  new TimeControl({ id: '1p1',       label: '1 min + 1 s',    short: '1+1',   baseSeconds: 60,   incrementSeconds: 1,  category: 'bullet' }),
  new TimeControl({ id: '1m',        label: '1 minute',       short: '1+0',   baseSeconds: 60,   incrementSeconds: 0,  category: 'bullet' })
]);

export function timeControlById(id) {
  return TIME_CONTROLS.find((tc) => tc.id === id) || null;
}

/**
 * @typedef {Object} ClockState
 * @property {number|null} w   milliseconds remaining, null when unlimited
 * @property {number|null} b
 * @property {'w'|'b'} side    whose clock is counting
 * @property {boolean} running
 * @property {null|'w'|'b'} flagged
 */

/**
 * Two-sided increment clock.
 *
 * Time is tracked in milliseconds against a monotonic `now()` so that a
 * dropped animation frame or a backgrounded tab cannot leak time — every read
 * recomputes from the timestamp of the last press.
 */
export class ChessClock {
  /**
   * @param {TimeControl} timeControl
   * @param {{ now?: () => number }} [deps] injectable clock source (tests)
   */
  constructor(timeControl = TIME_CONTROLS[3], { now = () => Date.now() } = {}) {
    this.timeControl = timeControl;
    this._now = now;
    const base = timeControl.isUnlimited ? null : timeControl.baseSeconds * 1000;
    this.remaining = { [WHITE]: base, [BLACK]: base };
    this.side = WHITE;
    this.running = false;
    this.flagged = null;
    this._lastTick = null;
    this._listeners = new Set();
    /** Per-move elapsed time, filled in by press(). */
    this.lastMoveMs = 0;
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit() { const s = this.state(); for (const fn of this._listeners) fn(s); }

  /** @returns {ClockState} */
  state() {
    return {
      w: this.remaining[WHITE], b: this.remaining[BLACK],
      side: this.side, running: this.running, flagged: this.flagged,
      unlimited: this.timeControl.isUnlimited
    };
  }

  start(side = this.side) {
    if (this.flagged) return this;
    this.side = side;
    this.running = true;
    this._lastTick = this._now();
    this._emit();
    return this;
  }

  stop() {
    if (this.running) this._drain();
    this.running = false;
    this._lastTick = null;
    this._emit();
    return this;
  }

  /** Subtract wall time since the last drain from the side on move. */
  _drain() {
    if (this.timeControl.isUnlimited || this._lastTick === null) return;
    const now = this._now();
    const elapsed = now - this._lastTick;
    this._lastTick = now;
    if (!this.running) return;
    this.remaining[this.side] = Math.max(0, this.remaining[this.side] - elapsed);
    if (this.remaining[this.side] <= 0 && !this.flagged) {
      this.flagged = this.side;
      this.running = false;
    }
  }

  /** Recompute remaining time. Safe to call at any rate, including never. */
  tick() {
    if (!this.running) return this.state();
    const before = this.flagged;
    this._drain();
    this._emit();
    if (!before && this.flagged) this._emit();
    return this.state();
  }

  /**
   * `side` has completed a move: bank the increment, hand over.
   * @returns {number} milliseconds this move consumed
   */
  press(side = this.side) {
    if (this.timeControl.isUnlimited) { this.side = otherColour(side); this._emit(); return 0; }
    const startedWith = this.remaining[side];
    this._drain();
    const spent = Math.max(0, startedWith - this.remaining[side]);
    this.lastMoveMs = spent;
    if (!this.flagged) {
      this.remaining[side] += this.timeControl.incrementSeconds * 1000;
      this.side = otherColour(side);
      this._lastTick = this._now();
    }
    this._emit();
    return spent;
  }

  /** Force a value, e.g. restoring a saved game. */
  setRemaining(side, ms) { this.remaining[side] = ms; this._emit(); return this; }

  reset() {
    const base = this.timeControl.isUnlimited ? null : this.timeControl.baseSeconds * 1000;
    this.remaining[WHITE] = base;
    this.remaining[BLACK] = base;
    this.side = WHITE;
    this.running = false;
    this.flagged = null;
    this._lastTick = null;
    this._emit();
    return this;
  }

  /** '9:58' / '0:09.4' under ten seconds / '∞'. */
  format(side) { return ChessClock.format(this.remaining[side]); }

  static format(ms) {
    if (ms === null || ms === undefined) return '∞';
    const total = Math.max(0, ms);
    const minutes = Math.floor(total / 60000);
    const seconds = (total % 60000) / 1000;
    if (total < 10000) return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
    return `${minutes}:${String(Math.floor(seconds)).padStart(2, '0')}`;
  }
}

export default { TimeControl, TIME_CONTROLS, timeControlById, ChessClock };
