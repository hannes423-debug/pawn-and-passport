/**
 * shop.js - buying and using what the coin shop sells. Pure: it reads and
 * writes the career and nothing else (the Journal's Shop page draws it).
 *
 *   career.shop = { owned: ['pieces:tokens', ...], pieces: 'tokens', board: 'marble' }
 *
 * Free items are owned without being listed. Unlike a fee or a flight, a
 * purchase is never covered by the sponsor: it needs the coins in hand and no
 * debt, because looks are the one thing a career can do without.
 */

import { SHOP_ITEMS, DEFAULT_STYLE, shopItem } from '../data/shop.js';

/** The career's shop record, repaired in place (old saves have none). */
export function shopRecord(career) {
  const rec = career.shop && typeof career.shop === 'object' ? career.shop : {};
  const owned = Array.isArray(rec.owned) ? rec.owned.filter((id, i, all) => shopItem(id) && all.indexOf(id) === i) : [];
  career.shop = { owned, pieces: rec.pieces || DEFAULT_STYLE.pieces, board: rec.board || DEFAULT_STYLE.board };
  // Something in use that is not owned (a hand-edited save, an item since withdrawn): back to the default.
  for (const kind of ['pieces', 'board']) {
    if (!ownsItem(career, `${kind}:${career.shop[kind]}`)) career.shop[kind] = DEFAULT_STYLE[kind];
  }
  return career.shop;
}

export function ownsItem(career, id) {
  const item = shopItem(id);
  if (!item) return false;
  return item.price === 0 || (Array.isArray(career.shop?.owned) && career.shop.owned.includes(id));
}

/** In use right now: { pieces: 'tokens', board: 'green' }. */
export function equippedStyle(career) {
  if (!career) return { ...DEFAULT_STYLE };
  const rec = shopRecord(career);
  return { pieces: rec.pieces, board: rec.board };
}

export const isEquipped = (career, id) => {
  const item = shopItem(id);
  return !!item && equippedStyle(career)[item.kind] === item.ref;
};

/**
 * Buy an item and put it to use.
 * @returns {{ok:boolean, reason?:'unknown'|'owned'|'debt'|'coins', short?:number}}
 */
export function buyItem(career, id) {
  const item = shopItem(id);
  if (!item) return { ok: false, reason: 'unknown' };
  shopRecord(career);
  if (ownsItem(career, id)) return { ok: false, reason: 'owned' };
  if ((career.debt || 0) > 0) return { ok: false, reason: 'debt' };
  const coins = career.coins ?? 0;
  if (coins < item.price) return { ok: false, reason: 'coins', short: item.price - coins };
  career.coins = coins - item.price;
  career.stats.coinsSpent = (career.stats.coinsSpent || 0) + item.price;
  career.shop.owned.push(id);
  career.shop[item.kind] = item.ref;
  return { ok: true };
}

/** Use an owned item. */
export function equipItem(career, id) {
  const item = shopItem(id);
  if (!item) return { ok: false, reason: 'unknown' };
  shopRecord(career);
  if (!ownsItem(career, id)) return { ok: false, reason: 'not-owned' };
  career.shop[item.kind] = item.ref;
  return { ok: true };
}

export const itemsOfKind = (kind) => SHOP_ITEMS.filter((item) => item.kind === kind);

export default { shopRecord, ownsItem, equippedStyle, isEquipped, buyItem, equipItem, itemsOfKind };
