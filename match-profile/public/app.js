/**
 * app.js - the frontend: a hash router over a few screens, no build step.
 *
 *   #/            home (signed out: sign in / create account)
 *   #/register    account + the consent step
 *   #/login  #/forgot  #/reset/<token>
 *   #/settings    consents (with history) and password
 *
 * Every request is JSON; state-changing ones carry the session's CSRF token.
 */

import { newGameCard, gameScreen } from './game.js';

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const state = { session: null, consentTypes: null };

/* ------------------------------------------------------------ helpers -- */

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(method, url, body) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && state.session?.csrfToken) headers['x-csrf-token'] = state.session.csrfToken;
  const res = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || 'Something went wrong. Try again.'), { code: data.error, status: res.status, data });
  return data;
}

async function refreshSession() {
  state.session = await api('GET', '/api/session').catch(() => ({ signedIn: false }));
  paintNav();
}

async function consentTypes() {
  state.consentTypes ??= await api('GET', '/api/consent/types');
  return state.consentTypes;
}

function paintNav() {
  nav.replaceChildren(...(state.session?.signedIn
    ? [h('a', { href: '#/settings', class: 'button' }, 'Settings'),
       h('button', { type: 'button', onclick: signOut }, 'Sign out')]
    : [h('a', { href: '#/login', class: 'button' }, 'Sign in')]));
}

/** A form whose submit runs `action`; errors show in the form, the button waits. */
function form(fields, submitLabel, action) {
  const error = h('p', { class: 'error', role: 'alert' });
  const button = h('button', { type: 'submit', class: 'primary' }, submitLabel);
  const el = h('form', { novalidate: true }, ...fields, error, button);
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    button.disabled = true;
    try { await action(new FormData(el), el); } catch (err) { error.textContent = err.message; } finally { button.disabled = false; }
  });
  return el;
}

const field = (label, input, hint) => h('label', { class: 'field' }, label, hint ? h('span', { class: 'hint' }, hint) : null, input);
const input = (name, type, extra = {}) => h('input', { name, type, ...extra });
const go = (hash) => { location.hash = hash; };

async function signOut() {
  await api('POST', '/api/auth/logout', {}).catch(() => {});
  await refreshSession();
  go('#/');
}

/* ------------------------------------------------------------ screens -- */

async function home() {
  if (!state.session.signedIn) {
    return [h('h1', {}, 'Your chess, measured'),
      h('div', { class: 'card' },
        h('p', {}, 'Play against Stockfish here or import your Lichess games, and get a profile of how you play: your openings, your accuracy by phase, how you handle time pressure. Every number comes from counted moves in your own games.'),
        h('div', { class: 'row' }, h('a', { href: '#/register', class: 'button primary' }, 'Create account'), h('a', { href: '#/login', class: 'button' }, 'Sign in')))];
  }
  const s = state.session;
  if (!s.player) return [h('h1', {}, 'Master account'), h('p', { class: 'muted' }, 'The admin dashboard arrives in a later release.')];
  const play = await newGameCard({ h, api, go }).catch((err) => h('div', { class: 'card' }, h('h2', {}, 'Play Stockfish'), h('p', { class: 'error' }, err.message)));
  return [h('h1', {}, `Hello, ${s.player.username}`),
    play,
    h('div', { class: 'card' }, h('h2', {}, 'Your data'), h('p', {}, 'Choose what your games may be used for in ', h('a', { href: '#/settings' }, 'Settings'), '.'))];
}

async function register() {
  if (state.session.signedIn) { go('#/'); return []; }
  const { types } = await consentTypes();
  const required = types.filter((c) => c.required);
  const optional = types.filter((c) => !c.required);
  return [h('h1', {}, 'Create account'),
    h('div', { class: 'card' }, form([
      field('Email', input('email', 'email', { autocomplete: 'email', required: true })),
      field('Password', input('password', 'password', { autocomplete: 'new-password', minlength: 10, required: true }), 'At least 10 characters.'),
      field('Username', input('username', 'text', { autocomplete: 'username', pattern: '[A-Za-z0-9_-]{3,20}', required: true }), 'Shown to others. 3-20 letters, digits, _ or -.'),
      field('Display name (optional)', input('displayName', 'text', { maxlength: 40, autocomplete: 'name' }), 'Shown only if you allow it below.'),
      field('Country (optional)', input('country', 'text', { maxlength: 2, autocapitalize: 'characters', placeholder: 'FI' }), 'Two-letter code. Shown only if you allow it.'),
      h('h2', {}, 'Conditions of the service'),
      h('p', { class: 'small muted' }, 'Creating an account means you agree to these two. Without them there is nothing the app can do.'),
      h('ul', { class: 'conditions' }, required.map((c) => h('li', {}, h('b', {}, `${c.label}. `), c.text))),
      h('h2', {}, 'Your choices'),
      h('p', { class: 'small muted' }, 'All off unless you tick them. You can change them any time in Settings.'),
      h('div', {}, optional.map((c) => h('label', { class: 'consent' },
        input(`consent:${c.type}`, 'checkbox'), h('span', {}, h('b', {}, c.label), h('span', { class: 'small' }, c.text)))))
    ], 'Create account', async (data) => {
      const consents = Object.fromEntries(types.map((c) => [c.type, c.required || data.get(`consent:${c.type}`) === 'on']));
      const country = String(data.get('country') || '').trim().toUpperCase();
      await api('POST', '/api/auth/register', {
        email: data.get('email'), password: data.get('password'), username: data.get('username'),
        ...(data.get('displayName') ? { displayName: data.get('displayName') } : {}),
        ...(country ? { country } : {}),
        consents
      });
      await refreshSession();
      go('#/');
    }))];
}

function login() {
  if (state.session.signedIn) { go('#/'); return []; }
  return [h('h1', {}, 'Sign in'),
    h('div', { class: 'card' }, form([
      field('Email', input('email', 'email', { autocomplete: 'email', required: true })),
      field('Password', input('password', 'password', { autocomplete: 'current-password', required: true }))
    ], 'Sign in', async (data) => {
      await api('POST', '/api/auth/login', { email: data.get('email'), password: data.get('password') });
      await refreshSession();
      go('#/');
    }), h('p', { class: 'small' }, h('a', { href: '#/forgot' }, 'Forgot your password?')))];
}

function forgot() {
  const done = h('p', { class: 'notice', role: 'status' });
  return [h('h1', {}, 'Reset your password'),
    h('div', { class: 'card' }, form([
      field('Email', input('email', 'email', { autocomplete: 'email', required: true }))
    ], 'Send reset link', async (data, el) => {
      await api('POST', '/api/auth/reset/request', { email: data.get('email') });
      el.reset();
      done.textContent = 'If that email has an account, a reset link is on its way. It works for one hour.';
    }), done)];
}

function reset(token) {
  return [h('h1', {}, 'Choose a new password'),
    h('div', { class: 'card' }, form([
      field('New password', input('password', 'password', { autocomplete: 'new-password', minlength: 10, required: true }), 'At least 10 characters.'),
      field('Again', input('again', 'password', { autocomplete: 'new-password', required: true }))
    ], 'Set password', async (data) => {
      if (data.get('password') !== data.get('again')) throw new Error('The two passwords are not the same.');
      await api('POST', '/api/auth/reset/complete', { token, newPassword: data.get('password') });
      await refreshSession();
      view.replaceChildren(h('h1', {}, 'Password changed'), h('div', { class: 'card' },
        h('p', {}, 'Every device that was signed in has been signed out.'), h('a', { href: '#/login', class: 'button primary' }, 'Sign in')));
    }))];
}

async function settings() {
  if (!state.session.signedIn) { go('#/login'); return []; }
  const out = [h('h1', {}, 'Settings')];
  if (state.session.player) {
    const [{ types }, mine] = await Promise.all([consentTypes(), api('GET', '/api/consent')]);
    const label = Object.fromEntries(types.map((c) => [c.type, c.label]));
    const error = h('p', { class: 'error', role: 'alert' });
    out.push(h('div', { class: 'card' },
      h('h2', {}, 'What your games may be used for'),
      h('ul', { class: 'conditions' }, types.filter((c) => c.required).map((c) => h('li', {}, h('b', {}, `${c.label}: `), 'a condition of the service. Withdrawing it means deleting your account.'))),
      h('div', {}, types.filter((c) => !c.required).map((c) => {
        const box = input(c.type, 'checkbox', { checked: mine.current[c.type].granted });
        box.addEventListener('change', async () => {
          error.textContent = '';
          box.disabled = true;
          try { await api('POST', '/api/consent', { type: c.type, granted: box.checked }); await route(); }
          catch (err) { box.checked = !box.checked; error.textContent = err.message; box.disabled = false; }
        });
        return h('label', { class: 'consent' }, box, h('span', {}, h('b', {}, c.label), h('span', { class: 'small' }, c.text)));
      })),
      error,
      h('h2', {}, 'History'),
      h('div', { class: 'history-wrap' }, h('table', { class: 'history' },
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'What'), h('th', {}, 'Answer'), h('th', {}, 'Policy'))),
        h('tbody', {}, [...mine.history].reverse().map((e) => h('tr', {},
          h('td', {}, new Date(e.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })), h('td', {}, label[e.consent_type] || e.consent_type),
          h('td', {}, e.granted ? 'yes' : 'no'), h('td', {}, e.policy_version))))))));
  }
  const done = h('p', { class: 'notice', role: 'status' });
  out.push(h('div', { class: 'card' }, h('h2', {}, 'Change password'), form([
    field('Current password', input('current', 'password', { autocomplete: 'current-password', required: true })),
    field('New password', input('next', 'password', { autocomplete: 'new-password', minlength: 10, required: true }), 'At least 10 characters. Other devices will be signed out.')
  ], 'Change password', async (data, el) => {
    const r = await api('POST', '/api/account/password', { currentPassword: data.get('current'), newPassword: data.get('next') });
    state.session.csrfToken = r.csrfToken;
    el.reset();
    done.textContent = 'Password changed. Other devices have been signed out.';
  }), done));
  return out;
}

/* ------------------------------------------------------------- router -- */

let leaving = null;      // the open screen's clean-up (the game's clock and board)

async function route() {
  if (!state.session) await refreshSession();
  leaving?.();
  leaving = null;
  const hash = location.hash || '#/';
  const resetMatch = /^#\/reset\/([A-Za-z0-9_-]{20,100})$/.exec(hash);
  const gameMatch = /^#\/game\/([0-9a-f-]{36})$/.exec(hash);
  document.body.classList.toggle('is-game', !!gameMatch);
  let screen;
  try {
    if (resetMatch) screen = reset(resetMatch[1]);
    else if (gameMatch) {
      if (!state.session.signedIn) { go('#/login'); return; }
      const g = await gameScreen({ h, api, go }, gameMatch[1]);
      leaving = g.destroy;
      screen = g.nodes;
    } else screen = await ({ '#/': home, '#/register': register, '#/login': login, '#/forgot': forgot, '#/settings': settings }[hash] || home)();
  } catch (err) {
    screen = [h('h1', {}, 'Something went wrong'), h('p', { class: 'error' }, err.message), h('a', { href: '#/', class: 'button' }, 'Home')];
  }
  view.replaceChildren(...screen);
  if (!gameMatch) view.querySelector('input:not([type=radio])')?.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);
route();
