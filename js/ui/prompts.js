/**
 * prompts.js - "press this" icons that follow the device in use.
 *
 * prompt('accept') is a small inline element that shows E on a keyboard, A on
 * an Xbox or Nintendo pad and Cross on a PlayStation one, and swaps the
 * picture the moment the player picks up a different device. With a mouse or
 * a touch screen it is hidden (css/pap.css), so a prompt can sit in any label
 * without cluttering the pointer layout.
 *
 * The art is the artist's prompt sheet, cut by tools/build_prompts.py into
 * assets/ui/prompts/. Keys the sheet does not draw (Esc, the digits, letters)
 * are CSS keycaps styled to match it.
 */

import { h } from './dom.js';
import { inputDevice, gamepadBrand, onDevice } from './controls.js';

const ART = 'assets/ui/prompts';

/** Every picture the prompts use: tools/build-itch.sh checks each one is shipped. */
export const PAD_PROMPTS = Object.freeze({
  xbox: { accept: 'xbox-a', cancel: 'xbox-b', skill1: 'xbox-x', skill2: 'xbox-y', move: 'xbox-dpad', map: 'xbox-menu', journal: 'xbox-view', prevTab: 'xbox-lb', nextTab: 'xbox-rb' },
  nintendo: { accept: 'nin-a', cancel: 'nin-b', skill1: 'nin-y', skill2: 'nin-x', move: 'nin-dpad', map: 'nin-plus', journal: 'nin-minus', prevTab: 'nin-l', nextTab: 'nin-r' },
  playstation: { accept: 'ps-cross', cancel: 'ps-circle', skill1: 'ps-square', skill2: 'ps-triangle', move: 'ps-dpad', map: 'ps-options', journal: 'ps-share', prevTab: 'ps-l1', nextTab: 'ps-r1' }
});
/** Keyboard: a picture from the sheet where it has one, a CSS keycap otherwise. */
export const KEY_PROMPTS = Object.freeze({
  accept: { img: 'key-e' },
  cancel: { cap: 'Esc' },
  skill1: { cap: '1' },
  skill2: { cap: '2' },
  move: { img: 'key-w' },
  map: { cap: 'M' },
  journal: { cap: 'J' },
  panel: { cap: 'H' }
});
/** What each action is called, for screen readers and the Controls page. */
export const ACTION_NAMES = Object.freeze({
  accept: 'Accept', cancel: 'Back', skill1: 'Skill 1', skill2: 'Skill 2', move: 'Move',
  map: 'Map', journal: 'Journal', prevTab: 'Previous tab', nextTab: 'Next tab', panel: 'Actions panel'
});

export const promptSrc = (name) => `${ART}/${name}.png`;

/** The picture (or keycap text) for an action on a device. */
export function promptFor(action, device = inputDevice(), brand = gamepadBrand()) {
  if (device === 'gamepad') {
    const name = PAD_PROMPTS[brand]?.[action] || PAD_PROMPTS.xbox[action];
    return name ? { img: name } : null;
  }
  return KEY_PROMPTS[action] || null;
}

function paint(el) {
  const pinned = el.dataset.device;
  const spec = PAD_PROMPTS[pinned] ? promptFor(el.dataset.action, 'gamepad', pinned) : promptFor(el.dataset.action, pinned || inputDevice());
  const key = spec ? `${spec.img || ''}|${spec.cap || ''}` : '';
  if (el.dataset.painted === key) return;
  el.dataset.painted = key;
  el.replaceChildren();
  if (!spec) { el.hidden = true; return; }
  el.hidden = false;
  if (spec.img) el.append(h('img', { src: promptSrc(spec.img), alt: '', draggable: 'false' }));
  else el.append(h('kbd.pp-keycap', { text: spec.cap }));
}

/**
 * An inline prompt for an action ('accept', 'cancel', 'skill1', 'skill2',
 * 'move', 'map', 'journal', 'prevTab', 'nextTab', 'panel').
 * `device` pins it to 'keyboard', 'xbox', 'nintendo' or 'playstation' (the
 * Controls page draws every device side by side).
 */
export function prompt(action, { device = null, cls = '' } = {}) {
  const el = h(`span.pp-prompt${cls ? `.${cls}` : ''}`, { 'aria-hidden': 'true', dataset: { action } });
  if (device) { el.dataset.device = device; el.classList.add('is-pinned'); }
  paint(el);
  return el;
}

/** Repaint every live prompt when the player changes device or pad. */
onDevice(() => { for (const el of document.querySelectorAll('.pp-prompt:not(.is-pinned)')) paint(el); });

export default prompt;
