/**
 * create.js - character creation: Boy or Girl, a name, a starting city and
 * how hard the opposition should be.
 *
 * Small on purpose. The starting city is the jam's "class": it decides the one
 * opening the player begins at 40%. The difficulty can be changed later, in
 * Settings, and only ever affects games not yet played.
 */

import { h, button } from '../dom.js';
import { sfx } from '../audio.js';
import { spriteCanvas, PLAYER_LOOKS } from '../sprites.js';
import { CLUBS } from '../../data/clubs.js';
import { openingById } from '../../data/openings.js';
import { starById } from '../../data/starPlayers.js';
import { MASTERY, DIFFICULTY } from '../../data/config.js';
import { difficultyPicker } from '../difficultyPicker.js';
import { pixelIcon, sideIcon } from '../icons.js';
import { newCareer } from '../../core/career.js';

export function createScreen(app) {
  let avatar = 'boy';
  let clubId = null;
  let difficulty = DIFFICULTY.default;

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
      h('span.pp-badge.pp-city__side', null, sideIcon(opening.side, { size: 'sm' }), h('span', { text: opening.side === 'w' ? ' White' : ' Black' })),
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
    const career = newCareer({ name: name.value, avatar, startClubId: clubId, difficulty });
    app.setCareer(career);
    sfx.trophy();
    app.go('scene', { sceneId: career.location.sceneId, arrival: true, intro: true });
  }, { cls: 'pp-btn--gold', icon: pixelIcon('passport', { size: 'sm' }) });

  function refresh() {
    for (const b of avatarButtons) { const on = b.dataset.id === avatar; b.classList.toggle('is-picked', on); b.setAttribute('aria-pressed', String(on)); }
    for (const b of cityButtons) { const on = b.dataset.id === clubId; b.classList.toggle('is-picked', on); b.setAttribute('aria-pressed', String(on)); }
    const club = CLUBS.find((c) => c.clubId === clubId);
    summary.textContent = club
      ? `${name.value.trim() || 'Rookie'} starts in ${club.city}, already knowing a bit of the ${openingById(club.openingId).name} (${MASTERY.starting}%). The other openings are learned on the road.`
      : 'Pick a home city below. It only decides your first opening.';
    start.disabled = !club;
  }

  const el = h('div.pp-screen.pp-create', null,
    h('div.pp-create__wrap', null,
      h('img.pp-create__logo', { src: 'assets/ui/logo.webp', alt: 'Pawn & Passport' }),
      h('img.pp-create__sub', { src: 'assets/ui/logo-sub.webp', alt: 'A Chess Career RPG' }),
      h('div.pp-create__grid', null,
        /* The questions scroll; the two buttons never do. With the difficulty
           picker added, "Get my passport" fell off the bottom of a 900px-tall
           window, and a creator whose confirm button you have to scroll for is
           a creator people get stuck in. */
        h('section.pp-panel.pp-col.pp-create__who', null,
          h('div.pp-create__ask', null,
            h('h2.pp-h2', { text: '1. Boy or girl?' }),
            h('div.pp-avatar-pick', null, avatarButtons),
            h('h2.pp-h2', { text: '2. Your name' }),
            name,
            h('h2.pp-h2', { text: '3. How strong are your opponents?' }),
            difficultyPicker(difficulty, (id) => { difficulty = id; sfx.click(); }, { compact: true }),
            h('p.pp-small.pp-muted', { text: 'Changeable later in Settings, and it only ever affects games you have not played yet.' }),
            summary),
          h('div.pp-row.pp-create__go', null, start, button('Back', () => app.go('title'), { cls: 'pp-btn--small' }))),
        h('section.pp-panel.pp-create__cities', null,
          h('h2.pp-h2', { text: '4. Home city' }),
          h('p.pp-small.pp-muted', { text: `Your home club's opening starts at ${MASTERY.starting}%. Don't worry: you can visit every city later, in any order.` }),
          h('div.pp-cities', null, cityButtons)))));

  refresh();
  setTimeout(() => name.focus(), 50);
  return { el };
}

export default createScreen;
