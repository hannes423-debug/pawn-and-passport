/**
 * fx.js - on-board effects for special moves.
 *
 * One effect per grade tier, all driven by the colour table in
 * chess/render/feedback.js so the burst, the verdict tint, the move-list glyph
 * and the result tiles agree:
 *
 *   epic       gold flash, 64 particles, light rays, big word
 *   brilliant  purple flash, 42 particles, big word
 *   clutch     pink shockwave rings, 36 particles, big word
 *   best       cyan ring + chip
 *   good       small green chip
 *   mistake    orange chip
 *   blunder    red chip + board shake
 *
 * Reduced motion keeps the word and the colour and drops the particles.
 */

import { h } from './dom.js';
import { sfx } from './audio.js';
import { FEEDBACK, hex } from '../chess/render/feedback.js';

export function createFx(frame, renderer, app) {
  const layer = frame.querySelector('.pp-fx');
  const canvas = document.createElement('canvas');
  layer.append(canvas);
  const ctx = canvas.getContext('2d');
  let particles = [];
  let raf = null;

  const reduced = () => app.settings.reducedMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function centreOf(square) {
    const host = renderer.host.getBoundingClientRect();
    const box = frame.getBoundingClientRect();
    const p = renderer.projectSquare?.(square);
    // projectSquare answers in the board host's own coordinates.
    if (p && typeof p.x === 'number') {
      return { x: host.left - box.left + p.x, y: host.top - box.top + p.y };
    }
    return { x: host.left - box.left + host.width / 2, y: host.top - box.top + host.height / 2 };
  }

  function loop() {
    const w = frame.clientWidth; const hgt = frame.clientHeight;
    if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
    ctx.clearRect(0, 0, w, hgt);
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.life -= 1; p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.985;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.c;
      const s = Math.max(2, Math.round(p.s * (0.5 + p.life / p.max)));
      ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
      if (p.ray) {
        ctx.strokeStyle = p.c; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(p.ox, p.oy); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    raf = particles.length ? requestAnimationFrame(loop) : null;
  }

  function burst(square, kind, count) {
    if (reduced()) return;
    const { x, y } = centreOf(square);
    const colours = [hex(kind), '#fff6dc', '#ffffff'];
    const spec = FEEDBACK[kind] || {};
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 6;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, g: 0.18, life: 40 + Math.random() * 30, max: 70,
        s: 4 + Math.random() * 5, c: colours[i % colours.length] });
    }
    for (let i = 0; i < (spec.rays || 0); i += 1) {
      const a = (i / spec.rays) * Math.PI * 2;
      particles.push({ x, y, ox: x, oy: y, vx: Math.cos(a) * 9, vy: Math.sin(a) * 9, g: 0, life: 22, max: 22, s: 3, c: hex(kind), ray: true });
    }
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function word(text, colour, sub = null) {
    const el = h('div.pp-fx__word', { text, style: { '--c': colour } });
    el.style.setProperty('--c', colour);
    layer.append(el);
    setTimeout(() => el.remove(), 1600);
    if (sub) {
      const s = h('div.pp-fx__sub', { text: sub });
      layer.append(s);
      setTimeout(() => s.remove(), 1600);
    }
  }

  function flash(colour) {
    if (reduced()) return;
    const el = h('div.pp-fx__flash');
    el.style.setProperty('--c', colour);
    layer.append(el);
    setTimeout(() => el.remove(), 520);
  }

  function ring(square, colour, delay = 0) {
    if (reduced()) return;
    setTimeout(() => {
      const { x, y } = centreOf(square);
      const el = h('div.pp-fx__ring', { style: { left: `${x}px`, top: `${y}px` } });
      el.style.setProperty('--c', colour);
      layer.append(el);
      setTimeout(() => el.remove(), 720);
    }, delay);
  }

  function chip(square, text, colour) {
    const { x, y } = centreOf(square);
    const el = h('div.pp-fx__chip', { text, style: { left: `${x}px`, top: `${y}px` } });
    el.style.setProperty('--c', colour);
    layer.append(el);
    setTimeout(() => el.remove(), 1450);
  }

  function shake() {
    if (reduced()) return;
    frame.classList.remove('is-shaking');
    void frame.offsetWidth;
    frame.classList.add('is-shaking');
  }

  /** Celebrate (or mourn) one graded move. */
  function grade({ grade: key, tier, meta, record, focusGain }) {
    const square = record.to;
    const colour = hex(tier);
    const gain = focusGain ? `+${focusGain} Focus` : null;
    switch (key) {
      case 'EPIC':
        flash(colour); burst(square, 'epic', 64); ring(square, colour); ring(square, '#fff6dc', 160);
        word('EPIC!', colour, gain || 'A brilliant move that was also the best move'); sfx.epic(); break;
      case 'BRILLIANT':
        flash(colour); burst(square, 'brilliant', 42); ring(square, colour);
        word('BRILLIANT!', colour, gain || 'A sound sacrifice'); sfx.brilliant(); break;
      case 'CLUTCH':
        ring(square, colour); ring(square, colour, 140); ring(square, colour, 280); burst(square, 'clutch', 36);
        word('CLUTCH!', colour, gain || 'The only move that held'); sfx.clutch(); break;
      case 'BEST':
      case 'EXCELLENT':
        ring(square, colour); chip(square, `${meta.glyph} ${meta.label}${gain ? `  ${gain}` : ''}`, colour); sfx.best(); break;
      case 'GOOD':
        chip(square, `${meta.glyph} ${meta.label}`, colour); sfx.good(); break;
      case 'BOOK':
        chip(square, `${meta.glyph} Book`, '#c9a24a'); break;
      case 'INACCURACY':
      case 'MISTAKE':
      case 'MISS':
        chip(square, `${meta.glyph} ${meta.label}`, colour); sfx.mistake(); break;
      case 'BLUNDER':
        chip(square, `${meta.glyph} Blunder`, colour); shake(); sfx.blunder(); break;
      default: break;
    }
  }

  return {
    grade, word, burst, ring, chip, flash, shake,
    destroy() { if (raf) cancelAnimationFrame(raf); particles = []; }
  };
}

export default createFx;
