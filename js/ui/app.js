/**
 * app.js - the shell every screen runs inside.
 *
 * One `app` object: the loaded career and settings, a screen switcher, the
 * shared HUD, toasts, modal overlays and the dialogue player. Screens are
 * plain functions `(app, params) => { el, destroy? }` registered in main.js.
 */

import { h, clear, wait } from './dom.js';
import { sfx, unlockAudio, configureAudio } from './audio.js';
import * as music from './music.js';
import { configureTouch, installTouchDetection, tapWord, canFullscreen, toggleFullscreen } from './touch.js';
import { portraitUrl, PLAYER_LOOKS, setPlayerAvatar } from './sprites.js';
import { pixelIcon } from './icons.js';
import * as Save from '../core/save.js';
import { xpProgress, maxFocus, trophyCount, postcardCount, migrateCareer, nextStep } from '../core/career.js';
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
      setPlayerAvatar(app.career?.avatar);
      if (!factory) throw new Error(`no screen ${name}`);
      try { app.current?.destroy?.(); } catch (error) { console.error(error); }
      clear(root);
      document.querySelectorAll('.pp-overlay, .pp-dialogue').forEach((el) => el.remove());
      app.dropCoach?.();
      app.currentName = name;
      const token = (app._goToken = (app._goToken || 0) + 1);
      const screen = await factory(app, params);
      // A newer navigation started while this screen was loading: drop this one,
      // or both screens end up stacked in the page.
      if (token !== app._goToken) {
        try { screen.destroy?.(); } catch (error) { console.error(error); }
        return app.current;
      }
      clear(root);
      app.current = screen;
      root.append(screen.el);
      document.documentElement.dataset.screen = name;
      /* One soundtrack for the whole game outside a match. Asking for the
         track already playing does nothing, so walking from the map into a
         club, a shop or the journal never restarts it. The match screen picks
         its own track (js/core/musicMood.js) the moment it opens. */
      if (name !== 'match') music.play('town');
      // Screens with the HUD lay out below it; its height changes with the
      // device (two rows on a phone held upright, the iPhone status bar inset).
      hudObserver.disconnect();
      const hud = screen.el.querySelector(':scope > .pp-hud');
      if (!hud) document.documentElement.style.setProperty('--coach-top', '0px');
      if (hud) {
        const publish = () => {
          screen.el.style.setProperty('--hud-h', `${hud.offsetHeight}px`);
          document.documentElement.style.setProperty('--coach-top', `${hud.getBoundingClientRect().bottom}px`);
        };
        publish();
        hudObserver = new ResizeObserver(publish);
        hudObserver.observe(hud);
      }
      return screen;
    },

    save() {
      if (!app.career) return true;
      const ok = Save.saveCareer(app.career);
      paintSaveWarning();
      return ok;
    },

    setCareer(career) {
      app.career = career;
      setPlayerAvatar(career?.avatar);
      app.save();
    },

    applySettings() {
      Save.saveSettings(app.settings);
      configureAudio(app.settings);
      music.configure(app.settings);
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
        const next = h('div.pp-dialogue__next', { text: `${tapWord()} to continue` });
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
                type: 'button',
                onclick: (e) => { e.stopPropagation(); sfx.click(); finish(action.id); }
              }, action.icon ? h('span.pp-btn__icon', { 'aria-hidden': 'true' }, action.icon) : null,
                h('span', { text: action.label })));
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
        h('div.pp-hud__stat', { title: 'Elo rating' }, pixelIcon('pawn', { size: 'sm' }), h('b', { text: c.elo })),
        h('div.pp-hud__stat.pp-hud__coins', { title: 'Coins: win them from club members and tournaments' }, pixelIcon('coins', { size: 'sm' }), h('b', { text: c.coins ?? 0 })),
        h('div.pp-hud__stat', { title: 'Maximum Focus' }, pixelIcon('xp', { size: 'sm' }), h('b', { text: maxFocus(c.level) })),
        h('div.pp-hud__stat', { title: 'Club Trophies' }, pixelIcon('trophy', { size: 'sm' }), h('b', { text: `${trophyCount(c)}/6` })),
        h('div.pp-hud__stat', { title: 'Postcards' }, pixelIcon('postcard', { size: 'sm' }), h('b', { text: `${postcardCount(c)}/6` })),
        where ? h('div.pp-hud__where', { text: where }) : null,
        h('div.pp-spacer'),
        h('button.pp-btn.pp-btn--small.pp-btn--ghost', { type: 'button', 'aria-label': 'Map', onclick: () => { sfx.click(); app.go('map'); } }, pixelIcon('map', { size: 'sm' }), h('span.pp-hud__label', { text: ' Map' })),
        h('button.pp-btn.pp-btn--small.pp-btn--ghost', { type: 'button', 'aria-label': 'Journal', onclick: () => { sfx.click(); app.go('journal', { back: app.backParams() }); } }, pixelIcon('journal', { size: 'sm' }), h('span.pp-hud__label', { text: ' Journal' })),
        /* The only glyph left in the HUD: the icon sheet has no fullscreen
           symbol, and U+26F6 is a geometric shape rather than an emoji, so it
           sits with the set rather than against it. Give it an icon and this
           becomes a pixelIcon call like its neighbours. */
        canFullscreen() ? h('button.pp-btn.pp-btn--small.pp-btn--ghost.pp-hud__fullscreen', { type: 'button', 'aria-label': 'Fullscreen', title: 'Fullscreen', onclick: () => { sfx.click(); toggleFullscreen(); } }, '\u26f6') : null,
        h('button.pp-btn.pp-btn--small.pp-btn--ghost', { type: 'button', 'aria-label': 'Settings', onclick: () => { sfx.click(); app.go('settings', { back: app.backParams() }); } }, pixelIcon('settings', { size: 'sm', label: 'Settings' })),
        /* The one thing to do next, always in view. */
        h('div.pp-hud__next', { role: 'status', title: 'Your next goal' }, pixelIcon('play', { size: 'sm' }), h('b', { text: ' Next: ' }), nextStep(c).label));
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

    /**
     * A one-time tip, shown when a system first matters rather than all at
     * once in an intro. Non-blocking: play goes on underneath. Remembered in
     * the career (`taught`), so it never repeats.
     */
    coach(key, text, { title = null, host = null } = {}) {
      const c = app.career;
      if (!c || c.taught?.[key] || coachQueue.some((t) => t.key === key) || coachEl?.dataset.key === key) return false;
      coachQueue.push({ key, text, title, host });
      if (!coachEl && !coachPending) showNextCoach();
      return true;
    },

    async celebrate(kind, text, { ms = 1800 } = {}) {
      sfx[kind]?.();
      app.toast(text, { ms });
      await wait(200);
    }
  };

  const coachQueue = [];
  let coachEl = null;
  let coachPending = false;      // waiting for a host to enter the document
  /**
   * A screen asks for its tip while it is still being BUILT, so the host it
   * passes is not in the document yet: app.go() appends the screen only once
   * the factory has returned. That is one frame away, so wait for it.
   *
   * It used to fall through instead, and the fallback kept the `--inline`
   * class while appending to <body> - which is `position: static`, so the tip
   * lost the fixed placement AND the safe-area offsets that go with it and
   * landed as a full-width bar in the top-left corner, under the notch on a
   * landscape phone. Every first match showed it there.
   */
  function showNextCoach(attempt = 0) {
    const tip = coachQueue[0];
    if (!tip) { coachEl = null; coachPending = false; return; }
    if (tip.host && !tip.host.isConnected && attempt < 4) {
      coachPending = true;
      requestAnimationFrame(() => showNextCoach(attempt + 1));
      return;
    }
    coachPending = false;
    coachQueue.shift();
    /* With a host (a match's side panel) the tip sits inline in it and never
       floats over the board or its buttons. Without one - or if the host
       never arrived - it floats, and the floating rules are the ones that
       know about the safe area. The class and the parent are decided from
       the SAME check, so they can never disagree again. */
    const host = tip.host?.isConnected ? tip.host : null;
    const close = () => { learned(tip.key); coachEl?.remove(); coachEl = null; setTimeout(showNextCoach, 250); };
    coachEl = h(`div.pp-coach${host ? '.pp-coach--inline' : ''}`, { role: 'note', dataset: { key: tip.key, shownAt: String(Date.now()) } },
      tip.title ? h('b.pp-coach__title', { text: tip.title }) : null,
      h('div', { text: tip.text }),
      h('button.pp-btn.pp-btn--small', { type: 'button', text: 'Got it', onclick: (e) => { e.stopPropagation(); sfx.click(); close(); } }));
    if (host) host.prepend(coachEl); else document.body.append(coachEl);
  }

  /* A tip counts as learned once dismissed, or once it was on screen long
     enough to read; one cut short by leaving the screen comes back later. */
  function learned(key) {
    if (!app.career) return;
    app.career.taught = { ...(app.career.taught || {}), [key]: true };
    app.save();
  }
  app.dropCoach = () => {
    if (coachEl && Date.now() - Number(coachEl.dataset.shownAt) > 4000) learned(coachEl.dataset.key);
    coachEl?.remove();
    coachEl = null;
    coachPending = false;
    coachQueue.length = 0;
  };

  /* One quiet, persistent banner while progress cannot be kept: shown once,
     never re-announced on every save, gone as soon as saving works again. */
  let saveWarning = null;
  function paintSaveWarning() {
    const st = Save.storageStatus();
    if (st.ok) { saveWarning?.remove(); saveWarning = null; return; }
    if (saveWarning) return;
    saveWarning = h('div.pp-savewarn', { role: 'status' },
      h('b', { text: 'Not saving. ' }),
      st.persistent ? 'Your browser refused to store the game (storage full or blocked).' : 'This browser is not allowing the game to store data (private mode or blocked site data).',
      ' You can keep playing, but progress will be lost when the page is closed or reloaded.');
    document.body.append(saveWarning);
  }
  Save.onStorageStatus(() => paintSaveWarning());
  app.paintSaveWarning = paintSaveWarning;
  paintSaveWarning();

  // First gesture unlocks WebAudio.
  const unlock = () => { unlockAudio(); configureAudio(app.settings); music.configure(app.settings); music.unlock(); };
  window.addEventListener('pointerdown', unlock, { once: false, passive: true });
  window.addEventListener('keydown', unlock, { once: false });
  installTouchDetection();
  app.applySettings();
  return app;
}

export default createApp;
