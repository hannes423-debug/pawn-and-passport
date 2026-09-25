/**
 * map.js - the stylised world map: six cities and Madrid.
 *
 * Each pin shows that city's trophy and postcard state. Choosing a pin opens
 * the city preview (the artist's card frame, css .pp-citypop): the city's
 * picture, four tiles lit by what the player has earned there, the club, its
 * opening and Star Player, and two buttons - fly there, or back to the map.
 * Flying shows the city's arrival card. Madrid stays locked until all six
 * Club Trophies.
 *
 * The map art is a wide landscape picture. When the window is narrower than
 * the art (a phone held upright), the map is ZOOMED to fill the height of its
 * area and the player drags it sideways; it opens centred on the current
 * city and glides to any city that is chosen. A panel under the map then
 * holds the trophy count and the hint to drag.
 */

import { h, button, wait } from '../dom.js';
import { pixelIcon } from '../icons.js';
import { portraitUrl } from '../sprites.js';
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
        entry.finale ? pixelIcon(locked ? 'lock' : 'crown', { size: 'sm' }) : null, label,
        entry.club && trophy ? pixelIcon('trophy', { size: 'sm', label: 'Club Trophy' }) : null,
        entry.club && postcard ? pixelIcon('postcard', { size: 'sm', label: 'Postcard' }) : null),
      pixelIcon('pin', { size: 'lg', cls: 'pp-pin__marker' }));
    stage.append(b);
  }

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
    await wait(350);
    const clubId = entry.finale ? FINALE.id : entry.club.clubId;
    const firstVisit = !entry.finale && !career.visited[clubId];
    travelTo(career, clubId, sceneId);
    app.save();
    app.go('scene', { sceneId, arrival: true, firstVisit });
  }

  /* The city preview: the artist's frame with the game's content in its slots. */
  function select(entry) {
    centreOn(entry.pin);
    const id = entry.finale ? FINALE.id : entry.club.clubId;
    const isHere = here === id;
    const visited = isHere || !!career.visited[id];
    let title; let lines; let tiles; let portrait = null; let flyLabel; let canFly = true; let sceneId;
    if (entry.finale) {
      const won = !!career.finale?.won;
      title = FINALE.city;
      canFly = finaleOpen;
      sceneId = FINALE.scenes.exterior;
      flyLabel = isHere ? 'Go to the championship' : finaleOpen ? 'Fly to Madrid' : 'Locked';
      lines = [
        h('b', { text: FINALE.eventName }),
        h('span', { text: FINALE.venueName }),
        h('span', { text: finaleOpen ? 'The six Star Players are waiting, stronger than before.' : `Locked: win all six Club Trophies (${trophyCount(career)}/6).` })];
      tiles = [
        ['pin', visited, visited ? 'Visited' : 'Not visited yet'],
        ['trophy', finaleOpen, `Club Trophies ${trophyCount(career)}/6`],
        ['crown', won, won ? 'Grand Finale won' : 'Grand Finale not won yet'],
        ['postcard', postcardCount(career) >= 6, `Postcards ${postcardCount(career)}/6`]];
    } else {
      const club = entry.club;
      const opening = openingById(club.openingId);
      const star = starById(club.starPlayerId);
      const mastery = career.openings[club.openingId] ?? 0;
      const mission = missionProgress(career, club.puzzleMissionId);
      const won = !!career.trophies[club.clubId];
      const beaten = !!career.stars?.[star.id]?.beaten;
      const postcard = !!career.postcards[club.postcardId];
      title = club.city;
      sceneId = club.scenes.exterior;
      flyLabel = isHere ? 'Go to the club' : `Fly to ${club.city}`;
      portrait = portraitUrl(star.look, { ring: '#c8963e', ground: '#f6e7c8' });
      lines = [
        h('b', { text: club.clubName }),
        h('span', { text: `${opening.name} (${opening.side === 'w' ? 'White' : 'Black'}) \u00b7 you know ${mastery}%` }),
        h('span', { text: `Star Player: ${star.name}` })];
      tiles = [
        ['pin', visited, isHere ? 'You are here' : visited ? 'Visited' : 'Not visited yet'],
        ['trophy', won, won ? `${club.trophyName}: won` : `${club.trophyName}: not won yet`],
        ['crown', beaten, beaten ? `${star.name}: beaten` : `${star.name}: not beaten yet`],
        ['postcard', postcard, `${postcard ? 'Postcard collected' : 'Postcard not collected yet'}: ${club.casualLocationName}, puzzles ${mission.solved}/${mission.total}`]];
    }
    app.overlay((close) => h('div.pp-citypop', { role: 'dialog', 'aria-label': `${title}: city preview` },
      h('img.pp-citypop__pic', { src: `assets/cities/${id}.webp`, alt: '', draggable: 'false' }),
      h('img.pp-citypop__frame', { src: 'assets/ui/city-popup.png', alt: '', draggable: 'false' }),
      h('div.pp-citypop__title', null, h('span', { text: title })),
      ...tiles.map(([icon, lit, what], i) => h(`div.pp-citypop__tile.pp-citypop__tile--${i + 1}`, { class: lit ? 'is-lit' : '', title: what },
        pixelIcon(icon, { size: 'lg', label: what }))),
      portrait ? h('img.pp-citypop__portrait', { src: portrait, alt: '' }) : h('div.pp-citypop__portrait', null, pixelIcon('crown', { size: 'xl' })),
      h('div.pp-citypop__info', null, ...lines),
      h('button.pp-citypop__fly', {
        type: 'button', title: flyLabel, 'aria-label': flyLabel, disabled: !canFly,
        onclick: () => { sfx.click(); close(); if (isHere) app.go('scene', { sceneId }); else fly(entry, sceneId); }
      }, canFly ? null : pixelIcon('lock', { size: 'xl' })),
      h('button.pp-citypop__close', { type: 'button', title: 'Back to the map', 'aria-label': 'Back to the map', onclick: () => { sfx.click(); close(); } })));
  }

  const legend = h('div.pp-map__legend.pp-panel.pp-small', null,
    h('div', null, pixelIcon('trophy', { size: 'sm' }), ' Club Trophies ', h('b', { text: `${trophyCount(career)}/6` })),
    h('div', null, pixelIcon('postcard', { size: 'sm' }), ' Postcards ', h('b', { text: `${postcardCount(career)}/6` })),
    h('div', null, pixelIcon(finaleOpen ? 'crown' : 'lock', { size: 'sm' }), h('span', { text: finaleOpen ? ' Grand Finale: OPEN' : ' Grand Finale: locked' })));

  // What the bottom panel shows on a narrow screen when no city is open.
  const defaultPanel = h('div.pp-panel.pp-map__default', null,
    h('h2.pp-h2', { text: 'World map' }),
    h('p.pp-small', { text: 'Tap a city to travel. Drag the map to look around.' }),
    h('div.pp-small', null, pixelIcon('trophy', { size: 'sm' }), ` Club Trophies ${trophyCount(career)}/6 \u00b7 `,
      pixelIcon('postcard', { size: 'sm' }), ` Postcards ${postcardCount(career)}/6 \u00b7 `,
      pixelIcon(finaleOpen ? 'crown' : 'lock', { size: 'sm' }), h('span', { text: finaleOpen ? ' Grand Finale: OPEN' : ' Grand Finale: locked' })));

  const card = h('div.pp-map__card', null, defaultPanel);
  const el = h('div.pp-screen.pp-map', null, app.hud({ where: 'World map' }), area, card, legend);
  const start = pins.find((p) => p.id === here) || pins[pins.length - 1];
  requestAnimationFrame(() => {
    layout();
    centreOn(start.pin, false);
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
        h('div.pp-invite__seal', null, pixelIcon('crown', { size: 'hero' })),
        h('div.pp-small', { text: 'An invitation' }),
        h('h2.pp-h1', { text: FINALE.eventName }),
        h('p', { text: `${career.name}: with all six Club Trophies in your passport, you are invited to ${FINALE.venueName} in Madrid. The six Star Players are waiting, stronger than before. Win three rounds to qualify for the Big Leagues.` }),
        h('div.pp-row', { style: { justifyContent: 'center' } },
          button('Fly to Madrid', () => close('fly'), { cls: 'pp-btn--gold', icon: pixelIcon('passport', { size: 'sm' }) }),
          button('Later', () => close(null), { cls: 'pp-btn--small' }))), { dismissable: false });
      if (choice === 'fly') fly(pins.find((p) => p.finale), FINALE.scenes.exterior);
      return;
    }
    app.coach('map', 'Pick a city to see what waits there, then fly. Every city has its own club, Star Player and opening, in any order you like.', { title: 'World map' });
  }
  return { el, destroy() { ro.disconnect(); } };
}

export default mapScreen;
