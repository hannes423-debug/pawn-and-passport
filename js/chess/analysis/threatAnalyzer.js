/**
 * threatAnalyzer.js — "what is my opponent actually threatening?"
 *
 * The technique is the null move: hand the opponent a free move and enumerate
 * what they would do with it. That answers the question a human asks after
 * every move, and it does so without an engine, so the readout works offline
 * and instantly while the engine is still thinking.
 *
 * Everything returned is structured; the explanation engine turns it into
 * prose, never the other way round.
 */

import { at, legalMoves, passTurn, kingSquare, isCheckmate } from '../core/rules.js';
import {
  hangingPieces, loosePieces, overloadedDefenders, pinsAndSkewers, kingSafety,
  pawnStructure, trappedPieces, see, clamp01
} from './boardAnalysis.js';
import { detectForks } from './forkDetector.js';
import { PIECE_VALUE, PIECE_NAME, KING, PAWN, otherColour, rankIndex } from '../core/constants.js';

export const THREAT_TYPES = Object.freeze({
  MATE: 'MATE_THREAT',
  MATERIAL: 'MATERIAL_THREAT',
  HANGING: 'HANGING_PIECE',
  FORK: 'FORK_THREAT',
  PIN: 'PIN',
  SKEWER: 'SKEWER',
  OVERLOAD: 'OVERLOADED_DEFENDER',
  PROMOTION: 'PROMOTION_THREAT',
  PAWN: 'PAWN_THREAT',
  KING_SAFETY: 'KING_SAFETY',
  TRAPPED: 'TRAPPED_PIECE',
  DISCOVERED: 'DISCOVERED_ATTACK'
});

/**
 * @typedef {Object} Threat
 * @property {string} type
 * @property {string} [piece]   the piece delivering the threat
 * @property {string} [target]  square being threatened
 * @property {number} severity  0..1
 * @property {boolean} forced   is the threatened side obliged to answer
 * @property {string} [move]    UCI that executes it
 * @property {string} [san]
 * @property {string} summary   one short factual clause, no interpretation
 */

/**
 * Everything `attacker` threatens against `defender` in this position.
 *
 * @param {string} fen
 * @param {'w'|'b'} attacker  the side whose threats we enumerate
 * @param {{ limit?:number, includeStatic?:boolean, forkDepth?:number }} [options]
 * @returns {Threat[]} sorted by severity
 */
export function analyzeThreats(fen, attacker, { limit = 8, includeStatic = true, forkDepth = 1 } = {}) {
  const defender = otherColour(attacker);
  // The position from which the attacker gets to move.
  const source = fen.split(' ')[1] === attacker ? fen : passTurn(fen);
  const threats = [];

  if (source) {
    threats.push(...movementThreats(source, fen, attacker, defender));
    for (const fork of detectForks(source, attacker, { maxDepth: forkDepth, limit: 3 })) {
      threats.push({
        type: THREAT_TYPES.FORK,
        piece: fork.attacker,
        target: fork.targets.map((t) => t.square).join('/'),
        severity: clamp01((fork.materialGain / 900) * (1 - fork.counterplayRisk) * fork.confidence),
        forced: fork.forcing,
        move: fork.move, san: fork.san,
        opportunity: fork,
        summary: `${cap(fork.attacker)} ${fork.san} forks the ${fork.targetA} and the ${fork.targetB}`
      });
    }
  }

  if (includeStatic) threats.push(...staticThreats(fen, attacker, defender));

  return dedupe(threats).sort((a, b) => b.severity - a.severity).slice(0, limit);
}

/** Threats that require the attacker to actually play a move. */
function movementThreats(source, originalFen, attacker, defender) {
  const out = [];
  const moves = legalMoves(source);

  for (const move of moves) {
    const board = at(source);
    try { board.move({ from: move.from, to: move.to, promotion: move.promotion }); } catch { continue; }
    const after = board.fen();

    // Mate in one, from a free move: the sharpest possible threat.
    if (board.isCheckmate()) {
      out.push({
        type: THREAT_TYPES.MATE,
        piece: PIECE_NAME[move.piece], target: move.to,
        severity: 1, forced: true,
        move: move.from + move.to + (move.promotion || ''), san: move.san,
        summary: `${move.san} is mate`
      });
      continue;
    }

    // Winning material by capture.
    if (move.captured) {
      const gain = see(source, move.to, attacker);
      if (gain >= 100) {
        out.push({
          type: THREAT_TYPES.MATERIAL,
          piece: PIECE_NAME[move.piece], target: move.to,
          severity: clamp01(gain / 900), forced: false,
          move: move.from + move.to + (move.promotion || ''), san: move.san,
          materialGain: gain,
          summary: `${move.san} wins the ${PIECE_NAME[move.captured]} on ${move.to}`
        });
      }
      continue;
    }

    // Promotion.
    if (move.promotion) {
      out.push({
        type: THREAT_TYPES.PROMOTION,
        piece: 'pawn', target: move.to,
        severity: 0.9, forced: false,
        move: move.from + move.to + move.promotion, san: move.san,
        summary: `the pawn promotes with ${move.san}`
      });
      continue;
    }

    // A quiet move that creates a mate threat next.
    if (!move.captured && createsMateThreat(after, attacker)) {
      out.push({
        type: THREAT_TYPES.MATE,
        piece: PIECE_NAME[move.piece], target: move.to,
        severity: 0.85, forced: false,
        move: move.from + move.to, san: move.san,
        summary: `${move.san} sets up a mating threat`
      });
    }
  }
  return out;
}

/** After `fen`, could the attacker mate on the following move? */
function createsMateThreat(fen, attacker) {
  const source = fen.split(' ')[1] === attacker ? fen : passTurn(fen);
  if (!source) return false;
  for (const move of legalMoves(source)) {
    if (!move.san.includes('+')) continue;
    const board = at(source);
    try { board.move({ from: move.from, to: move.to, promotion: move.promotion }); } catch { continue; }
    if (board.isCheckmate()) return true;
  }
  return false;
}

/** Threats that exist as a property of the position, no move required. */
function staticThreats(fen, attacker, defender) {
  const out = [];

  for (const piece of hangingPieces(fen, defender)) {
    out.push({
      type: THREAT_TYPES.HANGING,
      piece: piece.name, target: piece.square,
      severity: piece.severity, forced: false,
      undefended: piece.undefended,
      materialAtRisk: piece.materialAtRisk,
      summary: `the ${piece.name} on ${piece.square} is ${piece.undefended ? 'undefended' : 'losing material'}`
    });
  }

  for (const pin of pinsAndSkewers(fen, defender)) {
    out.push({
      type: pin.type === 'PIN' ? THREAT_TYPES.PIN : THREAT_TYPES.SKEWER,
      piece: pin.attacker.name,
      target: pin.type === 'PIN' ? pin.pinned.square : pin.front.square,
      severity: clamp01((pin.value || 300) / 900) * (pin.absolute ? 1 : 0.7),
      forced: !!pin.absolute,
      detail: pin,
      summary: pin.type === 'PIN'
        ? `the ${pin.pinned.name} on ${pin.pinned.square} is pinned by the ${pin.attacker.name} on ${pin.attacker.square}`
        : `the ${pin.front.name} on ${pin.front.square} is skewered against the ${pin.behind.name} on ${pin.behind.square}`
    });
  }

  for (const overload of overloadedDefenders(fen, defender)) {
    out.push({
      type: THREAT_TYPES.OVERLOAD,
      piece: overload.defender.name, target: overload.defender.square,
      severity: overload.severity * 0.6, forced: false,
      detail: overload,
      summary: `the ${overload.defender.name} on ${overload.defender.square} is defending ${overload.protecting.length} pieces at once`
    });
  }

  for (const trapped of trappedPieces(fen, defender)) {
    out.push({
      type: THREAT_TYPES.TRAPPED,
      piece: trapped.name, target: trapped.square,
      severity: trapped.severity * 0.8, forced: false,
      summary: `the ${trapped.name} on ${trapped.square} has no safe square`
    });
  }

  // King safety is only a THREAT when squares around the king are actually
  // covered. A bare king in a pawnless endgame scores high "exposure" because
  // it has no shelter, but nothing is attacking it — reporting that as a
  // threat is noise, and it was.
  const safety = kingSafety(fen, defender);
  if (safety && safety.attackedRingCount >= 2 && safety.exposure >= 0.4) {
    out.push({
      type: THREAT_TYPES.KING_SAFETY,
      piece: 'king', target: safety.square,
      severity: clamp01(safety.exposure) * 0.7, forced: false,
      detail: safety,
      summary: `${safety.attackedRingCount} squares around the king on ${safety.square} are under attack`
    });
  }

  // Passed pawns close to promotion.
  for (const passed of pawnStructure(fen, attacker).passed) {
    if (passed.distanceToPromotion > 3) continue;
    out.push({
      type: THREAT_TYPES.PAWN,
      piece: 'pawn', target: passed.square,
      severity: clamp01((4 - passed.distanceToPromotion) / 4) * 0.6, forced: false,
      summary: `the passed pawn on ${passed.square} is ${passed.distanceToPromotion} square${passed.distanceToPromotion === 1 ? '' : 's'} from promoting`
    });
  }

  return out;
}

function dedupe(threats) {
  const seen = new Set();
  const out = [];
  for (const threat of threats) {
    const key = `${threat.type}|${threat.target}|${threat.san || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(threat);
  }
  return out;
}

function cap(word) { return word ? word[0].toUpperCase() + word.slice(1) : word; }

/**
 * The full two-sided picture: what each side threatens, plus the standing
 * weaknesses. This is what the debug panel and the live-hint layer read.
 */
export function threatReport(fen, { limit = 6 } = {}) {
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const them = otherColour(turn);
  return {
    fen,
    turn,
    /** What the side to move can do. */
    opportunities: analyzeThreats(fen, turn, { limit }),
    /** What is coming at the side to move if they do nothing. */
    incoming: analyzeThreats(fen, them, { limit }),
    weaknesses: {
      [turn]: {
        hanging: hangingPieces(fen, turn),
        loose: loosePieces(fen, turn),
        kingSafety: kingSafety(fen, turn)
      },
      [them]: {
        hanging: hangingPieces(fen, them),
        loose: loosePieces(fen, them),
        kingSafety: kingSafety(fen, them)
      }
    }
  };
}

export const ThreatAnalyzer = { analyzeThreats, threatReport, THREAT_TYPES };
export default ThreatAnalyzer;
