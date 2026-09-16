/**
 * openingBook.js - the six club openings as a position index.
 *
 * Built once at load: every position a line passes through maps to the moves
 * the lines continue with. Queries are Map lookups, never replays - the match
 * screen asks on every move (see the World Tour's snapshot-path lesson).
 * Transpositions come for free, because the key is the position, not the
 * move order.
 *
 * Every node and every move remembers exactly which LINES contain it
 * (`openingId:lineIndex`), which is what lets a suggestion say "Italian Game"
 * while it is still on the main line and "Italian Game: Two Knights Defence"
 * once the game has left it.
 *
 * It speaks three dialects:
 *   lookup(fen)            ChessBot's book interface ({ name, moves[] })
 *   isBookPosition(fen)    GameReview's, so a line move is graded BOOK
 *   familiarity/guide/describe   the player's knowledge: hint cost, guide
 *                          arrows and the hover card on suggested squares
 */

import { OPENINGS } from '../data/openings.js';
import { createRules } from '../chess/core/rules.js';

/** Placement, side, castling, en passant: move counters do not change a position. */
export const positionKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

/** Plies played to reach a FEN, from its move counters. */
export const plyOf = (fen) => {
  const parts = fen.split(' ');
  return (Number(parts[5] || 1) - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
};

const tag = (openingId, lineIndex) => `${openingId}:${lineIndex}`;
const untag = (t) => { const [openingId, i] = t.split(':'); return { openingId, lineIndex: Number(i) }; };

export class ClubBook {
  /** @param {Object[]} [openings] a subset, e.g. one club's opening for its bots */
  constructor(openings = OPENINGS) {
    this.openings = openings;
    this.byId = new Map(openings.map((o) => [o.id, o]));
    /** @type {Map<string, {moves: Map<string, {san, uci, lines:Set<string>}>, lines:Set<string>, openings:Set<string>, depth:Object}>} */
    this.index = new Map();
    for (const opening of openings) {
      opening.lines.forEach((line, lineIndex) => this._addLine(opening, line, lineIndex));
    }
    this.loaded = true;
  }

  _node(key) {
    let node = this.index.get(key);
    if (!node) { node = { moves: new Map(), lines: new Set(), openings: new Set(), depth: {} }; this.index.set(key, node); }
    return node;
  }

  _addLine(opening, line, lineIndex) {
    const rules = createRules();
    const t = tag(opening.id, lineIndex);
    line.forEach((san, ply) => {
      const node = this._node(positionKey(rules.fen()));
      node.openings.add(opening.id);
      node.lines.add(t);
      node.depth[opening.id] = Math.max(node.depth[opening.id] ?? -1, ply);
      const move = rules.move(san);
      if (!move) throw new Error(`${opening.id} line ${lineIndex}: illegal ${san} at ply ${ply}`);
      const uci = move.from + move.to + (move.promotion || '');
      const entry = node.moves.get(uci) || { san: move.san, uci, lines: new Set() };
      entry.lines.add(t);
      node.moves.set(uci, entry);
    });
    const last = this._node(positionKey(rules.fen()));
    last.openings.add(opening.id);
    last.lines.add(t);
    last.depth[opening.id] = Math.max(last.depth[opening.id] ?? -1, line.length);
  }

  /** What the lines know about this position (null when out of book). */
  at(fen) { return this.index.get(positionKey(fen)) || null; }

  isBookPosition(fen) { return this.index.has(positionKey(fen)); }

  /** Openings whose line has been reached by this position (ply >= reachedAt). */
  reached(fen) {
    const node = this.at(fen);
    if (!node) return [];
    return this.openings.filter((o) => node.openings.has(o.id) && (node.depth[o.id] ?? 0) >= o.reachedAt);
  }

  /** ChessBot's book call. Main-line moves first, so the bot favours them. */
  lookup(fen) {
    const node = this.at(fen);
    if (!node || !node.moves.size) return null;
    const isMain = (m) => [...m.lines].some((t) => untag(t).lineIndex === 0);
    const moves = [...node.moves.values()].sort((a, b) => Number(isMain(b)) - Number(isMain(a)))
      .map((m) => ({ san: m.san, uci: m.uci }));
    const names = [...node.openings].map((id) => this.byId.get(id)?.name).filter(Boolean);
    return { name: names.join(' / '), moves };
  }

  /**
   * How many plies of an opening the player knows at a mastery percent:
   * mastery is a share of the opening's longest line (at least 2 plies once
   * the opening is known at all). 100% knows everything.
   */
  knownPlies(openingId, mastery) {
    const opening = this.byId.get(openingId);
    if (!opening || !mastery) return 0;
    const longest = Math.max(...opening.lines.map((l) => l.length));
    return mastery >= 100 ? Infinity : Math.max(2, Math.ceil(longest * mastery / 100));
  }

  /**
   * The player's familiarity with THIS position: the best mastery among the
   * given openings whose lines contain it. 0 when out of book or unknown.
   */
  familiarity(fen, mastery = {}) {
    const node = this.at(fen);
    if (!node) return { inBook: false, mastery: 0, openingId: null };
    let best = { inBook: true, mastery: 0, openingId: null };
    for (const id of node.openings) {
      const m = mastery[id] ?? 0;
      if (m > best.mastery || !best.openingId) best = { inBook: true, mastery: m, openingId: id };
    }
    return best;
  }

  /**
   * Guide arrows for the side to move, from the player's EQUIPPED openings.
   *
   * @param {Object} mastery      openingId -> percent, already filtered to equipped openings
   * @param {Object} [o]
   * @param {number} [o.allBranchesAt]  at this mastery every prepared branch is shown;
   *        below it only moves on the line the game is currently following
   * @returns {{from, to, san, openingId, main:boolean}[]}
   */
  guide(fen, mastery = {}, { allBranchesAt = 100 } = {}) {
    const node = this.at(fen);
    if (!node) return [];
    const ply = plyOf(fen);
    const out = [];
    for (const move of node.moves.values()) {
      let pick = null;
      for (const t of move.lines) {
        const { openingId, lineIndex } = untag(t);
        const m = mastery[openingId] ?? 0;
        if (!m || ply >= this.knownPlies(openingId, m)) continue;
        // Below full mastery you only know the line you are on: the main line
        // while the game follows it, otherwise the variation it has become.
        const onLine = node.lines.has(t);
        const followingMain = node.lines.has(tag(openingId, 0));
        const allowed = m >= allBranchesAt || (onLine && (lineIndex === 0 || !followingMain));
        if (!allowed) continue;
        const main = lineIndex === 0;
        if (!pick || (main && !pick.main) || m > (mastery[pick.openingId] ?? 0)) {
          pick = { from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), uci: move.uci, san: move.san, openingId, main };
        }
      }
      if (pick) out.push(pick);
    }
    return out.sort((a, b) => Number(b.main) - Number(a.main));
  }

  /**
   * What a suggested move means, for the hover card.
   *
   * One entry per opening that contains the move from this position. While
   * the position is still on that opening's MAIN line and the move keeps it
   * there, only the opening is named; once the game has left the main line
   * (or this move leaves it) the variation names are listed.
   *
   * @returns {{inBook:boolean, entries:{openingId, name, side, description, idea, mainLine:boolean, variations:string[]}[]}}
   */
  describe(fen, uci) {
    const node = this.at(fen);
    const move = node?.moves.get(uci);
    if (!move) return { inBook: !!node, entries: [] };
    const grouped = new Map();
    for (const t of move.lines) {
      const { openingId, lineIndex } = untag(t);
      if (!grouped.has(openingId)) grouped.set(openingId, []);
      grouped.get(openingId).push(lineIndex);
    }
    const entries = [];
    for (const [openingId, indices] of grouped) {
      const opening = this.byId.get(openingId);
      const mainLine = indices.includes(0) && node.lines.has(tag(openingId, 0));
      entries.push({
        openingId, name: opening.name, side: opening.side, eco: opening.eco,
        description: opening.description, idea: opening.idea, mainLine,
        variations: mainLine ? [] : indices.sort((a, b) => a - b).map((i) => opening.lineNames?.[i] || `Line ${i + 1}`)
      });
    }
    return { inBook: true, entries };
  }
}

export const fullBook = new ClubBook(OPENINGS);
export const bookForOpening = (openingId) => new ClubBook(OPENINGS.filter((o) => o.id === openingId));

export default ClubBook;
