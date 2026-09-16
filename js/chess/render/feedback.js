/**
 * feedback.js — ONE colour language, for the whole game.
 *
 * The board, the Focus suggestion cards, the move list and the post-game review
 * all read this table. A hierarchy that means one thing on the board and
 * another in a panel is not a hierarchy, and the player learns it once or not
 * at all.
 *
 *   grey        neutral, unknown, nothing to say
 *   blue        playable / common / acceptable
 *   green       good
 *   cyan        strong — the best tier an ordinary result reaches
 *   purple      brilliant — rare, and exciting
 *   gold        epic — brilliant AND best, or effectively tied for best
 *   orange-red  mistake
 *   red         blunder
 *
 * EPIC is the top tier for a reason worth stating: a brilliant move that is
 * also the engine's own choice is a different thing from a brilliant move that
 * merely works, and the rarest outcome in the game deserves to look like it.
 *
 * `fill`/`ring`/`particles`/`rays` are what the 3D board draws; `css` is the
 * variable the DOM uses. Nothing else decides what a tier looks like.
 */

export const FEEDBACK = Object.freeze({
  /* --- board states, not judgements ------------------------------------ */
  neutral:   { color: 0x8d97a6, css: '--fb-neutral',   fill: 0.16, label: '' },
  selected:  { color: 0x5aa9ff, css: '--fb-playable',  fill: 0.22, ring: true, label: '' },
  legal:     { color: 0x5aa9ff, css: '--fb-playable',  fill: 0.20, label: '' },
  'legal-capture': { color: 0xff8f5a, css: '--fb-mistake', fill: 0.26, ring: true, label: '' },
  'last-move': { color: 0x8d97a6, css: '--fb-neutral', fill: 0.14, label: '' },
  hint:      { color: 0x9aa7b8, css: '--fb-neutral',   fill: 0.20, label: '' },  // intuition's grey square
  threat:    { color: 0xff5a5a, css: '--fb-blunder',   fill: 0.22, label: '' },
  check:     { color: 0xff4444, css: '--fb-blunder',   fill: 0.10, ring: true, pulse: true, label: 'CHECK' },

  /* --- move quality, in ascending order -------------------------------- */
  playable:  { color: 0x5aa9ff, css: '--fb-playable',  fill: 0.22, label: 'PLAYABLE' },
  good:      { color: 0x5ad17a, css: '--fb-good',      fill: 0.26, ring: true, label: 'GOOD',
               glow: 0.35 },
  best:      { color: 0x36d6d6, css: '--fb-best',      fill: 0.32, ring: true, label: 'BEST',
               glow: 0.6, sweep: true },
  /* Pawn & Passport addition: CLUTCH, the only move under pressure. It sits
     between BEST and BRILLIANT - rarer than a best move, but it risks nothing. */
  clutch:    { color: 0xff4fa3, css: '--fb-clutch',    fill: 0.36, ring: true, label: 'CLUTCH!',
               glow: 0.8, particles: 36, additive: true },
  brilliant: { color: 0xb46cff, css: '--fb-brilliant', fill: 0.38, ring: true, label: 'BRILLIANT!',
               glow: 0.9, particles: 42, additive: true },
  epic:      { color: 0xffc341, css: '--fb-epic',      fill: 0.44, ring: true, label: 'EPIC!',
               glow: 1.2, particles: 64, rays: 12, additive: true },

  /* --- and the two that hurt ------------------------------------------- */
  mistake:   { color: 0xff8f3a, css: '--fb-mistake',   fill: 0.34, ring: true, label: 'MISTAKE',
               glow: 0.5, flash: true, mark: '!' },
  blunder:   { color: 0xff3b30, css: '--fb-blunder',   fill: 0.42, ring: true, label: 'BLUNDER',
               glow: 0.8, flash: true, shake: true, mark: '!!' },

  /* --- events ----------------------------------------------------------- */
  capture:   { color: 0xffd08a, css: '--fb-epic',      fill: 0.0, particles: 34, additive: true,
               label: '' }
});

/** Ascending, so a UI can sort or compare tiers without hard-coding names. */
export const QUALITY_ORDER = Object.freeze(
  ['blunder', 'mistake', 'neutral', 'playable', 'good', 'best', 'clutch', 'brilliant', 'epic']);

export const rank = (kind) => QUALITY_ORDER.indexOf(kind);

/**
 * The classifier's vocabulary -> this table's.
 *
 * EPIC is decided HERE rather than in the classifier, because it is a
 * presentation tier: it is what a BRILLIANT move is called when it was also the
 * engine's own choice. The classifier already knows both facts.
 *
 * @param {string} classification  from moveClassifier.js
 * @param {{isBest?: boolean, loss?: number}} [ctx]
 */
export function tierFor(classification, ctx = {}) {
  const c = String(classification || '').toUpperCase();
  if (c === 'BRILLIANT') {
    const tied = ctx.isBest || (typeof ctx.loss === 'number' && ctx.loss <= 10);
    return tied ? 'epic' : 'brilliant';
  }
  return {
    BEST: 'best', EXCELLENT: 'best', GOOD: 'good', BOOK: 'playable',
    FORCED: 'neutral', INACCURACY: 'mistake', MISTAKE: 'mistake',
    MISS: 'mistake', BLUNDER: 'blunder'
  }[c] || 'neutral';
}

/** `#rrggbb`, for the DOM side. */
export const hex = (kind) =>
  '#' + ((FEEDBACK[kind] || FEEDBACK.neutral).color).toString(16).padStart(6, '0');

export default FEEDBACK;
