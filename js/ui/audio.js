/**
 * audio.js - every sound EFFECT, synthesised with WebAudio.
 *
 * No files to load. Each effect is a short recipe of square and triangle
 * blips, so the whole soundboard stays in the 8-bit key of the art. The
 * context is created lazily on the first user gesture (autoplay rules), and
 * every call is a no-op until then.
 *
 * The music used to live here too, as a four-bar chiptune loop standing in for
 * a soundtrack. The real one is four MP3s, in js/ui/music.js.
 */

let ctx = null;
let master = null;
let settings = { volume: 0.7, sfx: true, music: true };

export function configureAudio(next) {
  settings = { ...settings, ...next };
  if (master) master.gain.value = settings.volume;
}

export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(ctx.destination);
  } catch { ctx = null; }
}

function tone(freq, { at = 0, dur = 0.12, type = 'square', vol = 0.18, slide = null, attack = 0.005 } = {}) {
  if (!ctx || !settings.sfx) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ at = 0, dur = 0.08, vol = 0.12, hp = 1200 } = {}) {
  if (!ctx || !settings.sfx) return;
  const t = ctx.currentTime + at;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass'; filter.frequency.value = hp;
  const gain = ctx.createGain(); gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
}

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);
const arpeggio = (notes, { at = 0, step = 0.07, type = 'square', vol = 0.14, dur = 0.14 } = {}) =>
  notes.forEach((n, i) => tone(NOTE(n), { at: at + i * step, type, vol, dur }));

export const sfx = {
  click: () => tone(880, { dur: 0.04, vol: 0.08 }),
  hover: () => tone(1320, { dur: 0.025, vol: 0.03, type: 'triangle' }),
  step: () => noise({ dur: 0.03, vol: 0.03, hp: 2500 }),
  move: () => { noise({ dur: 0.05, vol: 0.14, hp: 600 }); tone(180, { dur: 0.06, type: 'triangle', vol: 0.2 }); },
  capture: () => { noise({ dur: 0.09, vol: 0.2, hp: 400 }); tone(140, { dur: 0.1, type: 'square', vol: 0.12, slide: 90 }); },
  check: () => arpeggio([76, 72], { step: 0.08, vol: 0.12 }),
  illegal: () => tone(160, { dur: 0.12, type: 'sawtooth', vol: 0.08 }),
  hint: () => arpeggio([79, 83, 86], { step: 0.05, type: 'triangle', vol: 0.12 }),
  focusGain: () => tone(NOTE(88), { dur: 0.08, type: 'triangle', vol: 0.08 }),
  good: () => tone(NOTE(79), { dur: 0.1, type: 'triangle', vol: 0.1 }),
  best: () => arpeggio([79, 84], { step: 0.06, type: 'triangle', vol: 0.12 }),
  clutch: () => { arpeggio([67, 71, 74, 79], { step: 0.05, vol: 0.13 }); tone(NOTE(55), { at: 0.2, dur: 0.3, type: 'triangle', vol: 0.2 }); },
  brilliant: () => { arpeggio([72, 76, 79, 84, 88], { step: 0.06, vol: 0.13 }); noise({ at: 0.3, dur: 0.25, vol: 0.05, hp: 5000 }); },
  epic: () => {
    arpeggio([60, 64, 67, 72, 76, 79, 84], { step: 0.055, vol: 0.14 });
    [72, 76, 79].forEach((n) => tone(NOTE(n), { at: 0.42, dur: 0.6, type: 'square', vol: 0.08 }));
    noise({ at: 0.4, dur: 0.5, vol: 0.06, hp: 4000 });
  },
  mistake: () => tone(NOTE(62), { dur: 0.18, type: 'triangle', vol: 0.12, slide: NOTE(58) }),
  blunder: () => { tone(NOTE(55), { dur: 0.35, type: 'sawtooth', vol: 0.1, slide: NOTE(43) }); noise({ dur: 0.2, vol: 0.08, hp: 300 }); },
  opening: () => arpeggio([72, 79, 76, 84], { step: 0.08, type: 'triangle', vol: 0.12 }),
  win: () => { arpeggio([72, 76, 79, 84], { step: 0.1, vol: 0.14, dur: 0.2 }); tone(NOTE(88), { at: 0.45, dur: 0.5, vol: 0.12 }); },
  lose: () => arpeggio([67, 63, 60, 55], { step: 0.14, type: 'triangle', vol: 0.12, dur: 0.25 }),
  levelUp: () => arpeggio([72, 74, 76, 79, 81, 84, 88], { step: 0.05, vol: 0.13 }),
  trophy: () => {
    arpeggio([67, 72, 76, 79], { step: 0.12, vol: 0.14, dur: 0.22 });
    [72, 76, 79, 84].forEach((n) => tone(NOTE(n), { at: 0.55, dur: 0.9, vol: 0.07 }));
  },
  postcard: () => { noise({ dur: 0.15, vol: 0.06, hp: 3000 }); arpeggio([84, 88, 91], { at: 0.1, step: 0.07, type: 'triangle', vol: 0.12 }); },
  stamp: () => { noise({ dur: 0.06, vol: 0.25, hp: 200 }); tone(90, { dur: 0.08, type: 'square', vol: 0.15 }); },
  plane: () => tone(220, { dur: 0.9, type: 'sawtooth', vol: 0.04, slide: 330, attack: 0.3 }),
  text: () => tone(NOTE(76 + Math.floor(Math.random() * 3)), { dur: 0.02, vol: 0.025 })
};

export default { sfx, unlockAudio, configureAudio };
