/**
 * icons.js - the game's pixel-art icon set, in one place.
 *
 * Every UI symbol the game draws comes from here. Screens name an icon; they
 * never name a file, a size or a sheet offset, so the art can be recut,
 * renamed or moved without touching a screen. The files themselves are made by
 * `python3 tools/build_pixel_icons.py` out of the artist's sheet
 * (`ui-pixel-icons.png`) into assets/ui/icons/<name>.png at 32x32 native.
 *
 *     pixelIcon('trophy')                        decorative, aria-hidden
 *     pixelIcon('map', { size: 'sm' })
 *     pixelIcon('settings', { label: 'Settings' })   announced as an image
 *
 * SIZES are CSS pixels, not source pixels: 'sm' 16, 'md' 24, 'lg' 32, 'xl' 48,
 * 'hero' 64. css/pap.css renders them with image-rendering: pixelated, so the
 * art stays crisp and never gets the browser's smoothing.
 *
 * A decorative icon is aria-hidden and contributes nothing to the accessible
 * name - the text beside it is the name. An icon that IS the control (a button
 * with no words) must pass `label`, and the caller still puts an aria-label on
 * the button itself; the two are belt and braces on purpose, because a pixel
 * arrow with no text is otherwise a button called "".
 */

import { h } from './dom.js';

/** Every icon in assets/ui/icons/, with what it means in this game. */
export const ICONS = Object.freeze({
  xp: 'experience, Focus and anything that sparkles',
  trophy: 'a Club Trophy',
  postcard: 'a postcard, and the mail',
  settings: 'settings, and the engine status line',
  map: 'the world map and travel',
  journal: 'the journal, a lesson, an opening book',
  dialogue: 'an NPC you can talk to',
  play: 'play, continue, next, forward',
  practice: 'the practice board, drills and puzzles',
  exit: 'leaving a room, going back out',
  passport: 'the passport page and flying somewhere',
  'side-white': 'playing White',
  'side-black': 'playing Black',
  pawn: 'your Elo rating, and chess in the abstract',
  coin: 'coins',
  club: 'a chess club, and the tournament',
  back: 'back, undo, retry',
  hint: 'a hint, an idea, the answer'
});

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/**
 * CSS pixels per size name. 32 is the art's own resolution.
 *
 * 'em' is the odd one out and has no fixed pixel size: it is 1.4em, for the
 * journal's book pages, whose whole layout is sized in container-query units.
 * An icon pinned to 24px there would grow and shrink out of step with the
 * words around it. The number below is only the width/height ATTRIBUTE, which
 * reserves space before the PNG has loaded; the class is what sizes it.
 */
export const ICON_SIZES = Object.freeze({ sm: 16, md: 24, lg: 32, xl: 48, hero: 64, em: 24 });

const PATH = (name) => `assets/ui/icons/${name}.png`;

/**
 * One icon.
 * @param {keyof ICONS} name
 * @param {{ size?:keyof ICON_SIZES, label?:string|null, cls?:string }} [opts]
 * @returns {HTMLImageElement}
 */
export function pixelIcon(name, { size = 'md', label = null, cls = '' } = {}) {
  if (!ICONS[name]) throw new Error(`icons.js: no icon named "${name}"`);
  const px = ICON_SIZES[size] || ICON_SIZES.md;
  return h(`img.pp-ico.pp-ico--${size}${cls ? `.${cls.split(' ').filter(Boolean).join('.')}` : ''}`, {
    src: PATH(name),
    width: px,
    height: px,
    alt: label || '',
    /* Decorative icons say nothing: the words next to them are the label.
       An icon that carries the meaning on its own gets role=img + its text. */
    'aria-hidden': label ? null : 'true',
    role: label ? 'img' : null,
    draggable: false,
    decoding: 'async'
  });
}

/** The White or Black side icon, from a colour letter. */
export const sideIcon = (colour, opts) => pixelIcon(colour === 'b' ? 'side-black' : 'side-white', opts);

/**
 * Icon + words, as one inline run. Used wherever a string used to start with a
 * glyph ("🏆 Champion!"), so the icon sits on the text's baseline box instead
 * of pushing the line height around.
 */
export function iconText(name, text, { size = 'sm', cls = '' } = {}) {
  return h(`span.pp-icotext${cls ? `.${cls.split(' ').filter(Boolean).join('.')}` : ''}`, null,
    pixelIcon(name, { size }), h('span', { text: String(text) }));
}

export default { pixelIcon, sideIcon, iconText, ICONS, ICON_NAMES, ICON_SIZES };
