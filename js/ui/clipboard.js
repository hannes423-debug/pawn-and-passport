/**
 * clipboard.js - copy text, and always end with the player holding it.
 *
 *   1. the async clipboard (needs a secure page and, on some phones, a fresh tap);
 *   2. the old copy command on a hidden text box (older WebViews);
 *   3. a pop-up with the text selected, to copy by hand.
 * So "Copy PGN" never silently does nothing.
 */

import { h, button } from './dom.js';

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  Object.assign(area.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

/**
 * @param {Object} app
 * @param {string} text
 * @param {{done?: string, title?: string}} [o]
 * @returns {Promise<'copied'|'shown'>}
 */
export async function copyText(app, text, { done = 'Copied.', title = 'Copy this' } = {}) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); app.toast(done); return 'copied'; }
  } catch { /* refused: try the old way */ }
  if (legacyCopy(text)) { app.toast(done); return 'copied'; }
  await app.overlay((close) => {
    const area = h('textarea.pp-copybox', { readonly: '', rows: '10', spellcheck: 'false' });
    area.value = text;
    requestAnimationFrame(() => { area.focus(); area.select(); });
    return h('div.pp-panel.pp-modal', null,
      h('h2.pp-h2', { text: title }),
      h('p.pp-small', { text: 'This browser did not allow copying. Select the text and copy it.' }),
      area,
      h('div.pp-row', { style: { justifyContent: 'flex-end' } }, button('Close', () => close(), { cls: 'pp-btn--small', back: true })));
  });
  return 'shown';
}

export default { copyText };
