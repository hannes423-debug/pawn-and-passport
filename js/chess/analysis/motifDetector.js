/**
 * motifDetector.js — the tactical vocabulary of the game.
 *
 * Two entry points:
 *   detectMoveMotifs(fenBefore, move)  what the move that was just played DID
 *   detectPositionMotifs(fen)          what is standing in the position now
 *
 * Detection is board-state analysis, not engine output. Stockfish is used
 * afterwards (see verifyMotifs) to confirm that a detected motif is actually
 * significant, which is a different job from finding it: a fork that loses to
 * a refutation is still a fork, and the game should be able to say so.
 */

import { at, legalMoves, passTurn, phaseOf } from '../core/rules.js';
import {
  see, pinsAndSkewers, overloadedDefenders, hangingPieces, trappedPieces,
  piecesAlongRay, directionBetween, squaresBetween, kingSafety, clamp01
} from './boardAnalysis.js';
import { evaluateForkMove } from './forkDetector.js';
import {
  PIECE_VALUE, PIECE_NAME, KING, PAWN, QUEEN, ROOK, BISHOP, KNIGHT,
  otherColour, isSlider, RAYS, rankIndex, fileIndex, squareAt
} from '../core/constants.js';

export const MOTIFS = Object.freeze({
  CHECK: 'CHECK',
  DOUBLE_CHECK: 'DOUBLE_CHECK',
  DISCOVERED_CHECK: 'DISCOVERED_CHECK',
  DISCOVERED_ATTACK: 'DISCOVERED_ATTACK',
  CAPTURE: 'CAPTURE',
  THREAT: 'THREAT',
  FORK: 'FORK',
  DOUBLE_ATTACK: 'DOUBLE_ATTACK',
  PIN: 'PIN',
  SKEWER: 'SKEWER',
  DEFLECTION: 'DEFLECTION',
  ATTRACTION: 'ATTRACTION',
  REMOVING_DEFENDER: 'REMOVING_DEFENDER',
  OVERLOAD: 'OVERLOAD',
  ZWISCHENZUG: 'ZWISCHENZUG',
  CLEARANCE: 'CLEARANCE',
  INTERFERENCE: 'INTERFERENCE',
  TRAPPED_PIECE: 'TRAPPED_PIECE',
  BACK_RANK: 'BACK_RANK',
  MATING_ATTACK: 'MATING_ATTACK',
  MATE: 'MATE',
  PROMOTION: 'PROMOTION',
  SACRIFICE: 'SACRIFICE',
  EXCHANGE_SACRIFICE: 'EXCHANGE_SACRIFICE',
  UNDERPROMOTION: 'UNDERPROMOTION',
  STALEMATE_TRICK: 'STALEMATE_TRICK'
});

/** Human labels; kept beside the codes so nothing downstream invents its own. */
export const MOTIF_LABEL = Object.freeze({
  CHECK: 'Check', DOUBLE_CHECK: 'Double check', DISCOVERED_CHECK: 'Discovered check',
  DISCOVERED_ATTACK: 'Discovered attack', CAPTURE: 'Capture', THREAT: 'Threat',
  FORK: 'Fork', DOUBLE_ATTACK: 'Double attack', PIN: 'Pin', SKEWER: 'Skewer',
  DEFLECTION: 'Deflection', ATTRACTION: 'Attraction', REMOVING_DEFENDER: 'Removing the defender',
  OVERLOAD: 'Overloaded defender', ZWISCHENZUG: 'Zwischenzug', CLEARANCE: 'Clearance',
  INTERFERENCE: 'Interference', TRAPPED_PIECE: 'Trapped piece', BACK_RANK: 'Back-rank tactic',
  MATING_ATTACK: 'Mating attack', MATE: 'Checkmate', PROMOTION: 'Promotion',
  SACRIFICE: 'Sacrifice', EXCHANGE_SACRIFICE: 'Exchange sacrifice',
  UNDERPROMOTION: 'Underpromotion', STALEMATE_TRICK: 'Stalemate resource'
});

/**
 * @typedef {Object} Motif
 * @property {string} type
 * @property {string} label
 * @property {number} significance 0..1, deterministic estimate
 * @property {Object} detail       type-specific structured payload
 * @property {string} summary      one factual clause
 */

/**
 * What did this move do?
 * @param {string} fenBefore
 * @param {Object} move   chess.js verbose move (already legal in fenBefore)
 * @param {{ previousMove?:Object }} [context]
 * @returns {Motif[]}
 */
export function detectMoveMotifs(fenBefore, move, { previousMove = null } = {}) {
  const boardBefore = at(fenBefore);
  const mover = boardBefore.get(move.from);
  if (!mover) return [];
  const side = mover.color;
  const enemy = otherColour(side);

  const boardAfter = at(fenBefore);
  try { boardAfter.move({ from: move.from, to: move.to, promotion: move.promotion }); }
  catch { return []; }
  const fenAfter = boardAfter.fen();

  const motifs = [];
  const add = (type, significance, detail, summary) =>
    motifs.push({ type, label: MOTIF_LABEL[type], significance: clamp01(significance), detail: detail || {}, summary });

  /* ---------------------------------------------------------- checks */

  const enemyKing = boardAfter.findPiece({ type: KING, color: enemy })[0];
  if (boardAfter.isCheckmate()) {
    add(MOTIFS.MATE, 1, { square: enemyKing }, `${move.san} is checkmate`);
  }
  if (boardAfter.inCheck() && enemyKing) {
    const checkers = boardAfter.attackers(enemyKing, side);
    if (checkers.length >= 2) {
      add(MOTIFS.DOUBLE_CHECK, 0.95, { checkers }, `${move.san} gives double check — only a king move answers it`);
    } else if (!checkers.includes(move.to)) {
      add(MOTIFS.DISCOVERED_CHECK, 0.9, { checker: checkers[0], vacated: move.from },
        `moving off ${move.from} uncovered a check from ${checkers[0]}`);
    } else if (!boardAfter.isCheckmate()) {
      add(MOTIFS.CHECK, 0.35, { checker: move.to }, `${move.san} gives check`);
    }
  }

  /* ------------------------------------------------- captures & material */

  if (move.captured) {
    const gain = see(fenBefore, move.to, side);
    add(MOTIFS.CAPTURE, clamp01(PIECE_VALUE[move.captured] / 900),
      { captured: move.captured, square: move.to, see: gain },
      `${move.san} takes the ${PIECE_NAME[move.captured]} on ${move.to}`);
  }

  const offered = materialOffered(fenBefore, fenAfter, move, side, enemy);
  if (offered >= 100) {
    const movedValue = PIECE_VALUE[mover.type];
    const isExchangeSac = mover.type === ROOK && move.captured &&
      (move.captured === KNIGHT || move.captured === BISHOP);
    add(isExchangeSac ? MOTIFS.EXCHANGE_SACRIFICE : MOTIFS.SACRIFICE,
      clamp01(offered / 900),
      { offered, piece: PIECE_NAME[mover.type], square: move.to },
      isExchangeSac
        ? `${move.san} gives up the exchange`
        : `${move.san} offers ${describeMaterial(offered)}`);
  }

  if (move.promotion) {
    add(move.promotion === QUEEN ? MOTIFS.PROMOTION : MOTIFS.UNDERPROMOTION, 0.9,
      { to: move.promotion, square: move.to },
      `the pawn promotes to a ${PIECE_NAME[move.promotion]} on ${move.to}`);
  }

  /* ------------------------------------------------------------ forks */

  const fork = evaluateForkMove(fenBefore, move, side, 2);
  if (fork) {
    add(fork.type === 'FORK' ? MOTIFS.FORK : MOTIFS.DOUBLE_ATTACK,
      clamp01((fork.materialGain / 900) * (1 - fork.counterplayRisk)),
      fork,
      `${move.san} attacks the ${fork.targetA} and the ${fork.targetB} at once`);
  }

  /* --------------------------------------------------- pins & skewers */

  const pinsBefore = keySet(pinsAndSkewers(fenBefore, enemy));
  for (const pin of pinsAndSkewers(fenAfter, enemy)) {
    if (pinsBefore.has(pinKey(pin))) continue;
    if (pin.attacker.square !== move.to && pin.attacker.square !== move.from) continue;
    if (pin.type === 'PIN') {
      add(MOTIFS.PIN, pin.absolute ? 0.7 : 0.5, pin,
        `${move.san} pins the ${pin.pinned.name} on ${pin.pinned.square} against the ${pin.behind.name} on ${pin.behind.square}`);
    } else {
      add(MOTIFS.SKEWER, 0.7, pin,
        `${move.san} skewers the ${pin.front.name} on ${pin.front.square} to the ${pin.behind.name} behind it`);
    }
  }

  /* ------------------------------------------------ discovered attacks */

  const discovered = findDiscoveredAttack(fenBefore, fenAfter, move, side, enemy);
  if (discovered) {
    add(MOTIFS.DISCOVERED_ATTACK, clamp01(discovered.targetValue / 900), discovered,
      `moving off ${move.from} uncovered the ${discovered.attackerName} on ${discovered.attackerSquare}, hitting the ${discovered.targetName} on ${discovered.targetSquare}`);
  }

  /* ------------------------------------------- removing / deflecting */

  const removal = findRemovedDefender(fenBefore, fenAfter, move, side, enemy);
  if (removal) {
    add(MOTIFS.REMOVING_DEFENDER, clamp01(removal.exposedValue / 900), removal,
      `${move.san} removes the ${removal.defenderName} that was defending ${removal.exposedSquare}`);
  }

  const deflection = findDeflection(fenBefore, fenAfter, move, side, enemy);
  if (deflection) {
    add(MOTIFS.DEFLECTION, clamp01(deflection.exposedValue / 900), deflection,
      `${move.san} forces the ${deflection.defenderName} away from ${deflection.exposedSquare}`);
  }

  const attraction = findAttraction(fenBefore, fenAfter, move, side, enemy, offered);
  if (attraction) {
    add(MOTIFS.ATTRACTION, 0.7, attraction,
      `${move.san} drags the ${attraction.luredName} onto ${attraction.square}, where ${attraction.followUpSan} follows`);
  }

  /* ---------------------------------------- clearance & interference */

  // Clearance is only interesting once development is finished. In the opening
  // every pawn move "clears" a square for a bishop; that is development, not a
  // tactic, and reporting it drowns the real motifs.
  const clearance = phaseOf(fenBefore) === 'opening' ? null : findClearance(fenBefore, fenAfter, move, side);
  if (clearance) {
    add(MOTIFS.CLEARANCE, 0.3, clearance,
      `${move.san} clears ${move.from} for the ${clearance.beneficiaryName}`);
  }

  const interference = findInterference(fenBefore, fenAfter, move, side, enemy);
  if (interference) {
    add(MOTIFS.INTERFERENCE, clamp01(interference.cutValue / 900), interference,
      `${move.san} cuts the ${interference.blockedName} off from ${interference.protectedSquare}`);
  }

  /* ------------------------------------------------------ zwischenzug */

  if (previousMove && isZwischenzug(fenBefore, move, previousMove, boardAfter)) {
    add(MOTIFS.ZWISCHENZUG, 0.75, { instead: previousMove.to },
      `${move.san} is an in-between move rather than the expected recapture on ${previousMove.to}`);
  }

  /* --------------------------------------------------- back rank & mate net */

  // Only report a back-rank weakness the move actually created or sharpened —
  // a latent one that was already there is a property of the position, not of
  // this move, and belongs to detectPositionMotifs().
  const backRankBefore = findBackRank(fenBefore, side, enemy);
  const backRank = findBackRank(fenAfter, side, enemy);
  if (backRank && (!backRankBefore || backRank.severity > backRankBefore.severity)) {
    add(MOTIFS.BACK_RANK, backRank.severity, backRank,
      `the ${enemy === 'w' ? 'white' : 'black'} king on ${backRank.kingSquare} has no escape square on the back rank`);
  }

  const safety = kingSafety(fenAfter, enemy);
  if (safety && safety.attackedRingCount >= 2 && safety.exposure >= 0.55 && !boardAfter.isCheckmate()) {
    add(MOTIFS.MATING_ATTACK, clamp01(safety.exposure), safety,
      `${safety.attackedRingCount} of the squares around the enemy king are covered`);
  }

  for (const trapped of trappedPieces(fenAfter, enemy)) {
    add(MOTIFS.TRAPPED_PIECE, trapped.severity, trapped,
      `the ${trapped.name} on ${trapped.square} is trapped`);
  }

  for (const overload of overloadedDefenders(fenAfter, enemy)) {
    add(MOTIFS.OVERLOAD, overload.severity * 0.6, overload,
      `the ${overload.defender.name} on ${overload.defender.square} now has two jobs`);
  }

  return motifs.filter(keepMotif).sort((a, b) => b.significance - a.significance);
}

/** Always-interesting motifs survive a zero significance score; the rest do not. */
const ALWAYS_REPORT = new Set([
  MOTIFS.MATE, MOTIFS.CHECK, MOTIFS.DOUBLE_CHECK, MOTIFS.DISCOVERED_CHECK,
  MOTIFS.PROMOTION, MOTIFS.UNDERPROMOTION
]);
function keepMotif(motif) {
  return ALWAYS_REPORT.has(motif.type) || motif.significance >= 0.02;
}

/**
 * Motifs standing in the position, independent of how it was reached.
 * Used by puzzles, hints and the debug panel.
 */
export function detectPositionMotifs(fen) {
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const motifs = [];
  const add = (type, significance, detail, summary) =>
    motifs.push({ type, label: MOTIF_LABEL[type], significance: clamp01(significance), detail, summary });

  for (const side of ['w', 'b']) {
    const enemy = otherColour(side);
    for (const pin of pinsAndSkewers(fen, side)) {
      add(pin.type === 'PIN' ? MOTIFS.PIN : MOTIFS.SKEWER,
        pin.absolute ? 0.7 : 0.5, { ...pin, against: side },
        pin.type === 'PIN'
          ? `${PIECE_NAME[pin.pinned.type]} on ${pin.pinned.square} is pinned`
          : `${PIECE_NAME[pin.front.type]} on ${pin.front.square} is skewered`);
    }
    for (const over of overloadedDefenders(fen, side)) {
      add(MOTIFS.OVERLOAD, over.severity * 0.6, { ...over, against: side },
        `${over.defender.name} on ${over.defender.square} is overloaded`);
    }
    for (const hanging of hangingPieces(fen, side)) {
      add(MOTIFS.THREAT, hanging.severity, { ...hanging, against: side },
        `${hanging.name} on ${hanging.square} is hanging`);
    }
    const back = findBackRank(fen, enemy, side);
    if (back) add(MOTIFS.BACK_RANK, back.severity, { ...back, against: side },
      `${side === 'w' ? 'White' : 'Black'} has a back-rank weakness`);
  }

  // Forks available to whoever is to move.
  for (const move of legalMoves(fen)) {
    const fork = evaluateForkMove(fen, move, turn, 2);
    if (fork && fork.materialGain >= 200) {
      add(fork.type === 'FORK' ? MOTIFS.FORK : MOTIFS.DOUBLE_ATTACK,
        clamp01((fork.materialGain / 900) * (1 - fork.counterplayRisk)), fork,
        `${fork.san} forks the ${fork.targetA} and the ${fork.targetB}`);
    }
  }

  return dedupe(motifs).sort((a, b) => b.significance - a.significance);
}

/* ------------------------------------------------------------ detectors */

function materialOffered(fenBefore, fenAfter, move, side, enemy) {
  const mover = at(fenBefore).get(move.from);
  if (!mover || mover.type === KING) return 0;
  const captured = move.captured ? PIECE_VALUE[move.captured] : 0;
  const recapture = see(fenAfter, move.to, enemy);
  return Math.max(0, recapture - captured);
}

function describeMaterial(cp) {
  if (cp >= 850) return 'a queen';
  if (cp >= 450) return 'a rook';
  if (cp >= 280) return 'a piece';
  if (cp >= 150) return 'the exchange';
  return 'a pawn';
}

/**
 * A friendly slider that was blocked by the moving piece and now hits
 * something valuable through the vacated square.
 */
function findDiscoveredAttack(fenBefore, fenAfter, move, side, enemy) {
  const before = at(fenBefore);
  const after = at(fenAfter);
  for (const dir of RAYS.q) {
    // Look backwards from the vacated square for a friendly slider.
    const behind = piecesAlongRay(after, move.from, dir)[0];
    if (!behind || behind.color !== side || !isSlider(behind.type)) continue;
    if (!RAYS[behind.type].some(([f, r]) => f === -dir[0] && r === -dir[1])) continue;
    // And forwards for the newly exposed target.
    const ahead = piecesAlongRay(after, move.from, [-dir[0], -dir[1]])[0];
    if (!ahead || ahead.color !== enemy) continue;
    if (ahead.type === KING) continue;   // that is a DISCOVERED_CHECK, reported above
    if (before.attackers(ahead.square, side).includes(behind.square)) continue;   // not new
    if (!after.attackers(ahead.square, side).includes(behind.square)) continue;
    if (ahead.square === move.to) continue;
    return {
      attackerSquare: behind.square, attackerName: PIECE_NAME[behind.type],
      targetSquare: ahead.square, targetName: PIECE_NAME[ahead.type],
      targetValue: PIECE_VALUE[ahead.type], vacated: move.from
    };
  }
  return null;
}

/** The move captured a piece whose only job was defending something else. */
function findRemovedDefender(fenBefore, fenAfter, move, side, enemy) {
  if (!move.captured) return null;
  const before = at(fenBefore);
  const guarded = [];
  for (const row of before.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy || cell.square === move.to) continue;
      if (cell.type === KING) continue;   // a king is never "defended"
      if (before.attackers(cell.square, enemy).includes(move.to)) guarded.push(cell);
    }
  }
  for (const target of guarded) {
    const stillDefended = at(fenAfter).attackers(target.square, enemy).length > 0;
    const attacked = at(fenAfter).attackers(target.square, side).length > 0;
    if (!stillDefended && attacked) {
      return {
        defenderName: PIECE_NAME[move.captured], defenderSquare: move.to,
        exposedSquare: target.square, exposedName: PIECE_NAME[target.type],
        exposedValue: PIECE_VALUE[target.type]
      };
    }
  }
  return null;
}

/**
 * The move attacks a defender so forcefully that it must move, abandoning what
 * it was guarding. Distinguished from removing-the-defender: the defender is
 * still on the board.
 */
function findDeflection(fenBefore, fenAfter, move, side, enemy) {
  const after = at(fenAfter);
  const defenders = [];
  for (const row of after.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy) continue;
      if (!after.attackers(cell.square, side).includes(move.to)) continue;
      // Attacking it must actually threaten it.
      if (see(fenAfter, cell.square, side) <= 0 && cell.type !== KING) continue;
      defenders.push(cell);
    }
  }
  for (const defender of defenders) {
    for (const row of after.board()) {
      for (const cell of row) {
        if (!cell || cell.color !== enemy || cell.square === defender.square) continue;
        if (cell.type === KING) continue;   // a king is never "defended"
        const guards = after.attackers(cell.square, enemy);
        if (guards.length !== 1 || guards[0] !== defender.square) continue;
        if (!after.attackers(cell.square, side).length) continue;
        return {
          defenderName: PIECE_NAME[defender.type], defenderSquare: defender.square,
          exposedSquare: cell.square, exposedName: PIECE_NAME[cell.type],
          exposedValue: PIECE_VALUE[cell.type]
        };
      }
    }
  }
  return null;
}

/**
 * A sacrifice that lures an enemy piece (usually the king) onto a square where
 * a concrete follow-up exists. Verified by playing the forced recapture and
 * looking for a check or a fork.
 */
function findAttraction(fenBefore, fenAfter, move, side, enemy, offered) {
  if (offered < 150) return null;
  const after = at(fenAfter);
  const recaptures = legalMoves(fenAfter).filter((m) => m.to === move.to);
  if (!recaptures.length || recaptures.length > 2) return null;
  for (const recapture of recaptures) {
    const board = at(fenAfter);
    try { board.move({ from: recapture.from, to: recapture.to, promotion: recapture.promotion }); } catch { continue; }
    const next = board.fen();
    const source = next.split(' ')[1] === side ? next : passTurn(next);
    if (!source) continue;
    for (const follow of legalMoves(source)) {
      const inner = at(source);
      try { inner.move({ from: follow.from, to: follow.to, promotion: follow.promotion }); } catch { continue; }
      if (inner.isCheckmate()) {
        return { luredName: PIECE_NAME[recapture.piece], square: move.to, followUpSan: follow.san, kind: 'mate' };
      }
      const fork = evaluateForkMove(source, follow, side, 2);
      if (fork && fork.materialGain >= offered) {
        return { luredName: PIECE_NAME[recapture.piece], square: move.to, followUpSan: follow.san, kind: 'fork' };
      }
    }
  }
  return null;
}

/**
 * Clearance: the move vacated a square a friendly LINE piece genuinely wants.
 *
 * The bar is deliberately high. "Some piece could legally move there" is true
 * on nearly every move and is not a tactic; the arriving piece has to be a
 * slider that gains real scope, and the square has to be safe for it.
 */
function findClearance(fenBefore, fenAfter, move, side) {
  const source = passTurn(fenAfter);
  if (!source) return null;
  const candidates = legalMoves(source)
    .filter((m) => m.to === move.from && m.from !== move.to)
    .filter((m) => isSlider(m.piece));
  if (!candidates.length) return null;

  for (const candidate of candidates.sort((a, b) => PIECE_VALUE[b.piece] - PIECE_VALUE[a.piece])) {
    const board = at(source);
    try { board.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion }); } catch { continue; }
    const landed = board.fen();
    if (see(landed, move.from, otherColour(side)) > 0) continue;      // it would just hang
    const scopeBefore = legalMoves(source).filter((m) => m.from === candidate.from).length;
    const scopeAfter = legalMoves(passTurn(landed) || landed).filter((m) => m.from === move.from).length;
    if (scopeAfter - scopeBefore < 5) continue;                        // no real gain
    return {
      square: move.from, beneficiary: candidate.from,
      beneficiaryName: PIECE_NAME[candidate.piece], san: candidate.san,
      scopeGain: scopeAfter - scopeBefore
    };
  }
  return null;
}

/**
 * The move plants a piece between an enemy slider and something it defends,
 * cutting the defence.
 */
function findInterference(fenBefore, fenAfter, move, side, enemy) {
  const before = at(fenBefore);
  const after = at(fenAfter);
  for (const row of before.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy || !isSlider(cell.type)) continue;
      const dir = directionBetween(cell.square, move.to);
      if (!dir || !RAYS[cell.type].some(([f, r]) => f === dir[0] && r === dir[1])) continue;
      // Anything this slider used to defend that lies beyond the new blocker.
      const beyond = piecesAlongRay(after, move.to, dir)[0];
      if (!beyond || beyond.color !== enemy || beyond.type === KING) continue;
      if (!before.attackers(beyond.square, enemy).includes(cell.square)) continue;
      if (after.attackers(beyond.square, enemy).includes(cell.square)) continue;
      if (!after.attackers(beyond.square, side).length) continue;
      return {
        blockedSquare: cell.square, blockedName: PIECE_NAME[cell.type],
        protectedSquare: beyond.square, protectedName: PIECE_NAME[beyond.type],
        cutValue: PIECE_VALUE[beyond.type], blockerSquare: move.to
      };
    }
  }
  return null;
}

/**
 * An in-between move: the opponent's last move invited a recapture and this
 * move does something more forcing instead.
 */
function isZwischenzug(fenBefore, move, previousMove, boardAfter) {
  if (!previousMove || !previousMove.captured) return false;
  if (move.to === previousMove.to) return false;
  const recaptureAvailable = legalMoves(fenBefore).some((m) => m.to === previousMove.to && m.captured);
  if (!recaptureAvailable) return false;
  return boardAfter.inCheck() || !!move.captured;
}

/**
 * Back-rank weakness: the enemy king is boxed in on its home rank AND `side`
 * has a heavy piece that can actually get there.
 *
 * The second half matters. Almost every castled king with an untouched pawn
 * shield has "no escape squares"; that is a normal, safe position, not a
 * tactic. Only a rook or queen bearing on the back rank makes it one.
 */
function findBackRank(fen, side, enemy) {
  const board = at(fen);
  const kingSq = board.findPiece({ type: KING, color: enemy })[0];
  if (!kingSq) return null;
  const homeRank = enemy === 'w' ? 0 : 7;
  if (rankIndex(kingSq) !== homeRank) return null;

  const forward = enemy === 'w' ? 1 : -1;
  const escapes = [-1, 0, 1]
    .map((df) => squareAt(fileIndex(kingSq) + df, homeRank + forward))
    .filter(Boolean)
    .filter((sq) => {
      const piece = board.get(sq);
      return !(piece && piece.color === enemy);
    })
    .filter((sq) => !board.isAttacked(sq, side));
  if (escapes.length > 0) return null;

  // Which of OUR heavy pieces already bear on a square of that back rank?
  const heavy = new Set();
  for (let f = 0; f < 8; f += 1) {
    const sq = squareAt(f, homeRank);
    const occupant = board.get(sq);
    if (occupant && occupant.color === side) continue;
    for (const from of board.attackers(sq, side)) {
      const piece = board.get(from);
      if (piece && (piece.type === ROOK || piece.type === QUEEN)) heavy.add(from);
    }
  }
  if (!heavy.size) return null;

  const onTheRank = [...heavy].filter((sq) => rankIndex(sq) === homeRank);
  return {
    kingSquare: kingSq,
    escapeSquares: 0,
    heavyPieces: [...heavy],
    severity: onTheRank.length ? 0.85 : 0.5
  };
}

/* --------------------------------------------------------------- engine */

/**
 * Confirm that a detected motif matters, using engine numbers the caller has
 * already fetched. Detection stays deterministic; this only adjusts confidence
 * and marks a motif as refuted when the engine says the tactic does not work.
 *
 * @param {Motif[]} motifs
 * @param {{ bestScoreCp:number, motifScoreCp:number }} evidence  mover's POV
 */
export function verifyMotifs(motifs, { bestScoreCp = 0, motifScoreCp = 0 } = {}) {
  const drop = bestScoreCp - motifScoreCp;
  return motifs.map((motif) => {
    const refuted = drop > 150 && motif.significance > 0.3;
    return {
      ...motif,
      engineVerified: true,
      refuted,
      significance: refuted ? motif.significance * 0.35 : Math.min(1, motif.significance * 1.1)
    };
  });
}

/* -------------------------------------------------------------- helpers */

function pinKey(pin) {
  return `${pin.type}|${pin.attacker.square}|${pin.type === 'PIN' ? pin.pinned.square : pin.front.square}|${pin.behind.square}`;
}
function keySet(pins) { return new Set(pins.map(pinKey)); }

function dedupe(motifs) {
  const seen = new Set();
  const out = [];
  for (const motif of motifs) {
    const key = `${motif.type}|${motif.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(motif);
  }
  return out;
}

export default { detectMoveMotifs, detectPositionMotifs, verifyMotifs, MOTIFS, MOTIF_LABEL };
