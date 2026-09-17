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
add(garden('nyc-ext', 'assets/scenes/nyc-ext.webp',
  { gate: [50, 86], path: [50, 69], porch: [50, 50], door: [50, 45], sides: [[38, 59], [62, 59]] }));
add(hallA('nyc-int', 'assets/scenes/nyc-int.webp', {
  entrance: [50, 90], lobby: [50, 66], mid: [50, 40], stairs: [50, 16],
  dirDoor: [33, 33], director: [20, 34], starNpc: [16, 27],
  pracDoor: [33, 60], practice: [19, 64], practiceNpc: [13, 60],
  hallDoor: [67, 45], hall: [80, 47], hallNpc: [86, 41]
}));
add(upstairs('nyc-up', 'assets/scenes/nyc-up.webp',
  { stairs: [50, 45], hub: [50, 70], lounge: [22, 58], loungeNpc: [16, 50], trophies: [78, 55] }));
add({
  id: 'nyc-venue', image: 'assets/scenes/nyc-venue.webp', kind: 'venue', placeholder: false,
  spawn: { default: 'arrive' },
  nodes: { arrive: [50, 92], plaza: [27, 86], stairFoot: [12, 69], stairTop: [9, 45], terrace: [15, 37], host: [21, 37], exit: [50, 96] },
  links: [['arrive', 'plaza'], ['plaza', 'stairFoot'], ['stairFoot', 'stairTop'], ['stairTop', 'terrace'], ['terrace', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Chess tables', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [28, 33] } },
    { id: 'exit', node: 'exit', label: 'Leave the park', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* London */
add(garden('lon-ext', 'assets/scenes/lon-ext.webp',
  { gate: [50, 86], path: [50, 62], porch: [50, 46], door: [50, 38] }));
add({
  id: 'lon-int', image: 'assets/scenes/lon-int.webp', kind: 'interior', spawn: { default: 'entrance', entrance: 'entrance' },
  nodes: { entrance: [50, 90], lobby: [50, 70], stairs: [50, 52], hall: [50, 30], dirDoor: [36, 70], director: [22, 62], studyDoor: [64, 70], study: [76, 64] },
  links: [['entrance', 'lobby'], ['lobby', 'stairs'], ['stairs', 'hall'], ['lobby', 'dirDoor'], ['dirDoor', 'director'], ['lobby', 'studyDoor'], ['studyDoor', 'study']],
  hotspots: [
    { id: 'tournament', node: 'hall', label: 'Tournament hall', verb: 'Play', action: { type: 'tournament' }, npc: { kind: 'regular', index: 0, at: [60, 22] } },
    { id: 'star', node: 'director', label: "Director's office", verb: 'Talk', action: { type: 'star' }, npc: { kind: 'star', at: [20, 53] } },
    { id: 'friendly', node: 'study', label: 'Study and practice', verb: 'Practice', action: { type: 'friendly' }, npc: { kind: 'regular', index: 1, at: [84, 58] } },
    { id: 'exit', node: 'entrance', label: 'Garden', verb: 'Exit', action: { type: 'scene', to: 'lon-ext', spawn: 'door' } }
  ]
});
add({
  // Covent Garden Chess Courtyard: in from the street, along the benches, up the west aisle.
  id: 'lon-venue', image: 'assets/scenes/lon-venue.webp', kind: 'venue', spawn: { default: 'arrive' },
  nodes: { arrive: [50, 86], aisle: [50, 74], west: [21, 74], host: [21, 57], exit: [50, 93] },
  links: [['arrive', 'aisle'], ['aisle', 'west'], ['west', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Courtyard chess tables', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [27, 50] } },
    { id: 'exit', node: 'exit', label: 'Leave the courtyard', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* Vienna */
add(garden('vie-ext', 'assets/scenes/vie-ext.webp',
  { gate: [50, 88], path: [50, 66], porch: [50, 52], door: [50, 44] }));
add(hallA('vie-int', 'assets/scenes/vie-int.webp', {
  entrance: [50, 90], lobby: [50, 62], mid: [44, 34], stairs: [50, 14],
  dirDoor: [33, 30], director: [19, 32], starNpc: [18, 24],
  pracDoor: [33, 58], practice: [18, 62], practiceNpc: [12, 56],
  hallDoor: [67, 42], hall: [80, 46], hallNpc: [86, 40]
}));
add(upstairs('vie-up', 'assets/scenes/vie-up.webp',
  { stairs: [50, 86], hub: [50, 30], lounge: [22, 46], loungeNpc: [14, 40], trophies: [80, 50] }));
add({
  // Café Wien: in over the doormat, between the plants, to the table under the cathedral window.
  id: 'vie-venue', image: 'assets/scenes/vie-venue.webp', kind: 'venue', spawn: { default: 'arrive' },
  nodes: { arrive: [50, 87], floor: [50, 72], host: [47, 62], exit: [50, 95] },
  links: [['arrive', 'floor'], ['floor', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Cafe chess table', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [39, 54] } },
    { id: 'exit', node: 'exit', label: 'Leave the cafe', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* Istanbul */
add(garden('ist-ext', 'assets/scenes/ist-ext.webp',
  { gate: [50, 84], path: [50, 64], porch: [50, 48], door: [50, 40] }));
add(hallA('ist-int', 'assets/scenes/ist-int.webp', {
  entrance: [50, 90], lobby: [50, 68], mid: [50, 38], stairs: [50, 16],
  dirDoor: [33, 32], director: [19, 34], starNpc: [18, 24],
  pracDoor: [33, 60], practice: [18, 63], practiceNpc: [12, 57],
  hallDoor: [67, 45], hall: [80, 48], hallNpc: [86, 42]
}));
add(upstairs('ist-up', 'assets/scenes/ist-up.webp',
  { stairs: [50, 30], hub: [50, 62], lounge: [22, 50], loungeNpc: [15, 44], trophies: [78, 56] }));
add({
  // Bosphorus tea terrace: up the steps, round the sign, to the middle table.
  id: 'ist-venue', image: 'assets/scenes/ist-venue.webp', kind: 'venue', spawn: { default: 'arrive' },
  nodes: { arrive: [50, 90], steps: [50, 80], west: [30, 64], host: [38, 58], exit: [50, 97] },
  links: [['arrive', 'steps'], ['steps', 'west'], ['west', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Tea terrace table', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [55, 57] } },
    { id: 'exit', node: 'exit', label: 'Down to the water', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* Chennai */
add(garden('che-ext', 'assets/scenes/che-ext.webp',
  { gate: [50, 82], path: [50, 62], porch: [50, 50], door: [50, 41] }));
add({
  id: 'che-int', image: 'assets/scenes/che-int.webp', kind: 'interior', spawn: { default: 'entrance', entrance: 'entrance' },
  nodes: { entrance: [50, 90], lobby: [50, 72], stairs: [50, 56], hall: [50, 32], dirDoor: [32, 70], director: [18, 64], studyDoor: [68, 70], study: [80, 64] },
  links: [['entrance', 'lobby'], ['lobby', 'stairs'], ['stairs', 'hall'], ['lobby', 'dirDoor'], ['dirDoor', 'director'], ['lobby', 'studyDoor'], ['studyDoor', 'study']],
  hotspots: [
    { id: 'tournament', node: 'hall', label: 'Tournament hall', verb: 'Play', action: { type: 'tournament' }, npc: { kind: 'regular', index: 0, at: [38, 26] } },
    { id: 'star', node: 'director', label: "Director's office", verb: 'Talk', action: { type: 'star' }, npc: { kind: 'star', at: [20, 55] } },
    { id: 'friendly', node: 'study', label: 'Study and practice', verb: 'Practice', action: { type: 'friendly' }, npc: { kind: 'regular', index: 1, at: [86, 58] } },
    { id: 'exit', node: 'entrance', label: 'Temple garden', verb: 'Exit', action: { type: 'scene', to: 'che-ext', spawn: 'door' } }
  ]
});
add({
  // Marina Beach promenade: along the east walk past the palm, to the tables by the tea stall.
  id: 'che-venue', image: 'assets/scenes/che-venue.webp', kind: 'venue', spawn: { default: 'arrive' },
  nodes: { arrive: [77, 87], walk: [77, 62], host: [62, 55], exit: [60, 93] },
  links: [['arrive', 'walk'], ['walk', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Chess corner', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [57, 48] } },
    { id: 'exit', node: 'exit', label: 'Leave the promenade', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* Wenzhou */
add(garden('wen-ext', 'assets/scenes/wen-ext.webp',
  { gate: [50, 86], path: [50, 64], porch: [50, 50], door: [50, 42] }));
add(hallA('wen-int', 'assets/scenes/wen-int.webp', {
  entrance: [50, 90], lobby: [40, 60], mid: [50, 40], stairs: [50, 14],
  dirDoor: [33, 28], director: [19, 30], starNpc: [16, 22],
  pracDoor: [33, 62], practice: [18, 66], practiceNpc: [12, 60],
  hallDoor: [68, 50], hall: [82, 54], hallNpc: [88, 46]
}));
add(upstairs('wen-up', 'assets/scenes/wen-up.webp',
  { stairs: [50, 32], hub: [50, 58], lounge: [24, 52], loungeNpc: [16, 44], trophies: [78, 54] }));
add({
  // Ou River pavilion: down the old-town steps, across the quay, to the riverside table.
  id: 'wen-venue', image: 'assets/scenes/wen-venue.webp', kind: 'venue', spawn: { default: 'arrive' },
  nodes: { arrive: [80, 42], quay: [70, 63], host: [52, 64], exit: [86, 30] },
  links: [['arrive', 'quay'], ['quay', 'host'], ['arrive', 'exit']],
  hotspots: [
    { id: 'mission', node: 'host', label: 'Riverside chess table', verb: 'Puzzles', action: { type: 'mission' }, npc: { kind: 'host', at: [45, 66] } },
    { id: 'exit', node: 'exit', label: 'Up to the old town', verb: 'Travel', action: { type: 'leave' } }
  ]
});

/* Madrid: the Grand Finale */
add({
  id: 'mad-ext', image: 'assets/scenes/mad-ext.webp', kind: 'exterior', spawn: { default: 'gate', door: 'door' },
  nodes: { gate: [50, 90], path: [50, 72], left: [38, 52], porch: [50, 40], door: [50, 34] },
  links: [['gate', 'path'], ['path', 'left'], ['left', 'porch'], ['porch', 'door']],
  hotspots: [
    { id: 'door', node: 'door', label: 'Palacio del Ajedrez', verb: 'Enter', action: { type: 'scene', to: 'mad-int', spawn: 'entrance' } },
    { id: 'gate', node: 'gate', label: 'Leave', verb: 'Travel', action: { type: 'leave' } }
  ]
});
add({
  id: 'mad-int', image: 'assets/scenes/mad-int.webp', kind: 'finale', spawn: { default: 'entrance', entrance: 'entrance' },
  nodes: { entrance: [50, 92], lobby: [50, 66], leftStair: [40, 42], stage: [50, 24], lounge: [20, 64] },
  links: [['entrance', 'lobby'], ['lobby', 'leftStair'], ['leftStair', 'stage'], ['lobby', 'lounge']],
  hotspots: [
    { id: 'finale', node: 'stage', label: 'Championship stage', verb: 'Compete', action: { type: 'finale' } },
    { id: 'rivals', node: 'lounge', label: 'Players\' lounge', verb: 'Talk', action: { type: 'rivals' }, npc: { kind: 'rivals', at: [14, 58] } },
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
