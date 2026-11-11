/**
 * save.js - Pawn & Passport's own save namespace.
 *
 * Every key starts with PAP_, so nothing here can collide with Chess: World
 * Tour (which uses cwt.* keys) even on the same origin. The storage backend is
 * injectable so the Node tests run the real code against a Map.
 *
 *   PAP_career_v1             the single career slot
 *   PAP_career_v1_backup      the career as it was one save earlier
 *   PAP_career_v1_unreadable  a career slot that could not be read, kept
 *                             aside so nothing overwrites it (see loadCareerSafe)
 *   PAP_history_v1            finished games (js/core/history.js)
 *   PAP_settings_v1           audio / board / accessibility preferences
 */

import { migrateHistory, emptyHistory } from './history.js';

export const SAVE_PREFIX = 'PAP_';
export const KEYS = Object.freeze({
  career: `${SAVE_PREFIX}career_v1`,
  careerBackup: `${SAVE_PREFIX}career_v1_backup`,
  careerUnreadable: `${SAVE_PREFIX}career_v1_unreadable`,
  history: `${SAVE_PREFIX}history_v1`,
  settings: `${SAVE_PREFIX}settings_v1`
});

export const DEFAULT_SETTINGS = Object.freeze({
  volume: 0.7,
  sfx: true,
  music: true,
  pieceAnimation: 'smooth',      // off | fast | smooth | slow
  coordinates: true,
  moveGrades: true,              // live colour-coded verdicts on your moves
  guideArrows: true,             // opening-knowledge arrows
  openingNotes: true,            // the opening card on suggested squares (match screen: Notes)
  reducedMotion: false,
  textSpeed: 'normal',           // slow | normal | fast
  touchControls: 'auto',         // auto | on | off: joystick, phone layout, tap wording
  actionsPanel: true,            // the scene's actions panel (H or its Hide button)
  sceneZoom: 'zoom',             // zoom | fit: landscape scenes zoomed in with a following camera, or the whole room
  padLayout: 'auto'              // auto | xbox | playstation | nintendo: which pad button accepts (js/ui/controls.js)
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

function browserStorage() {
  try {
    const probe = `${SAVE_PREFIX}probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

const initial = typeof window !== 'undefined' ? browserStorage() : null;
let storage = initial || memoryStorage();

/* Is progress really being kept? The memory fallback keeps the game playable
   when the browser refuses storage (private mode, blocked site data, a full
   quota), but then nothing survives a reload, and the player must be told. */
const status = { persistent: !!initial, lastWriteOk: true, error: null };
const statusListeners = new Set();
const setStatus = (patch) => {
  const before = storageOk();
  Object.assign(status, patch);
  if (storageOk() !== before) for (const fn of [...statusListeners]) { try { fn(storageStatus()); } catch { /* a listener never breaks saving */ } }
};
const storageOk = () => status.persistent && status.lastWriteOk;
/** { ok, persistent, lastWriteOk, error } */
export const storageStatus = () => ({ ok: storageOk(), ...status });
export function onStorageStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }

/** Tests (and a private-mode browser) swap the backend here. */
export function useStorage(backend, { persistent = !!backend } = {}) {
  storage = backend || memoryStorage();
  setStatus({ persistent, lastWriteOk: true, error: null });
}
export const createMemoryStorage = memoryStorage;

function read(key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function readRaw(key) {
  try { return storage.getItem(key); } catch { return null; }
}

function parsed(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function write(key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    setStatus({ lastWriteOk: true, error: null });
    return true;
  } catch (error) {
    setStatus({ lastWriteOk: false, error: String(error?.name || error) });
    return false;
  }
}

export const hasCareer = () => !!read(KEYS.career);
export const loadCareer = () => read(KEYS.career);

/**
 * Save the career. The slot's previous content, if it was a readable career,
 * becomes the backup first: a save that turns out to be broken (a bug, a
 * cut-off write) then still has the one before it. The backup is best
 * effort: if storage is too full for it, it is dropped, never the save.
 */
export function saveCareer(career) {
  career.savedAt = Date.now();
  const before = readRaw(KEYS.career);
  const ok = write(KEYS.career, career);
  if (ok && before && parsed(before)) {
    try { storage.setItem(KEYS.careerBackup, before); } catch { try { storage.removeItem(KEYS.careerBackup); } catch { /* nothing */ } }
  }
  return ok;
}

/** Starting a new career: the old one, its backup and its quarantine go. */
export function deleteCareer() {
  for (const key of [KEYS.career, KEYS.careerBackup]) { try { storage.removeItem(key); } catch { /* nothing to delete */ } }
}

/* Keep an unreadable slot aside, once: the first copy is the one worth having. */
function quarantine(raw) {
  if (!raw || readRaw(KEYS.careerUnreadable)) return;
  try { storage.setItem(KEYS.careerUnreadable, raw); } catch { /* storage full: nothing more to do */ }
}

/**
 * Load the career the game can actually resume.
 *
 * `prepare(career)` brings it up to date (career.js migrateCareer) and may
 * throw on a career it cannot handle. In order:
 *   1. the slot, prepared;
 *   2. if the slot is not JSON or prepare throws: the slot is kept aside
 *      (PAP_career_v1_unreadable) so a New Game cannot overwrite it, and the
 *      backup is tried, prepared;
 *   3. otherwise no career (the title offers New Game).
 * Before this, a slot that was not JSON read as "no career" and the next
 * New Game replaced it, and a career migrateCareer threw on stopped the game
 * from starting at all.
 *
 * @returns {{career:Object|null, source:'main'|'backup'|null, problem:string|null}}
 */
export function loadCareerSafe(prepare = (c) => c) {
  const attempt = (raw) => {
    const value = parsed(raw);
    if (!value) return { career: null, error: raw ? 'not readable' : null };
    try { return { career: prepare(value) || null, error: null }; } catch (error) { return { career: null, error: String(error?.message || error) }; }
  };
  const mainRaw = readRaw(KEYS.career);
  const main = attempt(mainRaw);
  if (main.career) return { career: main.career, source: 'main', problem: null };
  if (!mainRaw) return { career: null, source: null, problem: null };
  quarantine(mainRaw);
  const backup = attempt(readRaw(KEYS.careerBackup));
  if (backup.career) {
    write(KEYS.career, backup.career);
    return { career: backup.career, source: 'backup', problem: main.error };
  }
  return { career: null, source: null, problem: main.error };
}

/** Was a career slot ever set aside as unreadable? (Settings can offer it as a file.) */
export const unreadableCareer = () => readRaw(KEYS.careerUnreadable);

/* ------------------------------------------------------------ history -- */

/** Finished games, migrated (js/core/history.js). Never throws. */
export function loadHistory() {
  try { return migrateHistory(read(KEYS.history)); } catch { return emptyHistory(); }
}
export const saveHistory = (history) => write(KEYS.history, history);

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...(read(KEYS.settings) || {}) });
export const saveSettings = (settings) => write(KEYS.settings, settings);

export default { KEYS, SAVE_PREFIX, hasCareer, loadCareer, loadCareerSafe, saveCareer, deleteCareer, unreadableCareer, loadHistory, saveHistory, loadSettings, saveSettings, useStorage, storageStatus, onStorageStatus };
