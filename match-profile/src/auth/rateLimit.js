/**
 * rateLimit.js - fixed-window counters, per IP and per email.
 *
 *   const limiter = createLimiter()
 *   limiter.hit('login:ip:203.0.113.4', [20, 900])  -> { ok, retryAfter }
 *
 * In memory: one server process, and a restart forgetting the counts is
 * acceptable for a small service (docs/DECISIONS.md).
 */

export function createLimiter({ now = () => Date.now() } = {}) {
  const windows = new Map();
  function sweep(t) {
    if (windows.size < 5000) return;
    for (const [key, w] of windows) if (w.resetAt <= t) windows.delete(key);
  }
  return {
    hit(key, [max, seconds]) {
      const t = now();
      sweep(t);
      let w = windows.get(key);
      if (!w || w.resetAt <= t) { w = { count: 0, resetAt: t + seconds * 1000 }; windows.set(key, w); }
      w.count += 1;
      return w.count <= max ? { ok: true } : { ok: false, retryAfter: Math.ceil((w.resetAt - t) / 1000) };
    },
    reset() { windows.clear(); }
  };
}

export default { createLimiter };
