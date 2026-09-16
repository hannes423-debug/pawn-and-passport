/**
 * app.js - the shell every screen runs inside.
 *
 * One `app` object: the loaded career and settings, a screen switcher, the
 * shared HUD, toasts, modal overlays and the dialogue player. Screens are
 * plain functions `(app, params) => { el, destroy? }` registered in main.js.
 */

import { h, clear, wait } from './dom.js';
import { sfx, unlockAudio, configureAudio } from './audio.js';
import { configureTouch, installTouchDetection, tapWord, canFullscreen, toggleFullscreen } from './touch.js';
import { portraitUrl, PLAYER_LOOKS } from './sprites.js';
import * as Save from '../core/save.js';
import { xpProgress, maxFocus, trophyCount, postcardCount, migrateCareer } from '../core/career.js';
import { clubById, FINALE } from '../data/clubs.js';
import { sceneById } from '../data/scenes.js';

const TEXT_MS = { slow: 38, normal: 22, fast: 8 };

export function createApp(root, screens) {
  const toasts = h('div.pp-toasts');
  let hudObserver = new ResizeObserver(() => {});
  document.body.append(toasts);

  const app = {
    root,
    screens,
    career: migrateCareer(Save.loadCareer()),
    settings: Save.loadSettings(),
    current: null,
    currentName: null,

    async go(name, params = {}) {
      const factory = screens[name];
      if (!factory) throw new Error(`no screen ${name}`);
      try { app.current?.destroy?.(); } catch (error) { console.error(error); }
      clear(root);
      document.querySelectorAll('.pp-overlay, .pp-dialogue').forEach((el) => el.remove());
      app.currentName = name;
      const screen = await factory(app, params);
      app.current = screen;
      root.append(screen.el);
      document.documentElement.dataset.screen = name;
      // Screens with the HUD lay out below it; its height changes with the
      // device (two rows on a phone held upright, the iPhone status bar inset).
      hudObserver.disconnect();
      const hud = screen.el.querySelector(':scope > .pp-hud');
      if (hud) {
        const publish = () => screen.el.style.setProperty('--hud-h', `${hud.offsetHeight}px`);
        publish();
        hudObserver = new ResizeObserver(publish);
        hudObserver.observe(hud);
      }
      return screen;
    },

    save() {
      if (app.career) Save.saveCareer(app.career);
    },

    setCareer(career) {
      app.career = career;
      app.save();
    },

    applySettings() {
      Save.saveSettings(app.settings);
      configureAudio(app.settings);
      document.documentElement.dataset.reducedMotion = String(!!app.settings.reducedMotion);
      configureTouch(app.settings);
    },

    toast(text, { ms = 2600 } = {}) {
      const el = h('div.pp-toast', { text });
      toasts.append(el);
      setTimeout(() => el.remove(), ms);
    },

    /** A modal. Resolves with whatever `close(value)` is called with. */
    overlay(build, { dismissable = true } = {}) {
      return new Promise((resolve) => {
        const layer = h('div.pp-overlay');
        const close = (value) => { layer.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
        const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
        layer.addEventListener('click', (e) => { if (e.target === layer && dismissable) close(null); });
        layer.append(build(close));
        document.body.append(layer);
        document.addEventListener('keydown', onKey);
        layer.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
      });
    },

    /**
     * Play a short linear dialogue. `actions` (optional) become buttons on the
     * LAST line; the promise resolves with the chosen action id, or null.
     */
    dialogue({ name, role = null, look = null, portrait = null, lines = [], actions = null }) {
      return new Promise((resolve) => {
        let index = 0;
        let typing = null;
        const text = h('div.pp-dialogue__text');
        const next = h('div.pp-dialogue__next', { text: `${tapWord()} to continue ▼` });
        const actionRow = h('div.pp-dialogue__actions');
        const img = h('img', { alt: '', src: portrait || (look ? portraitUrl(look) : portraitUrl(PLAYER_LOOKS.boy)) });
        const box = h('div.pp-dialogue', { role: 'dialog', 'aria-live': 'polite' },
          h('div.pp-panel', null, img,
            h('div', null,
              h('div.pp-dialogue__name', null, name, role ? h('span.pp-dialogue__role', { text: role }) : null),
              text, next, actionRow)));
        const finish = (value) => {
          clearInterval(typing);
          box.remove();
          document.removeEventListener('keydown', onKey);
          resolve(value);
        };
        const show = () => {
          clearInterval(typing);
          const line = lines[index] || '';
          const last = index >= lines.length - 1;
          let shown = 0;
          text.textContent = '';
          clear(actionRow);
          next.hidden = true;
          const speed = TEXT_MS[app.settings.textSpeed] ?? TEXT_MS.normal;
          typing = setInterval(() => {
            shown += 1;
            text.textContent = line.slice(0, shown);
            if (shown % 3 === 0) sfx.text();
            if (shown >= line.length) { clearInterval(typing); typing = null; revealEnd(last); }
          }, speed);
        };
        const revealEnd = (last) => {
          if (last && actions?.length) {
            next.hidden = true;
            for (const action of actions) {
              actionRow.append(h(`button.pp-btn${action.cls ? `.${action.cls}` : ''}`, {
                type: 'button', text: action.label,
                onclick: (e) => { e.stopPropagation(); sfx.click(); finish(action.id); }
              }));
            }
            actionRow.querySelector('button')?.focus();
          } else {
            next.hidden = false;
          }
        };
        const advance = () => {
          const line = lines[index] || '';
          if (typing) { clearInterval(typing); typing = null; text.textContent = line; revealEnd(index >= lines.length - 1); return; }
          if (index >= lines.length - 1) { if (!actions?.length) finish(null); return; }
          index += 1;
          show();
        };
        const onKey = (e) => {
          if (e.key === 'Enter' || e.key === ' ') { if (!actionRow.children.length) { e.preventDefault(); advance(); } }
          if (e.key === 'Escape') finish(null);
        };
        box.addEventListener('click', advance);
        document.addEventListener('keydown', onKey);
        document.body.append(box);
        show();
      });
    },

    /** The status bar shown on the map and in every scene. */
    hud({ where = null } = {}) {
      const c = app.career;
      const xp = xpProgress(c);
      const bar = h('header.pp-hud', null,
        h('div.pp-hud__who', null,
          h('img', { alt: '', src: portraitUrl(PLAYER_LOOKS[c.avatar]) }),
          h('div', null, h('div.pp-hud__name', { text: c.name }), h('div.pp-small', { text: `Level ${c.level}` }))),
        h('div.pp-hud__lvl', { title: xp.max ? 'Max level' : `${xp.into} / ${xp.needed} XP` },
          h('div.pp-small', null, h('span', { text: 'XP' }), h('span', { text: xp.max ? 'MAX' : `${xp.into}/${xp.needed}` })),
          h('div.pp-meter.pp-meter--xp', null, h('div.pp-meter__fill', { style: { width: `${Math.round(xp.fraction * 100)}%` } }))),
        h('div.pp-hud__stat', { title: 'Elo rating' }, '♟', h('b', { text: c.elo })),
        h('div.pp-hud__stat', { title: 'Maximum Focus' }, '✦', h('b', { text: maxFocus(c.level) })),
        h('div.pp-hud__stat', { title: 'Club Trophies' }, '🏆', h('b', { text: `${trophyCount(c)}/6` })),
        h('div.pp-hud__stat', { title: 'Postcards' }, '✉', h('b', { text: `${postcardCount(c)}/6` })),
        where ? h('div.pp-hud__where', { text: where }) : null,
        h('div.pp-spacer'),
        h('button.pp-btn.pp-btn--small.pp-btn--ghost', { type: 'button', 'aria-label': 'Map', onclick: () => { sfx.click(); app.go('map'); } }, '🗺', h('span.pp-hud__label', { text: ' Map' })),
        h('button.pp-btn.pp-btn--small.pp-btn--ghost', { type: 'button', 'aria-label': 'Journal', onclick: () => { sfx.click(); app.go('journal', { back: app.backParams() }); } }, '📔', h('span.pp-hud__label', { text: ' Journal' })),
        canFullscreen() ? h('button.pp-btn.pp-btn--small.pp-btn--ghost.pp-hud__fullscreen', { type: 'button', 'aria-label': 'Fullscreen', title: 'Fullscreen', onclick: () => { sfx.click(); toggleFullscreen(); } }, '⛶') : null,
        h('button.pp-btn.pp-btn--small.pp-btn--ghost', { type: 'button', 'aria-label': 'Settings', onclick: () => { sfx.click(); app.go('settings', { back: app.backParams() }); } }, '⚙'));
      return bar;
    },

    /** Where "Back" from the journal/settings should return to. */
    backParams() {
      if (app.currentName === 'scene') return { screen: 'scene', params: { sceneId: app.career.location.sceneId } };
      if (app.currentName === 'map') return { screen: 'map', params: {} };
      return { screen: app.career ? 'map' : 'title', params: {} };
    },

    locationName() {
      const { clubId, sceneId } = app.career.location;
      const scene = sceneById(sceneId);
      const club = clubById(clubId);
      if (clubId === FINALE.id) return `${FINALE.city} · ${FINALE.venueName}`;
      if (!club) return '';
      const part = scene?.kind === 'venue' ? club.casualLocationName : club.clubName;
      return `${club.city} · ${part}`;
    },

    async celebrate(kind, text, { ms = 1800 } = {}) {
      sfx[kind]?.();
      app.toast(text, { ms });
      await wait(200);
    }
  };

  // First gesture unlocks WebAudio.
  const unlock = () => { unlockAudio(); configureAudio(app.settings); };
  window.addEventListener('pointerdown', unlock, { once: false, passive: true });
  window.addEventListener('keydown', unlock, { once: false });
  installTouchDetection();
  app.applySettings();
  return app;
}

export default createApp;
