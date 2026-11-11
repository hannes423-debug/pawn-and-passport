/**
 * controls.js - keyboard and gamepads, as one set of ACTIONS.
 *
 * The whole game can be played without a mouse:
 *
 *   action    keyboard              Xbox        Nintendo        PlayStation
 *   move      W A S D, arrows       LS, d-pad   LS, d-pad       LS, d-pad
 *   accept    E, Space, Enter       A           A (right)       Cross
 *   cancel    Esc, Backspace        B           B (bottom)      Circle
 *   skill 1   1                     X           Y (left)        Square
 *   skill 2   2                     Y           X (top)         Triangle
 *   map       M                     Menu        +               Options
 *   journal   J                     View        -               Share / Create
 *   tabs      -                     LB / RB     L / R           L1 / R1
 *
 * Accept and cancel follow each maker's convention, so a Nintendo player
 * presses A (the right button) to accept, as on the Switch. The skills sit on
 * the same PLACES on every pad (left face = skill 1, top face = skill 2).
 *
 * Screens push a HANDLER: { onAction(action) -> true when used, onStick(vec),
 * modal }. The newest handler hears an action first; a MODAL one (an overlay,
 * a dialogue) is the last one asked, and while any overlay or dialogue is on
 * screen only modal handlers are asked at all. Whatever no handler uses falls
 * to the default: moving focus between the buttons of the top layer, pressing
 * the focused one, and Back (the element marked [data-back]).
 *
 * <html data-input="mouse|keyboard|gamepad|touch" data-pad="xbox|nintendo|
 * playstation"> says what was used last, so prompts (js/ui/prompts.js) and
 * focus rings show only for keys and pads.
 */

export const DIRECTIONS = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] });
const KEY_ACTION = {
  arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  e: 'accept', ' ': 'accept', enter: 'accept',
  escape: 'cancel', backspace: 'cancel',
  m: 'map', j: 'journal'
};
const DIGITS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
const TYPING = /^(text|search|email|password|number|tel|url)$/;

/* Gamepad tuning. */
const PAD = Object.freeze({
  navDead: 0.55,         // stick deflection that counts as a menu direction
  walkDead: 0.2,         // radial dead zone for analog walking
  repeatDelay: 420,      // ms before a held direction repeats (a tap is ~100 ms)
  repeatRate: 110        // ms between repeats
});
/* Standard mapping: 0 bottom, 1 right, 2 left, 3 top, 4 LB, 5 RB, 6 LT, 7 RT,
   8 view/select, 9 menu/start, 12-15 d-pad up/down/left/right. */
const PAD_BUTTONS = Object.freeze({
  xbox: { accept: 0, cancel: 1 },
  playstation: { accept: 0, cancel: 1 },
  nintendo: { accept: 1, cancel: 0 }
});

const handlers = [];
const stickListeners = new Set();
const deviceListeners = new Set();
const connectListeners = new Set();
const heldKeys = new Set();
const swallowedKeys = new Set();     // keys whose keydown an action used: their keyup must not click either
let padVec = null;
let lastStick = null;
let device = 'mouse';
let padBrand = 'xbox';
let padLayout = 'auto';
let started = false;

/** Which maker a gamepad is, from its id string. Unknown pads use the Xbox layout. */
export function brandOf(id = '') {
  if (/nintendo|057e|pro controller|joy-?con|switch/i.test(id)) return 'nintendo';
  if (/054c|sony|playstation|dualshock|dualsense|ps[345]|wireless controller/i.test(id)) return 'playstation';
  return 'xbox';
}

/** Settings > Gamepad layout: 'auto' reads the pad's id, anything else forces that maker's layout. */
export function setPadLayout(layout = 'auto') {
  padLayout = PAD_BUTTONS[layout] ? layout : 'auto';
  if (padLayout !== 'auto') setDevice(device, padLayout);
}
const brandFor = (pad) => (padLayout === 'auto' ? brandOf(pad?.id) : padLayout);

export const inputDevice = () => device;
export const gamepadBrand = () => padBrand;
/** Keys or a pad: prompts and focus rings are on. */
export const usingKeysOrPad = () => device === 'keyboard' || device === 'gamepad';

function setDevice(next, brand = null) {
  const root = document.documentElement;
  let changed = false;
  if (brand && brand !== padBrand) { padBrand = brand; root.dataset.pad = brand; changed = true; }
  if (next !== device) { device = next; root.dataset.input = next; changed = true; }
  if (!changed) return;
  for (const fn of [...deviceListeners]) { try { fn(device, padBrand); } catch { /* a listener */ } }
}

/** Listen for the device changing (keyboard -> gamepad -> mouse ...), or the pad's maker. */
export function onDevice(fn) { deviceListeners.add(fn); return () => deviceListeners.delete(fn); }
/** Listen for a gamepad being plugged in: (gamepad, brand). */
export function onPadConnected(fn) { connectListeners.add(fn); return () => connectListeners.delete(fn); }

/**
 * @param {{name?:string, modal?:boolean, scope?:()=>Element|null,
 *          onAction?:(a:{type:string, n?:number, key?:string, repeat?:boolean, source:string})=>boolean,
 *          onStick?:(vec:{x:number,y:number}|null)=>void}} handler
 * @returns {()=>void} removes it
 */
export function pushHandler(handler) {
  /* No stick vector is replayed to a new handler: screens push theirs while
     they are still being built, and one that walks off a held key before its
     own state exists would throw. A held direction arrives with the next key
     repeat or stick change instead (see the scene). */
  handlers.push(handler);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** The walking vector right now: keys, d-pad or the left stick (null when centred). */
export function stickVector() { return lastStick; }
export function onStick(fn) { stickListeners.add(fn); return () => stickListeners.delete(fn); }

/* ------------------------------------------------------------ dispatch -- */

/** The top modal layer on screen, if any. */
export function topLayer() {
  const overlays = document.querySelectorAll('.pp-overlay');
  if (overlays.length) return overlays[overlays.length - 1];
  return document.querySelector('.pp-dialogue');
}
const screenRoot = () => document.querySelector('#app > .pp-screen');

/* A handler whose element has left the page (a screen or pop-up removed by
   app.go) is dropped; one whose element is not in the page YET (a screen is
   built before app.go attaches it) is only passed over. */
function live(hd) {
  const el = hd.scope?.();
  if (!el) return true;
  if (el.isConnected) { hd.seen = true; return true; }
  if (hd.seen) { const i = handlers.indexOf(hd); if (i >= 0) handlers.splice(i, 1); }
  return false;
}

/** Send one action through the handlers, then the default. Exported for tests. */
export function dispatch(action) {
  const layer = topLayer();
  // Back first puts away a one-time tip (js/ui/app.js coach), the way a click on "Got it" does.
  if (action.type === 'cancel' && !layer) {
    const gotIt = document.querySelector('.pp-coach button');
    if (gotIt && isVisible(gotIt)) { gotIt.click(); return true; }
  }
  for (let i = handlers.length - 1; i >= 0; i -= 1) {
    const hd = handlers[i];
    if (!hd || (layer && !hd.modal) || !live(hd)) continue;
    try { if (hd.onAction?.(action)) return true; } catch (error) { console.error('[controls]', hd.name, error); }
    if (hd.modal) return defaultAction(action, hd.scope?.() || layer || screenRoot());
  }
  return defaultAction(action, layer || screenRoot());
}

function emitStick() {
  let vec = null;
  if (padVec) vec = padVec;
  else if (heldKeys.size) {
    let x = 0; let y = 0;
    for (const d of heldKeys) { x += DIRECTIONS[d][0]; y += DIRECTIONS[d][1]; }
    const len = Math.hypot(x, y);
    vec = len ? { x: x / len, y: y / len } : null;
  }
  const same = vec && lastStick && Math.abs(vec.x - lastStick.x) < 0.02 && Math.abs(vec.y - lastStick.y) < 0.02;
  if (same || (!vec && !lastStick)) return;
  lastStick = vec;
  const layer = topLayer();
  for (let i = handlers.length - 1; i >= 0; i -= 1) {
    const hd = handlers[i];
    if (!hd || (layer && !hd.modal) || !live(hd)) continue;
    if (hd.onStick) { try { hd.onStick(vec); } catch (error) { console.error('[controls]', hd.name, error); } break; }
  }
  for (const fn of [...stickListeners]) { try { fn(vec); } catch { /* a listener */ } }
}

/* ------------------------------------------------------ default: focus -- */

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="tab"]';

export function isVisible(el) {
  if (!el || !el.getClientRects().length) return false;
  if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}

/** Everything focus can move to inside `scope`. The chess board is driven by its own handler, never focused here. */
export function focusables(scope) {
  if (!scope) return [];
  return [...scope.querySelectorAll(FOCUSABLE)].filter((el) =>
    !el.disabled && !el.closest('.cwt-board') && el.dataset.nav !== 'skip' && isVisible(el));
}

const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

export function focusEl(el) {
  if (!el) return false;
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  return true;
}

/** Where focus lands when nothing in `scope` has it: the control marked [data-autofocus], else the first. */
export function firstFocus(scope) {
  const items = focusables(scope);
  return items.find((el) => el.hasAttribute('data-autofocus')) || items[0] || null;
}

/** Move focus to the nearest control in a direction; with nothing focused, the first one. */
export function moveFocus(scope, dir) {
  const items = focusables(scope);
  if (!items.length) return false;
  const current = items.includes(document.activeElement) ? document.activeElement : null;
  if (!current) return focusEl(firstFocus(scope));
  const [vx, vy] = DIRECTIONS[dir];
  const c = centre(current);
  let best = null;
  for (const el of items) {
    if (el === current) continue;
    const p = centre(el);
    const dx = p.x - c.x; const dy = p.y - c.y;
    const along = dx * vx + dy * vy;
    if (along <= 2) continue;
    const across = Math.abs(dx * vy - dy * vx);
    const score = along + across * 2.5;
    if (!best || score < best.score) best = { el, score };
  }
  return best ? focusEl(best.el) : true;          // nothing that way: stay put, but the key was used
}

function stepControl(el, dir) {
  if (el.tagName === 'SELECT') {
    const next = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + (dir === 'right' ? 1 : -1)));
    if (next !== el.selectedIndex) { el.selectedIndex = next; el.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  }
  if (el.type === 'range') {
    if (dir === 'right') el.stepUp(); else el.stepDown();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

/** Press the focused control, as a click would. */
export function activate(el) {
  if (!el) return false;
  if (el.tagName === 'SELECT' || el.type === 'range') return true;
  if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TYPING.test(el.type))) { el.focus(); return true; }
  const labelOf = (b) => b.getAttribute('aria-label') || b.textContent.trim();
  const label = labelOf(el);
  const scope = el.closest('.pp-overlay, .pp-dialogue, .pp-screen') || document.body;
  el.click();
  /* Panels that repaint their buttons (the lesson player's Next, a page of
     tabs) drop focus along with the old ones. Put it back on the button with
     the same label, or on the one marked autofocus, so the next press of
     accept presses again instead of first having to find it. Not when focus
     went somewhere on purpose (a pop-up), nor when the screen changed. */
  const restore = () => {
    const active = document.activeElement;
    if ((active && active !== document.body) || !scope.isConnected) return;
    const items = focusables(scope);
    const target = (label && items.find((b) => labelOf(b) === label)) || items.find((b) => b.hasAttribute('data-autofocus'));
    if (target) focusEl(target);
  };
  setTimeout(restore, 0);
  return true;
}

function defaultAction(a, scope) {
  if (!scope) return false;
  if (DIRECTIONS[a.type]) {
    const el = document.activeElement;
    if ((a.type === 'left' || a.type === 'right') && el && scope.contains(el) && (el.tagName === 'SELECT' || el.type === 'range')) return stepControl(el, a.type);
    return moveFocus(scope, a.type);
  }
  if (a.type === 'accept') {
    const el = document.activeElement;
    if (el && el !== document.body && scope.contains(el) && focusables(scope).includes(el)) return activate(el);
    return focusEl(firstFocus(scope));
  }
  if (a.type === 'cancel') {
    const back = [...scope.querySelectorAll('[data-back]')].find(isVisible);
    if (back) { back.click(); return true; }
  }
  return false;
}

/* ------------------------------------------------------------ keyboard -- */

const isTypingIn = (el) => !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && TYPING.test(el.type)));

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const typing = isTypingIn(e.target);
  // In a text field only leaving it is ours: up/down move on, Esc gives the keys back.
  if (typing && !['arrowup', 'arrowdown', 'escape'].includes(key)) return;
  const onRange = e.target?.type === 'range' || e.target?.tagName === 'SELECT';
  let type = KEY_ACTION[key] || null;
  let n;
  if (!type && DIGITS.has(key)) { type = 'digit'; n = Number(key); }
  if (!type) {
    if (/^[a-z]$/.test(key)) { setDevice('keyboard'); dispatch({ type: 'key', key, repeat: e.repeat, source: 'keyboard' }); }
    return;
  }
  setDevice('keyboard');
  if (typing && type === 'cancel') { e.target.blur(); e.preventDefault(); return; }
  if (DIRECTIONS[type]) {
    if (!heldKeys.has(type)) { heldKeys.add(type); emitStick(); }
    if (onRange && (type === 'up' || type === 'down')) e.preventDefault();
  } else if (e.repeat) {
    e.preventDefault();           // a held E or Esc must not press twice
    return;
  }
  const used = dispatch({ type, n, key, repeat: e.repeat, source: 'keyboard' });
  // Space and the arrows scroll the page and press focused buttons natively:
  // once an action has used the key, the browser must not do it again - and a
  // button pressed with Space clicks on keyup, so that is swallowed too.
  if (used) { e.preventDefault(); swallowedKeys.add(e.code); }
}

function onKeyUp(e) {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const type = KEY_ACTION[key];
  if (swallowedKeys.delete(e.code)) e.preventDefault();
  if (DIRECTIONS[type] && heldKeys.delete(type)) emitStick();
}

/* ------------------------------------------------------------- gamepad -- */

let padPrev = {};
let padRepeat = {};
let polling = false;

function readPad(pad) {
  const b = (i) => { const x = pad.buttons[i]; return !!x && (x.pressed || x.value > 0.5); };
  const brand = brandFor(pad);
  const map = PAD_BUTTONS[brand];
  const lx = pad.axes[0] || 0; const ly = pad.axes[1] || 0;
  // As a menu direction the stick counts along its stronger axis only, so a
  // push slightly off straight does not also step sideways.
  const vertical = Math.abs(ly) >= Math.abs(lx);
  const state = {
    up: b(12) || (vertical && ly < -PAD.navDead), down: b(13) || (vertical && ly > PAD.navDead),
    left: b(14) || (!vertical && lx < -PAD.navDead), right: b(15) || (!vertical && lx > PAD.navDead),
    accept: b(map.accept), cancel: b(map.cancel),
    skill1: b(2), skill2: b(3),
    prevTab: b(4), nextTab: b(5),
    journal: b(8), map: b(9)
  };
  // walking: the analog stick first, the d-pad as whole directions
  let vec = null;
  const mag = Math.hypot(lx, ly);
  if (mag > PAD.walkDead) vec = { x: lx / Math.max(1, mag), y: ly / Math.max(1, mag) };
  else {
    const x = (b(15) ? 1 : 0) - (b(14) ? 1 : 0); const y = (b(13) ? 1 : 0) - (b(12) ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len) vec = { x: x / len, y: y / len };
  }
  return { brand, state, vec };
}

function pollPads() {
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  if (!pads.length) { polling = false; padVec = null; emitStick(); return; }
  const now = performance.now();
  // the pad with anything pressed wins; otherwise the first
  let chosen = null;
  for (const pad of pads) {
    const r = readPad(pad);
    if (!chosen || Object.values(r.state).some(Boolean) || r.vec) { chosen = r; if (Object.values(r.state).some(Boolean) || r.vec) break; }
  }
  const { brand, state, vec } = chosen;
  const active = Object.values(state).some(Boolean) || !!vec;
  if (active) setDevice('gamepad', brand);
  for (const [type, down] of Object.entries(state)) {
    const was = padPrev[type];
    if (down && !was) {
      padRepeat[type] = now + PAD.repeatDelay;
      dispatch(type === 'skill1' || type === 'skill2'
        ? { type: 'digit', n: type === 'skill1' ? 1 : 2, alias: type, source: 'gamepad' }
        : { type, source: 'gamepad' });
    } else if (down && DIRECTIONS[type] && now >= (padRepeat[type] || Infinity)) {
      padRepeat[type] = now + PAD.repeatRate;
      dispatch({ type, repeat: true, source: 'gamepad' });
    }
  }
  padPrev = state;
  const changed = (vec && !padVec) || (!vec && padVec) || (vec && padVec && (Math.abs(vec.x - padVec.x) > 0.02 || Math.abs(vec.y - padVec.y) > 0.02));
  if (changed) { padVec = vec; emitStick(); }
  requestAnimationFrame(pollPads);
}

function startPolling() {
  if (polling) return;
  polling = true;
  requestAnimationFrame(pollPads);
}

/* --------------------------------------------------------------- setup -- */

/** Wire the listeners once, at boot. */
export function installControls() {
  if (started) return;
  started = true;
  const root = document.documentElement;
  root.dataset.input = device;
  root.dataset.pad = padBrand;
  // On document, not window: real key presses reach both, and so does a key
  // a tool fires at document without bubbling (tools/cdp_dock.py).
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { if (heldKeys.size) { heldKeys.clear(); emitStick(); } });
  // the mouse takes over when it MOVES (not on the synthetic moves a re-layout fires)
  let lastXY = null;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (lastXY && Math.hypot(e.clientX - lastXY[0], e.clientY - lastXY[1]) > 4) setDevice('mouse');
    lastXY = [e.clientX, e.clientY];
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => setDevice(e.pointerType === 'touch' ? 'touch' : 'mouse'), { capture: true, passive: true });
  window.addEventListener('gamepadconnected', (e) => {
    const brand = brandFor(e.gamepad);
    if (brand !== padBrand) { padBrand = brand; root.dataset.pad = brand; for (const fn of [...deviceListeners]) { try { fn(device, padBrand, e.gamepad); } catch { /* a listener */ } } }
    for (const fn of [...connectListeners]) { try { fn(e.gamepad, brand); } catch { /* a listener */ } }
    startPolling();
  });
  // some browsers only report a pad after a button press, and never fire the event
  setInterval(() => { if (!polling && [...(navigator.getGamepads?.() || [])].some(Boolean)) startPolling(); }, 1000);
}

export default { installControls, pushHandler, dispatch, stickVector, onStick, onDevice, onPadConnected, setPadLayout, inputDevice, gamepadBrand, usingKeysOrPad, brandOf, topLayer, moveFocus, firstFocus, focusables, focusEl, activate, isVisible, DIRECTIONS };
