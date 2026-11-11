/**
 * share.js - "Share" on the title screen and in the settings notebook.
 *
 *   shareGame(app)   the system share sheet, else copy the link, else show it
 *
 * Always the public link (GAME.url), never location.href: inside itch.io's
 * iframe that is a CDN address nobody can open, and on the live site it may
 * carry a debug deep link (?scene=...).
 *
 * Each step can be refused - no navigator.share on most desktops, an iframe
 * without the web-share or clipboard-write permission, an insecure origin - so
 * each failure falls through to the next, and the last one cannot fail: a
 * pop-up with the link ready to select and copy by hand.
 */

import { h, button } from './dom.js';
import { GAME } from '../data/config.js';

export const shareText = () => `${GAME.title}: ${GAME.subtitle}. Travel to six chess clubs, win their trophies, and play the Grand Finale in Madrid.`;

export async function shareGame(app) {
  const url = GAME.url;
  const data = { title: GAME.title, text: shareText(), url };
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';      // the player closed the sheet
      /* NotAllowedError (an iframe without web-share) and the rest: copy instead. */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    app.toast(`Link copied: ${url}`);
    return 'copied';
  } catch { /* no clipboard here: show it */ }
  await app.overlay((close) => {
    const field = h('input.pp-input.pp-share__url', { type: 'text', readOnly: true, value: url, 'aria-label': 'Link to the game', onfocus: (e) => e.target.select() });
    return h('div.pp-panel.pp-modal.pp-share', null,
      h('h2.pp-h2', { text: `Share ${GAME.title}` }),
      h('p', { text: 'Copy this link and send it to a friend:' }),
      field,
      h('div.pp-row', { style: { marginTop: '10px' } }, button('Close', () => close(null), { cls: 'pp-btn--gold', back: true, autofocus: true })));
  });
  return 'shown';
}

export default { shareGame, shareText };
