/**
 * music.js - the soundtrack: four MP3s, one playing at a time, crossfaded.
 *
 *   music.play('town')        start (or stay on) a track
 *   music.stop()              fade the soundtrack out
 *   music.configure(settings) music on/off and the master volume
 *   music.unlock()            after a real user gesture, start what is pending
 *
 * Each track owns a looping <audio>; a change fades the old one down and the
 * new one up over CROSSFADE_MS. Asking for the track already playing does
 * NOTHING, so walking between screens - or making a move - never restarts the
 * music. This is separate from audio.js, which keeps the synthesised SFX.
 *
 * AUTOPLAY. A browser rejects play() until the page has had a real gesture, so
 * a rejected play is remembered as `pending` rather than treated as an error,
 * and unlock() (wired to the same first gesture that starts the SFX context)
 * plays it. Nothing here throws into the caller.
 */

export const TRACKS = Object.freeze({
  town: 'assets/audio/town.mp3',
  tactical: 'assets/audio/match-tactical.mp3',
  intense: 'assets/audio/match-intense.mp3',
  critical: 'assets/audio/match-critical.mp3'
});

export const CROSSFADE_MS = 900;          // the brief asks for 0.7-1.2s
const STEP_MS = 50;
const MIX = 0.55;                         // the soundtrack sits under the SFX

let settings = { volume: 0.7, music: true };
let current = null;                       // the track id that should be sounding
let pending = null;                       // wanted, but autoplay said no
const players = new Map();                // id -> { el, fade, target }

const canAudio = () => typeof window !== 'undefined' && typeof window.Audio === 'function';
const ceiling = () => (settings.music ? Math.max(0, Math.min(1, settings.volume)) * MIX : 0);

function playerFor(id) {
  if (players.has(id)) return players.get(id);
  if (!canAudio() || !TRACKS[id]) return null;
  const el = new window.Audio(TRACKS[id]);
  el.loop = true;
  el.preload = 'none';
  el.volume = 0;
  const player = { el, fade: null, target: 0 };
  players.set(id, player);
  return player;
}

/** Ramp one track to `target` over `ms`, and pause it when it reaches zero. */
function rampTo(player, target, ms) {
  if (!player) return;
  clearInterval(player.fade);
  player.target = target;
  const from = player.el.volume;
  const steps = Math.max(1, Math.round(ms / STEP_MS));
  let step = 0;
  player.fade = setInterval(() => {
    step += 1;
    const v = from + ((target - from) * step) / steps;
    try { player.el.volume = Math.max(0, Math.min(1, v)); } catch { /* detached */ }
    if (step >= steps) {
      clearInterval(player.fade);
      player.fade = null;
      if (target === 0) { try { player.el.pause(); } catch { /* already gone */ } }
    }
  }, STEP_MS);
}

function start(player) {
  if (!player) return;
  const attempt = player.el.play();
  if (attempt && typeof attempt.catch === 'function') attempt.catch(() => { pending = current; });
}

/**
 * Play `id`, crossfading from whatever is playing. Re-asking for the track
 * already playing is a no-op, which is what keeps a screen change or a move
 * from restarting the music.
 */
export function play(id) {
  if (!TRACKS[id]) return;
  if (current === id) {
    // Still the right track: only make sure it is actually sounding, in case
    // the volume or the music setting changed while it was current.
    const player = players.get(id);
    if (player && settings.music) {
      if (player.el.paused) start(player);
      if (Math.abs(player.target - ceiling()) > 0.001) rampTo(player, ceiling(), CROSSFADE_MS);
    }
    return;
  }
  current = id;
  pending = null;
  if (!settings.music) return;
  for (const [other, player] of players) if (other !== id) rampTo(player, 0, CROSSFADE_MS);
  const next = playerFor(id);
  if (!next) return;
  start(next);
  rampTo(next, ceiling(), CROSSFADE_MS);
}

/** Fade everything out. The soundtrack has no "current track" afterwards. */
export function stop({ ms = CROSSFADE_MS } = {}) {
  current = null;
  pending = null;
  for (const player of players.values()) rampTo(player, 0, ms);
}

/** Music on/off and the master volume, from the settings screen. */
export function configure(next = {}) {
  settings = { ...settings, ...next };
  if (!settings.music) {
    for (const player of players.values()) rampTo(player, 0, 300);
    return;
  }
  if (current) {
    const player = playerFor(current);
    if (player) {
      if (player.el.paused) start(player);
      rampTo(player, ceiling(), 300);
    }
  }
}

/** Called from the first real user gesture: retry whatever autoplay refused. */
export function unlock() {
  if (!pending || !settings.music) { pending = null; return; }
  const id = pending;
  pending = null;
  if (current !== id) return;
  const player = playerFor(id);
  if (!player) return;
  start(player);
  rampTo(player, ceiling(), CROSSFADE_MS);
}

/** Drop every element. Only the page teardown and the tests need this. */
export function dispose() {
  for (const player of players.values()) {
    clearInterval(player.fade);
    try { player.el.pause(); player.el.src = ''; } catch { /* detached */ }
  }
  players.clear();
  current = null;
  pending = null;
}

export const playing = () => current;

export default { TRACKS, CROSSFADE_MS, play, stop, configure, unlock, dispose, playing };
