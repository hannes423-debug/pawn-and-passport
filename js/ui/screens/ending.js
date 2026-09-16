/**
 * ending.js - "You have qualified for the Big Leagues", then the credits.
 *
 * Also doubles as the credits page from the title screen (creditsOnly). The
 * one place the player-facing build names Chess: World Tour outside the
 * secret page is here, in the credits, as the project this jam game grew from.
 */

import { h, button } from '../dom.js';
import { sfx } from '../audio.js';
import { portraitUrl, PLAYER_LOOKS } from '../sprites.js';
import { STAR_PLAYERS } from '../../data/starPlayers.js';
import { GAME } from '../../data/config.js';
import { hasAllPostcards } from '../../core/career.js';

export function endingScreen(app, params) {
  const career = app.career;
  const creditsOnly = params.creditsOnly || !career?.completed;
  if (!creditsOnly) sfx.trophy();

  const hero = creditsOnly ? h('div.pp-ending__hero', null, h('img', { src: 'assets/ui/logo.webp', alt: GAME.title, style: { width: 'min(420px, 80vw)' } }))
    : h('div.pp-ending__hero', null,
      h('img', { src: portraitUrl(PLAYER_LOOKS[career.avatar], { size: 160 }), alt: '', style: { width: '160px' } }),
      h('div.pp-ending__big', { text: 'You have qualified for the Big Leagues.' }),
      h('p', { style: { fontSize: '22px' }, text: `${career.name} arrived as an amateur with one opening at 40%. ${career.name} leaves Madrid with six Club Trophies, six mastered openings and a ${career.elo} rating.` }),
      h('div.pp-row', { style: { justifyContent: 'center' } }, STAR_PLAYERS.map((s) => h('img', { src: portraitUrl(s.look, { size: 72 }), alt: s.name, title: s.name }))),
      h('p', { text: 'Six rivals, six friends. The amateur circuit is finished.' }),
      hasAllPostcards(career)
        ? h('p', null, h('b', { text: 'And you read the postcards. You know this is not the end of the road.' }))
        : h('p.pp-small', { style: { opacity: 0.75 }, text: 'Some postcards are still out there, waiting to be read.' }));

  const credits = h('div.pp-credits', null,
    h('h3', { text: GAME.title }), h('div', { text: GAME.subtitle }),
    h('h3', { text: 'A jam game from' }), h('div', { text: 'the Chess: World Tour project' }),
    h('h3', { text: 'Art' }), h('div', { text: 'Club, city, map, journal, character and piece art: project art (see LICENSES.md)' }),
    
    h('h3', { text: 'Chess' }),
    h('div', { text: 'Stockfish 18 lite (GPLv3), the Stockfish developers' }),
    h('div', { text: 'chess.js (BSD-2-Clause), Jeff Hlywa' }),
    h('h3', { text: 'Fonts' }), h('div', { text: 'Jersey 15 and Press Start 2P (SIL Open Font License)' }),
    h('h3', { text: 'Sound' }), h('div', { text: 'Synthesised live in your browser' }),
    h('h3', { text: 'Thanks for playing' }),
    h('div.pp-row', { style: { justifyContent: 'center', marginTop: '20px' } },
      button(creditsOnly ? 'Back' : 'Back to the title', () => app.go('title'), { cls: 'pp-btn--gold' }),
      !creditsOnly ? button('Open the journal', () => app.go('journal', { back: { screen: 'ending', params: {} } })) : null));

  const el = h('div.pp-screen.pp-ending', null, hero, credits);
  return { el };
}

export default endingScreen;
