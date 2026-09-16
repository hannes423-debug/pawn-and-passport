/**
 * positionCache.js — FEN + settings -> analysis.
 *
 * Openings repeat, puzzles repeat, and a review pass re-visits positions the
 * live analysis already saw. Caching turns those into free lookups, which is
 * what makes the review of a 60-move game finish in seconds on a phone.
 *
 * The key includes the engine settings, because a depth-4 answer must never
 * be served to a caller that asked for depth 20. A cached entry with a HIGHER
 * depth than requested is still a valid answer and is served.
 */

const DEFAULT_CAPACITY = 400;

export class PositionCache {
  constructor({ capacity = DEFAULT_CAPACITY } = {}) {
    this.capacity = capacity;
    /** @type {Map<string, Object>} insertion-ordered, so the first key is the oldest */
    this._map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  static key(fen, { multiPv = 1, level = null } = {}) {
    // The move counters do not change the evaluation of a position, but they
    // do change the FEN string, so they are dropped from the key.
    const parts = fen.split(' ');
    const positionOnly = parts.slice(0, 4).join(' ');
    return `${positionOnly}|mpv=${multiPv}|lvl=${level || '-'}`;
  }

  /**
   * @returns {Object|null} a cached result at least as deep as `minDepth`
   */
  get(fen, { multiPv = 1, level = null, minDepth = 0 } = {}) {
    const key = PositionCache.key(fen, { multiPv, level });
    const entry = this._map.get(key);
    if (!entry || entry.depth < minDepth) { this.misses += 1; return null; }
    // Refresh recency.
    this._map.delete(key);
    this._map.set(key, entry);
    this.hits += 1;
    return { ...entry.result, cached: true };
  }

  set(fen, result, { multiPv = 1, level = null } = {}) {
    if (!result || result.cancelled) return result;
    const key = PositionCache.key(fen, { multiPv, level });
    const existing = this._map.get(key);
    if (existing && existing.depth >= result.depth) return result;
    this._map.delete(key);
    this._map.set(key, { depth: result.depth, result, storedAt: Date.now() });
    while (this._map.size > this.capacity) {
      this._map.delete(this._map.keys().next().value);
    }
    return result;
  }

  /**
   * Attach non-engine analysis (motifs, facts) to a cached position so the
   * whole reasoning bundle is reusable, not just the numbers.
   */
  annotate(fen, patch, { multiPv = 1, level = null } = {}) {
    const key = PositionCache.key(fen, { multiPv, level });
    const entry = this._map.get(key);
    if (!entry) return null;
    entry.result = { ...entry.result, ...patch };
    return entry.result;
  }

  has(fen, options) { return !!this.get(fen, options); }
  clear() { this._map.clear(); this.hits = 0; this.misses = 0; }
  get size() { return this._map.size; }
  get stats() {
    const total = this.hits + this.misses;
    return { size: this._map.size, hits: this.hits, misses: this.misses,
      hitRate: total ? Math.round((this.hits / total) * 100) : 0 };
  }

  /** Seed from a pre-baked JSON file produced by tools/analysis_pipeline. */
  loadPrebaked(entries = []) {
    for (const entry of entries) {
      if (!entry.fen || !entry.result) continue;
      this.set(entry.fen, { ...entry.result, cached: true },
        { multiPv: entry.multiPv || 1, level: entry.level || null });
    }
    return this;
  }
}

export const globalPositionCache = new PositionCache();
export default PositionCache;
