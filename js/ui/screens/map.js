/**
 * map.js - the stylised world map: six cities and Madrid.
 *
 * Each pin shows that city's trophy and postcard state. Choosing a pin opens a
 * travel card (club, casual venue, opening, progress) and flying there shows
 * the city's arrival card. Madrid stays locked until all six Club Trophies.
 */

import { h, button, wait } from '../dom.js';
import { sfx, startMusic } from '../audio.js';
import { CLUBS, FINALE, clubById } from '../../data/clubs.js';
import { openingById } from '../../data/openings.js';
import { starById } from '../../data/starPlayers.js';
import { postcardForClub } from '../../data/postcards.js';
import { hasAllTrophies, trophyCount, postcardCount, missionProgress, masteryState, travelTo } from '../../core/career.js';

export function mapScreen(app) {
  const career = app.career;
  startMusic();
  const here = career.location.clubId;
  const stage = h('div.pp-map__stage', { role: 'main', 'aria-label': 'World map' });
  const card = h('div.pp-map__card');
  const plane = h('div.pp-map__plane', { text: '✈', 'aria-hidden': 'true' });

  // Dotted routes from home to every visited city.
  const svgNS = 'http://www.w3.org/2000/svg';
  const routes = document.createElementNS(svgNS, 'svg');
  routes.setAttribute('class', 'pp-map__routes');
  routes.setAttribute('viewBox', '0 0 100 100');
  routes.setAttribute('preserveAspectRatio', 'none');
  const home = clubById(career.startClubId).mapPin;
  for (const club of CLUBS) {
    if (club.clubId === career.startClubId || !career.visited[club.clubId]) continue;
    const p = club.mapPin;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', `M ${home.x} ${home.y} Q ${(home.x + p.x) / 2} ${Math.min(home.y, p.y) - 8} ${p.x} ${p.y}`);
    routes.append(path);
  }
  stage.append(routes);

  const finaleOpen = hasAllTrophies(career);
  const pins = [...CLUBS.map((club) => ({ id: club.clubId, club, pin: club.mapPin })), { id: FINALE.id, finale: true, pin: FINALE.mapPin }];
  for (const entry of pins) {
    const trophy = entry.club && career.trophies[entry.club.clubId];
    const postcard = entry.club && career.postcards[postcardForClub(entry.club.clubId).id];
    const locked = entry.finale && !finaleOpen;
    const label = entry.finale ? `${locked ? '🔒' : '🏟'} Madrid` : entry.club.city;
    const b = h('button.pp-pin', {
      type: 'button',
      class: [here === entry.id ? 'is-here' : '', locked ? 'is-locked' : '', entry.finale ? 'is-finale' : ''].join(' '),
      style: { left: `${entry.pin.x}%`, top: `${entry.pin.y}%` },
      'aria-label': entry.finale ? `Madrid Grand Finale${locked ? ', locked' : ''}` : `${entry.club.city}${trophy ? ', trophy won' : ''}${postcard ? ', postcard collected' : ''}`,
      onclick: () => { sfx.click(); select(entry); }
    },
      h('span.pp-pin__flag', null, label,
        entry.club ? h('span', { text: trophy ? '🏆' : '', title: 'Club Trophy' }) : null,
        entry.club ? h('span', { text: postcard ? '✉' : '', title: 'Postcard' }) : null),
      h('span.pp-pin__stem'), h('span.pp-pin__dot'));
    stage.append(b);
  }
  plane.style.left = `${(clubById(here)?.mapPin || FINALE.mapPin).x}%`;
  plane.style.top = `${(clubById(here)?.mapPin || FINALE.mapPin).y - 7}%`;
  stage.append(plane);

  async function fly(entry, sceneId) {
    sfx.plane();
    plane.style.left = `${entry.pin.x}%`;
    plane.style.top = `${entry.pin.y - 7}%`;
    await wait(1100);
    const clubId = entry.finale ? FINALE.id : entry.club.clubId;
    const firstVisit = !entry.finale && !career.visited[clubId];
    travelTo(career, clubId, sceneId);
    app.save();
    app.go('scene', { sceneId, arrival: true, firstVisit });
  }

  function select(entry) {
    card.replaceChildren();
    if (entry.finale) {
      card.append(h('div.pp-panel', null,
        h('h2.pp-h2', { text: `${FINALE.city}: ${FINALE.eventName}` }),
        finaleOpen
          ? h('p', { text: `All six Star Players are waiting at the ${FINALE.venueName}, stronger than when you met them. Win three rounds to qualify for the Big Leagues.` })
          : h('p', { text: `Locked. Win all six Club Trophies to receive your invitation (${trophyCount(career)}/6).` }),
        h('div.pp-row', null,
          button(finaleOpen ? 'Fly to Madrid' : 'Locked', () => fly(entry, FINALE.scenes.exterior), { cls: 'pp-btn--gold', disabled: !finaleOpen, icon: '✈' }),
          button('Close', () => card.replaceChildren(), { cls: 'pp-btn--small' }))));
      return;
    }
    const club = entry.club;
    const opening = openingById(club.openingId);
    const star = starById(club.starPlayerId);
    const mastery = career.openings[club.openingId] ?? 0;
    const mission = missionProgress(career, club.puzzleMissionId);
    const isHere = here === club.clubId;
    card.append(h('div.pp-panel', null,
      h('h2.pp-h2', { text: `${club.city}, ${club.country}` }),
      h('div.pp-col.pp-small', null,
        h('div', null, '♜ ', h('b', { text: club.clubName }), career.trophies[club.clubId] ? ` · 🏆 ${club.trophyName}` : ` · ${club.trophyName} not won`),
        h('div', null, '♟ ', h('b', { text: opening.name }), ` (${opening.side === 'w' ? 'White' : 'Black'}) · ${mastery}% ${masteryState(mastery).label}`),
        h('div', null, '★ Star Player: ', h('b', { text: star.name })),
        h('div', null, '☕ ', h('b', { text: club.casualLocationName }), ` · puzzles ${mission.solved}/${mission.total}${career.postcards[club.postcardId] ? ' · ✉ collected' : ''}`)),
      h('div.pp-row', { style: { marginTop: '10px' } },
        button(isHere ? 'Go to the club' : 'Fly to the club', () => (isHere ? app.go('scene', { sceneId: club.scenes.exterior }) : fly(entry, club.scenes.exterior)), { cls: 'pp-btn--gold', icon: '♜' }),
        button(isHere ? 'Casual venue' : 'Fly to the venue', () => (isHere ? app.go('scene', { sceneId: club.scenes.venue }) : fly(entry, club.scenes.venue)), { icon: '☕' }),
        button('Close', () => card.replaceChildren(), { cls: 'pp-btn--small' }))));
  }

  const legend = h('div.pp-map__legend.pp-panel.pp-small', null,
    h('div', null, '🏆 Club Trophies ', h('b', { text: `${trophyCount(career)}/6` })),
    h('div', null, '✉ Postcards ', h('b', { text: `${postcardCount(career)}/6` })),
    h('div', null, finaleOpen ? '🏟 Grand Finale: OPEN' : '🔒 Grand Finale: locked'));

  const el = h('div.pp-screen.pp-map', null, app.hud({ where: 'World map' }), stage, card, legend);
  const start = pins.find((p) => p.id === here);
  if (start && !start.finale) select(start);
  return { el };
}

export default mapScreen;
