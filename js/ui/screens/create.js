/**
 * create.js - character creation, in two pages.
 *
 *   1. Who are you?   avatar, name, how hard the opposition should be
 *   2. Home city      the one choice that changes the game
 *
 * It used to be one screen with both panels side by side, and on a phone the
 * two would not fit: the city list - question 4, and the only question that
 * HAS to be answered - was squeezed off the bottom. One question per page
 * needs no squeezing at any size, and it puts the home city on a page of its
 * own, which is where it belongs: the starting city is the jam's "class", and
 * it decides the one opening the player begins at 40%.
 *
 * Nothing is committed until "Get my passport" on page 2. Both pages stay in
 * the DOM and are shown and hidden, so going Back keeps every answer.
 * Difficulty can be changed later in Settings, and only ever affects games
 * not yet played.
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

const PAGES = 2;

export function createScreen(app) {
  let avatar = 'boy';
  let clubId = null;
  let difficulty = DIFFICULTY.default;
  let page = 0;

  const avatarButtons = ['boy', 'girl'].map((id) => {
    const b = h('button.pp-avatar', {
      type: 'button', 'aria-pressed': String(id === avatar),
      onclick: () => { avatar = id; sfx.click(); refresh(); }
    }, spriteCanvas(PLAYER_LOOKS[id], { scale: 6 }), h('b', { text: id === 'boy' ? 'Boy' : 'Girl' }));
    b.dataset.id = id;
    return b;
  });

  const name = h('input.pp-input', {
    type: 'text', maxlength: '16', placeholder: 'Your name', autocomplete: 'off', 'aria-label': 'Player name',
    oninput: () => refresh(),
    /* Enter is "I have answered this" everywhere else; here it is Next. */
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); goTo(1); } }
  });

  const cityButtons = CLUBS.map((club) => {
    const opening = openingById(club.openingId);
    const b = h('button.pp-city', {
      type: 'button', 'aria-pressed': 'false',
      onclick: () => { clubId = club.clubId; sfx.stamp(); refresh(); }
    },
      /* NOT loading="lazy". These six live on page 2, which is behind a
         display:none until Next is pressed, so a lazy image here never starts
         loading at all - it just makes page 2 appear blank and then pop, and
         it hangs anything that calls img.decode() on a page-1 screenshot
         (every screenshot tool in tools/ did). Eager, they fetch while the
         player is still typing a name, which is exactly when there is time. */
      h('img', { src: `assets/cities/${club.clubId}.webp`, alt: '' }),
      h('span.pp-badge.pp-city__side', null, sideIcon(opening.side, { size: 'sm' }), h('span', { text: opening.side === 'w' ? ' White' : ' Black' })),
      h('div.pp-city__body', null,
        h('div.pp-city__name', { text: `${club.city}` }),
        h('div.pp-small', { text: club.clubName }),
        h('div', null, h('b', { text: opening.name }), ` starts at ${MASTERY.starting}%`),
        h('div.pp-small.pp-muted', { text: `Star Player: ${starById(club.starPlayerId).name}` })));
    b.dataset.id = club.clubId;
    return b;
  });

  const summary = h('p.pp-small.pp-create__summary');
  const step = h('p.pp-small.pp-muted.pp-create__step');

  const start = button('Get my passport', () => {
    const career = newCareer({ name: name.value, avatar, startClubId: clubId, difficulty });
    app.setCareer(career);
    sfx.trophy();
    app.go('scene', { sceneId: career.location.sceneId, arrival: true, intro: true });
  }, { cls: 'pp-btn--gold', icon: pixelIcon('passport', { size: 'sm' }) });

  const next = button('Next', () => goTo(1), { cls: 'pp-btn--gold', icon: pixelIcon('play', { size: 'sm' }) });

  /* Page 1: who you are. */
  const whoPage = h('section.pp-panel.pp-col.pp-create__who.pp-create__page', null,
    /* The questions scroll; the buttons under them never do. A creator whose
       confirm button you have to go looking for is one people get stuck in. */
    h('div.pp-create__ask', null,
      h('h2.pp-h2', { text: '1. Boy or girl?' }),
      h('div.pp-avatar-pick', null, avatarButtons),
      h('h2.pp-h2', { text: '2. Your name' }),
      name,
      h('h2.pp-h2', { text: '3. How strong are your opponents?' }),
      difficultyPicker(difficulty, (id) => { difficulty = id; sfx.click(); }, { compact: true }),
      h('p.pp-small.pp-muted', { text: 'Changeable later in Settings, and it only ever affects games you have not played yet.' })),
    h('div.pp-row.pp-create__go', null,
      next,
      button('Back', () => app.go('title'), { cls: 'pp-btn--small' })));

  /* Page 2: the home city, on its own, with room for all six. */
  const cityPage = h('section.pp-panel.pp-create__cities.pp-create__page', { hidden: true },
    h('h2.pp-h2', { text: '4. Home city' }),
    h('p.pp-small.pp-muted', { text: `Your home club's opening starts at ${MASTERY.starting}%. Don't worry: you can visit every city later, in any order.` }),
    h('div.pp-cities', null, cityButtons),
    h('div.pp-create__foot', null,
      summary,
      h('div.pp-row.pp-create__go', null,
        start,
        button('Back', () => goTo(0), { cls: 'pp-btn--small', icon: pixelIcon('back', { size: 'sm' }) }))));

  function goTo(to) {
    page = Math.max(0, Math.min(PAGES - 1, to));
    sfx.click();
    whoPage.hidden = page !== 0;
    cityPage.hidden = page !== 1;
    refresh();
    // Land the keyboard on the first thing this page asks for.
    setTimeout(() => (page === 0 ? name : cityButtons[0]).focus({ preventScroll: true }), 30);
  }

  function refresh() {
    for (const b of avatarButtons) { const on = b.dataset.id === avatar; b.classList.toggle('is-picked', on); b.setAttribute('aria-pressed', String(on)); }
    for (const b of cityButtons) { const on = b.dataset.id === clubId; b.classList.toggle('is-picked', on); b.setAttribute('aria-pressed', String(on)); }
    const club = CLUBS.find((c) => c.clubId === clubId);
    const who = name.value.trim() || 'Rookie';
    summary.textContent = club
      ? `${who} starts in ${club.city}, already knowing a bit of the ${openingById(club.openingId).name} (${MASTERY.starting}%). The other openings are learned on the road.`
      : 'Pick a home city. It only decides your first opening.';
    summary.classList.toggle('is-ready', !!club);
    step.textContent = page === 0
      ? `Step 1 of ${PAGES}: who you are`
      : `Step 2 of ${PAGES}: where ${who} starts`;
    start.disabled = !club;
  }

  const el = h('div.pp-screen.pp-create', null,
    h('div.pp-create__wrap', null,
      h('img.pp-create__logo', { src: 'assets/ui/logo.webp', alt: 'Pawn & Passport' }),
      h('img.pp-create__sub', { src: 'assets/ui/logo-sub.webp', alt: 'A Chess Career RPG' }),
      step,
      h('div.pp-create__grid', null, whoPage, cityPage)));

  refresh();
  setTimeout(() => name.focus(), 50);
  return { el };
}

export default createScreen;
