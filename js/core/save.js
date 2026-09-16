/**
 * save.js - Pawn & Passport's own save namespace.
 *
 * Every key starts with PAP_, so nothing here can collide with Chess: World
 * Tour (which uses cwt.* keys) even on the same origin. The storage backend is
 * injectable so the Node tests run the real code against a Map.
 *
 *   PAP_career_v1    the single career slot
 *   PAP_settings_v1  audio / board / accessibility preferences
 */

export const SAVE_PREFIX = 'PAP_';
export const KEYS = Object.freeze({
  career: `${SAVE_PREFIX}career_v1`,
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
  reducedMotion: false,
  textSpeed: 'normal',           // slow | normal | fast
  touchControls: 'auto'          // auto | on | off: joystick, phone layout, tap wording
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

let storage = (typeof window !== 'undefined' && browserStorage()) || memoryStorage();

/** Tests (and a private-mode browser) swap the backend here. */
export function useStorage(backend) { storage = backend || memoryStorage(); }
export const createMemoryStorage = memoryStorage;

function read(key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function write(key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const hasCareer = () => !!read(KEYS.career);
export const loadCareer = () => read(KEYS.career);
export function saveCareer(career) {
  career.savedAt = Date.now();
  return write(KEYS.career, career);
}
export function deleteCareer() { try { storage.removeItem(KEYS.career); } catch { /* nothing to delete */ } }

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...(read(KEYS.settings) || {}) });
export const saveSettings = (settings) => write(KEYS.settings, settings);

export default { KEYS, SAVE_PREFIX, hasCareer, loadCareer, saveCareer, deleteCareer, loadSettings, saveSettings, useStorage };
