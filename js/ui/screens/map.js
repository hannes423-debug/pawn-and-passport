/**
 * map.js - the stylised world map: six cities and Madrid.
 *
 * Each pin shows that city's trophy and postcard state. Choosing a pin opens a
 * travel card (club, casual venue, opening, progress) and flying there shows
 * the city's arrival card. Madrid stays locked until all six Club Trophies.
 *
 * The map art is a wide landscape picture. When the window is narrower than
 * the art (a phone held upright), the map is ZOOMED to fill the height of its
 * area and the player drags it sideways; it opens centred on the current
 * city and glides to any city that is chosen. The travel card then sits in a
 * panel under the map instead of on top of it.
 */

import { h, button, wait } from '../dom.js';
import { pixelIcon } from '../icons.js';
import { sfx } from '../audio.js';
import { CLUBS, FINALE, clubById } from '../../data/clubs.js';
import { openingById } from '../../data/openings.js';
import { starById } from '../../data/starPlayers.js';
import { postcardForClub } from '../../data/postcards.js';
import { hasAllTrophies, trophyCount, postcardCount, missionProgress, masteryState, travelTo } from '../../core/career.js';

export function mapScreen(app) {
  const career = app.career;
  const here = career.location.clubId;
  const stage = h('div.pp-map__stage', { role: 'main', 'aria-label': 'World map' });
  const area = h('div.pp-map__area', null, stage);
  const card = h('div.pp-map__card');
  const plane = h('div.pp-map__plane', { 'aria-hidden': 'true' }, pixelIcon('passport', { size: 'lg' }));

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
    const label = entry.finale ? 'Madrid' : entry.club.city;
    const b = h('button.pp-pin', {
      type: 'button',
      class: [here === entry.id ? 'is-here' : '', locked ? 'is-locked' : '', entry.finale ? 'is-finale' : ''].join(' '),
      style: { left: `${entry.pin.x}%`, top: `${entry.pin.y}%` },
      'aria-label': entry.finale ? `Madrid Grand Finale${locked ? ', locked' : ''}` : `${entry.club.city}${trophy ? ', trophy won' : ''}${postcard ? ', postcard collected' : ''}`,
      onclick: () => { sfx.click(); select(entry); }
    },
      h('span.pp-pin__flag', null,
        entry.finale ? pixelIcon(locked ? 'exit' : 'club', { size: 'sm' }) : null, label,
        entry.club && trophy ? pixelIcon('trophy', { size: 'sm', label: 'Club Trophy' }) : null,
        entry.club && postcard ? pixelIcon('postcard', { size: 'sm', label: 'Postcard' }) : null),
      h('span.pp-pin__stem'), h('span.pp-pin__dot'));
    stage.append(b);
  }
  plane.style.left = `${(clubById(here)?.mapPin || FINALE.mapPin).x}%`;
  /* Clear of the city's name plate: the marker is a solid pixel icon now, not
     a thin glyph, and at -7% it sat on top of the label. */
  plane.style.top = `${(clubById(here)?.mapPin || FINALE.mapPin).y - 12}%`;
  stage.append(plane);

  /* ------------------------------------------------------ zoom and pan -- */
  const RATIO = 1672 / 941;
  let panX = 0;
  let size = { w: 0, h: 0, areaW: 0 };
  let panning = null;
  let dragged = false;

  function layout() {
    const areaW = area.clientWidth;
    const areaH = area.clientHeight;
    if (!areaW || !areaH) return;
    let w; let h; let top;
    if (areaW / areaH < 1.25) {
      // Narrow: zoom so the band of latitudes that holds the cities fills the area.
      h = areaH * 1.45;
      w = h * RATIO;
      top = areaH * 0.1 - h * 0.17;
    } else {
      w = Math.min(areaW, areaH * RATIO);
      h = w / RATIO;
      top = (areaH - h) / 2;
    }
    size = { w, h, areaW };
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    stage.style.top = `${top}px`;
    area.classList.toggle('is-pannable', w > areaW + 1);
    panTo(panX, false);
  }

  function clampPan(x) {
    if (size.w <= size.areaW) return (size.areaW - size.w) / 2;
    return Math.max(size.areaW - size.w, Math.min(0, x));
  }
  function panTo(x, animate = true) {
    panX = clampPan(x);
    stage.style.transition = animate ? 'transform 450ms ease' : 'none';
    stage.style.transform = `translate3d(${panX}px, 0, 0)`;
  }
  function centreOn(pin, animate = true) {
    if (!size.w) return;
    panTo(size.areaW / 2 - (pin.x / 100) * size.w, animate);
  }

  area.addEventListener('pointerdown', (e) => {
    if (!area.classList.contains('is-pannable')) return;
    panning = { id: e.pointerId, x: e.clientX, start: panX };
    dragged = false;
  });
  area.addEventListener('pointermove', (e) => {
    if (!panning || e.pointerId !== panning.id) return;
    const dx = e.clientX - panning.x;
    if (!dragged && Math.abs(dx) < 6) return;
    if (!dragged) { dragged = true; area.setPointerCapture?.(e.pointerId); }
    panTo(panning.start + dx, false);
  });
  const endPan = (e) => { if (panning && e.pointerId === panning.id) panning = null; };
  area.addEventListener('pointerup', endPan);
  area.addEventListener('pointercancel', endPan);
  // A drag must not also press the pin it started on.
  area.addEventListener('click', (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);

  const ro = new ResizeObserver(() => layout());
  ro.observe(area);

  async function fly(entry, sceneId) {
    sfx.plane();
    plane.style.left = `${entry.pin.x}%`;
    plane.style.top = `${entry.pin.y - 12}%`;
    await wait(1100);
    const clubId = entry.finale ? FINALE.id : entry.club.clubId;
    const firstVisit = !entry.finale && !career.visited[clubId];
    travelTo(career, clubId, sceneId);
    app.save();
    app.go('scene', { sceneId, arrival: true, firstVisit });
  }

  function closeCard() {
    card.replaceChildren(defaultPanel);
    el.classList.remove('has-card');
  }

  function select(entry) {
    card.replaceChildren();
    el.classList.add('has-card');
    centreOn(entry.pin);
    if (entry.finale) {
      card.append(h('div.pp-panel', null,
        h('h2.pp-h2', { text: `${FINALE.city}: ${FINALE.eventName}` }),
        finaleOpen
          ? h('p', { text: `All six Star Players are waiting at the ${FINALE.venueName}, stronger than when you met them. Win three rounds to qualify for the Big Leagues.` })
          : h('p', { text: `Locked. Win all six Club Trophies to receive your invitation (${trophyCount(career)}/6).` }),
        h('div.pp-row', null,
          button(finaleOpen ? 'Fly to Madrid' : 'Locked', () => fly(entry, FINALE.scenes.exterior), { cls: 'pp-btn--gold', disabled: !finaleOpen, icon: pixelIcon('passport', { size: 'sm' }) }),
          button('Close', () => closeCard(), { cls: 'pp-btn--small' }))));
      return;
    }
    const club = entry.club;
    const opening = openingById(club.openingId);
    const star = starById(club.starPlayerId);
    const mastery = career.openings[club.openingId] ?? 0;
    const mission = missionProgress(career, club.puzzleMissionId);
    const isHere = here === club.clubId;
    const won = !!career.trophies[club.clubId];
    /* City, club, trophy state, Travel: first and biggest. The rest is detail. */
    card.append(h('div.pp-panel.pp-mapcard', null,
      h('h2.pp-h2', { text: club.city }),
      h('div.pp-mapcard__club', null, h('b', { text: club.clubName })),
      h(`div.pp-mapcard__trophy${won ? '.is-won' : ''}`, null, pixelIcon('trophy', { size: 'sm' }),
        h('span', { text: won ? ` ${club.trophyName}: won!` : ` ${club.trophyName}: not won yet` })),
      h('div.pp-row', { style: { marginTop: '8px' } },
        button(isHere ? 'Go to the club' : 'Fly to the club', () => (isHere ? app.go('scene', { sceneId: club.scenes.exterior }) : fly(entry, club.scenes.exterior)), { cls: 'pp-btn--gold', icon: pixelIcon(isHere ? 'club' : 'passport', { size: 'sm' }) }),
        button(isHere ? 'Casual venue' : 'Fly to the venue', () => (isHere ? app.go('scene', { sceneId: club.scenes.venue }) : fly(entry, club.scenes.venue)), { icon: pixelIcon('postcard', { size: 'sm' }) }),
        button('Close', () => closeCard(), { cls: 'pp-btn--small' })),
      h('div.pp-col.pp-small.pp-muted.pp-mapcard__more', null,
        h('div', null, pixelIcon('pawn', { size: 'sm' }), ` ${opening.name} (${opening.side === 'w' ? 'White' : 'Black'}) \u00b7 you know ${mastery}%`),
        h('div', null, pixelIcon('xp', { size: 'sm' }), ` Star Player: ${star.name}`),
        h('div', null, pixelIcon('postcard', { size: 'sm' }), ` ${club.casualLocationName} \u00b7 puzzles ${mission.solved}/${mission.total}${career.postcards[club.postcardId] ? ' \u00b7 postcard collected' : ''}`))));
  }

  const legend = h('div.pp-map__legend.pp-panel.pp-small', null,
    h('div', null, pixelIcon('trophy', { size: 'sm' }), ' Club Trophies ', h('b', { text: `${trophyCount(career)}/6` })),
    h('div', null, pixelIcon('postcard', { size: 'sm' }), ' Postcards ', h('b', { text: `${postcardCount(career)}/6` })),
    h('div', null, pixelIcon('club', { size: 'sm' }), h('span', { text: finaleOpen ? ' Grand Finale: OPEN' : ' Grand Finale: locked' })));

  // What the bottom panel shows on a narrow screen when no city is open.
  const defaultPanel = h('div.pp-panel.pp-map__default', null,
    h('h2.pp-h2', { text: 'World map' }),
    h('p.pp-small', { text: 'Tap a city to travel. Drag the map to look around.' }),
    h('div.pp-small', null, pixelIcon('trophy', { size: 'sm' }), ` Club Trophies ${trophyCount(career)}/6 \u00b7 `,
      pixelIcon('postcard', { size: 'sm' }), ` Postcards ${postcardCount(career)}/6 \u00b7 `,
      pixelIcon('club', { size: 'sm' }), h('span', { text: finaleOpen ? ' Grand Finale: OPEN' : ' Grand Finale: locked' })));

  const el = h('div.pp-screen.pp-map', null, app.hud({ where: 'World map' }), area, card, legend);
  const start = pins.find((p) => p.id === here) || pins[pins.length - 1];
  requestAnimationFrame(() => {
    layout();
    centreOn(start.pin, false);
    if (start && !start.finale) select(start); else closeCard();
    if (area.classList.contains('is-pannable')) area.append(h('div.pp-map__drag', { 'aria-hidden': 'true', text: 'Drag the map to see every city' }));
    welcome();
  });

  /* The map's own lessons, once each: what it is for, and Madrid's invitation. */
  async function welcome() {
    if (finaleOpen && !career.taught?.madrid) {
      career.taught = { ...(career.taught || {}), madrid: true };
      app.save();
      sfx.trophy();
      const choice = await app.overlay((close) => h('div.pp-panel.pp-modal.pp-invite', null,
        h('div.pp-invite__seal', null, pixelIcon('club', { size: 'hero' })),
        h('div.pp-small', { text: 'An invitation' }),
        h('h2.pp-h1', { text: FINALE.eventName }),
        h('p', { text: `${career.name}: with all six Club Trophies in your passport, you are invited to ${FINALE.venueName} in Madrid. The six Star Players are waiting, stronger than before. Win three rounds to qualify for the Big Leagues.` }),
        h('div.pp-row', { style: { justifyContent: 'center' } },
          button('Fly to Madrid', () => close('fly'), { cls: 'pp-btn--gold', icon: pixelIcon('passport', { size: 'sm' }) }),
          button('Later', () => close(null), { cls: 'pp-btn--small' }))), { dismissable: false });
      if (choice === 'fly') fly(pins.find((p) => p.finale), FINALE.scenes.exterior);
      return;
    }
    app.coach('map', 'Pick a city, then Fly. Every city has its own club, Star Player and opening, in any order you like.', { title: 'World map' });
  }
  return { el, destroy() { ro.disconnect(); } };
}

export default mapScreen;
