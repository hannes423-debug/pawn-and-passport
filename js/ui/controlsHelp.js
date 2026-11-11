/**
 * controlsHelp.js - the Controls page (Settings > Controls).
 *
 * One tab per device: keyboard and mouse, the three gamepad families and
 * touch. Each shows the artist's diagram of the device and what every button
 * does, where it does it. It opens on the device in use, so a player holding
 * a DualSense sees Cross and Circle, not A and B.
 *
 * The bindings themselves live in js/ui/controls.js; this page only names
 * them. The pictures are the prompt sheet (js/ui/prompts.js) and the
 * controls sheets cut by tools/build_controls_art.py.
 */

import { h, button } from './dom.js';
import { sfx } from './audio.js';
import { inputDevice, gamepadBrand } from './controls.js';
import { prompt, promptSrc } from './prompts.js';

const ART = 'assets/ui/controls';

const DEVICES = [
  { id: 'keyboard', label: 'Keyboard & mouse', icon: 'device-keyboard', panel: 'panel-keyboard' },
  { id: 'xbox', label: 'Xbox', icon: 'device-xbox', panel: 'panel-xbox' },
  { id: 'playstation', label: 'PlayStation', icon: 'device-dualsense', panel: 'panel-playstation' },
  { id: 'nintendo', label: 'Nintendo', icon: 'device-joycon', panel: 'panel-nintendo' },
  { id: 'touch', label: 'Touch', icon: 'device-handheld', panel: null }
];

/** Every picture this page loads: tools/build-itch.sh checks each one is shipped. */
export const CONTROLS_ART = DEVICES.flatMap((d) => [d.icon, d.panel]).filter(Boolean);

const img = (name) => h('img', { src: promptSrc(name), alt: '', draggable: 'false' });
const cap = (text) => h('kbd.pp-keycap', { text });

/** The keys for an action on one device, as pictures. */
function keys(device, action) {
  if (device === 'keyboard') {
    switch (action) {
      case 'move': return [img('key-w'), img('key-a'), img('key-s'), img('key-d'), h('span.pp-muted', { text: 'or' }), img('key-up'), img('key-left'), img('key-down'), img('key-right')];
      case 'accept': return [img('key-e'), img('key-space'), cap('Enter')];
      case 'cancel': return [cap('Esc'), cap('Backspace')];
      case 'digits': return [cap('1'), h('span.pp-muted', { text: 'to' }), cap('9')];
      case 'panel': return [cap('H')];
      case 'tabs': return null;           // the tab bar is only buttons: the arrows reach it
      default: return [prompt(action, { device: 'keyboard' })];
    }
  }
  if (action === 'move') return [prompt('move', { device }), h('span.pp-muted', { text: 'or the left stick' })];
  if (action === 'tabs') return [prompt('prevTab', { device }), prompt('nextTab', { device })];
  if (action === 'digits' || action === 'panel') return null;
  return [prompt(action, { device })];
}

/** Where each action does what. `only` limits a row to keys or pads. */
const SECTIONS = [
  ['Everywhere', [
    ['move', 'Move between buttons'],
    ['accept', 'Press the button; continue a dialogue'],
    ['cancel', 'Back: close a pop-up, skip a dialogue, put a tip away']]],
  ['Walking in a club', [
    ['move', 'Walk'],
    ['accept', 'Do what the prompt in the corner says: talk, play, go in'],
    ['digits', 'Use a spot from the actions panel directly'],
    ['cancel', 'Reach the actions panel and the status bar; Back again returns'],
    ['panel', 'Show or hide the actions panel'],
    ['map', 'World map'],
    ['journal', 'Journal']]],
  ['On the chess board', [
    ['move', 'Move the cursor'],
    ['accept', 'Pick a piece up; press again on a square to move it there'],
    ['cancel', 'Put the piece back; with nothing in hand, go to the buttons beside the board (Back again returns)'],
    ['skill1', 'Hint (costs Focus)'],
    ['skill2', 'Undo your last move']]],
  ['Journal', [
    ['tabs', 'Turn the page']]]
];

const POINTER = {
  keyboard: ['The mouse works everywhere too: click or drag a piece to move it, click the floor to walk, click a label to use it.'],
  touch: [
    'Walk with the joystick in the bottom-left corner; the A button in the bottom-right does what its label says.',
    'Tap a piece, then its square (dragging works too). Tap a label in a club to walk there and use it.',
    'Settings > Touch controls turns the joystick on or off.']
};

function page(device) {
  const d = DEVICES.find((x) => x.id === device);
  const out = [];
  if (d.panel) out.push(h('img.pp-controls__panel', { src: `${ART}/${d.panel}.webp`, alt: `${d.label} controller`, draggable: 'false' }));
  if (device === 'touch') {
    out.push(...POINTER.touch.map((line) => h('p', { text: line })));
    return out;
  }
  for (const [title, rows] of SECTIONS) {
    const lines = rows.map(([action, what]) => {
      const pics = keys(device, action);
      return pics ? h('div.pp-controls__row', null, h('span.pp-controls__keys', null, pics), h('span', { text: what })) : null;
    }).filter(Boolean);
    if (lines.length) out.push(h('section.pp-controls__section', null, h('h3.pp-h3', { text: title }), lines));
  }
  if (POINTER[device]) out.push(...POINTER[device].map((line) => h('p.pp-small.pp-muted', { text: line })));
  if (device !== 'keyboard') {
    out.push(h('p.pp-small.pp-muted', { text: device === 'nintendo'
      ? 'Nintendo layout: A (the right button) accepts and B (the bottom one) goes back, as on a Switch.'
      : 'If the game shows the wrong buttons for your controller, pick its layout in Settings > Gamepad layout.' }));
  }
  return out;
}

export function showControls(app) {
  const current = inputDevice();
  let tab = current === 'gamepad' ? gamepadBrand() : current === 'touch' ? 'touch' : 'keyboard';
  return app.overlay((close) => {
    const tabs = h('nav.pp-controls__tabs', { 'aria-label': 'Device' });
    const body = h('div.pp-controls__body');
    const paint = () => {
      tabs.replaceChildren(...DEVICES.map((d) => h('button.pp-btn.pp-btn--small.pp-controls__tab', {
        type: 'button', class: d.id === tab ? 'is-active' : '', 'aria-pressed': String(d.id === tab),
        onclick: () => { tab = d.id; sfx.click(); paint(); }
      }, h('img', { src: `${ART}/${d.icon}.webp`, alt: '', draggable: 'false' }), h('span', { text: d.label }))));
      body.replaceChildren(...page(tab));
      body.scrollTop = 0;
    };
    paint();
    return h('div.pp-panel.pp-modal.pp-modal--wide.pp-controls', { role: 'dialog', 'aria-label': 'Controls' },
      h('h2.pp-h2', { text: 'Controls' }),
      tabs,
      body,
      h('div.pp-row', { style: { justifyContent: 'flex-end' } }, button('Close', () => close(), { cls: 'pp-btn--gold', back: true })));
  });
}

export default showControls;
