/**
 * forkDetector.js — forks, double attacks and the TacticalOpportunity object.
 *
 * This is the reference implementation for every tactical opportunity in the
 * game: detection is deterministic board analysis, and `counterplayRisk` is
 * derived from the opponent's actual defensive resources — NOT from an engine
 * evaluation. A forced sequence with no defence approaches 0 risk however
 * modest the material gain; a speculative shot with four playable answers
 * scores high risk even when the engine likes it.
 *
 * The same object shape is reused by the hint system, the explanation engine,
 * the perk/ability layer and the Python pre-baking pipeline.
 */

import { at, legalMoves, passTurn, sanFor } from '../core/rules.js';
import { see, clamp01, isAbsolutelyPinned } from './boardAnalysis.js';
import {
  PIECE_VALUE, PIECE_NAME, KING, QUEEN, ROOK, otherColour
} from '../core/constants.js';

/**
 * @typedef {Object} TacticalOpportunity
 * @property {string} type            FORK | DOUBLE_ATTACK | ...
 * @property {string} attacker        piece name that delivers it
 * @property {string} attackerSquare
 * @property {string} move            UCI of the move that creates it
 * @property {string} san
 * @property {Array<{square,type,name,value,defended}>} targets
 * @property {string} targetA         convenience: the most valuable target's name
 * @property {string} targetB
 * @property {number} depth           1 = available immediately, 2 = after one forcing move
 * @property {number} materialGain    centipawns expected, deterministic estimate
 * @property {number} confidence      0..1 — how sure the DETECTOR is
 * @property {number} counterplayRisk 0..1 — how much the opponent can do about it
 * @property {boolean} forcing        does it give check / is every reply forced
 * @property {string[]} defences      opponent replies that reduce or refute it
 */

/**
 * Every fork `colour` can play from this position.
 * @param {string} fen
 * @param {'w'|'b'} [colour] defaults to the side to move
 * @param {{ maxDepth?:number, minTargets?:number, limit?:number }} [options]
 * @returns {TacticalOpportunity[]} sorted best-first
 */
export function detectForks(fen, colour = null, { maxDepth = 1, minTargets = 2, limit = 12 } = {}) {
  const side = colour || (fen.split(' ')[1] === 'b' ? 'b' : 'w');
  const source = fen.split(' ')[1] === side ? fen : passTurn(fen);
  if (!source) return [];

  const found = [];
  for (const move of legalMoves(source)) {
    const opportunity = evaluateForkMove(source, move, side, minTargets);
    if (opportunity) found.push(opportunity);
  }

  if (maxDepth >= 2) found.push(...findPreparedForks(source, side, minTargets));

  return found
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}

function score(opportunity) {
  return opportunity.materialGain * (1 - opportunity.counterplayRisk) * opportunity.confidence;
}

/** Test one candidate move for a fork. @returns {TacticalOpportunity|null} */
export function evaluateForkMove(fen, move, side, minTargets = 2) {
  const board = at(fen);
  const mover = board.get(move.from);
  if (!mover) return null;

  const after = at(fen);
  try { after.move({ from: move.from, to: move.to, promotion: move.promotion }); }
  catch { return null; }
  const fenAfter = after.fen();
  const enemy = otherColour(side);
  const moverValue = PIECE_VALUE[move.promotion || mover.type];

  // Which enemy pieces does the piece on its NEW square attack?
  const targets = [];
  for (const row of after.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy) continue;
      if (!after.attackers(cell.square, side).includes(move.to)) continue;
      const defenders = after.attackers(cell.square, enemy);
      const value = PIECE_VALUE[cell.type];
      // A target only counts if taking it would actually gain something:
      // the king always counts; anything else must be undefended or worth
      // more than the attacking piece.
      const worthwhile = cell.type === KING || defenders.length === 0 || value > moverValue;
      if (!worthwhile) continue;
      targets.push({
        square: cell.square, type: cell.type, name: PIECE_NAME[cell.type],
        value, defended: defenders.length > 0, defenders
      });
    }
  }
  if (targets.length < minTargets) return null;

  targets.sort((a, b) => b.value - a.value);
  const givesCheck = after.inCheck();

  // Would the forking piece simply be captured on its landing square?
  const landingExchange = see(fenAfter, move.to, enemy);
  const capturedValue = move.captured ? PIECE_VALUE[move.captured] : 0;
  const netOnLanding = capturedValue - landingExchange;

  // Deterministic estimate: the second-best target is what actually falls,
  // because the opponent saves the most valuable one (or the king must move).
  const spoils = targets[0].type === KING ? targets[1] : targets[1];
  const grossGain = spoils ? spoils.value : 0;
  const materialGain = Math.max(0, grossGain + netOnLanding);
  if (materialGain <= 0 && !givesCheck) return null;

  const { counterplayRisk, defences, forcing } =
    assessCounterplay(fenAfter, { side, enemy, forkSquare: move.to, targets, givesCheck, materialGain });

  const confidence = clamp01(
    0.55 +
    (givesCheck ? 0.2 : 0) +
    (landingExchange <= 0 ? 0.15 : 0) +
    clamp01(materialGain / 900) * 0.1
  );

  return {
    type: targets[0].type === KING ? 'FORK' : 'DOUBLE_ATTACK',
    attacker: PIECE_NAME[mover.type],
    attackerSquare: move.to,
    fromSquare: move.from,
    move: move.from + move.to + (move.promotion || ''),
    san: move.san,
    targets,
    targetA: targets[0]?.name || null,
    targetB: targets[1]?.name || null,
    depth: 1,
    materialGain,
    confidence: Math.round(confidence * 100) / 100,
    counterplayRisk: Math.round(counterplayRisk * 100) / 100,
    forcing,
    defences,
    givesCheck
  };
}

/**
 * counterplayRisk — the heart of the system.
 *
 * It is explicitly NOT the engine evaluation. It answers: how likely is it
 * that this tactic simply does not work in practice? Inputs:
 *   - is the sequence forced (check, or every reply loses material anyway)?
 *   - how many replies meaningfully defuse it?
 *   - can the forking piece be taken?
 *   - can the opponent produce a bigger counter-threat (check, or a capture
 *     worth more than the fork wins)?
 */
export function assessCounterplay(fenAfter, { side, enemy, forkSquare, targets, givesCheck, materialGain }) {
  const replies = legalMoves(fenAfter);
  if (!replies.length) {
    return { counterplayRisk: 0, defences: [], forcing: true };   // mate or stalemate
  }

  const defences = [];
  for (const reply of replies) {
    const board = at(fenAfter);
    try { board.move({ from: reply.from, to: reply.to, promotion: reply.promotion }); } catch { continue; }
    const next = board.fen();

    // 1. Capturing the forking piece profitably.
    if (reply.to === forkSquare) {
      const recapture = see(next, forkSquare, side);
      const netForEnemy = PIECE_VALUE[reply.captured || 'p'] - recapture;
      if (netForEnemy >= 0) {
        defences.push({ san: reply.san, uci: reply.from + reply.to, kind: 'CAPTURES_ATTACKER', value: netForEnemy });
        continue;
      }
    }

    // 2. A counter-check the forking side must answer first.
    if (board.inCheck() === false && reply.san.includes('+')) {
      defences.push({ san: reply.san, uci: reply.from + reply.to, kind: 'COUNTER_CHECK', value: 0 });
      continue;
    }

    // 3. A counter-capture worth at least as much as the fork wins.
    if (reply.captured && PIECE_VALUE[reply.captured] >= materialGain && see(fenAfter, reply.to, enemy) > 0) {
      defences.push({ san: reply.san, uci: reply.from + reply.to, kind: 'COUNTER_CAPTURE', value: PIECE_VALUE[reply.captured] });
      continue;
    }

    // 4. Defending or moving the second target so nothing actually falls.
    const second = targets[0]?.type === KING ? targets[1] : targets[1];
    if (second) {
      const movedAway = reply.from === second.square;
      const nowDefended = !movedAway && at(next).attackers(second.square, enemy).length >
                          at(fenAfter).attackers(second.square, enemy).length;
      const stillAttacked = at(next).attackers(movedAway ? reply.to : second.square, side).includes(forkSquare);
      if ((movedAway && !stillAttacked) || (nowDefended && see(next, second.square, side) <= 0)) {
        defences.push({
          san: reply.san, uci: reply.from + reply.to,
          kind: movedAway ? 'MOVES_TARGET' : 'DEFENDS_TARGET', value: second.value
        });
      }
    }
  }

  // A check that the king must answer, with no defence found, is forced.
  const forcing = givesCheck && defences.length === 0;

  // Weighting: a capture of the forking piece is the worst news; a defensive
  // resource that only saves the smaller target barely counts.
  const weights = { CAPTURES_ATTACKER: 1.0, COUNTER_CHECK: 0.7, COUNTER_CAPTURE: 0.7, MOVES_TARGET: 0.45, DEFENDS_TARGET: 0.4 };
  const pressure = defences.reduce((sum, d) => sum + (weights[d.kind] || 0.3), 0);

  let risk = clamp01(pressure / 2.2);
  if (givesCheck) risk *= 0.55;                 // the king must respond first
  if (replies.length <= 2) risk *= 0.6;         // almost nothing to choose from
  if (defences.some((d) => d.kind === 'CAPTURES_ATTACKER')) risk = Math.max(risk, 0.75);

  return { counterplayRisk: clamp01(risk), defences, forcing };
}

/**
 * Depth-2 forks: a forcing move (check or winning capture) first, then the
 * fork. The search is deliberately narrow — the point is to find the shots a
 * strong club player would see, not to out-search Stockfish.
 */
function findPreparedForks(fen, side, minTargets) {
  const out = [];
  const forcing = legalMoves(fen).filter((m) => m.san.includes('+') || (m.captured && see(fen, m.to, side) >= 0));
  for (const prep of forcing.slice(0, 10)) {
    const board = at(fen);
    try { board.move({ from: prep.from, to: prep.to, promotion: prep.promotion }); } catch { continue; }
    const replies = legalMoves(board.fen());
    if (!replies.length || replies.length > 4) continue;   // only genuinely forced lines

    // The fork must work against EVERY reply, otherwise it is not a threat.
    let worksEverywhere = true;
    let sample = null;
    for (const reply of replies) {
      const inner = at(board.fen());
      try { inner.move({ from: reply.from, to: reply.to, promotion: reply.promotion }); } catch { worksEverywhere = false; break; }
      const hit = legalMoves(inner.fen())
        .map((m) => evaluateForkMove(inner.fen(), m, side, minTargets))
        .filter(Boolean)
        .sort((a, b) => score(b) - score(a))[0];
      if (!hit) { worksEverywhere = false; break; }
      if (!sample) sample = { hit, reply };
    }
    if (!worksEverywhere || !sample) continue;

    out.push({
      ...sample.hit,
      depth: 2,
      preparation: { move: prep.from + prep.to, san: prep.san },
      expectedReply: { move: sample.reply.from + sample.reply.to, san: sample.reply.san },
      confidence: Math.round(sample.hit.confidence * 0.85 * 100) / 100,
      counterplayRisk: Math.round(Math.min(1, sample.hit.counterplayRisk + 0.1) * 100) / 100
    });
  }
  return out;
}

/**
 * The single best fork available, or null. What the hint system asks for.
 */
export function bestFork(fen, colour = null, options = {}) {
  return detectForks(fen, colour, options)[0] || null;
}

export default { detectForks, evaluateForkMove, assessCounterplay, bestFork };
