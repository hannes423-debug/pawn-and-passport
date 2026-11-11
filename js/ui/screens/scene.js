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
 * LAYERED scenes (js/data/sceneLayers.js, built by tools/build_occlusion.py) are
 * walked FREELY instead: the joystick, arrow keys or WASD move the player
 * anywhere on the floor with collision, a tap walks there along an A* path,
 * and the artist's occlusion layer is drawn in depth order with the
 * characters, so the player passes behind a lamp and in front of a table.
 */

import { h, button, wait, clear } from '../dom.js';
import { sfx } from '../audio.js';
import { drawCharacter, PLAYER_LOOKS, CELL, portraitUrl, renderScale, directionsFor } from '../sprites.js';
import { facingFor, createStride } from '../../core/locomotion.js';
import { sceneById, findPath } from '../../data/scenes.js';
import { CLUBS, FINALE, clubById } from '../../data/clubs.js';
import { STAR_PLAYERS, starById, starForClub } from '../../data/starPlayers.js';
import { missionForClub } from '../../data/missions.js';
import { openingById } from '../../data/openings.js';
import { ELO, MASTERY, COINS } from '../../data/config.js';
import {
  travelTo, meetStar, enterTournament, currentRound, tier, regularElo, missionProgress,
  hasAllTrophies, enterFinale, currentFinaleRound, trophyCount, masteryState,
  memberElo, finaleElo, stakeFor, canAfford, nextStep, entryFee
} from '../../core/career.js';
import { MEMBERS, CHESS_TIPS } from '../../data/members.js';
import { MEMBER_SPOTS } from '../../data/memberSpots.js';
import { TOURNAMENT } from '../../data/config.js';
import { formatBlurb, eventView, roundLabel, statusBanner } from '../tournamentView.js';
import { exitRound } from '../../core/tournament.js';
import { starLines, loungeLines } from '../../core/dialogue.js';
import { createTouchpad, tapWord, isTouch } from '../touch.js';
import { openOpeningStudy } from '../openingStudy.js';
import { learnFromTutorial } from '../../core/career.js';
import { practiceSummary } from '../../core/lessons.js';
import { SCENE_LAYERS } from '../../data/sceneLayers.js';
import { SCENE_LAYERS_FLOOR } from '../../data/sceneLayersFloor.js';
import { createWalkGrid, walkerFor } from '../../core/freeWalk.js';
import { pixelIcon, sideIcon } from '../icons.js';
import { pushHandler, DIRECTIONS, firstFocus, focusEl, stickVector } from '../controls.js';
import { prompt } from '../prompts.js';

const GUIDE_LOOK = { sprite: 'old-scarf', skin: '#d9a57c', hair: '#3a2a20', hairStyle: 'bun', top: '#2f5f8a', bottom: '#2a2f3a', accent: '#e8b04a' };
/**
 * Who a hotspot's NPC is: { id, name, look }. The overworld draws this person
 * and the hotspot's dialogue shows the same one, so the face in the box is
 * always the person the player walked up to (2026-11-08: the tournament desk
 * drew a club regular but spoke with a generic old man; the practice room's
 * friendly was played against a random regular, not the one standing there).
 */
export function personAt(clubId, npc) {
  if (!npc) return null;
  if (npc.kind === 'star') { const s = starForClub(clubId); return s ? { id: s.id, name: s.name, look: s.look } : null; }
  if (npc.kind === 'host') { const m = missionForClub(clubId); return m ? { id: m.host.id || `${clubId}-host`, name: m.host.name, look: m.host.look } : null; }
  if (npc.kind === 'member') return npc.member ? { id: npc.member.id, name: npc.member.name, look: npc.member.look } : null;
  const pool = clubById(clubId)?.regularOpponentPool;
  if (!pool?.length) return null;
  const r = pool[(npc.index || 0) % pool.length];
  return { id: r.id, name: r.name, look: r.look, style: r.style };
}

const WALK_SPEED = 33.6;         // percent of the stage height per second (42 until 2026-09-25: too brisk)
/* One walk frame every 0.09 s at full speed (the pace the cycle was tuned
   at), counted in DISTANCE so a slower walk moves the legs slower
   (js/core/locomotion.js createStride). */
const FRAME_SECONDS = 0.09;

/* What a hotspot is FOR decides how its label looks (css: .pp-hotspot.is-*). */
const KIND_ICON = { goal: 'trophy', star: 'crown', practice: 'practice', puzzle: 'scroll', exit: 'exit', member: 'dialogue', info: 'dialogue' };
function spotKind(spot) {
  if (spot.member) return 'member';
  const t = spot.action.type;
  if (t === 'tournament' || t === 'finale' || t === 'trophies') return 'goal';
  if (t === 'star' || t === 'rivals') return 'star';
  if (t === 'friendly') return 'practice';
  if (t === 'mission') return 'puzzle';
  if (t === 'leave' || t === 'scene') return 'exit';
  return 'info';
}

/* How close the player has to be before a hotspot shows anything. A phone
   shows a slice of the scene, and a name plate, a speech bubble and a signpost
   over everything in it hide the room. So a hotspot has three states: out of
   reach it is not drawn at all (the dock still lists it, and A says "Go: ..."
   toward the nearest one); within CUE_RADIUS it shows only its icon (a
   member's speech bubble, an exit's door); and its WORDS appear only on the
   one spot A would use right now (.is-near), or under the mouse or the
   keyboard focus. */
const CUE_RADIUS = 30;    // percent of the scene height, like USE_RADIUS

/** Is ?debugCollision=1 (or #debugCollision=1) in the address bar? */
export function collisionDebugOn() {
  if (typeof window === 'undefined') return false;
  const q = `${window.location.search}&${window.location.hash.replace('#', '&')}`;
  return /[?&]debugCollision=1(&|$)/.test(q);
}

/** A canvas of the walk grid. Debug only. */
function collisionOverlay(grid) {
  const canvas = h('canvas.pp-scene__collision', { width: String(grid.cols), height: String(grid.rows) });
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '9000', opacity: '0.45' });
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(grid.cols, grid.rows);
  for (let n = 0; n < grid.cells.length; n += 1) {
    const free = grid.cells[n] === 1;
    img.data[n * 4] = free ? 40 : 220;
    img.data[n * 4 + 1] = free ? 230 : 30;
    img.data[n * 4 + 2] = free ? 90 : 40;
    img.data[n * 4 + 3] = free ? 150 : 190;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/* Scene picture sizes, so a scene can lay out before (or without) its art. */
let sizesPromise = null;
const sceneSizes = () => (sizesPromise = sizesPromise || fetch('assets/manifest.json').then((r) => r.json()).then((m) => m.scenes || {}).catch(() => ({})));

const ordinal = (n) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
};

/* The depth slices only line up with THEIR atlas. Right after a deploy a
   browser can hold a cached sceneLayers.js from the build before (GitHub Pages
   caches 10 minutes): its atlas URL then fetches the new, repacked image and
   every table and wall is drawn in the wrong pieces. The atlas's real size
   gives that away; then the data is fetched fresh, and if it still does not
   match, the scene runs without depth slices rather than with wrong ones. */
const atlasSize = (url) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
  img.onerror = () => resolve(null);
  img.src = url;
});
const fits = (size, d) => !size || (size[0] === d.atlasSize[0] && size[1] === d.atlasSize[1]);
/* FLOOR-MASK DEPTH (docs/FLOORMASK.md): every scene has a second set of depth
   slices, built from the artist's original occlusion layer, a floor mask and
   the club's ceiling (sceneLayersFloor.js). It is the default; the L key or
   ?depth=legacy switches to the previous renderer (and back), live, for the
   rest of the session. Walking is identical in both: same walk grid. */
const DEPTH_DEFAULT = 'floor';     // 'legacy' puts everybody back on the previous renderer
const XRAY = true;                 // the player shows through whatever stands in front (paintXray)
const XRAY_LINE = [255, 216, 122]; // --gold-hi: the hidden silhouette's outline
const XRAY_RING = [26, 15, 8];     // the HUD's outline ink, round it
const XRAY_GHOST = 90;             // alpha (of 255) of the sprite inside the outline
const XRAY_Z = 2100;               // over every slice (a slice's z is at most 2 * 990)
let depthMode = (() => {
  try {
    const q = new URLSearchParams(location.search).get('depth');
    return q === 'legacy' || q === 'floor' ? q : DEPTH_DEFAULT;
  } catch { return DEPTH_DEFAULT; }
})();
const hasFloorDepth = (id) => !!SCENE_LAYERS_FLOOR[id];
const checkedLayerCache = new Map();
async function checkedLayers(id, mode = depthMode) {
  const floor = mode === 'floor' && hasFloorDepth(id);
  const cur = floor ? SCENE_LAYERS_FLOOR[id] : SCENE_LAYERS[id];
  if (!cur) return null;
  const key = `${id}:${floor ? 'floor' : 'legacy'}`;
  if (checkedLayerCache.has(key)) return checkedLayerCache.get(key);
  const timeout = () => wait(4000).then(() => null);    // unknown: trust the data
  let good = cur;
  if (!fits(await Promise.race([atlasSize(cur.atlas), timeout()]), cur)) {
    good = null;
    try {
      const mod = floor
        ? (await import(`../../data/sceneLayersFloor.js?fresh=${Date.now()}`)).SCENE_LAYERS_FLOOR
        : (await import(`../../data/sceneLayers.js?fresh=${Date.now()}`)).SCENE_LAYERS;
      const fresh = mod[id];
      if (fresh && fits(await Promise.race([atlasSize(fresh.atlas), timeout()]), fresh)) good = fresh;
    } catch { /* offline: fall through */ }
    if (!good) good = { ...cur, slices: [] };            // walk the floor, draw no wrong depth
  }
  checkedLayerCache.set(key, good);
  return good;
}

/* A walk grid takes a moment to bake on a phone: build each scene's once. */
const walkGrids = new Map();
function walkGridFor(id, layers, aspect, actorHeight) {
  const key = `${id}:${layers.walk.rle.length}:${aspect.toFixed(4)}:${actorHeight}`;      // both depth modes walk alike
  if (!walkGrids.has(key)) walkGrids.set(key, createWalkGrid(layers, { aspect, walker: walkerFor(actorHeight) }));
  return walkGrids.get(key);
}

/**
 * The scene with its club members added: each one a hotspot (walk up, talk,
 * challenge) standing on a spot tools/place-members.mjs found on the floor.
 */
function withMembers(base) {
  const spots = MEMBER_SPOTS[base.id];
  const members = MEMBERS[base.id.slice(0, 3)] || [];
  if (!spots) return base;
  const nodes = { ...base.nodes };
  const hotspots = [...base.hotspots];
  for (const member of members) {
    const spot = spots[member.id];
    if (!spot) continue;
    nodes[`m:${member.id}`] = spot.stand;
    hotspots.push({ id: `member:${member.id}`, node: `m:${member.id}`, label: member.name, verb: 'Talk', member: true,
      action: { type: 'member', memberId: member.id }, npc: { kind: 'member', member, at: spot.at, dir: spot.dir } });
  }
  return { ...base, nodes, hotspots };
}

/** env(safe-area-inset-*) in px: what the iPhone's bars and notch cover. */
function safeInsets() {
  const probe = h('div', { style: { position: 'fixed', visibility: 'hidden', pointerEvents: 'none',
    paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
    paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' } });
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const px = (v) => parseFloat(v) || 0;
  const out = { top: px(cs.paddingTop), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft), right: px(cs.paddingRight) };
  probe.remove();
  return out;
}

export async function sceneScreen(app, params) {
  const career = app.career;
  const scene = withMembers(sceneById(params.sceneId) || sceneById(clubById(career.location.clubId)?.scenes.exterior) || sceneById('nyc-ext'));
  const clubId = scene.id.slice(0, 3);
  const club = clubById(clubId);
  const isFinale = clubId === FINALE.id;
  travelTo(career, clubId, scene.id);
  app.save();

  const bg = h('img.pp-scene__bg', { src: scene.image, alt: '', draggable: 'false' });
  const actors = h('div.pp-scene__actors');
  const ACTOR_H = scene.actorHeight ?? (scene.placeholder ? 0.15 : 0.1);
  // Walking pace in proportion to the character's size, within limits.
  const SPEED = WALK_SPEED * Math.min(1.8, Math.max(0.9, ACTOR_H / 0.1));
  const hotspotLayer = h('div.pp-scene__labels', { style: { position: 'absolute', inset: '0' } });
  const stage = h('div.pp-scene__stage', null, bg, actors, hotspotLayer);
  const viewport = h('div.pp-scene__viewport', null, stage);
  const dock = h('div.pp-scene__dock');
  const el = h('div.pp-screen.pp-scene', null, app.hud({ where: app.locationName() }), viewport, dock);

  /* The background should arrive, but a scene must never wait on it: after a
     short wait the room is shown anyway (sized from assets/manifest.json, so
     walking and hotspots already work), with a readable placeholder and a
     Retry button while the art keeps retrying in the background. */
  const sizes = await sceneSizes();
  let refit = () => {};                    // becomes fit() once the layout code below exists
  let tries = 0;
  let artShown = false;
  const missing = h('div.pp-scene__missing', null,
    h('b', { text: app.locationName() }),
    h('span', { text: 'The picture of this place did not load. Everything still works: use the buttons below.' }),
    h('button.pp-btn.pp-btn--small', { type: 'button', text: 'Retry picture', onclick: (e) => { e.stopPropagation(); tries = 0; retryArt(true); } }));
  const artReady = new Promise((resolve) => {
    bg.onload = () => { if (bg.naturalWidth) { artShown = true; missing.remove(); stage.classList.remove('is-missing'); refit(); resolve(true); } };
    bg.onerror = () => retryArt(false);
    if (bg.complete && bg.naturalWidth) bg.onload();
  });
  function retryArt(now) {
    if (artShown) return;
    tries += 1;
    if (tries > 5 && !now) return;                       // the Retry button starts a new round
    setTimeout(() => { bg.src = `${scene.image}?retry=${Date.now()}`; }, now ? 0 : 400 * tries);
  }
  await Promise.race([artReady, wait(2500)]);
  if (!artShown) { stage.classList.add('is-missing'); stage.append(missing); }
  const known = sizes[scene.id];
  const aspect = known ? known[0] / known[1] : (bg.naturalWidth ? bg.naturalWidth / bg.naturalHeight : 4 / 3);

  /* ---------------------------------------------------------- layout -- */
  let stageH = 600;
  const hudBar = el.firstChild;
  /* The room always fills the scene viewport, no dark bands: a window
     narrower than the art (a phone held upright) shows the full height and
     the camera follows the player sideways; a wider one (landscape, desktop,
     ultra-wide) shows the full width and the camera follows up and down.
     Settings > Controls > Scene view 'fit' shows the whole room instead.
     `camera` is on whenever the stage is larger than the viewport. */
  let camera = false;
  let stageW = 0;
  const zoomed = () => app.settings.sceneZoom !== 'fit';
  const fit = () => {
    // The HUD is shorter on phones and wraps to two rows in portrait.
    const hudH = hudBar?.offsetHeight || 0;
    if (hudH) el.style.setProperty('--hud-h', `${hudH}px`);
    // Zoomed, the room runs under the HUD too: its icons float over the art, no bar.
    hudBar?.classList.toggle('pp-hud--float', zoomed());
    reserveDock(zoomed() ? 0 : hudH);
    const vw = viewport.clientWidth || window.innerWidth;
    const vh = viewport.clientHeight || (window.innerHeight - 56);
    const whole = vh * aspect;                       // the whole room's height in view
    const w = zoomed() || whole > vw * 1.3 ? Math.max(vw, whole) : Math.min(vw, whole);
    stageW = w;
    stageH = w / aspect;
    camera = stageW > vw + 0.5 || stageH > vh + 0.5;
    stage.style.width = `${w}px`;
    stage.style.height = `${stageH}px`;
    viewport.classList.toggle('is-camera', camera);
    for (const actor of actorList) actor.resize();
    follow();
    requestAnimationFrame(nudgeLabels);
  };

  refit = () => fit();

  /* Room for the open actions panel: a column beside the stage when the side
     gutter is wide enough for it (landscape phone, wide desktop). Otherwise the
     stage keeps the whole screen and the panel floats over it, see-through
     (css/pap.css .is-over), rather than shrinking the room to a strip. While
     the room is zoomed to fill the window the panel always floats: a column
     would leave a dark strip beside the room. */
  function reserveDock(hudH) {
    const box = viewport.style;
    box.top = `${hudH}px`; box.left = ''; box.right = ''; box.bottom = '';
    dock.classList.remove('is-side', 'is-over');
    if (!dockOpen() || !dock.firstChild) return;
    if (zoomed()) { dock.classList.add('is-over'); return; }
    const W = el.clientWidth || window.innerWidth;
    const H = (el.clientHeight || window.innerHeight) - hudH;
    dock.classList.add('is-side');                       // measure it as a column first
    const side = dock.getBoundingClientRect();
    const gutter = W - H * aspect;
    if (side.width + 16 <= gutter && side.bottom <= window.innerHeight) {
      // The column keeps its strip; the room fits the rest (fit()).
      box.left = `${Math.ceil(side.right + 8)}px`;
      return;
    }
    dock.classList.remove('is-side');
    dock.classList.add('is-over');
  }

  function follow() {
    if (!camera) { stage.style.transform = ''; return; }
    const who = actorList.find((a) => a.player);
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    // Each axis: centred when the stage fits it, else on the player, held at the edges.
    const axis = (view, size, at) => (size <= view ? (view - size) / 2 : Math.max(view - size, Math.min(0, view / 2 - at)));
    const x = axis(vw, stageW, ((who ? who.x : 50) / 100) * stageW);
    const y = axis(vh, stageH, ((who ? who.y : 50) / 100) * stageH - (who?.height || 0) / 2);
    stage.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  /* A label centred on a spot near the edge of a narrow (portrait) stage
     hangs off the screen: slide the label, not the arrow, back inside. */
  function nudgeLabels() {
    // The screen, less the iPhone's status bar, home bar and notch sides.
    const safe = safeInsets();
    const box = el.getBoundingClientRect();
    const limit = { left: box.left + safe.left, right: box.right - safe.right };
    const port = viewport.getBoundingClientRect();
    // A floating HUD (zoomed) sits on the art: labels stay below it.
    const hudBottom = hudBar?.classList.contains('pp-hud--float') ? hudBar.getBoundingClientRect().bottom : 0;
    const vp = { top: Math.max(port.top, hudBottom, box.top + safe.top), bottom: Math.min(port.bottom, box.bottom - safe.bottom) };
    const controls = [...viewport.querySelectorAll('.pp-pad__stick, .pp-pad__action')]
      .filter((c) => c.getBoundingClientRect().width && getComputedStyle(c.parentElement).display !== 'none')
      .map((c) => c.getBoundingClientRect());
    for (const spot of hotspotLayer.querySelectorAll('.pp-hotspot')) {
      spot.style.setProperty('--nudge', '0px');
      spot.style.setProperty('--nudge-y', '0px');
      spot.classList.remove('is-tight');
      if (spot.classList.contains('is-far')) continue;          // not drawn
      // An exit whose words do not fit between the joystick and the A button
      // drops the words (the A button says what it does) and stays on its doorway.
      if (place(spot, false)) continue;
      if (spot.classList.contains('is-near')) {
        spot.classList.add('is-tight');
        if (place(spot, false)) continue;
      }
      place(spot, true);
    }
    for (const spot of hotspotLayer.querySelectorAll('.pp-hotspot.is-member:not(.is-far)')) placeName(spot);
    /* A member's name, where it covers no other character (user, che-int,
       2026-11-01: Hiro's name over Rahul, who stood a body and a half behind
       him). Tried in order: the bubble's place, above it, under the member's
       feet, beside the head either side; the first that covers nobody, else
       the one covering least. Its own member is not counted. */
    function placeName(spot) {
      const name = spot.querySelector('.pp-hotspot__name');
      if (!name) return;
      name.style.setProperty('--name-dx', '0px');
      name.style.setProperty('--name-dy', '0px');
      const at = spot.dataset.at ? spot.dataset.at.split(',').map(Number) : null;
      const own = at ? actorList.find((a) => a.x === at[0] && a.y === at[1]) : null;
      const bodies = actorList.filter((a) => a !== own).map((a) => {
        const b = a.canvas.getBoundingClientRect();
        const inset = b.width * 0.2;                   // the sprite, not its canvas's empty sides
        return { left: b.left + inset, right: b.right - inset, top: b.top, bottom: b.bottom };
      });
      const r = name.getBoundingClientRect();
      if (!r.width) return;
      const feet = own ? own.canvas.getBoundingClientRect().bottom : null;
      const tries = [[0, 0], [0, -(r.height + 3)]];
      if (feet !== null) tries.push([0, feet + 3 - r.top]);
      tries.push([-(r.width / 2 + 8), 0], [r.width / 2 + 8, 0]);
      let best = null;
      for (const [dx, dy] of tries) {
        const c = { left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy };
        if (c.left < limit.left || c.right > limit.right || c.top < vp.top || c.bottom > vp.bottom) continue;
        let cover = 0;
        for (const b of bodies) {
          cover += Math.max(0, Math.min(c.right, b.right) - Math.max(c.left, b.left)) * Math.max(0, Math.min(c.bottom, b.bottom) - Math.max(c.top, b.top));
        }
        if (!best || cover < best.cover) best = { dx, dy, cover };
        if (cover === 0) break;
      }
      if (!best) return;
      name.style.setProperty('--name-dx', `${Math.round(best.dx)}px`);
      name.style.setProperty('--name-dy', `${Math.round(best.dy)}px`);
    }
    /** Nudge one label inside the screen and off the controls; false when an exit would have to leave its doorway (unless `lift`). */
    function place(spot, lift) {
      spot.style.setProperty('--nudge', '0px');
      spot.style.setProperty('--nudge-y', '0px');
      const r = spot.getBoundingClientRect();
      const pad = 2;
      let dx = 0;
      let dy = 0;
      // Off camera entirely: leave it where it is rather than pin it to the edge.
      if (r.right < limit.left || r.left > limit.right || r.bottom < vp.top || r.top > vp.bottom) return true;
      if (r.left < limit.left + pad) dx = limit.left + pad - r.left;
      else if (r.right > limit.right - pad) dx = limit.right - pad - r.right;
      // A label near the top edge of the art would tuck under the HUD; an
      // exit under the feet must not hang off the bottom.
      if (r.top < vp.top + pad) dy = vp.top + pad - r.top;
      else if (r.bottom > vp.bottom - pad) dy = vp.bottom - pad - r.bottom;
      const hits = (left) => controls.filter((c) => left < c.right && left + r.width > c.left && r.bottom + dy > c.top && r.top + dy < c.bottom);
      let hit = hits(r.left + dx);
      /* Never under the joystick or the A button. An exit stays on its
         doorway and steps sideways into the gap between them; anything else
         is lifted above the higher one. */
      if (hit.length && spot.classList.contains('is-out') && !lift) {
        if (hit.length > 1) return false;
        const c = hit[0];
        const side = (c.left + c.right) / 2 < (r.left + r.right) / 2
          ? c.right + 6 - (r.left + dx) : c.left - 6 - (r.right + dx);
        if (hits(r.left + dx + side).length || r.left + dx + side < limit.left || r.right + dx + side > limit.right) return false;
        dx += side;
        hit = [];
      }
      if (hit.length) dy = Math.min(...hit.map((c) => c.top - 6 - r.bottom));
      spot.style.setProperty('--nudge', `${Math.round(dx)}px`);
      spot.style.setProperty('--nudge-y', `${Math.round(dy)}px`);
      return true;
    }
  }

  /* ---------------------------------------------------------- actors -- */
  const actorList = [];
  function makeActor(look, [x, y], { dir = 'down', player = false } = {}) {
    const canvas = document.createElement('canvas');
    canvas.className = player ? 'pp-actor is-player' : 'pp-actor';
    const shadow = h('div.pp-actor__shadow');
    actors.append(shadow, canvas);
    // The player's x-ray (paintXray): the parts of them something stands in front of.
    // Its own class, not .pp-actor (the test drivers take the last .pp-actor as the player)
    const xray = player ? document.createElement('canvas') : null;
    if (xray) { xray.className = 'pp-xray'; xray.hidden = true; xray.style.zIndex = String(XRAY_Z); actors.append(xray); }
    const actor = {
      look, x, y, dir, frame: 0, walking: false, canvas, shadow, player, xray,
      resize() {
        // Characters stand about a tenth of the scene tall; close-up scenes
        // set their own measured height (scenes.js actorHeight).
        const height = Math.max(40, Math.round(stageH * ACTOR_H));
        const width = Math.round(height * CELL.W / CELL.H);
        /* The bitmap is rasterised at the SCREEN's resolution and shown at
           the CSS size: a canvas the CSS size, enlarged 2-3x by the browser
           on a phone, was what made every character look blurry (a 29x44
           bitmap shown 132 device px tall). this.height / this.cssW stay in
           CSS px: the camera, the shadow and the x-ray all work in those. */
        const k = renderScale();
        canvas.height = Math.round(height * k);
        canvas.width = Math.round(width * k);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        if (xray) { xray.style.width = `${width}px`; xray.style.height = `${height}px`; }
        shadow.style.width = `${width * 0.55}px`;
        shadow.style.height = `${width * 0.16}px`;
        this.height = height;
        this.cssW = width;
        this.draw();
      },
      draw() {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawCharacter(ctx, look, { dir: this.dir, frame: this.frame, walking: this.walking, height: canvas.height, width: canvas.width });
        canvas.style.left = `${this.x}%`; canvas.style.top = `${this.y}%`;
        shadow.style.left = `${this.x}%`; shadow.style.top = `${this.y}%`;
        // Odd: a character level with a slice's ground line stands in front of it.
        canvas.style.zIndex = String(Math.round(this.y * 10) * 2 + 1);
        if (xray) paintXray(this);
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
      // A scene crowd (the finale hall) puts the rivals in its left line; the
      // rest of it is spectators, one of each member sprite, facing the aisle.
      if (scene.crowd) {
        const stars = STAR_PLAYERS.slice(0, 6).map((s) => s.look);
        const taken = new Set(stars.map((l) => l.sprite));
        const extras = [...new Map(Object.values(MEMBERS).flat().map((m) => [m.look.sprite, m.look])).values()].filter((l) => !taken.has(l.sprite));
        const looks = [...stars, ...extras];
        scene.crowd.left.forEach((at, i) => makeActor(looks[i % looks.length], at, { dir: 'right' }));
        scene.crowd.right.forEach((at, i) => makeActor(looks[(scene.crowd.left.length + i) % looks.length], at, { dir: 'left' }));
        continue;
      }
      STAR_PLAYERS.slice(0, 6).forEach((star, i) => {
        const at = npc.spread ? [npc.at[0] + i * npc.spread[0], npc.at[1] + i * npc.spread[1]] : [npc.at[0] + (i % 3) * 5, npc.at[1] + Math.floor(i / 3) * 9];
        makeActor(star.look, at, { dir: i % 2 ? 'right' : 'left' });
      });
      continue;
    }
    if (npc.kind === 'member') { makeActor(npc.member.look, npc.at, { dir: npc.dir || 'down' }); continue; }
    const look = personAt(clubId, npc)?.look;
    if (look) makeActor(look, npc.at, { dir: npc.dir || 'down' });
  }

  /* X-RAY (user, 2026-11-01: the player vanished behind a palm crown, an open
     gate, a pillar they walk behind). Where a depth slice is drawn in front of
     the player, that part of them shows as a soft ghost of the sprite with its
     outline highlighted in the game's gold, ringed in dark ink like the name
     labels and the HUD numbers: the depth stays right and the player is never
     lost. Only the hidden px: where nothing covers the player the x-ray is
     empty. Same stacking rule as the stage (a slice covers a character whose
     feet are above its ground line). */
  let depthSet = null;
  let atlasImg = null;
  /* The outline is drawn at the screen's own resolution (XK device px per
     css px), from a SMOOTHED silhouette: traced on the sprite's css-px grid
     it came out in steps, with specks where a slice's stray px covered the
     player (user, 2026-11-02). Steps: the sprite's alpha and the cover's,
     each blurred 3x3 (1-px bits and notches go), scaled up bilinear and cut
     at half; the hidden part opened (slivers under 2 css px go) and its
     small pieces dropped; then the gold line inside its edge and the ink ring
     outside, by distance, soft at their inner and outer sides. */
  const XK = Math.max(1, Math.min(2, Math.round(window.devicePixelRatio || 1)));    // 2 at most: the browser scales the soft result to a 3x screen
  const scratch = document.createElement('canvas');
  const figure = document.createElement('canvas');   // the player redrawn for reading back (CPU side), only when hidden
  const buf = {};
  const grow = (name, n, T) => (buf[name] && buf[name].length >= n ? buf[name] : (buf[name] = new T(n)));
  function blur3(src, w, h, out) {               // 3x3 box blur of a 0..1 field
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let s = 0; let c = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            s += src[yy * w + xx]; c += 1;
          }
        }
        out[y * w + x] = s / c;
      }
    }
  }
  function upsample(src, w, h, k, W, H, out) {   // bilinear, cut at half: 1 inside
    for (let Y = 0; Y < H; Y += 1) {
      const fy = Math.min(h - 1, Math.max(0, (Y + 0.5) / k - 0.5));
      const y0 = Math.floor(fy); const y1 = Math.min(h - 1, y0 + 1); const ty = fy - y0;
      for (let X = 0; X < W; X += 1) {
        const fx = Math.min(w - 1, Math.max(0, (X + 0.5) / k - 0.5));
        const x0 = Math.floor(fx); const x1 = Math.min(w - 1, x0 + 1); const tx = fx - x0;
        const top = src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx;
        const bot = src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx;
        out[Y * W + X] = top * (1 - ty) + bot * ty >= 0.5 ? 1 : 0;
      }
    }
  }
  function distance(feature, W, H, out) {        // chamfer 3-4: px to the nearest feature px (x3)
    const INF = 1 << 29;
    const n = W * H;
    for (let i = 0; i < n; i += 1) out[i] = feature[i] ? 0 : INF;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = y * W + x;
        let v = out[i];
        if (!v) continue;
        if (x > 0) v = Math.min(v, out[i - 1] + 3);
        if (y > 0) {
          v = Math.min(v, out[i - W] + 3);
          if (x > 0) v = Math.min(v, out[i - W - 1] + 4);
          if (x < W - 1) v = Math.min(v, out[i - W + 1] + 4);
        }
        out[i] = v;
      }
    }
    for (let y = H - 1; y >= 0; y -= 1) {
      for (let x = W - 1; x >= 0; x -= 1) {
        const i = y * W + x;
        let v = out[i];
        if (!v) continue;
        if (x < W - 1) v = Math.min(v, out[i + 1] + 3);
        if (y < H - 1) {
          v = Math.min(v, out[i + W] + 3);
          if (x < W - 1) v = Math.min(v, out[i + W + 1] + 4);
          if (x > 0) v = Math.min(v, out[i + W - 1] + 4);
        }
        out[i] = v;
      }
    }
  }
  function fill(mask, W, H, N, seeds, ok) {       // 4-connected flood fill from `seeds`: mask[i] = 1 where reached and ok(i)
    const stack = seeds;
    while (stack.length) {
      const j = stack.pop(); const px = j % W;
      if (j >= W && !mask[j - W] && ok(j - W)) { mask[j - W] = 1; stack.push(j - W); }
      if (j + W < N && !mask[j + W] && ok(j + W)) { mask[j + W] = 1; stack.push(j + W); }
      if (px > 0 && !mask[j - 1] && ok(j - 1)) { mask[j - 1] = 1; stack.push(j - 1); }
      if (px < W - 1 && !mask[j + 1] && ok(j + 1)) { mask[j + 1] = 1; stack.push(j + 1); }
    }
  }
  function paintXray(a) {
    const g = a.xray;
    if (!g) return;
    // CSS px: the actor's bitmap is renderScale() times larger (resize).
    const cw = a.cssW || a.canvas.width; const ch = a.height || a.canvas.height;
    if (g.width !== cw * XK || g.height !== ch * XK) { g.width = cw * XK; g.height = ch * XK; }
    const ctx = g.getContext('2d');
    ctx.clearRect(0, 0, g.width, g.height);
    g.style.left = a.canvas.style.left; g.style.top = a.canvas.style.top;
    if (!XRAY || !depthSet || !atlasImg || !stageW || !cw) { g.hidden = true; return; }
    const left = (a.x / 100) * stageW - cw / 2;      // .pp-actor: translate(-50%, -92%)
    const top = (a.y / 100) * stageH - 0.92 * ch;
    const z = Math.round(a.y * 10) * 2 + 1;
    if (scratch.width !== cw || scratch.height !== ch) { scratch.width = cw; scratch.height = ch; }
    const sc = scratch.getContext('2d', { willReadFrequently: true });
    sc.clearRect(0, 0, cw, ch);
    sc.imageSmoothingEnabled = false;
    let covered = false;
    for (const [base, x, y, pw, ph, ax, ay, w, hgt] of depthSet.slices) {
      if (Math.round(base * 10) * 2 <= z) continue;
      const sx = (x / 100) * stageW - left; const sy = (y / 100) * stageH - top;
      const sw = (pw / 100) * stageW; const sh = (ph / 100) * stageH;
      if (sx >= cw || sy >= ch || sx + sw <= 0 || sy + sh <= 0) continue;
      sc.drawImage(atlasImg, ax, ay, w, hgt, sx, sy, sw, sh);
      covered = true;
    }
    if (!covered) { g.hidden = true; return; }
    const cover = sc.getImageData(0, 0, cw, ch).data;
    if (figure.width !== cw || figure.height !== ch) { figure.width = cw; figure.height = ch; }
    const fc = figure.getContext('2d', { willReadFrequently: true });
    fc.clearRect(0, 0, cw, ch);
    drawCharacter(fc, a.look, { dir: a.dir, frame: a.frame, walking: a.walking, height: ch, width: cw });
    const body = fc.getImageData(0, 0, cw, ch).data;
    // only round what is hidden: its box, and room for the blur and the ring
    let bx0 = cw; let by0 = ch; let bx1 = -1; let by1 = -1;
    for (let y = 0; y < ch; y += 1) {
      for (let x = 0; x < cw; x += 1) {
        const k = (y * cw + x) * 4 + 3;
        if (body[k] > 127 && cover[k] > 127) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      }
    }
    if (bx1 < 0) { g.hidden = true; return; }
    const m = 3;
    bx0 = Math.max(0, bx0 - m); by0 = Math.max(0, by0 - m); bx1 = Math.min(cw - 1, bx1 + m); by1 = Math.min(ch - 1, by1 + m);
    const w = bx1 - bx0 + 1; const h = by1 - by0 + 1; const n = w * h;
    const s0 = grow('s0', n, Float32Array); const c0 = grow('c0', n, Float32Array);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const k = ((y + by0) * cw + x + bx0) * 4 + 3;
        s0[y * w + x] = body[k] / 255; c0[y * w + x] = cover[k] / 255;
      }
    }
    const s1 = grow('s1', n, Float32Array); const c1 = grow('c1', n, Float32Array);
    blur3(s0, w, h, s1); blur3(c0, w, h, c1);
    const W = w * XK; const H = h * XK; const N = W * H;
    const inS = grow('inS', N, Uint8Array); const inC = grow('inC', N, Uint8Array);
    upsample(s1, w, h, XK, W, H, inS); upsample(c1, w, h, XK, W, H, inC);
    const hid = grow('hid', N, Uint8Array); const tmp = grow('tmp', N, Uint8Array);
    const d = grow('d', N, Int32Array);
    let bodyArea = 0;
    for (let i = 0; i < N; i += 1) { hid[i] = inS[i] & inC[i]; bodyArea += inS[i]; }
    // open the hidden part: slivers under 2 css px wide go
    const r = XK * 3;                                   // chamfer units (3 per px)
    for (let i = 0; i < N; i += 1) tmp[i] = hid[i] ? 0 : 1;
    distance(tmp, W, H, d);
    for (let i = 0; i < N; i += 1) tmp[i] = d[i] > r ? 1 : 0;
    distance(tmp, W, H, d);
    for (let i = 0; i < N; i += 1) hid[i] = hid[i] && d[i] <= r ? 1 : 0;
    // ...and its small pieces (a speck of a slice over a shoulder)
    const piece = grow('piece', N, Uint8Array);
    const done = grow('done', N, Uint8Array); done.fill(0, 0, N);
    const minArea = Math.max(6 * XK * XK, bodyArea * 0.012);
    let shown = false;
    for (let i = 0; i < N; i += 1) {
      if (!hid[i] || done[i]) continue;
      piece.fill(0, 0, N); piece[i] = 1;
      fill(piece, W, H, N, [i], (q) => hid[q] === 1);
      let area = 0;
      for (let j = 0; j < N; j += 1) if (piece[j]) { area += 1; done[j] = 1; }
      if (area < minArea) { for (let j = 0; j < N; j += 1) if (piece[j]) hid[j] = 0; } else shown = true;
    }
    if (!shown) { g.hidden = true; return; }
    // OUTSIDE the figure: the empty px joined to the box's border (a few
    // see-through px inside the sprite are no edge: they drew a seam at the neck)
    const outside = grow('outside', N, Uint8Array); outside.fill(0, 0, N);
    const seeds = [];
    for (let X = 0; X < W; X += 1) {
      for (const i of [X, (H - 1) * W + X]) if (!inS[i] && !outside[i]) { outside[i] = 1; seeds.push(i); }
    }
    for (let Y = 0; Y < H; Y += 1) {
      for (const i of [Y * W, Y * W + W - 1]) if (!inS[i] && !outside[i]) { outside[i] = 1; seeds.push(i); }
    }
    fill(outside, W, H, N, seeds, (q) => inS[q] === 0);
    const out = ctx.createImageData(W, H);
    const o = out.data;
    const t = Math.max(1, Math.round(ch / 70));
    const lw = Math.max(2, t * XK * 1.5);               // the gold line (XK px per css px): as heavy as a sprite pixel
    const rw = Math.max(1.5, XK * 1.4);                 // the ink ring round it
    const [GR, GG, GB] = XRAY_LINE; const [IR, IG, IB] = XRAY_RING;
    distance(outside, W, H, d);                         // hidden px: how far in from the edge
    for (let Y = 0; Y < H; Y += 1) {
      const by = ((Math.floor(Y / XK) + by0) * cw + bx0) * 4;
      for (let X = 0; X < W; X += 1) {
        const i = Y * W + X;
        if (!hid[i]) continue;
        const k = i * 4;
        const bi = by + Math.floor(X / XK) * 4;
        const line = Math.min(1, Math.max(0, lw + 0.5 - d[i] / 3));
        o[k] = Math.round(body[bi] * (1 - line) + GR * line);         // gold over the ghost, soft on its inner side
        o[k + 1] = Math.round(body[bi + 1] * (1 - line) + GG * line);
        o[k + 2] = Math.round(body[bi + 2] * (1 - line) + GB * line);
        o[k + 3] = Math.round(XRAY_GHOST * (1 - line) + 255 * line);
      }
    }
    distance(hid, W, H, d);                             // outside px: how far from the hidden part
    for (let i = 0; i < N; i += 1) {
      if (!outside[i] || !inC[i]) continue;
      const ring = Math.min(1, Math.max(0, rw + 0.5 - d[i] / 3));
      if (ring <= 0) continue;
      const k = i * 4;
      o[k] = IR; o[k + 1] = IG; o[k + 2] = IB; o[k + 3] = Math.round(235 * ring);
    }
    ctx.putImageData(out, bx0 * XK, by0 * XK);
    g.hidden = false;
  }

  /* Depth layers: the artist's occlusion layer, cut into slices by ground line
     (tools/build_occlusion.py). Each slice sits in the actors layer at its own
     z, so a character is drawn behind every slice whose ground line is lower
     down the picture than its feet. One atlas image per scene. */
  const layers = await checkedLayers(scene.id);
  const freeMode = !!layers;
  const grid = freeMode ? walkGridFor(scene.id, layers, aspect, ACTOR_H) : null;
  function drawDepth(set) {
    depthSet = set;
    const img = new Image();
    img.onload = () => { if (depthSet === set) { atlasImg = img; if (player) paintXray(player); } };
    img.src = set.atlas;
    for (const old of actors.querySelectorAll('.pp-prop')) old.remove();
    const [AW, AH] = set.atlasSize;
    const pct = (a, size, whole) => (whole === size ? 0 : (a / (whole - size)) * 100);
    for (const [base, x, y, pw, ph, ax, ay, w, hgt] of set.slices) {
      actors.append(h('div.pp-prop', {
        style: {
          left: `${x}%`, top: `${y}%`, width: `${pw}%`, height: `${ph}%`,
          zIndex: String(Math.round(base * 10) * 2),
          backgroundImage: `url("${set.atlas}")`,
          backgroundSize: `${(AW / w) * 100}% ${(AH / hgt) * 100}%`,
          backgroundPosition: `${pct(ax, w, AW)}% ${pct(ay, hgt, AH)}%`
        }
      }));
    }
    stage.dataset.depth = set.depth === 'floor' ? 'floor' : 'legacy';
  }
  if (freeMode) drawDepth(layers);

  /* L: swap the floor-mask depth for the previous renderer and back, where
     the player stands (docs/FLOORMASK.md). */
  async function toggleDepth() {
    if (!freeMode || !hasFloorDepth(scene.id)) return;
    depthMode = depthMode === 'floor' ? 'legacy' : 'floor';
    const set = await checkedLayers(scene.id);
    if (set) drawDepth(set);
    app.toast(depthMode === 'floor' ? 'Depth: floor-mask (L: previous renderer)' : 'Depth: previous renderer (L: floor-mask)', { ms: 2200 });
  }

  /* ?debugCollision=1 paints the grid the player actually walks on, over the
     art: green where a body fits, red where it does not. Off unless the flag is in the URL - it is a development
     aid, never part of a build's normal run. */
  if (freeMode && collisionDebugOn()) stage.append(collisionOverlay(grid));

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
  let cueClock = 0;
  const playerDirections = directionsFor(player.look);
  const stride = createStride(SPEED * FRAME_SECONDS);
  /** Face a screen-space vector, steady on diagonals (js/core/locomotion.js). */
  function faceToward(dxPx, dy, { steady = true } = {}) {
    const dir = facingFor(dxPx, dy, { previous: steady ? player.dir : null, available: playerDirections });
    if (dir) player.dir = dir;
    return dir;
  }
  /** One walk frame per FRAME_SECONDS of full-speed walking, whatever the pace. */
  function stepLegs(moved) {
    if (!player.walking) { player.walking = true; player.frame = 0; stride.reset(); }
    const frames = stride.advance(moved);
    for (let i = 0; i < frames; i += 1) {
      player.frame += 1;
      if (player.frame % 4 === 0) sfx.step();
    }
  }
  /**
   * Advance the walk animation and face the direction of travel.
   * (faceDx, faceDy): where the character means to go, screen space;
   * moved: how far it really went this tick (0 against a wall).
   */
  function animateStep(faceDx, faceDy, dt, moved) {
    faceToward(faceDx, faceDy);
    cueClock += dt;
    if (cueClock > 0.15) { cueClock = 0; paintCues(); }
    if (moved > 1e-6) stepLegs(moved);
    else if (player.walking) { player.walking = false; player.frame = 0; }    // pushing a wall: stand, facing it
    player.draw();
    follow();
  }
  function stopWalking() {
    player.walking = false; player.frame = 0; stride.reset(); player.draw();
    if (camera) nudgeLabels();
    paintCues();
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
        animateStep(dxPx, dy, dt, Math.min(dist, step));
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
      const tick = (now) => {
        if (walking !== token) { player.walking = false; player.draw(); resolve(false); return; }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (segment >= path.length) {
          player.walking = false; player.frame = 0; player.draw();
          playerNode = target; headingNode = null; walking = null;
          if (camera) nudgeLabels();
          paintCues();
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
        faceToward(dxPx, dy);
        stepLegs(Math.min(dist, step));
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
      // Turn to whoever the spot is about, not the way the last step went.
      if (arrived && spot.npc?.at) {
        const dxPx = (spot.npc.at[0] - player.x) * aspect;
        const dy = spot.npc.at[1] - player.y;
        if (faceToward(dxPx, dy, { steady: false })) player.draw();
      }
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

  /* The button drawn for each hotspot, so proximity can reveal a name without
     repainting the layer (a repaint mid-walk drops hover and focus). */
  const spotNodes = new Map();

  /** Show each hotspot as much as the player's distance earns (see CUE_RADIUS). */
  let nearSpot = null;
  let shownKey = '';
  function paintCues(pick = spotForAction()) {
    const near = pick?.ready ? pick.spot : null;
    // The way to the next goal stays on screen at any distance, faintly: one
    // small icon, so the room is never empty of a direction.
    const goal = goalSpot();
    let shown = '';
    for (const [spot, node] of spotNodes) {
      const [x, y] = scene.nodes[spot.node];
      const out = spot !== near && Math.hypot((x - player.x) * aspect, y - player.y) > CUE_RADIUS;
      node.classList.toggle('is-far', out && spot !== goal);
      node.classList.toggle('is-goal-far', out && spot === goal);
      node.classList.toggle('is-near', spot === near);
      if (!(out && spot !== goal)) shown += `${spot.id}|`;
    }
    // The words widen the label, and a label coming into view was never
    // placed (far ones are skipped): slide them back inside the screen again.
    if (near !== nearSpot || shown !== shownKey) { nearSpot = near; shownKey = shown; nudgeLabels(); }
  }

  /** Your head-to-head against a member, wins-losses(-draws): "2-1", or '' before the first game. */
  function recordText(memberId) {
    const r = career.memberRecords?.[memberId];
    if (!r || !(r.w + r.l + (r.d || 0))) return '';
    return `${r.w}-${r.l}${r.d ? `-${r.d}` : ''}`;
  }

  function drawHotspots() {
    clear(hotspotLayer);
    spotNodes.clear();
    const list = h('div.pp-row');
    const people = h('div');
    scene.hotspots.forEach((spot, i) => {
      const [x, y] = scene.nodes[spot.node];
      const kind = spotKind(spot);
      /* Labels float just above a character's head, however tall characters
         are drawn here. An exit is the exception: it marks the way OUT, so a
         way out at the bottom of the picture (a garden gate, the front steps)
         hangs under the feet of whoever stands there, pointing out, and
         `mark` (scenes.js) puts it on the doorway itself when the art's
         doorway lies outside the walk mask. Above the head it sat in the
         middle of the garden. */
      const [mx, my] = spot.mark || [x, y];
      const out = kind === 'exit' && my >= 60;
      const labelY = out ? my + (spot.mark ? 0 : 0.5)
        : spot.npc?.at ? Math.min(y, spot.npc.at[1]) - ACTOR_H * 95 - 1 : my - Math.max(7, ACTOR_H * 70);
      /* A member wears the speech bubble on its own; its name is a label that
         is revealed, not drawn. Everything else keeps icon + words. */
      const record = spot.member ? recordText(spot.action.memberId) : '';
      const label = spot.member
        ? h('span.pp-hotspot__label.pp-hotspot__name', null, spot.label, record ? h('small.pp-hotspot__record', { text: ` · you ${record}` }) : null)
        : h('span.pp-hotspot__label', null, h('small.pp-hotspot__key', { text: String(i + 1) }),
            pixelIcon(KIND_ICON[kind], { size: 'sm' }), h('span.pp-hotspot__text', { text: ` ${spot.label}` }));
      const node = h('button.pp-hotspot', {
        type: 'button', class: `${spotState(spot)} is-${kind}${out ? ' is-out' : ''}${spot.member && (career.membersMet?.[spot.action.memberId] || career.memberRecords?.[spot.action.memberId]) ? ' is-met' : ''} is-far`,
        style: { left: `${spot.npc?.at && !spot.mark ? spot.npc.at[0] : mx}%`, top: `${Math.max(4, labelY)}%` },
        dataset: spot.member ? { at: spot.npc.at.join(',') } : {},
        'aria-label': `${spot.verb}: ${spot.label}`,
        onclick: (e) => { e.stopPropagation(); use(spot); }
      }, spot.member ? h('span.pp-hotspot__bubble', null, pixelIcon('dialogue', { size: 'sm' })) : null,
        label, h('span.pp-hotspot__arrow', { text: '\u25be', 'aria-hidden': 'true' }));
      spotNodes.set(spot, node);
      hotspotLayer.append(node);
      if (spot.member) people.append(button(`${spot.label.split(' ')[0]}${record ? ` ${record}` : ''}`, () => use(spot), { cls: 'pp-btn--small', title: `Talk to ${spot.label}${record ? ` (you are ${record})` : ''}` }));
      else list.append(button(`${i + 1}. ${spot.verb}`, () => use(spot), { cls: 'pp-btn--small', title: spot.label }));
    });
    const toggle = h('button.pp-btn.pp-btn--small.pp-scene__toggle', { type: 'button', onclick: (e) => { e.stopPropagation(); setDock(!dockOpen()); } });
    dock.replaceChildren(toggle, h('div.pp-panel', null, h('div.pp-scene__title', { text: app.locationName() }), list,
      people.children.length ? h('div.pp-row.pp-scene__people', null, h('span.pp-small.pp-muted', { text: 'People:' }), ...people.children) : null,
      // Keys and pads only (css/pap.css): what the buttons the pad has no picture of do here.
      h('div.pp-scene__keys.pp-when-keys.pp-small', null,
        h('span', null, prompt('cancel'), ' Menu'), h('span', null, prompt('map'), ' Map'), h('span', null, prompt('journal'), ' Journal'))));
    paintDock();
    refit();
    nearSpot = undefined;
    paintCues();
  }

  /* The actions panel can be hidden (button or H, remembered in settings).
     While it is open it takes a side gutter if there is one, and otherwise
     floats see-through over the map, which keeps its full size. */
  // A function declaration, not a const: fit() can run from the background's
  // onload while the scene is still awaiting its depth data, before this line.
  function dockOpen() { return app.settings.actionsPanel !== false; }
  function paintDock() {
    const open = dockOpen();
    dock.classList.toggle('is-collapsed', !open);
    const toggle = dock.querySelector('.pp-scene__toggle');
    if (toggle) {
      toggle.textContent = open ? '\u2715 Hide' : '\u2630 Actions';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.title = open ? 'Hide the actions panel (H)' : 'Show the actions panel (H)';
    }
  }
  function setDock(open) {
    app.settings.actionsPanel = open;
    app.applySettings();
    paintDock();
    refit();
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

  /* Keys and pads (js/ui/controls.js). Held keys, the d-pad and the left
     stick all arrive as one stick vector, and walk exactly like the touch
     joystick. Accept is the touch pad's A: use the spot underfoot, or walk to
     the nearest one and use it. 1-9 use a spot directly. Back hands the
     controls to the buttons (the actions panel and the status bar), and Back
     again takes them back; the mouse never needs this, a click is a click. */
  let ctrlStick = null;
  let menuMode = false;
  const menuOn = () => {
    const active = document.activeElement;
    if (menuMode && active && active !== document.body && el.contains(active)) return true;
    menuMode = false;
    return false;
  };
  function openMenu() {
    const target = firstFocus(dock) || firstFocus(el);
    if (!target) return false;
    menuMode = true;
    halt();
    focusEl(target);
    return true;
  }
  function closeMenu() {
    menuMode = false;
    if (el.contains(document.activeElement)) document.activeElement.blur();
  }
  function halt() {
    if (!stickHeld) stick = null;
  }

  const releaseControls = pushHandler({
    name: 'scene',
    scope: () => el,
    onStick(vec) {
      ctrlStick = vec;
      if (stickHeld) return;
      stick = vec;
      if (vec && !halted()) {
        if (walking && !driving) walking = null;     // the stick overrides a click-to-walk
        drive();
      }
    },
    onAction(a) {
      if (menuOn()) {
        if (a.type === 'cancel') { closeMenu(); return true; }
        if (a.type !== 'map' && a.type !== 'journal') return false;     // the buttons: focus moves, accept presses
      }
      if (DIRECTIONS[a.type]) {
        // Walking is the stick's; a held key only (re)starts it: after a
        // dialogue stopped it, or when it was held down through the door.
        ctrlStick = stickVector();
        stick = stickHeld ? stick : ctrlStick;
        if (stick && !driving && !halted()) drive();
        return true;
      }
      switch (a.type) {
        case 'accept': {
          if (blocked()) return true;
          const pick = spotForAction();
          if (pick) use(pick.spot);
          return true;
        }
        case 'cancel': return openMenu();
        case 'digit':
          if (a.n > scene.hotspots.length) return false;
          use(scene.hotspots[a.n - 1]);
          return true;
        case 'map': app.go('map'); return true;
        case 'journal': app.go('journal', { back: app.backParams() }); return true;
        case 'key':
          if (a.key === 'h') { setDock(!dockOpen()); return true; }
          if (a.key === 'l') { toggleDepth(); return true; }
          return false;
        default: return false;
      }
    }
  });

  /* ----------------------------------------------------- touch walking -- */
  const adjacent = {};
  for (const [a, b] of scene.links) {
    (adjacent[a] = adjacent[a] || []).push(b);
    (adjacent[b] = adjacent[b] || []).push(a);
  }
  const blocked = () => busy || !!document.querySelector('.pp-overlay, .pp-dialogue');
  const halted = () => blocked() || menuOn();
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
        while (stick && !halted()) {
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
          animateStep(r.moved ? mdx : dxPx, r.moved ? mdy : dy, dt, r.moved ? Math.hypot(mdx, mdy) : 0);
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
      while (stick && !halted()) {
        const target = nodeToward(stick);
        if (!target) {
          // Nothing that way: face it, so the stick still feels alive.
          const before = player.dir;
          if (!walking && faceToward(stick.x * aspect, stick.y, { steady: false }) && player.dir !== before) player.draw();
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

  const USE_RADIUS = 10;    // screen-space percent of the scene height: forgiving on purpose
  const distanceTo = (spot) => {
    const [x, y] = scene.nodes[spot.node];
    return Math.hypot((x - player.x) * aspect, y - player.y);
  };

  /**
   * The hotspot that leads toward the career's next goal (the HUD's "Next:")
   * from this scene: the goal itself when it is here, otherwise the way out
   * that heads for it. Null when nothing here does.
   */
  function goalSpot() {
    const step = nextStep(career);
    if (step.type === 'ending') return null;
    const here = step.clubId === clubId && step.type !== 'travel';
    const goal = !here ? 'leave' : step.type === 'finale' ? 'finale' : 'tournament';
    const spots = scene.hotspots.filter((spot) => !spot.member);
    const direct = spots.find((spot) => spot.action.type === goal);
    if (direct) return direct;
    // Not in this scene: inward toward the hall, outward toward the gate.
    const toward = (suffix) => spots.find((spot) => spot.action.type === 'scene' && spot.action.to.endsWith(suffix));
    return goal === 'leave' ? (toward('-ext') || toward('-int')) : (toward('-int') || toward('-ext'));
  }

  /**
   * What A does: the hotspot within reach (walk up, use it), otherwise the way
   * to the next goal, otherwise the nearest signpost. A member is only ever
   * the target when the player is already next to them: "Go: Hector Ramos"
   * from the gate sent people to whoever stood nearest, not where the game is.
   */
  function spotForAction() {
    let best = null;
    for (const spot of scene.hotspots) {
      const d = freeMode ? distanceTo(spot) : (spot.node === playerNode && !walking ? 0 : Infinity);
      if (!best || d < best.d) best = { spot, d };
    }
    if (best && best.d <= (freeMode ? USE_RADIUS : 0)) return { spot: best.spot, ready: true };
    const goal = goalSpot();
    if (goal) return { spot: goal, ready: false };
    let sign = null;
    for (const spot of scene.hotspots) {
      if (spot.member) continue;
      const [x, y] = scene.nodes[spot.node];
      const d = Math.hypot((x - player.x) * aspect, y - player.y);
      if (!sign || d < sign.d) sign = { spot, d };
    }
    return sign ? { spot: sign.spot, ready: false } : null;
  }

  const pad = createTouchpad({
    onStick(vec) {
      stickHeld = !!vec;
      stick = vec || ctrlStick;
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
  /* The same prompt for keys and pads: the accept button's picture and what it does. */
  const keyLabel = h('span.pp-keyprompt__label');
  const keyPrompt = h('div.pp-keyprompt', { 'aria-hidden': 'true' }, prompt('accept'), keyLabel);
  function paintPad() {
    const pick = spotForAction();
    /* Ready: the verb ("Travel"). Not yet: where A walks to, as that spot's
       own icon and an arrow - "Go: Leave the promenade" did not fit a phone. */
    const label = pick ? (pick.ready ? pick.spot.verb : `Go: ${pick.spot.label}`) : '';
    const icon = () => (pick && !pick.ready ? pixelIcon(KIND_ICON[spotKind(pick.spot)], { size: 'sm' }) : null);
    pad.setAction(pick?.ready ? label : '', pick?.ready, { icon: icon(), title: label });
    keyLabel.replaceChildren(...(pick && !pick.ready ? [icon(), '\u00a0\u25b8'] : [label]));
    keyLabel.title = label;
    keyPrompt.hidden = !label;
    keyPrompt.classList.toggle('is-ready', !!pick?.ready);
    paintCues();
  }
  viewport.append(pad.el, keyPrompt);

  /* --------------------------------------------------------- actions -- */
  async function runAction(spot) {
    const a = spot.action;
    switch (a.type) {
      case 'scene': sfx.step(); return app.go('scene', { sceneId: a.to, spawn: a.spawn });
      case 'leave': return leaveMenu();
      case 'tournament': return tournamentDesk(spot);
      case 'star': return starOffice();
      case 'friendly': return practiceRoom(spot);
      case 'trophies': return trophyHall();
      case 'talk': {
        const who = personAt(clubId, spot.npc) || personAt(clubId, { kind: 'regular', index: 2 });
        return app.dialogue({ name: who.name, role: club.clubName, look: who.look, lines: loungeLines(career, clubId) });
      }
      case 'mission': return venueMission();
      case 'member': return memberTalk(a.memberId);
      case 'finale': return finaleStage();
      case 'rivals': return rivalsLounge();
      default: return null;
    }
  }

  async function leaveMenu() {
    const choice = await app.overlay((close) => h('div.pp-panel.pp-modal', null,
      h('h2.pp-h2', { text: 'Where to?' }),
      h('div.pp-col', null,
        button('World map', () => close('map'), { icon: pixelIcon('map', { size: 'sm' }), cls: 'pp-btn--gold' }),
        club && scene.kind !== 'venue' ? button(`${club.casualLocationName}`, () => close('venue'), { icon: pixelIcon('exit', { size: 'sm' }) }) : null,
        club && scene.kind === 'venue' ? button(`${club.clubName}`, () => close('club'), { icon: pixelIcon('club', { size: 'sm' }) }) : null,
        button('Stay here', () => close(null), { cls: 'pp-btn--small' }))));
    if (choice === 'map') app.go('map');
    if (choice === 'venue') app.go('scene', { sceneId: club.scenes.venue });
    if (choice === 'club') app.go('scene', { sceneId: club.scenes.exterior, spawn: 'default' });
  }

  function playMatch({ kind, opponent, colour }) {
    app.go('match', { kind, opponent, colour, clubId, returnScene: scene.id, returnSpawn: playerNode });
  }

  /* What the entry costs and what it can pay back, in coins (config COINS). */
  function feeLine(fee) {
    const back = Math.round(TOURNAMENT.rounds * COINS.perPointShare * fee + COINS.finalistShare * fee);
    const champion = Math.round(TOURNAMENT.rounds * COINS.perPointShare * fee + COINS.championShare * fee + COINS.championBonus);
    const short = fee - (career.coins ?? 0);
    return h('p.pp-small.pp-desk__fee', null, pixelIcon('coins', { size: 'sm' }),
      h('b', { text: ` Entry ${fee} coins. ` }),
      `Every point pays prize money; reach the final and you win back about ${back}. Beat the Star Player for about ${champion}.`,
      short > 0 ? h('span', { text: ` You have ${career.coins}: your sponsor covers the other ${short}, out of your next prize.` }) : null);
  }

  async function tournamentDesk(spot = null) {
    const star = starForClub(clubId);
    const desk = personAt(clubId, spot?.npc);
    const opening = openingById(club.openingId);
    const event = club.tournamentConfig.name;
    if (career.trophies[clubId]) {
      await app.dialogue({ name: desk?.name || 'Tournament director', role: `${event} · tournament hall`, look: desk?.look || GUIDE_LOOK,
        lines: [`${club.trophyName} is already yours, champion.`, 'The practice room is always open, and the members will always take your coins.'] });
      return;
    }
    let run = career.tournaments[clubId];
    if (!run || run.completed) {
      const format = TOURNAMENT.format[clubId];
      const fee = entryFee(career);
      const last = run?.completed ? run : null;
      const lastLine = !last ? null
        : last.outcome === 'runner-up' ? `Last time you reached the final and lost to ${star.name}. So close.`
        : last.outcome === 'eliminated' ? `Last time you went out in the ${roundLabel(last, exitRound(last)).toLowerCase()}.`
        : `Last time you finished ${ordinal(last.place)} of ${last.players.length}.`;
      const choice = await app.overlay((close) => h('div.pp-panel.pp-modal', null,
        h('h2.pp-h2', { text: event }),
        h('p.pp-small', { text: format === 'swiss'
          ? `A ${TOURNAMENT.field.swiss}-player Swiss: ${TOURNAMENT.rounds} rounds, and you play every one of them. Whoever tops the table meets ${star.name} in the final.`
          : `A ${TOURNAMENT.field.knockout}-player knockout: ${TOURNAMENT.rounds} rounds, one loss and you are out. A drawn game goes to Black. Win the bracket and ${star.name} is waiting in the final.` }),
        h('p.pp-small', { text: `${club.trophyName} goes only to whoever beats ${star.name} in the final. Every game you play teaches you the ${opening.name}, even if you fall short.` }),
        lastLine ? h('p.pp-small', null, h('b', { text: lastLine })) : null,
        feeLine(fee),
        h('div.pp-row', null,
          button(`${last ? 'Enter again' : 'Enter'} (${fee} coins)`, () => close('enter'), { cls: 'pp-btn--gold', icon: pixelIcon('medal', { size: 'sm' }) }),
          button('Not yet', () => close(null), { cls: 'pp-btn--small' }))));
      if (choice !== 'enter') return;
      run = enterTournament(career, clubId);
      app.save();
    }
    const round = currentRound(career, clubId);
    if (!round) return;
    const isFinal = round.kind === 'star';
    const choice = await app.overlay((close) => h('div.pp-panel.pp-modal.pp-modal--wide.pp-desk', null,
      h('h2.pp-h2', { text: event }),
      statusBanner(run, star.name),
      /* Round, opponent, Elo, colour, Play: the only things needed to go on. */
      h(`div.pp-desk__next${isFinal ? '.is-final' : ''}`, null,
        h('div.pp-desk__round', null, isFinal ? pixelIcon('trophy', { size: 'sm' }) : null, h('span', { text: isFinal ? ' The final' : round.label })),
        h('div.pp-desk__opp', null,
          h('img', { alt: '', src: portraitUrl(round.look || GUIDE_LOOK) }),
          h('div', null,
            h('div.pp-desk__name', { text: round.name }),
            h('div', null, `${round.elo} Elo · you play ${round.colour === 'w' ? 'White' : 'Black'} `, sideIcon(round.colour, { size: 'sm' })))),
        h('div.pp-row', null,
          button(isFinal ? 'Play the final' : `Play ${round.label.toLowerCase()}`, () => close('play'), { cls: 'pp-btn--gold', icon: pixelIcon('play', { size: 'sm' }) }),
          button('Not yet', () => close(null), { cls: 'pp-btn--small' }))),
      h('details.pp-desk__more', { open: !isTouch() }, h('summary', { text: run.format === 'swiss' ? 'Standings' : 'This round' }), eventView(run)),
      h('details.pp-desk__more', null, h('summary', { text: 'How this event works' }), h('p.pp-small', { text: formatBlurb(run, star.name) }),
        h('p.pp-small.pp-muted', { text: `Difficulty tier ${run.tier + 1}/6, set by the trophies you had when you entered. Attempt ${run.attempt || 1}.` }))));
    if (choice !== 'play') return;
    if (round.kind === 'star') {
      meetStar(career, star.id);
      app.save();
      await app.dialogue({ name: star.name, role: star.title, look: star.look, lines: starLines(career, star.id, 'challenge') });
    }
    playMatch({
      kind: round.kind === 'star' ? 'star' : 'tournament',
      colour: round.colour,
      opponent: { id: round.opponentId, name: round.name, elo: round.elo, style: round.style, openingId: round.openingId || club.openingId,
        look: round.kind === 'star' ? star.look : round.look }
    });
  }

  /* A member: a line or two about the city, their opening or the game, then
     a challenge for coins. The stake is set by their Elo. */
  async function memberTalk(memberId) {
    const member = (MEMBERS[clubId] || []).find((x) => x.id === memberId);
    if (!member) return;
    // Met once: their bubble fades from now on, so the people not met yet stand out.
    if (!career.membersMet?.[member.id]) {
      career.membersMet = { ...(career.membersMet || {}), [member.id]: true };
      app.save();
      for (const [spot, node] of spotNodes) if (spot.action.memberId === member.id) node.classList.add('is-met');
    }
    const elo = memberElo(member.rel, tier(career), career.difficulty);
    const stake = stakeFor(elo);
    const record = career.memberRecords?.[member.id];
    const spoken = [...member.lines];
    // Now and then a general tip as well, so a second visit is not word for word the same.
    if (Math.random() < 0.5) spoken.splice(Math.floor(Math.random() * spoken.length) + 1, 0, CHESS_TIPS[Math.floor(Math.random() * CHESS_TIPS.length)]);
    const said = spoken.slice(0, 2);
    const special = openingById(member.openingId);
    const recordLine = record ? ` We are ${record.w}-${record.l}${record.d ? `-${record.d}` : ''} so far.` : '';
    const afford = canAfford(career, stake);
    const offer = afford
      ? `Fancy a game? ${stake} coins on it. I am about ${elo}, and I play the ${special.name}.${recordLine}`
      : `I play for ${stake} coins a game, and you have ${career.coins}. Win some in the tournament or solve some puzzles, then come back.`;
    const choice = await app.dialogue({
      name: member.name, role: `${club.clubName} · ${elo} Elo`, look: member.look,
      lines: [...said, offer],
      actions: afford
        ? [{ id: 'w', label: `Play White (${stake} coins)`, icon: sideIcon('w', { size: 'sm' }), cls: 'pp-btn--gold' }, { id: 'b', label: `Play Black (${stake} coins)`, icon: sideIcon('b', { size: 'sm' }), cls: 'pp-btn--gold' }, { id: null, label: 'Not now' }]
        : [{ id: null, label: 'Bye' }]
    });
    if (!choice) return;
    playMatch({ kind: 'challenge', colour: choice,
      opponent: { id: member.id, name: member.name, elo, style: member.style, openingId: member.openingId, look: member.look, stake } });
  }

  async function starOffice() {
    const star = starForClub(clubId);
    const first = meetStar(career, star.id);
    app.save();
    const lines = first ? star.lines.intro : starLines(career, star.id, 'office');
    const round = currentRound(career, clubId);
    const ready = round && round.kind === 'star';
    const actions = ready
      ? [{ id: 'play', label: `Challenge ${star.name.split(' ')[0]}`, icon: pixelIcon('crown', { size: 'sm' }), cls: 'pp-btn--gold' }, { id: null, label: 'Later' }]
      : null;
    const choice = await app.dialogue({ name: star.name, role: star.title, look: star.look, lines, actions });
    if (!ready && !career.trophies[clubId] && !first) {
      app.toast(`Reach the final of the ${club.tournamentConfig.name} to face ${star.name}.`);
    }
    if (choice === 'play') {
      playMatch({ kind: 'star', colour: round.colour,
        opponent: { id: star.id, name: star.name, elo: round.elo, style: star.style, openingId: star.openingId, look: star.look } });
    }
  }

  /* The practice room: nothing here is rated. A friendly against a member, the
     puzzle collection, and the club opening's tutorial and drills. */
  async function practiceRoom(spot = null) {
    const opening = openingById(club.openingId);
    const mastery = career.openings[club.openingId] ?? 0;
    const tutored = !!career.tutorialsDone?.[club.openingId];
    const host = personAt(clubId, spot?.npc) || personAt(clubId, { kind: 'regular', index: 1 });
    /* The practice tree: lessons by rating band, unlocked by Club Trophies. */
    const tree = practiceSummary(career);
    const treeLine = tree.next
      ? `${tree.lessonsOpen} lessons open, ${tree.lessonsDone} complete. Read, watch, then solve. ${tree.next.tier.label} opens after ${tree.next.trophiesNeeded} more ${tree.next.trophiesNeeded === 1 ? 'trophy' : 'trophies'}.`
      : `All ${tree.lessonsOpen} lessons open, ${tree.lessonsDone} complete. Read, watch, then solve.`;
    const option = (id, icon, label, sub, cls = '') => h('button.pp-practice__option', { type: 'button', class: cls, onclick: () => close(id) },
      h('span.pp-practice__icon', null, pixelIcon(icon, { size: 'lg' })), h('span', null, h('b', { text: label }), h('span.pp-small.pp-muted', { text: sub })));
    let close;
    const choice = await app.overlay((c) => {
      close = c;
      return h('div.pp-panel.pp-modal.pp-practice', null,
        h('h2.pp-h2', { text: `${club.clubName}: practice room` }),
        h('p.pp-small', { text: `${host.name} runs the practice room. Nothing here changes your rating.` }),
        /* The club's opening first: it is what this club's tournament is about. */
        h('div.pp-col', null,
          option('tutorial', 'journal', `Tutorial: ${opening.name}`, tutored ? 'Walk through every line again.' : mastery > 0 ? `Every line with notes. You know ${mastery}%.` : `Every line with notes. Finishing it unlocks the opening (${MASTERY.tutorialGrant}%).`, tutored ? '' : 'is-new'),
          option('drill', 'practice', `Drills: ${opening.name}`, mastery > 0 ? `Find the book move. Pass a set: +${MASTERY.drillGain}% mastery (you know ${mastery}%).` : 'Do the tutorial first.'),
          option('friendly', 'handshake', 'Friendly game', 'Unrated. Play a club member as White or Black.'),
          option('puzzles', 'hint', 'Puzzles', `This club's own set, from real ${opening.name} games.`),
          option('lessons', 'practice', 'Practice tree (optional)', treeLine)),
        h('div.pp-row', { style: { justifyContent: 'flex-end' } }, button('Leave', () => c(null), { cls: 'pp-btn--small' })));
    });
    if (choice === 'lessons') return app.go('practice', { clubId, returnScene: scene.id });
    if (choice === 'friendly') return friendlyGame(host);
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

  /* The friendly is with whoever runs the practice room: the person the
     player walked up to (it used to be a random regular). */
  async function friendlyGame(host) {
    const pool = club.regularOpponentPool;
    const regular = pool.find((r) => r.id === host?.id) || pool[1 % pool.length];
    const elo = regularElo(tier(career), Math.random, career.difficulty);
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
        h('b.pp-trophy', { class: career.trophies[c.clubId] ? '' : 'is-empty' }, pixelIcon('trophy', { size: 'xl' })),
        h('span', { text: c.trophyName }), h('div.pp-small.pp-muted', { text: c.city })))),
      h('p', { text: career.trophies[clubId] ? `Your name is engraved on ${club.trophyName}.` : `${club.trophyName} is still waiting for a name.` }),
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
      h('p.pp-small', { text: `Three knockout rounds against returning Star Players at full strength (${FINALE.rounds.map((_, i) => finaleElo(i, career.difficulty)).join(' / ')} Elo). Every round must be won; a lost round can be replayed. Win the final to qualify for the Big Leagues.` }),
      h('ol.pp-col', { style: { paddingLeft: '20px' } }, f.opponents.map((id, i) => {
        const s = starById(id);
        return h('li', null, h('b', { text: FINALE.rounds[i].label }), `: ${s.name} (${openingById(s.openingId).name}) · ${finaleElo(i, career.difficulty)}`,
          i < f.round ? ' \u00b7 done' : i === f.round ? ' \u00b7 next' : '');
      })),
      h('div.pp-row', null,
        button(`${round.label} vs ${star.name}`, () => close('play'), { cls: 'pp-btn--gold', icon: pixelIcon('trophy', { size: 'sm' }) }),
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

  /* Standing characters hold still: no idle animation. */

  /* One-time tips for what this place is for (app.coach never repeats one). */
  function teachHere() {
    if (isFinale || !club) return;
    const star = starForClub(clubId);
    if (scene.kind === 'interior' && !career.trophies[clubId]) {
      app.coach('desk', `The Tournament hall is where it starts: enter the ${club.tournamentConfig.name}, win your way to the final, then beat ${star.name} for the trophy.`, { title: 'Your goal here' });
    }
    if (scene.kind === 'venue') {
      app.coach('venue', `A casual venue. The host has a puzzle set: solve all of it for ${club.city}'s postcard. Postcards are optional, but their backs hide a message...`, { title: 'Puzzles and postcards' });
    }
    if (trophyCount(career) >= 1 && !career.trophies[clubId] && scene.kind === 'exterior') {
      app.coach('members', 'The people around the club like a game too. Talk to them for tips, or play them for coins.', { title: 'Club members' });
    }
    if (trophyCount(career) >= 1 && career.trophies[clubId] && !hasAllTrophies(career)) {
      app.coach('travel', 'Trophy won! Open the Map (top bar) and fly to another city for the next one.', { title: 'Time to travel' });
    }
    if (scene.kind === 'interior' && (career.tournaments[clubId]?.attempt || 0) >= 1 && !career.trophies[clubId]) {
      app.coach('practice', `Want to get better at the ${openingById(club.openingId).name}? The practice room has its tutorial and drills. Optional, but it raises your mastery.`, { title: 'Practice room' });
    }
  }

  /* ---------------------------------------------------------- arrival -- */
  window.addEventListener('resize', fit);
  // The HUD can change height after the first fit (fonts arriving, a longer
  // goal, more coins): the stage must start below it, or labels hide under it.
  const hudRo = hudBar ? new ResizeObserver(() => fit()) : null;
  hudRo?.observe(hudBar);
  // The dock and HUD settle after the first fit (fonts, wrapping): re-fit so the
  // stage and the label nudges match the room they really leave.
  const settle = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
  if (settle) { settle.observe(dock); if (hudBar) settle.observe(hudBar); }
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
      /* Only what the first minute needs. Everything else is taught when it
         first matters (app.coach): the desk, Focus, the guide, the map... */
      void opening;
      await app.dialogue({ name: 'Passport officer', role: 'Welcome desk', look: GUIDE_LOOK, lines: [
        `Welcome to ${club.city}, ${career.name}! Here is your chess passport: six empty pages, one for each city's Club Trophy.`,
        `To win a trophy, enter the club tournament inside, then beat the club's Star Player in the final.`,
        tapWord() === 'tap'
          ? 'Tap the club door, or walk with the stick and press A. Good games!'
          : 'Click the club door (or walk there with the arrow keys). Good games!'
      ] });
    }
    teachHere();
    if (params.intro) {
      /* handled above */
    } else if (params.firstVisit && club) {
      const opening = openingById(club.openingId);
      const mastery = career.openings[club.openingId] ?? 0;
      app.toast(`${club.city}: home of the ${opening.name} (${mastery}% ${masteryState(mastery).label.toLowerCase()})`, { ms: 4200 });
    }
  })();

  return {
    el,
    /** Tests: stand the player at a spot (percent of the scene), as if walked there. */
    debugPlace(x, y) {
      walking = null;
      const [px, py] = freeMode ? (grid.nearestFree(x, y) || [x, y]) : [x, y];
      player.x = px; player.y = py; playerNode = null;
      player.draw(); follow(); paintPad();
      return [px, py];
    },
    destroy() {
      walking = null;
      stick = null;
      pad.destroy();
      viewportObserver.disconnect();
      window.removeEventListener('resize', fit);
      hudRo?.disconnect();
      settle?.disconnect();
      releaseControls();
    }
  };
}

export default sceneScreen;
