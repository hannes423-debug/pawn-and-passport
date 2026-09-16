/**
 * facts.js — ChessReasoningFacts.
 *
 * The rule this project is built around: engine output is NEVER turned
 * straight into prose. It is first reduced to structured, checkable facts
 * about the position, and only those facts reach a sentence.
 *
 * That is what makes the explanations trustworthy (every clause traces back to
 * something measured on the board), testable (a fact is an object you can
 * assert on), translatable, and later LLM-ready — an LLM would rewrite these
 * facts, never replace them.
 *
 * Nothing here calls an engine. Engine numbers are passed IN.
 */

import { at, legalMoves, passTurn, sanFor } from '../core/rules.js';
import {
  see, hangingPieces, kingSafety, mobility, pinsAndSkewers, clamp01, pieceList
} from '../analysis/boardAnalysis.js';
import { analyzeThreats } from '../analysis/threatAnalyzer.js';
import { detectMoveMotifs } from '../analysis/motifDetector.js';
import {
  PIECE_NAME, PIECE_VALUE, KING, PAWN, ROOK, QUEEN, KNIGHT, BISHOP,
  otherColour, rankIndex, fileIndex, squareAt, COLOUR_NAME
} from '../core/constants.js';

/** Every fact the game can state. Adding one means adding a template too. */
export const FACT = Object.freeze({
  DEFENDS: 'DEFENDS',
  ATTACKS: 'ATTACKS',
  PREVENTS: 'PREVENTS',
  ALLOWS: 'ALLOWS',
  WINS_MATERIAL: 'WINS_MATERIAL',
  LOSES_MATERIAL: 'LOSES_MATERIAL',
  HANGS_PIECE: 'HANGS_PIECE',
  GIVES_CHECK: 'GIVES_CHECK',
  DELIVERS_MATE: 'DELIVERS_MATE',
  CREATES_MATE_THREAT: 'CREATES_MATE_THREAT',
  FORKS: 'FORKS',
  PINS: 'PINS',
  SKEWERS: 'SKEWERS',
  IMPROVES_ACTIVITY: 'IMPROVES_ACTIVITY',
  DEVELOPS: 'DEVELOPS',
  CASTLES: 'CASTLES',
  CONTROLS_CENTRE: 'CONTROLS_CENTRE',
  WEAKENS_KING: 'WEAKENS_KING',
  SHELTERS_KING: 'SHELTERS_KING',
  OPENS_FILE: 'OPENS_FILE',
  TRADES: 'TRADES',
  SIMPLIFIES: 'SIMPLIFIES',
  PROMOTES: 'PROMOTES',
  ADVANCES_PASSED_PAWN: 'ADVANCES_PASSED_PAWN',
  BLOCKS: 'BLOCKS',
  SACRIFICES: 'SACRIFICES',
  GAINS_TEMPO: 'GAINS_TEMPO',
  PROPHYLAXIS: 'PROPHYLAXIS',
  EVALUATION_IMPROVES: 'EVALUATION_IMPROVES',
  EVALUATION_WORSENS: 'EVALUATION_WORSENS'
});

const CENTRE = ['d4', 'e4', 'd5', 'e5'];

/**
 * @typedef {Object} ChessFact
 * @property {string} type      one of FACT
 * @property {string} [piece]   piece name doing it
 * @property {string} [from]
 * @property {string} [target]  square or piece being acted on
 * @property {string} [threat]  SAN of a threat prevented/allowed
 * @property {number} [amount]  centipawns, where relevant
 * @property {number} weight    0..1 — how much this fact should shape the sentence
 */

/**
 * Facts about ONE candidate move in a position.
 *
 * @param {Object} input
 * @param {string} input.fenBefore
 * @param {string} input.uci                the move to describe
 * @param {Object} [input.engineBefore]     { score, bestMove } for fenBefore
 * @param {Object} [input.engineAfter]      { score } for the position after `uci`
 * @param {Object} [input.previousMove]
 * @returns {{ move:string, san:string, uci:string, evaluationDelta:number|null,
 *             motifs:Array, facts:ChessFact[] }}
 */
export function factsForMove({ fenBefore, uci, engineBefore = null, engineAfter = null, previousMove = null }) {
  const move = legalMoves(fenBefore).find((m) => m.from + m.to + (m.promotion || '') === uci);
  if (!move) return { move: null, san: null, uci, evaluationDelta: null, motifs: [], facts: [] };

  const boardBefore = at(fenBefore);
  const side = move.color;
  const enemy = otherColour(side);
  const boardAfter = at(fenBefore);
  boardAfter.move({ from: move.from, to: move.to, promotion: move.promotion });
  const fenAfter = boardAfter.fen();

  const facts = [];
  const push = (type, weight, payload) => facts.push({ type, weight: clamp01(weight), ...payload });

  const motifs = detectMoveMotifs(fenBefore, move, { previousMove });

  /* ------------------------------------------------------- forcing moves */

  if (boardAfter.isCheckmate()) {
    push(FACT.DELIVERS_MATE, 1, { piece: PIECE_NAME[move.piece], target: move.to, san: move.san });
  } else if (boardAfter.inCheck()) {
    push(FACT.GIVES_CHECK, 0.55, { piece: PIECE_NAME[move.piece], target: move.to });
  }

  /* ---------------------------------------------------- material effects */

  const capturedValue = move.captured ? PIECE_VALUE[move.captured] : 0;
  const recapture = see(fenAfter, move.to, enemy);
  const net = capturedValue - recapture;
  if (net >= 100) {
    push(FACT.WINS_MATERIAL, clamp01(net / 900), {
      piece: PIECE_NAME[move.piece], target: move.to,
      captured: move.captured ? PIECE_NAME[move.captured] : null, amount: net
    });
  } else if (net <= -100 && move.piece !== KING) {
    const isSac = !move.captured || capturedValue < recapture;
    push(isSac ? FACT.SACRIFICES : FACT.LOSES_MATERIAL, clamp01(-net / 900), {
      piece: PIECE_NAME[move.piece], target: move.to, amount: -net
    });
  }
  if (move.captured && capturedValue === PIECE_VALUE[move.piece] && recapture > 0) {
    push(FACT.TRADES, 0.3, { piece: PIECE_NAME[move.piece], target: move.to });
  }
  if (move.promotion) {
    push(FACT.PROMOTES, 0.95, { target: move.to, to: PIECE_NAME[move.promotion] });
  }

  /* ------------------------------------------------- defence & exposure */

  for (const defended of newlyDefended(boardBefore, boardAfter, move, side, enemy)) {
    push(FACT.DEFENDS, clamp01(defended.value / 900 + 0.2), {
      piece: PIECE_NAME[move.piece], target: defended.square,
      targetPiece: defended.name, amount: defended.value
    });
  }

  const hangingBefore = new Set(hangingPieces(fenBefore, side).map((p) => p.square));
  for (const piece of hangingPieces(fenAfter, side)) {
    if (hangingBefore.has(piece.square) && piece.square !== move.to) continue;
    push(FACT.HANGS_PIECE, clamp01(piece.materialAtRisk / 900), {
      piece: piece.name, target: piece.square, amount: piece.materialAtRisk
    });
  }

  /* --------------------------------------------------- threats prevented */

  const threatsBefore = analyzeThreats(fenBefore, enemy, { limit: 6, includeStatic: false });
  const threatsAfter = analyzeThreats(fenAfter, enemy, { limit: 6, includeStatic: false });
  const afterKeys = new Set(threatsAfter.map(threatKey));

  for (const threat of threatsBefore) {
    if (afterKeys.has(threatKey(threat))) continue;
    push(FACT.PREVENTS, clamp01(threat.severity), {
      threat: threat.san || threat.summary,
      threatType: threat.type, target: threat.target,
      threatPiece: threat.piece, summary: threat.summary
    });
  }
  const beforeKeys = new Set(threatsBefore.map(threatKey));
  for (const threat of threatsAfter) {
    if (beforeKeys.has(threatKey(threat))) continue;
    if (threat.severity < 0.25) continue;
    push(FACT.ALLOWS, clamp01(threat.severity), {
      threat: threat.san || threat.summary,
      threatType: threat.type, target: threat.target,
      threatPiece: threat.piece, summary: threat.summary
    });
  }

  /* ---------------------------------------------- tactical motifs -> facts */

  for (const motif of motifs) {
    if (motif.type === 'FORK' || motif.type === 'DOUBLE_ATTACK') {
      push(FACT.FORKS, motif.significance, {
        piece: motif.detail.attacker, target: motif.detail.attackerSquare,
        targetA: motif.detail.targetA, targetB: motif.detail.targetB,
        counterplayRisk: motif.detail.counterplayRisk,
        defence: motif.detail.defences?.[0]?.san || null
      });
    }
    if (motif.type === 'PIN') {
      push(FACT.PINS, motif.significance, {
        piece: motif.detail.attacker?.name, target: motif.detail.pinned?.square,
        targetPiece: motif.detail.pinned?.name, behind: motif.detail.behind?.name
      });
    }
    if (motif.type === 'SKEWER') {
      push(FACT.SKEWERS, motif.significance, {
        piece: motif.detail.attacker?.name, target: motif.detail.front?.square,
        targetPiece: motif.detail.front?.name, behind: motif.detail.behind?.name
      });
    }
    if (motif.type === 'MATING_ATTACK') {
      push(FACT.CREATES_MATE_THREAT, motif.significance, { target: motif.detail.square });
    }
  }

  /* ----------------------------------------------- development & activity */

  const mobilityBefore = pieceMobility(fenBefore, move.from, side);
  const mobilityAfter = pieceMobility(fenAfter, move.to, side);
  if (mobilityAfter - mobilityBefore >= 3 && move.piece !== PAWN) {
    push(FACT.IMPROVES_ACTIVITY, clamp01((mobilityAfter - mobilityBefore) / 10 + 0.2), {
      piece: PIECE_NAME[move.piece], from: move.from, target: move.to,
      amount: mobilityAfter - mobilityBefore
    });
  }

  if (isDevelopingMove(fenBefore, move, side)) {
    push(FACT.DEVELOPS, 0.4, { piece: PIECE_NAME[move.piece], from: move.from, target: move.to });
  }
  if (move.flags?.includes('k') || move.flags?.includes('q')) {
    push(FACT.CASTLES, 0.6, { side: move.flags.includes('k') ? 'kingside' : 'queenside' });
  }

  const centreBefore = centreControl(fenBefore, side);
  const centreAfter = centreControl(fenAfter, side);
  if (centreAfter > centreBefore) {
    push(FACT.CONTROLS_CENTRE, 0.3, { piece: PIECE_NAME[move.piece], amount: centreAfter - centreBefore });
  }

  /* --------------------------------------------------------- king safety */

  const safetyBefore = kingSafety(fenBefore, side);
  const safetyAfter = kingSafety(fenAfter, side);
  if (safetyBefore && safetyAfter) {
    const change = safetyAfter.exposure - safetyBefore.exposure;
    if (change >= 0.12) {
      push(FACT.WEAKENS_KING, clamp01(change * 3), {
        target: safetyAfter.square, amount: Math.round(change * 100),
        attackedSquares: safetyAfter.attackedRingCount
      });
    } else if (change <= -0.12) {
      push(FACT.SHELTERS_KING, clamp01(-change * 3), { target: safetyAfter.square });
    }
  }

  /* ------------------------------------------------------ engine numbers */

  const evaluationDelta = engineDelta(engineBefore, engineAfter);
  if (evaluationDelta !== null) {
    if (evaluationDelta >= 40) push(FACT.EVALUATION_IMPROVES, clamp01(evaluationDelta / 300), { amount: evaluationDelta });
    else if (evaluationDelta <= -40) push(FACT.EVALUATION_WORSENS, clamp01(-evaluationDelta / 300), { amount: -evaluationDelta });
  }

  return {
    move: move.san, san: move.san, uci,
    piece: PIECE_NAME[move.piece], from: move.from, to: move.to,
    colour: side, colourName: COLOUR_NAME[side],
    evaluationDelta,
    motifs,
    facts: facts.sort((a, b) => b.weight - a.weight)
  };
}

/**
 * Compare what was played with what the engine preferred.
 * This is the input the explanation engine actually wants: the interesting
 * sentence is almost always about the DIFFERENCE between two moves.
 */
export function compareMoves({
  fenBefore, playedUci, bestUci,
  enginePlayed = null, engineBest = null, engineBefore = null, previousMove = null
}) {
  const played = factsForMove({
    fenBefore, uci: playedUci, engineBefore, engineAfter: enginePlayed, previousMove
  });
  const better = bestUci && bestUci !== playedUci
    ? factsForMove({ fenBefore, uci: bestUci, engineBefore, engineAfter: engineBest })
    : null;

  /** What the better move achieves that the played move does not. */
  const advantages = better
    ? better.facts.filter((fact) => !played.facts.some((p) => sameFact(p, fact)))
    : [];
  /** What the played move gave away that the better move does not. */
  const costs = better
    ? played.facts.filter((fact) =>
        (fact.type === FACT.ALLOWS || fact.type === FACT.HANGS_PIECE ||
         fact.type === FACT.LOSES_MATERIAL || fact.type === FACT.WEAKENS_KING) &&
        !better.facts.some((b) => sameFact(b, fact)))
    : played.facts.filter((fact) => fact.type === FACT.ALLOWS || fact.type === FACT.HANGS_PIECE);

  return { played, better, advantages, costs };
}

/* -------------------------------------------------------------- helpers */

function threatKey(threat) { return `${threat.type}|${threat.target}|${threat.san || ''}`; }

function sameFact(a, b) {
  return a.type === b.type && (a.target || null) === (b.target || null) &&
         (a.threat || null) === (b.threat || null);
}

/** Friendly pieces the moved piece defends now and did not defend before. */
function newlyDefended(boardBefore, boardAfter, move, side, enemy) {
  const out = [];
  for (const row of boardAfter.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== side || cell.square === move.to || cell.type === KING) continue;
      const nowDefends = boardAfter.attackers(cell.square, side).includes(move.to);
      if (!nowDefends) continue;
      const didDefend = boardBefore.attackers(cell.square, side).includes(move.from);
      if (didDefend) continue;
      // Only worth saying when the piece is actually under fire.
      if (!boardAfter.attackers(cell.square, enemy).length) continue;
      out.push({ square: cell.square, name: PIECE_NAME[cell.type], value: PIECE_VALUE[cell.type] });
    }
  }
  return out;
}

function pieceMobility(fen, square, side) {
  const source = fen.split(' ')[1] === side ? fen : passTurn(fen);
  if (!source) return 0;
  return legalMoves(source).filter((m) => m.from === square).length;
}

function centreControl(fen, side) {
  const board = at(fen);
  return CENTRE.reduce((sum, sq) => sum + board.attackers(sq, side).length, 0);
}

function isDevelopingMove(fen, move, side) {
  if (move.piece === PAWN || move.piece === KING) return false;
  const homeRank = side === 'w' ? 0 : 7;
  if (rankIndex(move.from) !== homeRank) return false;
  return rankIndex(move.to) !== homeRank;
}

/** Centipawn change from the mover's point of view. */
function engineDelta(before, after) {
  const toCp = (score) => {
    if (!score) return null;
    if (typeof score.mate === 'number' && score.mate !== null) return score.mate > 0 ? 3000 : -3000;
    return typeof score.cp === 'number' ? score.cp : null;
  };
  const a = toCp(before?.score || before);
  // After the move it is the OPPONENT to move, so the engine's score flips sign.
  const b = toCp(after?.score || after);
  if (a === null || b === null) return null;
  return Math.round(-b - a);
}

export default { factsForMove, compareMoves, FACT };
