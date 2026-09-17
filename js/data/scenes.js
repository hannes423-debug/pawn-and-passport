/**
 * scenes.js - every walkable place: 6 club gardens, 6 floor plans, 4 upper
 * floors, 6 casual venues and the two Madrid scenes.
 *
 * Coordinates are PERCENT of the scene image (x right, y down), measured off
 * the art with a grid overlay. The player walks a small waypoint graph
 * (`nodes` + `links`), never through free space, so there is no collision
 * mask to maintain: a new scene is a picture, a few points and its hotspots.
 *
 * A hotspot is where an action happens. `node` is where the player stands to
 * use it; `npc` optionally puts a character sprite there. `action.type` is
 * resolved by js/ui/sceneScreen.js with the club as context:
 *   scene      go to another scene      { to, spawn }
 *   leave      open the travel menu (world map / venue / club)
 *   tournament enter or continue the club tournament
 *   star       talk to the Star Player
 *   friendly   the practice room: unrated friendly, puzzles, opening tutorial and drills
 *   trophies   the club trophy cabinet
 *   mission    the venue's puzzle mission
 *   finale     the Grand Finale
 *   rivals     the returning Star Players in Madrid
 *   talk       a flavour line
 *
 * Every casual venue has its own art (Madrid has none: it is the finale).
 *
 * `actorHeight` is a character's sprite height as a share of the scene
 * height (default 0.1). The venues are close-up views, so it is measured from
 * the art: a person stands about 1.75 chair heights (chairs measured
 * backrest-top to feet; Madrid from a bench), and the drawn body fills 89% of
 * the sprite frame.
 */

const link = (...chain) => chain.slice(1).map((id, i) => [chain[i], id]);

/* ------------------------------------------------------------ builders -- */

/** Club garden: the gate at the bottom, the door at the top. */
function garden(id, image, { gate, path, porch, door, sides = null }) {
  const nodes = { gate, path, porch, door };
  const links = link('gate', 'path', 'porch', 'door');
  if (sides) {
    nodes.left = sides[0]; nodes.right = sides[1];
    links.push(['path', 'left'], ['left', 'porch'], ['path', 'right'], ['right', 'porch']);
  }
  return {
    id, image, kind: 'exterior', spawn: { default: 'gate', door: 'door' },
    nodes, links,
    hotspots: [
      { id: 'door', node: 'door', label: 'Enter the club', verb: 'Enter', action: { type: 'scene', to: `${id.slice(0, 3)}-int`, spawn: 'entrance' } },
      { id: 'gate', node: 'gate', label: 'Leave', verb: 'Travel', action: { type: 'leave' } }
    ]
  };
}

/**
 * Floor plan "A" (New York, Vienna, Istanbul, Wenzhou): director top-left,
 * practice room bottom-left, tournament hall on the right, stairs top centre.
 */
function hallA(id, image, p, { upstairs = true } = {}) {
  const club = id.slice(0, 3);
  const nodes = {
    entrance: p.entrance, lobby: p.lobby, mid: p.mid,
    dirDoor: p.dirDoor, director: p.director,
    pracDoor: p.pracDoor, practice: p.practice,
    hallDoor: p.hallDoor, hall: p.hall
  };
  const links = [
    ['entrance', 'lobby'], ['lobby', 'mid'],
    ['mid', 'dirDoor'], ['dirDoor', 'director'],
    ['lobby', 'pracDoor'], ['pracDoor', 'practice'],
    ['mid', 'hallDoor'], ['hallDoor', 'hall']
  ];
  const hotspots = [
    { id: 'tournament', node: 'hall', label: 'Tournament hall', verb: 'Play', action: { type: 'tournament' },
      npc: { kind: 'regular', index: 0, at: p.hallNpc } },
    { id: 'star', node: 'director', label: "Director's office", verb: 'Talk', action: { type: 'star' },
      npc: { kind: 'star', at: p.starNpc } },
    { id: 'friendly', node: 'practice', label: 'Practice room', verb: 'Practice', action: { type: 'friendly' },
      npc: { kind: 'regular', index: 1, at: p.practiceNpc } },
    { id: 'exit', node: 'entrance', label: 'Garden', verb: 'Exit', action: { type: 'scene', to: `${club}-ext`, spawn: 'door' } }
  ];
  if (upstairs) {
    nodes.stairs = p.stairs;
    links.push(['mid', 'stairs']);
    hotspots.push({ id: 'upstairs', node: 'stairs', label: 'Upstairs', verb: 'Climb', action: { type: 'scene', to: `${club}-up`, spawn: 'stairs' } });
  }
  return { id, image, kind: 'interior', spawn: { default: 'entrance', entrance: 'entrance', stairs: upstairs ? 'stairs' : 'entrance' }, nodes, links, hotspots };
}

/** Upper floor: lounge on the left, trophy hall on the right. */
function upstairs(id, image, p) {
  const club = id.slice(0, 3);
  return {
    id, image, kind: 'upstairs', spawn: { default: 'stairs', stairs: 'stairs' },
    nodes: { stairs: p.stairs, hub: p.hub, lounge: p.lounge, trophies: p.trophies },
    links: [['stairs', 'hub'], ['hub', 'lounge'], ['hub', 'trophies']],
    hotspots: [
      { id: 'trophies', node: 'trophies', label: 'Trophy hall', verb: 'Look', action: { type: 'trophies' } },
      { id: 'lounge', node: 'lounge', label: 'Members\' lounge', verb: 'Talk', action: { type: 'talk', lineKey: 'lounge' },
        npc: { kind: 'regular', index: 2, at: p.loungeNpc } },
      { id: 'down', node: 'stairs', label: 'Downstairs', verb: 'Descend', action: { type: 'scene', to: `${club}-int`, spawn: 'stairs' } }
    ]
  };
}

/** A casual venue. */
function venue(id, image, p, { placeholder = false } = {}) {
  return {
    id, image, kind: 'venue', placeholder, spawn: { default: 'arrive' },
    nodes: { arrive: p.arrive, ...(p.via ? { via: p.via } : {}), host: p.host, exit: p.exit },
    links: p.via ? [['arrive', 'via'], ['via', 'host'], ['arrive', 'exit']] : [['arrive', 'host'], ['arrive', 'exit']],
    hotspots: [
      { id: 'mission', node: 'host', label: p.hostLabel, verb: 'Puzzles', action: { type: 'mission' },
        npc: { kind: 'host', at: p.hostNpc } },
      { id: 'exit', node: 'exit', label: 'Leave', verb: 'Travel', action: { type: 'leave' } }
    ]
  };
}

/* -------------------------------------------------------------- scenes -- */

export const SCENES = {};
const add = (scene) => { SCENES[scene.id] = scene; };

/* New York */
add({ ...garden('nyc-ext', 'assets/scenes/nyc-ext.webp',
  { gate: [50, 89], path: [39.5, 62], porch: [50, 48], door: [50, 44.5], sides: [[39.5, 62], [60.5, 62]] }), actorHeight: 0.095 });
add({ ...hallA('nyc-int', 'assets/scenes/nyc-int.webp', {
  entrance: [50, 91], lobby: [50, 78], mid: [50, 40], stairs: [50, 14],
  dirDoor: [34, 38.5], director: [27, 32], starNpc: [18, 23.5],
  pracDoor: [34, 60], practice: [18.2, 66], practiceNpc: [18.2, 58.5],
  hallDoor: [64, 40], hall: [80.5, 46], hallNpc: [80.5, 35]
}), actorHeight: 0.07 });
add({ ...upstairs('nyc-up', 'assets/scenes/nyc-up.webp',
  { stairs: [50, 40], hub: [50, 32], lounge: [22, 39.5], loungeNpc: [18, 39.5], trophies: [80, 59.5] }), actorHeight: 0.07 });
add({
  id: 'nyc-venue', image: 'assets/scenes/nyc-venue.webp', actorHeight: 0.113, kind: 'venue', placeholder: false,
  spawn: { default: 'arrive' },
  nodes: { arrive: [50, 92], plaza: [27, 86], stairFoot: [12, 69], stairTop: [9, 45], terrace: [15, 37], host: [21, 37], exit: [50, 96] },
  links: [['arrive', 'plaza'], ['plaza', 'stairFoot'], ['stairFoot', 'stairTop'], ['stairTop', 'terrace'], ['terrace', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Chess tables', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [29.5, 36.5] } },
    { id: 'exit', node: 'exit', label: 'Leave the park', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* London */
add({ ...garden('lon-ext', 'assets/scenes/lon-ext.webp',
  { gate: [50, 90], path: [50, 66], porch: [50, 42], door: [50, 36] }), actorHeight: 0.08 });
add({
  id: 'lon-int', image: 'assets/scenes/lon-int.webp', actorHeight: 0.07, kind: 'interior', spawn: { default: 'entrance', entrance: 'entrance' },
  nodes: { entrance: [50, 92], lobby: [50, 70], stairs: [50, 50], hall: [50, 30], dirDoor: [34, 70], director: [28, 62], studyDoor: [66, 70], study: [78, 76.5] },
  links: [['entrance', 'lobby'], ['lobby', 'stairs'], ['stairs', 'hall'], ['lobby', 'dirDoor'], ['dirDoor', 'director'], ['lobby', 'studyDoor'], ['studyDoor', 'study']],
  hotspots: [
    { id: 'tournament', node: 'hall', label: 'Tournament hall', verb: 'Play', action: { type: 'tournament' }, npc: { kind: 'regular', index: 0, at: [50, 22] } },
    { id: 'star', node: 'director', label: "Director's office", verb: 'Talk', action: { type: 'star' }, npc: { kind: 'star', at: [20, 53.5] } },
    { id: 'friendly', node: 'study', label: 'Study and practice', verb: 'Practice', action: { type: 'friendly' }, npc: { kind: 'regular', index: 1, at: [80, 60] } },
    { id: 'exit', node: 'entrance', label: 'Garden', verb: 'Exit', action: { type: 'scene', to: 'lon-ext', spawn: 'door' } }
  ]
});
add({
  // Covent Garden Chess Courtyard: in from the street, along the benches, up the west aisle.
  id: 'lon-venue', image: 'assets/scenes/lon-venue.webp', actorHeight: 0.117, kind: 'venue', spawn: { default: 'arrive' },
  nodes: { arrive: [50, 86], aisle: [50, 74], west: [21, 74], host: [21, 57], exit: [50, 93] },
  links: [['arrive', 'aisle'], ['aisle', 'west'], ['west', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Courtyard chess tables', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [24.5, 53] } },
    { id: 'exit', node: 'exit', label: 'Leave the courtyard', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* Vienna */
add({ ...garden('vie-ext', 'assets/scenes/vie-ext.webp',
  { gate: [50, 92], path: [50, 65], porch: [50, 45], door: [50, 39] }), actorHeight: 0.09 });
add({ ...hallA('vie-int', 'assets/scenes/vie-int.webp', {
  entrance: [50, 91], lobby: [50, 78], mid: [50, 33], stairs: [50, 12],
  dirDoor: [34, 35], director: [27.5, 34], starNpc: [18.3, 23],
  pracDoor: [34, 60], practice: [29.2, 60], practiceNpc: [17.9, 58],
  hallDoor: [65, 36], hall: [81.3, 47], hallNpc: [81.3, 37]
}), actorHeight: 0.07 });
add({ ...upstairs('vie-up', 'assets/scenes/vie-up.webp',
  { stairs: [50, 37], hub: [50, 33], lounge: [21, 48], loungeNpc: [24, 48.5], trophies: [81, 57] }), actorHeight: 0.07 });
add({
  // Café Wien: in over the doormat, between the plants, to the table under the cathedral window.
  id: 'vie-venue', image: 'assets/scenes/vie-venue.webp', actorHeight: 0.27, kind: 'venue', spawn: { default: 'arrive' },
  nodes: { arrive: [50, 87], floor: [50, 72], host: [47, 62], exit: [50, 95] },
  links: [['arrive', 'floor'], ['floor', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Cafe chess table', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [36, 57] } },
    { id: 'exit', node: 'exit', label: 'Leave the cafe', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* Istanbul */
add({ ...garden('ist-ext', 'assets/scenes/ist-ext.webp',
  { gate: [50, 89], path: [50, 66], porch: [50, 48], door: [50, 42] }), actorHeight: 0.08 });
add({ ...hallA('ist-int', 'assets/scenes/ist-int.webp', {
  entrance: [50, 91], lobby: [50, 78], mid: [50, 38], stairs: [50, 12],
  dirDoor: [34, 33.5], director: [27, 34], starNpc: [18.5, 23],
  pracDoor: [34, 60.5], practice: [17.5, 63.5], practiceNpc: [17.5, 57],
  hallDoor: [66, 44.5], hall: [80.5, 50], hallNpc: [80.5, 36]
}), actorHeight: 0.07 });
add({ ...upstairs('ist-up', 'assets/scenes/ist-up.webp',
  { stairs: [50, 37], hub: [50, 48], lounge: [21, 48.5], loungeNpc: [18, 49], trophies: [82.5, 50] }), actorHeight: 0.07 });
add({
  // Bosphorus tea terrace: up the steps, round the sign, to the middle table.
  id: 'ist-venue', image: 'assets/scenes/ist-venue.webp', actorHeight: 0.17, kind: 'venue', spawn: { default: 'arrive' },
  nodes: { arrive: [62, 61], steps: [50, 63], west: [30, 61], host: [38, 58], exit: [50, 63] },
  links: [['arrive', 'steps'], ['steps', 'west'], ['west', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Tea terrace table', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [59, 61.5] } },
    { id: 'exit', node: 'exit', label: 'Down to the water', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* Chennai */
add({ ...garden('che-ext', 'assets/scenes/che-ext.webp',
  { gate: [50, 89], path: [50, 70], porch: [50, 52], door: [50, 44] }), actorHeight: 0.09 });
add({
  id: 'che-int', image: 'assets/scenes/che-int.webp', actorHeight: 0.07, kind: 'interior', spawn: { default: 'entrance', entrance: 'entrance' },
  nodes: { entrance: [50, 92], lobby: [50, 74], stairs: [50, 50], hall: [50, 28], dirDoor: [31, 66.5], director: [26, 73], studyDoor: [69, 66.5], study: [83.2, 67] },
  links: [['entrance', 'lobby'], ['lobby', 'stairs'], ['stairs', 'hall'], ['lobby', 'dirDoor'], ['dirDoor', 'director'], ['lobby', 'studyDoor'], ['studyDoor', 'study']],
  hotspots: [
    { id: 'tournament', node: 'hall', label: 'Tournament hall', verb: 'Play', action: { type: 'tournament' }, npc: { kind: 'regular', index: 0, at: [50, 22] } },
    { id: 'star', node: 'director', label: "Director's office", verb: 'Talk', action: { type: 'star' }, npc: { kind: 'star', at: [18.8, 57.5] } },
    { id: 'friendly', node: 'study', label: 'Study and practice', verb: 'Practice', action: { type: 'friendly' }, npc: { kind: 'regular', index: 1, at: [83.2, 59] } },
    { id: 'exit', node: 'entrance', label: 'Temple garden', verb: 'Exit', action: { type: 'scene', to: 'che-ext', spawn: 'door' } }
  ]
});
add({
  // Marina Beach promenade: along the east walk past the palm, to the tables by the tea stall.
  id: 'che-venue', image: 'assets/scenes/che-venue.webp', actorHeight: 0.13, kind: 'venue', spawn: { default: 'arrive' },
  nodes: { arrive: [77, 87], walk: [77, 62], host: [62, 55], exit: [60, 93] },
  links: [['arrive', 'walk'], ['walk', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Chess corner', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [54.5, 52] } },
    { id: 'exit', node: 'exit', label: 'Leave the promenade', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* Wenzhou */
add({ ...garden('wen-ext', 'assets/scenes/wen-ext.webp',
  { gate: [50, 91], path: [50, 66], porch: [50, 52], door: [50, 46] }), actorHeight: 0.08 });
add({ ...hallA('wen-int', 'assets/scenes/wen-int.webp', {
  entrance: [50, 91], lobby: [50, 78], mid: [50, 50], stairs: [50, 8],
  dirDoor: [33, 30.5], director: [26, 31], starNpc: [17, 21],
  pracDoor: [33, 62.5], practice: [17, 66], practiceNpc: [17, 62],
  hallDoor: [67, 50.5], hall: [82.5, 56], hallNpc: [82.5, 34.5]
}), actorHeight: 0.07 });
add({ ...upstairs('wen-up', 'assets/scenes/wen-up.webp',
  { stairs: [50, 40], hub: [50, 52], lounge: [20, 47.5], loungeNpc: [17, 48], trophies: [79, 60] }), actorHeight: 0.07 });
add({
  // Ou River pavilion: down the old-town steps, across the quay, to the riverside table.
  id: 'wen-venue', image: 'assets/scenes/wen-venue.webp', actorHeight: 0.166, kind: 'venue', spawn: { default: 'arrive' },
  nodes: { arrive: [80, 42], quay: [70, 63], host: [52, 64], exit: [86, 30] },
  links: [['arrive', 'quay'], ['quay', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Riverside chess table', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [50, 66.5] } },
    { id: 'exit', node: 'exit', label: 'Up to the old town', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* Madrid: the Grand Finale */
add({
  id: 'mad-ext', image: 'assets/scenes/mad-ext.webp', actorHeight: 0.088, kind: 'exterior', spawn: { default: 'gate', door: 'door' },
  nodes: { gate: [50, 95.5], path: [50, 72], left: [38, 52], porch: [50, 40], door: [50, 34] },
  links: [['gate', 'path'], ['path', 'left'], ['left', 'porch'], ['porch', 'door']],
  hotspots: [
    { id: 'door', node: 'door', label: 'Palacio del Ajedrez', verb: 'Enter', action: { type: 'scene', to: 'mad-int', spawn: 'entrance' } },
    { id: 'gate', node: 'gate', label: 'Leave', verb: 'Travel', action: { type: 'leave' } }
  ]
});
add({
  id: 'mad-int', image: 'assets/scenes/mad-int.webp', actorHeight: 0.06, kind: 'finale', spawn: { default: 'entrance', entrance: 'entrance' },
  nodes: { entrance: [50, 92], lobby: [50, 68], leftStair: [40, 50], stage: [50, 26], lounge: [22, 56.5] },
  links: [['entrance', 'lobby'], ['lobby', 'leftStair'], ['leftStair', 'stage'], ['lobby', 'lounge']],
  hotspots: [
    { id: 'finale', node: 'stage', label: 'Championship stage', verb: 'Compete', action: { type: 'finale' } },
    { id: 'rivals', node: 'lounge', label: 'Players\' lounge', verb: 'Talk', action: { type: 'rivals' }, npc: { kind: 'rivals', at: [9, 54], spread: [5, 0] } },
    { id: 'exit', node: 'entrance', label: 'Courtyard', verb: 'Exit', action: { type: 'scene', to: 'mad-ext', spawn: 'door' } }
  ]
});

export const sceneById = (id) => SCENES[id] || null;

/** Shortest path through a scene's waypoint graph (BFS; the graphs are tiny). */
export function findPath(scene, from, to) {
  if (from === to) return [to];
  const adjacent = {};
  for (const [a, b] of scene.links) {
    (adjacent[a] = adjacent[a] || []).push(b);
    (adjacent[b] = adjacent[b] || []).push(a);
  }
  const previous = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const node = queue.shift();
    if (node === to) break;
    for (const next of adjacent[node] || []) {
      if (!(next in previous)) { previous[next] = node; queue.push(next); }
    }
  }
  if (!(to in previous)) return null;
  const path = [];
  for (let node = to; node !== null; node = previous[node]) path.unshift(node);
  return path;
}

export default SCENES;
