/**
 * create.js - character creation: Boy or Girl, a name, a starting city.
 *
 * That is the whole creator on purpose. The starting city is the jam's
 * "class": it decides the one opening the player begins at 40%.
 */

import { h, button } from '../dom.js';
import { sfx } from '../audio.js';
import { spriteCanvas, PLAYER_LOOKS } from '../sprites.js';
import { CLUBS } from '../../data/clubs.js';
import { openingById } from '../../data/openings.js';
import { starById } from '../../data/starPlayers.js';
import { MASTERY } from '../../data/config.js';
import { newCareer } from '../../core/career.js';

export function createScreen(app) {
  let avatar = 'boy';
  let clubId = null;

  const avatarButtons = ['boy', 'girl'].map((id) => {
    const b = h('button.pp-avatar', {
      type: 'button', 'aria-pressed': String(id === avatar),
      onclick: () => { avatar = id; sfx.click(); refresh(); }
    }, spriteCanvas(PLAYER_LOOKS[id], { scale: 6 }), h('b', { text: id === 'boy' ? 'Boy' : 'Girl' }));
    b.dataset.id = id;
    return b;
  });

  const name = h('input.pp-input', { type: 'text', maxlength: '16', placeholder: 'Your name', autocomplete: 'off', 'aria-label': 'Player name',
    oninput: () => refresh() });

  const cityButtons = CLUBS.map((club) => {
    const opening = openingById(club.openingId);
    const b = h('button.pp-city', {
      type: 'button', 'aria-pressed': 'false',
      onclick: () => { clubId = club.clubId; sfx.stamp(); refresh(); }
    },
      h('img', { src: `assets/cities/${club.clubId}.webp`, alt: '', loading: 'lazy' }),
      h('span.pp-badge.pp-city__side', { text: opening.side === 'w' ? '♔ White' : '♚ Black' }),
      h('div.pp-city__body', null,
        h('div.pp-city__name', { text: `${club.city}` }),
        h('div.pp-small', { text: club.clubName }),
        h('div', null, h('b', { text: opening.name }), ` starts at ${MASTERY.starting}%`),
        h('div.pp-small.pp-muted', { text: `Star Player: ${starById(club.starPlayerId).name}` })));
    b.dataset.id = club.clubId;
    return b;
  });

  const summary = h('p.pp-small');
  const start = button('Get my passport', () => {
    const career = newCareer({ name: name.value, avatar, startClubId: clubId });
    app.setCareer(career);
    sfx.trophy();
    app.go('scene', { sceneId: career.location.sceneId, arrival: true, intro: true });
  }, { cls: 'pp-btn--gold', icon: '✈' });

  function refresh() {
    for (const b of avatarButtons) { const on = b.dataset.id === avatar; b.classList.toggle('is-picked', on); b.setAttribute('aria-pressed', String(on)); }
    for (const b of cityButtons) { const on = b.dataset.id === clubId; b.classList.toggle('is-picked', on); b.setAttribute('aria-pressed', String(on)); }
    const club = CLUBS.find((c) => c.clubId === clubId);
    summary.textContent = club
      ? `${name.value.trim() || 'Rookie'} starts in ${club.city} knowing ${openingById(club.openingId).name} at ${MASTERY.starting}%. Every other opening is learned by travelling and winning.`
      : 'Pick a starting city. It decides your first opening.';
    start.disabled = !club;
  }

  const el = h('div.pp-screen.pp-create', null,
    h('div.pp-create__wrap', null,
      h('img.pp-create__logo', { src: 'assets/ui/logo.webp', alt: 'Pawn & Passport' }),
      h('img.pp-create__sub', { src: 'assets/ui/logo-sub.webp', alt: 'A Chess Career RPG' }),
      h('div.pp-create__grid', null,
        h('section.pp-panel.pp-col', null,
          h('h2.pp-h2', { text: '1. Who are you?' }),
          h('div.pp-avatar-pick', null, avatarButtons),
          h('h2.pp-h2', { text: '2. Your name' }),
          name,
          h('div.pp-spacer'),
          summary,
          h('div.pp-row', null, start, button('Back', () => app.go('title'), { cls: 'pp-btn--small' }))),
        h('section.pp-panel', null,
          h('h2.pp-h2', { text: '3. Starting city' }),
          h('p.pp-small.pp-muted', { text: 'Your home club. You can travel to every other city later, in any order.' }),
          h('div.pp-cities', null, cityButtons)))));

  refresh();
  setTimeout(() => name.focus(), 50);
  return { el };
}

export default createScreen;
