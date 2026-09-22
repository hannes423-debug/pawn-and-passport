/**
 * ending.js - "You have qualified for the Big Leagues", then the credits.
 *
 * Also doubles as the credits page from the title screen (creditsOnly). The
 * one place the player-facing build names Chess: World Tour outside the
 * secret page is here, in the credits, as the project this jam game grew from.
 */

import { h, button } from '../dom.js';
import { pixelIcon } from '../icons.js';
import { sfx } from '../audio.js';
import { portraitUrl, PLAYER_LOOKS } from '../sprites.js';
import { STAR_PLAYERS } from '../../data/starPlayers.js';
import { GAME } from '../../data/config.js';
import { hasAllPostcards, postcardCount } from '../../core/career.js';
import { CLUBS } from '../../data/clubs.js';

export function endingScreen(app, params) {
  const career = app.career;
  const creditsOnly = params.creditsOnly || !career?.completed;
  if (!creditsOnly) sfx.trophy();

  const hero = creditsOnly ? h('div.pp-ending__hero', null, h('img', { src: 'assets/ui/logo.webp', alt: GAME.title, style: { width: 'min(420px, 80vw)' } }))
    : h('div.pp-ending__hero', null,
      h('img', { src: portraitUrl(PLAYER_LOOKS[career.avatar], { size: 160 }), alt: '', style: { width: '160px' } }),
      h('div.pp-ending__big', { text: 'You have qualified for the Big Leagues.' }),
      h('p', { style: { fontSize: '22px' }, text: `${career.name} arrived as an amateur with one opening at 40%. ${career.name} leaves Madrid with six Club Trophies, six mastered openings and a ${career.elo} rating.` }),
      /* The tour in one look: the six trophies, the six rivals, the numbers. */
      h('div.pp-ending__shelf', null, CLUBS.map((c) => h('div.pp-ending__trophy', null, h('span', null, pixelIcon('trophy', { size: 'xl' })), h('b', { text: c.trophyName }), h('small', { text: c.city })))),
      h('div.pp-ending__rivals', null, STAR_PLAYERS.map((s) => h('figure', null, h('img', { src: portraitUrl(s.look, { size: 72 }), alt: '' }), h('figcaption', { text: s.name.split(' ')[0] })))),
      h('p', { text: 'Six rivals, six friends. The amateur circuit is finished.' }),
      h('div.pp-ending__stats', null, [
        ['Games', career.stats.games], ['Wins', career.stats.wins], ['Peak Elo', career.stats.peakElo],
        ['Level', career.level], ['Best accuracy', career.stats.bestAccuracy === null ? '-' : `${career.stats.bestAccuracy}%`], ['Postcards', `${postcardCount(career)}/6`]
      ].map(([label, value]) => h('div', null, h('b', { text: String(value) }), h('span', { text: label })))),
      hasAllPostcards(career)
        ? h('div.pp-ending__secret', null,
          h('div.pp-ending__secretword', null, pixelIcon('xp', { size: 'lg' }), pixelIcon('xp', { size: 'lg' }), pixelIcon('xp', { size: 'lg' })),
          h('p', null, h('b', { text: 'And you read every postcard.' })),
          h('p', { text: 'Six backs, six first letters. Somebody was counting all along, and they have left something for you in the journal: Beyond the Tour.' }))
        : h('p.pp-small', { style: { opacity: 0.75 }, text: `Some postcards are still out there, waiting to be read (${postcardCount(career)}/6). Their backs hide a message.` }));

  const credits = h('div.pp-credits', null,
    h('h3', { text: GAME.title }), h('div', { text: GAME.subtitle }),
    h('h3', { text: 'A jam game from' }), h('div', { text: 'the Chess: World Tour project' }),
    h('h3', { text: 'Art' }), h('div', { text: 'Club, city, map, journal, character and piece art: project art (see LICENSES.md)' }),
    
    h('h3', { text: 'Chess' }),
    h('div', { text: 'Stockfish 18 lite (GPLv3), the Stockfish developers' }),
    h('div', { text: 'chess.js (BSD-2-Clause), Jeff Hlywa' }),
    h('h3', { text: 'Fonts' }), h('div', { text: 'Jersey 15 and Press Start 2P (SIL Open Font License)' }),
    h('h3', { text: 'Sound' }), h('div', { text: 'Synthesised live in your browser' }),
    h('h3', { text: 'Thanks for playing' }));

  // The buttons sit outside the rolling text so they are always on screen.
  const bar = h('div.pp-row.pp-ending__bar', null,
    button(creditsOnly ? 'Back' : 'Back to the title', () => app.go('title'), { cls: 'pp-btn--gold' }),
    !creditsOnly ? button(hasAllPostcards(career) ? 'Read Beyond the Tour' : 'Open the journal', () => app.go('journal', { tab: hasAllPostcards(career) ? 'beyond' : 'passport', back: { screen: 'ending', params: {} } })) : null,
    !creditsOnly ? button('Back to the world', () => app.go('map'), { cls: 'pp-btn--small' }) : null);

  const el = h('div.pp-screen.pp-ending', null, h('div.pp-ending__scroll', null, hero, credits), bar);
  return { el };
}

export default endingScreen;
