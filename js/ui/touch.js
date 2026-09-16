/**
 * touch.js - phones and tablets.
 *
 * The chess board and every button were already pointer-driven, so a tap
 * works everywhere. What a touch screen could NOT do was walk freely (arrow
 * keys and the 1-9 hotspot keys) or hover a suggested square, and the layout
 * assumed a desktop. This module decides whether we are on touch, stamps
 * `data-touch` on <html> for the CSS, and builds the on-screen joystick and
 * action button the scene screen uses.
 *
 * Detection follows the `touchControls` setting: 'auto' trusts a coarse
 * primary pointer, and ALSO switches on the first time a finger touches the
 * page (a touch laptop reports a fine pointer). 'on' and 'off' force it.
 */

import { h } from './dom.js';

let mode = 'auto';
let sawTouch = false;
const listeners = new Set();

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function isTouch() {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return sawTouch || coarse();
}

function stamp() {
  const on = isTouch();
  const root = document.documentElement;
  if (root.dataset.touch !== String(on)) {
    root.dataset.touch = String(on);
    for (const fn of [...listeners]) fn(on);
  }
}

/** Called by app.applySettings(). */
export function configureTouch(settings) {
  mode = settings?.touchControls || 'auto';
  stamp();
}

/** Fires with the new value whenever touch mode flips (a first touch, a setting change). */
export function onTouchChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "tap" on touch screens, "click" elsewhere, for instructions in the UI. */
export const tapWord = () => (isTouch() ? 'tap' : 'click');

export function installTouchDetection() {
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !sawTouch) { sawTouch = true; stamp(); }
  }, { capture: true, passive: true });
  matchMedia?.('(pointer: coarse)').addEventListener?.('change', stamp);
  stamp();
}

/** Fullscreen is the single biggest win on a phone; iPhone Safari has no element fullscreen. */
export const canFullscreen = () => !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);

export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    // Scenes and the board both want landscape; not every browser allows the lock.
    await screen.orientation?.lock?.('landscape').catch(() => {});
  } catch { /* the browser refused; nothing to undo */ }
}

/**
 * The walking pad: a floating analog stick on the left and an action button
 * on the right.
 *
 *   onStick({ x, y })   unit-ish vector in SCREEN space (y down), or null on release
 *   onAction()          the big button
 */
export function createTouchpad({ onStick, onAction }) {
  const RADIUS = 46;               // px the knob may travel
  const DEAD = 0.28;               // fraction of RADIUS that counts as centred

  const knob = h('div.pp-pad__knob');
  const base = h('div.pp-pad__base', null, knob);
  const stick = h('div.pp-pad__stick', { 'aria-label': 'Walk', role: 'application' }, base);
  const actionLabel = h('span.pp-pad__label');
  const action = h('button.pp-pad__action', { type: 'button', 'aria-label': 'Use' }, h('b', { text: 'A' }), actionLabel);
  const el = h('div.pp-pad', null, stick, action);

  let pointerId = null;
  let centre = null;
  let last = null;

  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };

  function emit(vec) {
    const same = vec && last && Math.abs(vec.x - last.x) < 0.02 && Math.abs(vec.y - last.y) < 0.02;
    if (same || (!vec && !last)) return;
    last = vec;
    onStick(vec);
  }

  function move(e) {
    let dx = e.clientX - centre.x;
    let dy = e.clientY - centre.y;
    const dist = Math.hypot(dx, dy);
    if (dist > RADIUS) { dx *= RADIUS / dist; dy *= RADIUS / dist; }
    setKnob(dx, dy);
    emit(dist < RADIUS * DEAD ? null : { x: dx / RADIUS, y: dy / RADIUS });
  }

  function release() {
    pointerId = null;
    stick.classList.remove('is-active');
    setKnob(0, 0);
    emit(null);
  }

  stick.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    e.preventDefault();
    pointerId = e.pointerId;
    stick.setPointerCapture?.(e.pointerId);
    stick.classList.add('is-active');
    // The base is drawn where it sits, but the stick centres on the first
    // touch, so a thumb that lands off-centre does not start walking.
    const r = base.getBoundingClientRect();
    const inside = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) < r.width / 2;
    centre = inside ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: e.clientX, y: e.clientY };
    move(e);
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === pointerId) move(e); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    stick.addEventListener(type, (e) => { if (e.pointerId === pointerId) release(); });
  }
  stick.addEventListener('contextmenu', (e) => e.preventDefault());

  action.addEventListener('click', (e) => { e.stopPropagation(); onAction(); });

  return {
    el,
    /** label: what A does right now; ready: the player is standing on it. */
    setAction(label, ready) {
      actionLabel.textContent = label || '';
      action.classList.toggle('is-ready', !!ready);
      action.disabled = !label;
    },
    release,
    destroy() { release(); el.remove(); }
  };
}
