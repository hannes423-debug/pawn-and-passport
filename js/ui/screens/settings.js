/**
 * settings.js - the settings notebook.
 *
 * Only what the jam build actually honours: audio, board, assistance display
 * and accessibility. Stored under PAP_settings_v1.
 */

import { h, button } from '../dom.js';
import { sfx } from '../audio.js';
import * as Save from '../../core/save.js';
import { GAME } from '../../data/config.js';

export function settingsScreen(app, params) {
  const back = params.back || { screen: 'title', params: {} };
  const s = app.settings;
  const commit = () => { app.applySettings(); sfx.click(); };

  const row = (label, control, note = null) => h('label.pp-col', { style: { gap: '2px', marginBottom: '10px' } },
    h('b', { text: label }), control, note ? h('span.pp-small.pp-muted', { text: note }) : null);
  const toggle = (key) => h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; commit(); } });
  const select = (key, options) => h('select.pp-input', { style: { fontSize: '17px', padding: '4px' }, onchange: (e) => { s[key] = e.target.value; commit(); } },
    options.map(([value, label]) => h('option', { value, selected: s[key] === value, text: label })));

  const left = h('div.pp-book__page.pp-book__page--left', null,
    h('h2.pp-h2', { text: 'Sound' }),
    row('Volume', h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume), oninput: (e) => { s.volume = Number(e.target.value); app.applySettings(); }, onchange: () => sfx.best() })),
    row('Sound effects', toggle('sfx')),
    row('Music', toggle('music'), 'A little chiptune loop on the title and map.'),
    h('h2.pp-h2', { text: 'Board' }),
    row('Piece animation', select('pieceAnimation', [['off', 'Off'], ['fast', 'Fast'], ['smooth', 'Smooth'], ['slow', 'Slow']])),
    row('Coordinates', toggle('coordinates')),
    h('h2.pp-h2', { text: 'Controls' }),
    row('Touch controls', select('touchControls', [['auto', 'Auto (on for touch screens)'], ['on', 'Always on'], ['off', 'Off']]), 'Walking joystick, action button and the phone layout.'));

  const right = h('div.pp-book__page.pp-book__page--right', null,
    h('h2.pp-h2', { text: 'Assistance' }),
    row('Live move grades', toggle('moveGrades'), 'Colour verdicts and Brilliant / Epic / Clutch effects on your moves.'),
    row('Opening guide arrows', toggle('guideArrows'), 'Blue arrows from your equipped openings. They never cost Focus.'),
    h('h2.pp-h2', { text: 'Accessibility' }),
    row('Reduce motion', toggle('reducedMotion'), 'No particles, flashes or shakes.'),
    row('Dialogue speed', select('textSpeed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']])),
    h('div.pp-row', null,
      button('Done', () => app.go(back.screen, back.params), { cls: 'pp-btn--gold' }),
      button('Reset settings', async () => {
        const ok = await app.overlay((close) => h('div.pp-panel.pp-modal', null,
          h('h2.pp-h2', { text: 'Reset every setting?' }),
          h('p', { text: 'Sound, board, assistance and accessibility go back to their defaults. Your career is not touched.' }),
          h('div.pp-row', null, button('Reset', () => close(true), { cls: 'pp-btn--red' }), button('Keep my settings', () => close(false), { cls: 'pp-btn--gold' }))));
        if (!ok) return;
        app.settings = { ...Save.DEFAULT_SETTINGS }; app.applySettings(); app.go('settings', params);
      }, { cls: 'pp-btn--small' })),
    h('p.pp-small.pp-muted', { text: `${GAME.title}: ${GAME.subtitle} v${GAME.version}. Saves use the ${Save.SAVE_PREFIX} prefix.` }));

  // The notebook art has painted sliders; a parchment sheet covers them.
  for (const page of [left, right]) {
    page.style.background = 'rgba(243, 227, 191, 0.96)';
    page.style.borderRadius = '6px';
    page.style.top = '12%';
  }
  const book = h('div.pp-book.pp-book--settings', { style: { marginTop: '16px' } }, left, right);
  const el = h('div.pp-screen.pp-journal', null, h('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' } }, book));
  return { el };
}

export default settingsScreen;
