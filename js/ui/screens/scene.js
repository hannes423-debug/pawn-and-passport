/**
 * scene.js - walking around a club, a venue or Madrid.
 *
 * The art is the room. The player sprite walks a waypoint graph from
 * js/data/scenes.js, and reaching a hotspot runs its action: enter the club,
 * play the tournament, talk to the Star Player, solve the venue puzzles.
 * Every hotspot is also a button in the dock, so nothing needs precise
 * clicking and the keyboard works (keys 1-9). On touch screens a joystick walks
 * the same graph link by link and the A button uses whatever is nearest.
 *
 * LAYERED scenes (js/data/sceneLayers.js, built by tools/build_layers.py) are
 * walked FREELY instead: the joystick, arrow keys or WASD move the player
 * anywhere on the floor with collision, a tap walks there along an A* path,
 * and every cut-out object is drawn in depth order with the characters, so
 * the player passes behind a lamp and in front of a table.
 */

import { h, button, wait, clear } from '../dom.js';
import { sfx, stopMusic } from '../audio.js';
import { drawCharacter, hasSheet, PLAYER_LOOKS, CELL } from '../sprites.js';
import { sceneById, findPath } from '../../data/scenes.js';
import { CLUBS, FINALE, clubById } from '../../data/clubs.js';
import { STAR_PLAYERS, starById, starForClub } from '../../data/starPlayers.js';
import { missionForClub } from '../../data/missions.js';
import { openingById } from '../../data/openings.js';
import { ELO, MASTERY } from '../../data/config.js';
import {
  travelTo, meetStar, enterTournament, currentRound, tier, regularElo, missionProgress,
  hasAllTrophies, enterFinale, currentFinaleRound, trophyCount, masteryState
} from '../../core/career.js';
import { starLines, loungeLines } from '../../core/dialogue.js';
import { createTouchpad, tapWord } from '../touch.js';
import { openOpeningStudy } from '../openingStudy.js';
import { learnFromTutorial } from '../../core/career.js';
import { SCENE_LAYERS } from '../../data/sceneLayers.js';
import { createWalkGrid, walkerFor } from '../../core/freeWalk.js';

const GUIDE_LOOK = { sprite: 'old-scarf', skin: '#d9a57c', hair: '#3a2a20', hairStyle: 'bun', top: '#2f5f8a', bottom: '#2a2f3a', accent: '#e8b04a' };
const WALK_SPEED = 42;           // percent of the stage height per second

/* A walk grid takes a moment to bake on a phone: build each scene's once. */
const walkGrids = new Map();
function walkGridFor(id, layers, aspect, actorHeight) {
  const key = `${id}:${aspect.toFixed(4)}:${actorHeight}`;
  if (!walkGrids.has(key)) walkGrids.set(key, createWalkGrid(layers, { aspect, walker: walkerFor(actorHeight) }));
  return walkGrids.get(key);
}

export async function sceneScreen(app, params) {
  const career = app.career;
  const scene = sceneById(params.sceneId) || sceneById(clubById(career.location.clubId)?.scenes.exterior) || sceneById('nyc-ext');
  const clubId = scene.id.slice(0, 3);
  const club = clubById(clubId);
  const isFinale = clubId === FINALE.id;
  travelTo(career, clubId, scene.id);
  app.save();
  stopMusic();

  const bg = h('img.pp-scene__bg', { src: scene.image, alt: '', draggable: 'false' });
  const actors = h('div.pp-scene__actors');
  const ACTOR_H = scene.actorHeight ?? (scene.placeholder ? 0.15 : 0.1);
  // Walking pace in proportion to the character's size, within limits.
  const SPEED = WALK_SPEED * Math.min(1.8, Math.max(0.9, ACTOR_H / 0.1));
  const hotspotLayer = h('div', { style: { position: 'absolute', inset: '0' } });
  const stage = h('div.pp-scene__stage', null, bg, actors, hotspotLayer);
  const viewport = h('div.pp-scene__viewport', null, stage);
  const dock = h('div.pp-scene__dock');
  const el = h('div.pp-screen.pp-scene', null, app.hud({ where: app.locationName() }), viewport, dock);

  /* The background must really arrive. A failed request (the dev server was
     killed for memory once, mid-play) used to leave a dark, image-less stage
     until the scene was re-entered, so retry with a cache-busting query. */
  await new Promise((resolve) => {
    let tries = 0;
    const done = () => (bg.naturalWidth ? resolve() : retry());
    const retry = () => {
      tries += 1;
      if (tries > 5) { resolve(); return; }
      setTimeout(() => { bg.src = `${scene.image}?retry=${tries}`; }, 400 * tries);
    };
    bg.onload = done;
    bg.onerror = retry;
    if (bg.complete) done();
  });
  bg.onload = () => fit();
  const aspect = (bg.naturalWidth || 16) / (bg.naturalHeight || 9);

  /* ---------------------------------------------------------- layout -- */
  let stageH = 600;
  const hudBar = el.firstChild;
  /* On a window much narrower than the art (a phone held upright) the scene
     fills the height and a camera follows the player sideways, instead of
     shrinking the room into a thin strip. */
  let camera = false;
  let stageW = 0;
  const fit = () => {
    // The HUD is shorter on phones and wraps to two rows in portrait.
    if (hudBar?.offsetHeight) { viewport.style.top = `${hudBar.offsetHeight}px`; el.style.setProperty('--hud-h', `${hudBar.offsetHeight}px`); }
    const vw = viewport.clientWidth || window.innerWidth;
    const vh = viewport.clientHeight || (window.innerHeight - 56);
    camera = vh * aspect > vw * 1.3;
    const w = camera ? vh * aspect : Math.min(vw, vh * aspect);
    stageW = w;
    stageH = w / aspect;
    stage.style.width = `${w}px`;
    stage.style.height = `${stageH}px`;
    viewport.classList.toggle('is-camera', camera);
    for (const actor of actorList) actor.resize();
    follow();
    requestAnimationFrame(nudgeLabels);
  };

  function follow() {
    if (!camera) { stage.style.transform = ''; return; }
    const who = actorList.find((a) => a.player);
    const vw = viewport.clientWidth;
    const target = vw / 2 - ((who ? who.x : 50) / 100) * stageW;
    const x = Math.max(vw - stageW, Math.min(0, target));
    stage.style.transform = `translate3d(${Math.round(x)}px, 0, 0)`;
  }

  /* A label centred on a spot near the edge of a narrow (portrait) stage
     hangs off the screen: slide the label, not the arrow, back inside. */
  function nudgeLabels() {
    const limit = el.getBoundingClientRect();
    const top = viewport.getBoundingClientRect().top;
    for (const spot of hotspotLayer.querySelectorAll('.pp-hotspot')) {
      spot.style.setProperty('--nudge', '0px');
      spot.style.setProperty('--nudge-y', '0px');
      const r = spot.getBoundingClientRect();
      const pad = 2;
      let dx = 0;
      // Off camera entirely: leave it where it is rather than pin it to the edge.
      if (r.right < limit.left || r.left > limit.right) continue;
      if (r.left < limit.left + pad) dx = limit.left + pad - r.left;
      else if (r.right > limit.right - pad) dx = limit.right - pad - r.right;
      spot.style.setProperty('--nudge', `${Math.round(dx)}px`);
      // A label near the top edge of the art would tuck under the HUD.
      if (r.top < top + pad) spot.style.setProperty('--nudge-y', `${Math.round(top + pad - r.top)}px`);
    }
  }

  /* ---------------------------------------------------------- actors -- */
  const actorList = [];
  function makeActor(look, [x, y], { dir = 'down', player = false } = {}) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pp-actor';
    const shadow = h('div.pp-actor__shadow');
    actors.append(shadow, canvas);
    const actor = {
      look, x, y, dir, frame: Math.floor(Math.random() * 4), walking: false, canvas, shadow, player,
      resize() {
        // Characters stand about a tenth of the scene tall; close-up scenes
        // set their own measured height (scenes.js actorHeight).
        const height = Math.max(40, Math.round(stageH * ACTOR_H));
        canvas.height = height;
        canvas.width = Math.round(height * CELL.W / CELL.H);
        shadow.style.width = `${canvas.width * 0.55}px`;
        shadow.style.height = `${canvas.width * 0.16}px`;
        this.height = height;
        this.draw();
      },
      draw() {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawCharacter(ctx, look, { dir: this.dir, frame: this.frame, walking: this.walking, height: this.height || 60 });
        canvas.style.left = `${this.x}%`; canvas.style.top = `${this.y}%`;
        shadow.style.left = `${this.x}%`; shadow.style.top = `${this.y}%`;
        canvas.style.zIndex = String(Math.round(this.y * 10));
      }
    };
    actorList.push(actor);
    return actor;
  }

  // NPCs attached to hotspots.
  for (const spot of scene.hotspots) {
    const npc = spot.npc;
    if (!npc) continue;
    if (npc.kind === 'rivals') {
      STAR_PLAYERS.slice(0, 6).forEach((star, i) => {
        const at = [npc.at[0] + (i % 3) * 5, npc.at[1] + Math.floor(i / 3) * 9];
        makeActor(star.look, at, { dir: i % 2 ? 'right' : 'left' });
      });
      continue;
    }
    const look = npc.kind === 'star' ? starForClub(clubId)?.look
      : npc.kind === 'host' ? missionForClub(clubId)?.host.look
      : club?.regularOpponentPool[npc.index % club.regularOpponentPool.length].look;
    if (look) makeActor(look, npc.at, { dir: 'down' });
  }

  /* Depth layers: each cut-out object sits in the actors layer, stacked by its ground line. */
  const layers = SCENE_LAYERS[scene.id] || null;
  const freeMode = !!layers;
  const grid = freeMode ? walkGridFor(scene.id, layers, aspect, ACTOR_H) : null;
  if (freeMode) {
    for (const prop of layers.props) {
      actors.append(h('img.pp-prop', {
        src: prop.src, alt: '', draggable: 'false', dataset: { prop: prop.id },
        style: { left: `${prop.x}%`, top: `${prop.y}%`, width: `${prop.w}%`, height: `${prop.h}%`, zIndex: String(Math.round(prop.base * 10)) }
      }));
    }
  }

  const spawnNode = (params.node && scene.nodes[params.node] ? params.node : null) || scene.spawn[params.spawn] || scene.spawn.default;
  let playerNode = spawnNode;
  const spawnAt = freeMode ? (grid.nearestFree(...scene.nodes[spawnNode]) || scene.nodes[spawnNode]) : scene.nodes[spawnNode];
  const player = makeActor(PLAYER_LOOKS[career.avatar], spawnAt, { dir: 'up', player: true });

  /* -------------------------------------------------------- walking -- */
  let walking = null;
  // The node the player is between playerNode and, while a walk is under way.
  // A walk interrupted mid-link (a new tap, the joystick) must either carry on
  // toward it or go back to playerNode: starting from path[1] regardless used
  // to cut straight across the room, through whatever was painted there.
  let headingNode = null;
  let stepClock = 0;
  /** Advance the walk animation and face the direction of travel (screen-space dx, dy). */
  function animateStep(dxPx, dy, dt) {
    if (Math.abs(dxPx) > 1e-6 || Math.abs(dy) > 1e-6) {
      player.dir = Math.abs(dxPx) > Math.abs(dy) ? (dxPx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
    }
    stepClock += dt;
    if (!player.walking) { player.walking = true; player.frame = 0; }
    if (stepClock > 0.09) {
      stepClock = 0;
      player.frame += 1;
      if (player.frame % 4 === 0) sfx.step();
    }
    player.draw();
    follow();
  }
  function stopWalking() {
    player.walking = false; player.frame = 0; player.draw();
    if (camera) nudgeLabels();
  }

  /** Free mode: walk a list of points (already collision-free) to the end. */
  function walkPoints(points) {
    const token = {};
    walking = token;
    return new Promise((resolve) => {
      let k = 0;
      let last = performance.now();
      const tick = (now) => {
        if (walking !== token) { stopWalking(); resolve(false); return; }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (k >= points.length) { stopWalking(); walking = null; resolve(true); return; }
        const [tx, ty] = points[k];
        const dxPx = (tx - player.x) * aspect;
        const dy = ty - player.y;
        const dist = Math.hypot(dxPx, dy);
        const step = SPEED * dt;
        if (dist <= step) { player.x = tx; player.y = ty; k += 1; }
        else { player.x += (dxPx / dist) * step / aspect; player.y += (dy / dist) * step; }
        animateStep(dxPx, dy, dt);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** Free mode: path to a point; resolves true on arrival. */
  async function walkToPoint(x, y) {
    const route = grid.path([player.x, player.y], [x, y]);
    if (!route) return false;
    playerNode = null;
    return walkPoints(route);
  }

  function walkTo(target) {
    if (freeMode) {
      const [x, y] = scene.nodes[target];
      return walkToPoint(x, y).then((ok) => { if (ok) playerNode = target; return ok; });
    }
    const path = findPath(scene, playerNode, target);
    if (!path) return Promise.resolve(false);
    const token = {};
    walking = token;
    return new Promise((resolve) => {
      const [sx, sy] = scene.nodes[playerNode];
      const onNode = Math.abs(player.x - sx) < 0.01 && Math.abs(player.y - sy) < 0.01;
      let segment = onNode || path[1] === headingNode ? 1 : 0;
      let last = performance.now();
      let stepClock = 0;
      const tick = (now) => {
        if (walking !== token) { player.walking = false; player.draw(); resolve(false); return; }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (segment >= path.length) {
          player.walking = false; player.frame = 0; player.draw();
          playerNode = target; headingNode = null; walking = null;
          if (camera) nudgeLabels();
          resolve(true); return;
        }
        headingNode = path[segment];
        const [tx, ty] = scene.nodes[path[segment]];
        // Move in screen space so a wide scene does not make sideways walking fast.
        const dxPx = (tx - player.x) * aspect;
        const dy = ty - player.y;
        const dist = Math.hypot(dxPx, dy);
        const step = SPEED * dt;
        if (dist <= step) {
          player.x = tx; player.y = ty; playerNode = path[segment]; segment += 1;
        } else {
          player.x += (dxPx / dist) * step / aspect;
          player.y += (dy / dist) * step;
        }
        player.dir = Math.abs(dxPx) > Math.abs(dy) ? (dxPx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
        stepClock += dt;
        if (!player.walking) { player.walking = true; player.frame = 0; }
        if (stepClock > 0.09) {
          stepClock = 0;
          player.frame += 1;
          if (player.frame % 4 === 0) sfx.step();
        }
        player.draw();
        follow();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /* -------------------------------------------------------- hotspots -- */
  let busy = false;
  async function use(spot) {
    if (busy) return;
    busy = true;
    sfx.click();
    try {
      // Free mode: close enough already counts as there.
      const near = freeMode && distanceTo(spot) <= USE_RADIUS;
      if (near) playerNode = spot.node;
      const arrived = near || await walkTo(spot.node);
      if (arrived) await runAction(spot);
    } finally {
      busy = false;
      paintPad();
    }
  }

  function spotState(spot) {
    const t = spot.action.type;
    if (t === 'tournament' && club && career.trophies[clubId]) return 'is-done';
    if (t === 'mission' && club && career.postcards[club.postcardId]) return 'is-done';
    if (t === 'finale' && career.finale.won) return 'is-done';
    return '';
  }

  function drawHotspots() {
    clear(hotspotLayer);
    const list = h('div.pp-row');
    scene.hotspots.forEach((spot, i) => {
      const [x, y] = scene.nodes[spot.node];
      // Labels float just above a character's head, however tall characters are drawn here.
      const labelY = spot.npc?.at ? Math.min(y, spot.npc.at[1]) - ACTOR_H * 95 - 1 : y - Math.max(7, ACTOR_H * 70);
      hotspotLayer.append(h('button.pp-hotspot', {
        type: 'button', class: spotState(spot),
        style: { left: `${spot.npc?.at ? spot.npc.at[0] : x}%`, top: `${Math.max(4, labelY)}%` },
        'aria-label': `${spot.verb}: ${spot.label}`,
        onclick: (e) => { e.stopPropagation(); use(spot); }
      }, h('span.pp-hotspot__label', { text: `${i + 1}  ${spot.label}` }), h('span.pp-hotspot__arrow', { text: '▼' })));
      list.append(button(`${i + 1}. ${spot.verb}`, () => use(spot), { cls: 'pp-btn--small', title: spot.label }));
    });
    dock.replaceChildren(h('div.pp-panel', null, h('div.pp-scene__title', { text: app.locationName() }), list));
  }

  // Clicking empty floor walks there (free mode) or to the nearest waypoint.
  stage.addEventListener('click', (e) => {
    if (busy) return;
    const rect = stage.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    if (freeMode) { walkToPoint(px, py).then(() => paintPad()); return; }
    let best = null;
    for (const [id, [x, y]] of Object.entries(scene.nodes)) {
      const d = Math.hypot((x - px) * aspect, y - py);
      if (!best || d < best.d) best = { id, d };
    }
    if (best) walkTo(best.id);
  });

  /* Arrow keys and WASD walk freely in a layered scene. */
  const held = new Set();
  const KEY_VEC = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  const keyVector = () => {
    let x = 0; let y = 0;
    for (const k of held) { x += KEY_VEC[k][0]; y += KEY_VEC[k][1]; }
    const len = Math.hypot(x, y);
    return len ? { x: x / len, y: y / len } : null;
  };
  const onKeyUp = (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!held.delete(k)) return;
    if (!stickHeld) stick = keyVector();
  };
  document.addEventListener('keyup', onKeyUp);

  const onKey = (e) => {
    if (document.querySelector('.pp-overlay, .pp-dialogue')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (freeMode && KEY_VEC[key]) {
      e.preventDefault();
      if (!held.has(key)) {
        held.add(key);
        if (!stickHeld) { stick = keyVector(); if (!blocked()) { if (walking && !driving) walking = null; drive(); } }
      }
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= scene.hotspots.length) use(scene.hotspots[n - 1]);
    if (e.key === 'm' || e.key === 'M') app.go('map');
    if (e.key === 'j' || e.key === 'J') app.go('journal', { back: app.backParams() });
  };
  document.addEventListener('keydown', onKey);

  /* ----------------------------------------------------- touch walking -- */
  const adjacent = {};
  for (const [a, b] of scene.links) {
    (adjacent[a] = adjacent[a] || []).push(b);
    (adjacent[b] = adjacent[b] || []).push(a);
  }
  const blocked = () => busy || !!document.querySelector('.pp-overlay, .pp-dialogue');
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  /** The linked node that best matches the stick, measured in screen space from where the player stands now. */
  function nodeToward(vec) {
    const len = Math.hypot(vec.x, vec.y) || 1;
    const ux = vec.x / len; const uy = vec.y / len;
    const candidates = new Set(adjacent[playerNode] || []);
    if (headingNode) { candidates.add(headingNode); candidates.add(playerNode); }
    let best = null;
    for (const id of candidates) {
      const [x, y] = scene.nodes[id];
      const dx = (x - player.x) * aspect; const dy = y - player.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.5) continue;
      const score = (dx * ux + dy * uy) / d;       // cosine: 1 = straight ahead
      if (score > 0.5 && (!best || score > best.score)) best = { id, score };
    }
    return best?.id || null;
  }

  let stick = null;
  let stickHeld = false;
  let driving = false;
  async function drive() {
    if (driving) return;
    driving = true;
    if (freeMode) {
      // Direct control: velocity from the stick (analog) or keys, sliding along obstacles.
      let last = performance.now();
      let padClock = 0;
      try {
        while (stick && !blocked()) {
          await nextFrame();
          const now = performance.now();
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          if (!stick) break;
          const mag = Math.min(1, Math.hypot(stick.x, stick.y));
          const len = Math.hypot(stick.x, stick.y) || 1;
          const step = SPEED * dt * (0.35 + 0.65 * mag);
          const dxPx = (stick.x / len) * step;
          const dy = (stick.y / len) * step;
          const r = grid.move(player.x, player.y, dxPx / aspect, dy);
          const mdx = (r.x - player.x) * aspect;
          const mdy = r.y - player.y;
          player.x = r.x; player.y = r.y;
          playerNode = null;
          // Face where the stick points even against a wall.
          animateStep(r.moved ? mdx : dxPx, r.moved ? mdy : dy, dt);
          padClock += dt;
          if (padClock > 0.2) { padClock = 0; paintPad(); }
        }
      } finally {
        driving = false;
        stopWalking();
        paintPad();
      }
      return;
    }
    try {
      while (stick && !blocked()) {
        const target = nodeToward(stick);
        if (!target) {
          // Nothing that way: face it, so the stick still feels alive.
          const dir = Math.abs(stick.x * aspect) > Math.abs(stick.y) ? (stick.x < 0 ? 'left' : 'right') : (stick.y < 0 ? 'up' : 'down');
          if (!walking && player.dir !== dir) { player.dir = dir; player.draw(); }
          await nextFrame();
          continue;
        }
        if (!(await walkTo(target))) break;
        paintPad();
      }
    } finally {
      driving = false;
      paintPad();
    }
  }

  const USE_RADIUS = 8;     // screen-space percent of the scene height
  const distanceTo = (spot) => {
    const [x, y] = scene.nodes[spot.node];
    return Math.hypot((x - player.x) * aspect, y - player.y);
  };

  /** What A does: the hotspot underfoot, otherwise the nearest one (walk there, then use it). */
  function spotForAction() {
    if (freeMode) {
      let best = null;
      for (const spot of scene.hotspots) {
        const d = distanceTo(spot);
        if (!best || d < best.d) best = { spot, d };
      }
      return best ? { spot: best.spot, ready: best.d <= USE_RADIUS } : null;
    }
    if (!walking) {
      const here = scene.hotspots.find((spot) => spot.node === playerNode);
      if (here) return { spot: here, ready: true };
    }
    let best = null;
    for (const spot of scene.hotspots) {
      const [x, y] = scene.nodes[spot.node];
      const d = Math.hypot((x - player.x) * aspect, y - player.y);
      if (!best || d < best.d) best = { spot, d };
    }
    return best ? { spot: best.spot, ready: false } : null;
  }

  const pad = createTouchpad({
    onStick(vec) {
      stickHeld = !!vec;
      stick = vec || keyVector();
      if (vec && !blocked()) {
        if (walking && !driving) walking = null;     // the stick overrides a tap-to-walk
        drive();
      }
    },
    onAction() {
      if (blocked()) return;
      const pick = spotForAction();
      if (pick) use(pick.spot);
    }
  });
  function paintPad() {
    const pick = spotForAction();
    pad.setAction(pick ? (pick.ready ? pick.spot.verb : `Go: ${pick.spot.label}`) : '', pick?.ready);
  }
  viewport.append(pad.el);

  /* --------------------------------------------------------- actions -- */
  async function runAction(spot) {
    const a = spot.action;
    switch (a.type) {
      case 'scene': sfx.step(); return app.go('scene', { sceneId: a.to, spawn: a.spawn });
      case 'leave': return leaveMenu();
      case 'tournament': return tournamentDesk();
      case 'star': return starOffice();
      case 'friendly': return practiceRoom();
      case 'trophies': return trophyHall();
      case 'talk': return app.dialogue({ name: 'Club member', role: club.clubName, look: club.regularOpponentPool[2 % club.regularOpponentPool.length].look, lines: loungeLines(career, clubId) });
      case 'mission': return venueMission();
      case 'finale': return finaleStage();
      case 'rivals': return rivalsLounge();
      default: return null;
    }
  }

  async function leaveMenu() {
    const choice = await app.overlay((close) => h('div.pp-panel.pp-modal', null,
      h('h2.pp-h2', { text: 'Where to?' }),
      h('div.pp-col', null,
        button('World map', () => close('map'), { icon: '🗺', cls: 'pp-btn--gold' }),
        club && scene.kind !== 'venue' ? button(`${club.casualLocationName}`, () => close('venue'), { icon: '☕' }) : null,
        club && scene.kind === 'venue' ? button(`${club.clubName}`, () => close('club'), { icon: '♜' }) : null,
        button('Stay here', () => close(null), { cls: 'pp-btn--small' }))));
    if (choice === 'map') app.go('map');
    if (choice === 'venue') app.go('scene', { sceneId: club.scenes.venue });
    if (choice === 'club') app.go('scene', { sceneId: club.scenes.exterior, spawn: 'default' });
  }

  function playMatch({ kind, opponent, colour }) {
    app.go('match', { kind, opponent, colour, clubId, returnScene: scene.id, returnSpawn: playerNode });
  }

  async function tournamentDesk() {
    const star = starForClub(clubId);
    const opening = openingById(club.openingId);
    if (career.trophies[clubId]) {
      await app.dialogue({ name: 'Tournament director', role: club.tournamentConfig.name, look: GUIDE_LOOK,
        lines: [`The ${club.trophyName} is already yours, champion.`, 'The practice room is always open for a friendly game.'] });
      return;
    }
    const run = enterTournament(career, clubId);
    app.save();
    const round = currentRound(career, clubId);
    const choice = await app.overlay((close) => h('div.pp-panel.pp-modal', null,
      h('h2.pp-h2', { text: club.tournamentConfig.name }),
      h('p.pp-small', { text: `Two rounds against club regulars (a win or a draw clears a round), then ${star.name}, who must be beaten. Everyone here leans toward the ${opening.name}. Lose a round and you can simply challenge it again.` }),
      h('ol.pp-col', { style: { paddingLeft: '20px', margin: '8px 0' } },
        run.rounds.map((r, i) => h('li', null,
          h('b', { text: r.kind === 'star' ? `★ ${r.name}` : r.name }),
          ` · ${r.elo} Elo · ${r.style}`,
          i < run.round ? ' · ✔ cleared' : i === run.round ? ' · ◀ next' : ''))),
      h('p.pp-small.pp-muted', { text: `Difficulty tier ${run.tier + 1}/6 (set by the trophies you had when you entered).` }),
      h('div.pp-row', null,
        button(`Play round ${round.index + 1} as ${round.colour === 'w' ? 'White' : 'Black'}`, () => close('play'), { cls: 'pp-btn--gold', icon: '♞' }),
        button('Not yet', () => close(null), { cls: 'pp-btn--small' }))));
    if (choice !== 'play') return;
    if (round.kind === 'star') {
      meetStar(career, star.id);
      app.save();
      await app.dialogue({ name: star.name, role: star.title, look: star.look, lines: starLines(career, star.id, 'challenge') });
    }
    playMatch({
      kind: round.kind === 'star' ? 'star' : 'tournament',
      colour: round.colour,
      opponent: { id: round.opponentId, name: round.name, elo: round.elo, style: round.style, openingId: club.openingId,
        look: round.kind === 'star' ? star.look : club.regularOpponentPool.find((p) => p.id === round.opponentId)?.look }
    });
  }

  async function starOffice() {
    const star = starForClub(clubId);
    const first = meetStar(career, star.id);
    app.save();
    const lines = first ? star.lines.intro : starLines(career, star.id, 'office');
    const round = currentRound(career, clubId);
    const ready = round && round.kind === 'star';
    const actions = ready
      ? [{ id: 'play', label: `Challenge ${star.name.split(' ')[0]}`, cls: 'pp-btn--gold' }, { id: null, label: 'Later' }]
      : null;
    const choice = await app.dialogue({ name: star.name, role: star.title, look: star.look, lines, actions });
    if (!ready && !career.trophies[clubId] && !first) {
      app.toast(`Clear the ${club.tournamentConfig.name} regular rounds to face ${star.name}.`);
    }
    if (choice === 'play') {
      playMatch({ kind: 'star', colour: round.colour,
        opponent: { id: star.id, name: star.name, elo: round.elo, style: star.style, openingId: star.openingId, look: star.look } });
    }
  }

  /* The practice room: nothing here is rated. A friendly against a member, the
     puzzle collection, and the club opening's tutorial and drills. */
  async function practiceRoom() {
    const opening = openingById(club.openingId);
    const mastery = career.openings[club.openingId] ?? 0;
    const tutored = !!career.tutorialsDone?.[club.openingId];
    const host = club.regularOpponentPool[1 % club.regularOpponentPool.length];
    const option = (id, icon, label, sub, cls = '') => h('button.pp-practice__option', { type: 'button', class: cls, onclick: () => close(id) },
      h('span.pp-practice__icon', { text: icon }), h('span', null, h('b', { text: label }), h('span.pp-small.pp-muted', { text: sub })));
    let close;
    const choice = await app.overlay((c) => {
      close = c;
      return h('div.pp-panel.pp-modal.pp-practice', null,
        h('h2.pp-h2', { text: `${club.clubName}: practice room` }),
        h('p.pp-small', { text: `${host.name} runs the practice room. Nothing here changes your rating.` }),
        h('div.pp-col', null,
          option('friendly', '♞', 'Friendly game', 'Unrated. Play a club member as White or Black.'),
          option('puzzles', '🧩', 'Puzzles', 'Tactics from all six cities. Practice only: postcards are won at the venues.'),
          option('tutorial', '📖', `Tutorial: ${opening.name}`, tutored ? 'Walk through every line again.' : mastery > 0 ? 'Every line with notes.' : `Every line with notes. Finishing it unlocks the opening (${MASTERY.tutorialGrant}%).`, tutored ? '' : 'is-new'),
          option('drill', '🎯', `Drills: ${opening.name}`, mastery > 0 ? `Find the book move. Passing a set: +${MASTERY.drillGain}% (you know ${mastery}%).` : 'Do the tutorial first.')),
        h('div.pp-row', { style: { justifyContent: 'flex-end' } }, button('Leave', () => c(null), { cls: 'pp-btn--small' })));
    });
    if (choice === 'friendly') return friendlyGame();
    if (choice === 'puzzles') return app.go('puzzle', { practice: true, clubId, returnScene: scene.id });
    if (choice === 'tutorial') {
      const result = await openOpeningStudy(app, club.openingId, { mode: 'tutorial' });
      if (result.finishedMain) {
        const gained = learnFromTutorial(career, club.openingId);
        app.save();
        app.toast(gained ? `${opening.name} unlocked: ${career.openings[club.openingId]}%. Equip it in the Journal.` : `${opening.name} tutorial complete.`, { ms: 4200 });
      } else {
        app.toast('Step through the first line to the end to complete the tutorial.', { ms: 3200 });
      }
      return null;
    }
    if (choice === 'drill') {
      if (!(career.openings[club.openingId] > 0)) { app.toast('Do the tutorial first: it teaches the lines the drills ask about.'); return null; }
      return app.go('drill', { openingId: club.openingId, clubId, returnScene: scene.id });
    }
    return null;
  }

  async function friendlyGame() {
    const pool = club.regularOpponentPool;
    const regular = pool[Math.floor(Math.random() * pool.length)];
    const elo = regularElo(tier(career));
    const choice = await app.dialogue({
      name: regular.name, role: 'club regular', look: regular.look,
      lines: [`Fancy a friendly? It's unrated: no trophy and no rating on the line, but you'll still learn something.`, `I'm about ${elo}. I play the ${openingById(club.openingId).name} whenever I can.`],
      actions: [{ id: 'w', label: 'Play White', cls: 'pp-btn--gold' }, { id: 'b', label: 'Play Black', cls: 'pp-btn--gold' }, { id: null, label: 'No thanks' }]
    });
    if (!choice) return;
    playMatch({ kind: 'friendly', colour: choice, opponent: { id: regular.id, name: regular.name, elo, style: regular.style, openingId: club.openingId, look: regular.look } });
  }

  async function trophyHall() {
    await app.overlay((close) => h('div.pp-panel.pp-modal', null,
      h('h2.pp-h2', { text: `${club.clubName}: trophy hall` }),
      h('div.pp-tiles', null, CLUBS.map((c) => h('div.pp-tile', { class: career.trophies[c.clubId] ? 'pp-tile--epic' : '' },
        h('b.pp-trophy', { class: career.trophies[c.clubId] ? '' : 'is-empty', text: '🏆' }),
        h('span', { text: c.trophyName }), h('div.pp-small.pp-muted', { text: c.city })))),
      h('p', { text: career.trophies[clubId] ? `Your name is engraved on the ${club.trophyName}.` : `The ${club.trophyName} is still waiting for a name.` }),
      button('Close', () => close(), { cls: 'pp-btn--small' })));
  }

  async function venueMission() {
    const mission = missionForClub(clubId);
    const progress = missionProgress(career, mission.id);
    if (progress.complete) {
      await app.dialogue({ name: mission.host.name, role: club.casualLocationName, look: mission.host.look,
        lines: ['You already solved my set. Come back any time to replay them.'],
        actions: [{ id: 'replay', label: 'Replay puzzles' }, { id: null, label: 'Bye' }] })
        .then((c) => { if (c === 'replay') app.go('puzzle', { missionId: mission.id, returnScene: scene.id }); });
      return;
    }
    const choice = await app.dialogue({ name: mission.host.name, role: `${mission.title} · ${mission.theme}`, look: mission.host.look,
      lines: progress.solved ? [`${progress.solved} of ${progress.total} done. Ready for the rest?`] : mission.intro,
      actions: [{ id: 'go', label: 'Solve puzzles', cls: 'pp-btn--gold' }, { id: null, label: 'Later' }] });
    if (choice === 'go') app.go('puzzle', { missionId: mission.id, returnScene: scene.id });
  }

  async function finaleStage() {
    if (!hasAllTrophies(career)) {
      await app.dialogue({ name: 'Steward', role: FINALE.venueName, look: GUIDE_LOOK, lines: [`The Grand Finale is invitation only: six Club Trophies (${trophyCount(career)}/6).`] });
      return;
    }
    if (career.finale.won) return app.go('ending');
    const f = enterFinale(career);
    app.save();
    const round = currentFinaleRound(career);
    const star = starById(round.opponentId);
    const choice = await app.overlay((close) => h('div.pp-panel.pp-modal', null,
      h('h2.pp-h2', { text: FINALE.eventName }),
      h('p.pp-small', { text: `Three knockout rounds against returning Star Players at full strength (${ELO.finaleRounds.join(' / ')} Elo). Every round must be won; a lost round can be replayed. Win the final to qualify for the Big Leagues.` }),
      h('ol.pp-col', { style: { paddingLeft: '20px' } }, f.opponents.map((id, i) => {
        const s = starById(id);
        return h('li', null, h('b', { text: FINALE.rounds[i].label }), `: ${s.name} (${openingById(s.openingId).name}) · ${ELO.finaleRounds[i]}`,
          i < f.round ? ' · ✔' : i === f.round ? ' · ◀ next' : '');
      })),
      h('div.pp-row', null,
        button(`${round.label} vs ${star.name}`, () => close('play'), { cls: 'pp-btn--gold', icon: '♛' }),
        button('Not yet', () => close(null), { cls: 'pp-btn--small' }))));
    if (choice !== 'play') return;
    await app.dialogue({ name: star.name, role: `${round.label} · ${star.title}`, look: star.look, lines: starLines(career, star.id, 'finale') });
    app.go('match', { kind: 'finale', colour: round.colour, clubId: FINALE.id, returnScene: scene.id, returnSpawn: playerNode,
      opponent: { id: star.id, name: star.name, elo: round.elo, style: star.style, openingId: star.openingId, look: star.look } });
  }

  async function rivalsLounge() {
    for (const star of STAR_PLAYERS) {
      const again = await app.dialogue({ name: star.name, role: star.title, look: star.look, lines: starLines(career, star.id, 'finale'),
        actions: [{ id: 'next', label: 'Next rival' }, { id: null, label: 'Done' }] });
      if (again !== 'next') break;
    }
  }

  /* --------------------------------------------------- idle animation -- */
  const idleTimer = setInterval(() => {
    for (const actor of actorList) {
      if (actor.walking || !hasSheet(actor.look)) continue;
      actor.frame += 1;
      actor.draw();
    }
  }, 320);

  /* ---------------------------------------------------------- arrival -- */
  window.addEventListener('resize', fit);
  const viewportObserver = new ResizeObserver(() => fit());
  viewportObserver.observe(viewport);
  if (hudBar) viewportObserver.observe(hudBar);
  drawHotspots();
  document.fonts?.ready.then(() => nudgeLabels());
  paintPad();
  requestAnimationFrame(fit);

  (async () => {
    if (params.arrival) {
      sfx.stamp();
      await app.overlay((close) => {
        const card = h('div.pp-arrival', { onclick: () => close() },
          // A phone held upright gets the portrait loading screen.
          h('picture', null,
            h('source', { media: '(max-aspect-ratio: 13/10)', srcset: `assets/cities/${clubId}-portrait.webp` }),
            h('img', { src: `assets/cities/${clubId}.webp`, alt: isFinale ? 'Madrid' : club.city })),
          h('div.pp-arrival__tap', { text: `${tapWord()} to step off the plane` }));
        return card;
      });
    }
    if (params.intro) {
      const opening = openingById(club.openingId);
      await app.dialogue({ name: 'Passport officer', role: 'Welcome desk', look: GUIDE_LOOK, lines: [
        `Welcome to ${club.city}, ${career.name}. Your chess passport is issued.`,
        `It has six empty pages for Club Trophies. Win a club's tournament and beat its Star Player to fill one.`,
        `You already know a little of the ${opening.name}: ${MASTERY.starting}%. Win this club and you will master it.`,
        'Every city also has a casual venue with a puzzle challenge. Solve it for a postcard. Collect all six... and read the backs.',
        tapWord() === 'tap'
          ? 'Tap anything with a label, or walk with the stick and press A. Good games!'
          : 'Walk to anything with a label, or press its number. Good games!'
      ] });
    } else if (params.firstVisit && club) {
      const opening = openingById(club.openingId);
      const mastery = career.openings[club.openingId] ?? 0;
      app.toast(`${club.city}: home of the ${opening.name} (${mastery}% ${masteryState(mastery).label.toLowerCase()})`, { ms: 4200 });
    }
  })();

  return {
    el,
    destroy() {
      walking = null;
      stick = null;
      pad.destroy();
      clearInterval(idleTimer);
      viewportObserver.disconnect();
      window.removeEventListener('resize', fit);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
    }
  };
}

export default sceneScreen;
