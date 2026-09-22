/**
 * title.js - the travel-desk title screen.
 *
 * The background art already paints the logo and four menu slots. Real
 * buttons are laid exactly over those slots (percentages measured from the
 * image), so the labels and the disabled state belong to the game, not the
 * picture.
 */

import { h } from '../dom.js';
import { pixelIcon } from '../icons.js';
import { sfx } from '../audio.js';
import { GAME } from '../../data/config.js';
import { clubById } from '../../data/clubs.js';
import * as Save from '../../core/save.js';

export function titleScreen(app) {
  const career = app.career;
  const item = (icon, label, onClick, { disabled = false } = {}) => h('button.pp-title__item', {
    type: 'button', disabled,
    onclick: () => { sfx.click(); onClick(); },
    onmouseenter: () => sfx.hover()
  }, h('span', { 'aria-hidden': 'true' }, pixelIcon(icon, { size: 'lg' })), h('span', { text: label }));

  const newGame = async () => {
    if (career && !career.completed) {
      const ok = await app.overlay((close) => h('div.pp-panel.pp-modal', null,
        h('h2.pp-h2', { text: 'Start a new career?' }),
        h('p', { text: `This replaces ${career.name}'s passport (level ${career.level}, ${Object.keys(career.trophies).length}/6 trophies). Chess: World Tour saves are never touched.` }),
        h('div.pp-row', null,
          h('button.pp-btn.pp-btn--red', { type: 'button', text: 'Yes, new career', onclick: () => close(true) }),
          h('button.pp-btn', { type: 'button', text: 'Keep my career', onclick: () => close(false) }))));
      if (!ok) return;
      Save.deleteCareer();
      app.career = null;
    }
    app.go('create');
  };

  const cont = () => {
    if (!career) return;
    app.go(career.completed ? 'ending' : 'scene', { sceneId: career.location.sceneId });
  };

  // The art paints the logo and four menu slots for a landscape window. On a
  // window taller than it is wide, CSS turns the same art into a backdrop and
  // this logo plus the real buttons become the menu (css/layout.css).
  const stage = h('div.pp-title__stage', { role: 'main', 'aria-label': `${GAME.title}: ${GAME.subtitle}` },
    h('img.pp-title__logo', { src: 'assets/ui/logo.webp', alt: '' }),
    h('img.pp-title__logo-sub', { src: 'assets/ui/logo-sub.webp', alt: '' }),
    h('nav.pp-title__menu', { 'aria-label': 'Main menu' },
      item('play', career ? 'New Career' : 'New Game', newGame),
      item('journal', 'Continue', cont, { disabled: !career }),
      item('settings', 'Settings', () => app.go('settings', { back: { screen: 'title', params: {} } })),
      item('passport', career ? 'Journal' : 'Credits', () => (career
        ? app.go('journal', { back: { screen: 'title', params: {} } })
        : app.go('ending', { creditsOnly: true })))),
    career ? h('div.pp-title__continue-note', { text: `${career.name} · Lv ${career.level} · ${clubById(career.location.clubId)?.city || 'Madrid'}` }) : null,
    h('div.pp-title__version', { text: `v${GAME.version}` }));

  const el = h('div.pp-screen.pp-title', null, stage);
  return { el };
}

export default titleScreen;
