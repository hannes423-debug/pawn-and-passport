/**
 * difficultyPicker.js - the Easy / Normal / Hard control, shared by the new
 * game screen and Settings so both spell the choice the same way.
 *
 *   difficultyPicker(current, onPick) -> element
 *
 * It shows each mode's name, its tagline and what it means in plain words. It
 * deliberately does NOT show the Elo ladder or anything about how the bot is
 * weakened: the player picks how hard they want the game, not a number.
 *
 * `compact` keeps only the CHOSEN mode's sentence open. The new-game screen
 * uses it, because with all three open the "Get my passport" button fell below
 * the fold on a 900px-tall window - and a creator whose confirm button you
 * have to go looking for is worse than one that explains two modes in four
 * words each until you click them.
 */

import { h } from './dom.js';
import { DIFFICULTY, difficultyMode } from '../data/config.js';

export function difficultyPicker(current, onPick, { compact = false } = {}) {
  const id = difficultyMode(current).id;
  const buttons = DIFFICULTY.modes.map((mode) => {
    const el = h('button.pp-difficulty', {
      type: 'button', 'aria-pressed': String(mode.id === id),
      onclick: () => {
        for (const other of buttons) {
          const on = other.dataset.id === mode.id;
          other.classList.toggle('is-picked', on);
          other.setAttribute('aria-pressed', String(on));
        }
        onPick(mode.id);
      }
    },
      h('b.pp-difficulty__name', { text: mode.label }),
      h('span.pp-difficulty__tagline', { text: mode.tagline }),
      h('span.pp-small.pp-difficulty__blurb', { text: mode.blurb }));
    el.dataset.id = mode.id;
    el.classList.toggle('is-picked', mode.id === id);
    return el;
  });
  return h(`div.pp-difficulty-pick${compact ? '.is-compact' : ''}`, null, buttons);
}

export default difficultyPicker;
