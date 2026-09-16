/**
 * dom.js - the tiny DOM vocabulary every screen uses.
 *
 *   h('div.card#id', { onclick, text, style, dataset, attrs }, ...children)
 */

export function h(spec, props = null, ...children) {
  const [, tag = 'div', rest = ''] = spec.match(/^([a-z0-9-]*)(.*)$/i) || [];
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'text') el.textContent = value;
      else if (key === 'html') el.innerHTML = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'class') el.className += ` ${value}`;
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key in el && typeof value !== 'string') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Next frame, twice: a style change after display:none needs both. */
export const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export function button(label, onClick, { cls = '', disabled = false, title = null, icon = null } = {}) {
  return h(`button.pp-btn${cls ? `.${cls.split(' ').join('.')}` : ''}`, {
    type: 'button', disabled, title, onclick: (e) => { if (!disabled) onClick?.(e); }
  }, icon ? h('span.pp-btn__icon', { text: icon, 'aria-hidden': 'true' }) : null, h('span', { text: label }));
}

export function meter(value, max, { cls = '', label = null } = {}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return h(`div.pp-meter${cls ? `.${cls}` : ''}`, { role: 'meter', 'aria-valuenow': String(value), 'aria-valuemax': String(max), 'aria-label': label || '' },
    h('div.pp-meter__fill', { style: { width: `${pct}%` } }));
}

export default { h, clear, $, $$, wait, frames, button, meter };
