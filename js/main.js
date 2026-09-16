/**
 * main.js - Pawn & Passport entry point.
 *
 * Serve the project root over HTTP (python3 tools/serve.py) and open
 * index.html. file:// breaks module imports and the Stockfish worker.
 *
 * Debug deep links (development only):
 *   ?screen=map | journal | settings | ending
 *   ?scene=nyc-int
 *   ?puzzle=m-lon
 */

import { createApp } from './ui/app.js';
import { titleScreen } from './ui/screens/title.js';
import { createScreen } from './ui/screens/create.js';
import { mapScreen } from './ui/screens/map.js';
import { sceneScreen } from './ui/screens/scene.js';
import { matchScreen } from './ui/screens/match.js';
import { puzzleScreen } from './ui/screens/puzzle.js';
import { journalScreen } from './ui/screens/journal.js';
import { settingsScreen } from './ui/screens/settings.js';
import { endingScreen } from './ui/screens/ending.js';
import { drillScreen } from './ui/screens/drill.js';
import { engineService } from './chess/engine/engineService.js';
import { loadCharacterSprites } from './ui/sprites.js';

const screens = {
  title: titleScreen,
  create: createScreen,
  map: mapScreen,
  scene: sceneScreen,
  match: matchScreen,
  puzzle: puzzleScreen,
  journal: journalScreen,
  settings: settingsScreen,
  ending: endingScreen,
  drill: drillScreen
};

const app = createApp(document.getElementById('app'), screens);
window.__pap = app;       // for the headless test drivers in tools/

async function boot() {
  const status = document.getElementById('curtain-status');
  // Warm the engine in the background; nothing waits on it.
  engineService.ready().then(() => { if (status) status.textContent = 'Engine ready.'; }).catch(() => {});

  // Character sheets first: portraits and scenes draw from them synchronously.
  if (status) status.textContent = 'Waking up the chess players...';
  await loadCharacterSprites();

  const query = new URLSearchParams(location.search);
  const needsCareer = (name) => !['title', 'create', 'settings', 'ending'].includes(name);
  let target = { name: 'title', params: {} };
  if (query.get('screen')) target = { name: query.get('screen'), params: {} };
  if (query.get('scene')) target = { name: 'scene', params: { sceneId: query.get('scene') } };
  if (query.get('puzzle')) target = { name: 'puzzle', params: { missionId: query.get('puzzle'), returnScene: `${query.get('puzzle').slice(2)}-venue` } };
  if (needsCareer(target.name) && !app.career) target = { name: 'title', params: {} };
  if (!screens[target.name]) target = { name: 'title', params: {} };

  await app.go(target.name, target.params);
  const curtain = document.getElementById('curtain');
  curtain.classList.add('is-gone');
  setTimeout(() => curtain.remove(), 500);
}

boot().catch((error) => {
  console.error(error);
  const status = document.getElementById('curtain-status');
  if (status) status.textContent = `Could not start: ${error.message}`;
});
