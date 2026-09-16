/**
 * explanationEngine.js — structured facts in, English out.
 *
 * The last stage of the reasoning pipeline:
 *
 *   Position -> engine analysis -> move comparison -> motif detection
 *            -> threat detection -> causal analysis -> FACTS
 *            -> template selection -> sentence
 *
 * Deterministic, offline, no LLM. An LLM could later re-voice the SAME facts
 * (see docs/ARCHITECTURE.md § Optional LLM layer) but must never be the source
 * of a chess claim — every clause below is traceable to a measurement.
 *
 * EXPLANATION LEVELS
 *   0  silent
 *   1  "Your move allowed a tactical threat."
 *   2  "Black can now create a fork."
 *   3  "Black can fork your king and rook with Nf7."
 *   4  level 3 + the opponent's best defensive resource and the numbers.
 *
 * The level is chosen by the caller — player skill, coach tier, perk, ability
 * and game mode all feed into it (see js/chess/rpg/).
 */

import { ExplanationTemplateDatabase as DB, FRAMES, fill, capitalise } from './templates.js';
import { compareMoves, factsForMove, FACT } from './facts.js';
import { analyzeThreats } from '../analysis/threatAnalyzer.js';
import { detectForks } from '../analysis/forkDetector.js';
import { COLOUR_NAME, otherColour } from '../core/constants.js';
import { CLASSIFICATIONS, CLASSIFICATION_META } from '../analysis/moveClassifier.js';

export const EXPLANATION_LEVELS = Object.freeze({
  NONE: 0, VAGUE: 1, CATEGORY: 2, CONCRETE: 3, FULL: 4
});

/** Facts that describe something going WRONG for the mover. */
const NEGATIVE_FACTS = new Set([
  FACT.ALLOWS, FACT.HANGS_PIECE, FACT.LOSES_MATERIAL, FACT.WEAKENS_KING, FACT.EVALUATION_WORSENS
]);

/** Facts too generic to lead a sentence when something sharper is available. */
const FILLER_FACTS = new Set([
  FACT.EVALUATION_IMPROVES, FACT.EVALUATION_WORSENS, FACT.CONTROLS_CENTRE, FACT.TRADES
]);

export class ExplanationEngine {
  constructor({ level = EXPLANATION_LEVELS.CONCRETE, maxClauses = 2 } = {}) {
    this.level = level;
    this.maxClauses = maxClauses;
  }

  /**
   * Explain a played move by comparing it with the engine's choice.
   *
   * @param {Object} input
   * @param {string} input.fenBefore
   * @param {string} input.playedUci
   * @param {string} [input.bestUci]
   * @param {Object} [input.enginePlayed]  { score } after the played move
   * @param {Object} [input.engineBest]    { score } after the best move
   * @param {string} [input.classification] from moveClassifier
   * @param {number} [input.level]
   * @returns {{ level:number, text:string, facts:Array, headline:string,
   *             played:Object, better:Object|null }}
   */
  explainMove({
    fenBefore, playedUci, bestUci = null,
    enginePlayed = null, engineBest = null, engineBefore = null,
    classification = null, previousMove = null, level = this.level
  }) {
    if (level <= EXPLANATION_LEVELS.NONE) {
      return { level, text: '', headline: '', facts: [], played: null, better: null };
    }

    const comparison = compareMoves({
      fenBefore, playedUci, bestUci, enginePlayed, engineBest, engineBefore, previousMove
    });
    const { played, better, advantages, costs } = comparison;
    if (!played.san) return { level, text: '', headline: '', facts: [], played: null, better: null };

    const mover = played.colour;
    const context = {
      move: played.san,
      better: better?.san || null,
      colour: COLOUR_NAME[mover],
      opponent: COLOUR_NAME[otherColour(mover)]
    };

    const meta = classification ? CLASSIFICATION_META[classification] : null;
    const headline = meta ? `${meta.label} — ${played.san}` : played.san;

    /* ---- level 1: a category, nothing concrete ------------------------ */
    if (level === EXPLANATION_LEVELS.VAGUE) {
      const text = costs.length
        ? FRAMES.VAGUE_THREAT
        : advantages.length
          ? 'There was something better available.'
          : `${played.san} keeps the position.`;
      return { level, text, headline, facts: [], played, better };
    }

    /* ---- level 2+: real clauses, built from facts ---------------------- */
    const clauses = [];
    const usedFacts = [];

    const source = better && advantages.length ? advantages : played.facts;
    const negatives = costs.filter((fact) => NEGATIVE_FACTS.has(fact.type));

    // A concrete cost outranks anything the better move would have gained:
    // "you hung a rook" is more useful than "the rook would have been active".
    const ordered = [
      ...negatives.sort((a, b) => b.weight - a.weight),
      ...source.filter((f) => !FILLER_FACTS.has(f.type)).sort((a, b) => b.weight - a.weight),
      ...source.filter((f) => FILLER_FACTS.has(f.type)).sort((a, b) => b.weight - a.weight)
    ];

    for (const fact of ordered) {
      if (clauses.length >= this.maxClauses) break;
      // Once something decisive has been said, stop. "allows Qh4#, which is
      // mate and gains central control" is a worse sentence than the first
      // half alone, and the filler actively distracts from the point.
      if (clauses.length && usedFacts[0] && NEGATIVE_FACTS.has(usedFacts[0].type) && usedFacts[0].weight >= 0.9) break;
      if (usedFacts.some((used) => used.type === fact.type && used.target === fact.target)) continue;
      const clause = DB.clause(fact, level, context);
      if (!clause) continue;
      clauses.push(clause);
      usedFacts.push(fact);
    }

    if (!clauses.length) {
      return {
        level, headline, played, better, facts: [],
        text: better ? fill(FRAMES.BETTER_MOVE_SHORT, {}, context) : `${played.san} is playable.`
      };
    }

    const joined = joinClauses(clauses);
    let text;
    if (better && advantages.length && usedFacts.every((f) => !NEGATIVE_FACTS.has(f.type))) {
      text = fill(FRAMES.BETTER_MOVE, {}, { ...context, clauses: joined });
    } else if (classification === CLASSIFICATIONS.BEST || classification === CLASSIFICATIONS.BRILLIANT) {
      text = fill(FRAMES.BEST_MOVE, {}, { ...context, clauses: joined });
    } else {
      // No capitalise() here: the sentence opens with a SAN move, and SAN
      // casing is meaningful ("a3" is a pawn move, "A3" is nothing).
      text = fill(FRAMES.PLAYED_COST, {}, { ...context, clauses: joined });
    }

    return { level, headline, text, facts: usedFacts, played, better };
  }

  /**
   * Explain what the side to move is facing — used by hints and live analysis.
   * Level shapes how much of the tactic is revealed, which is exactly the lever
   * the perk/coach system pulls on.
   */
  explainPosition({ fen, level = this.level, forColour = null }) {
    if (level <= EXPLANATION_LEVELS.NONE) return { level, text: '', facts: [] };

    const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    const side = forColour || turn;
    const enemy = otherColour(side);
    const incoming = analyzeThreats(fen, enemy, { limit: 4 });
    const chances = detectForks(fen, side, { maxDepth: 1, limit: 3 });
    const context = { colour: COLOUR_NAME[side], opponent: COLOUR_NAME[enemy] };

    if (level === EXPLANATION_LEVELS.VAGUE) {
      if (incoming.length && incoming[0].severity >= 0.4) return { level, text: 'There is a threat against you.', facts: incoming.slice(0, 1) };
      if (chances.length) return { level, text: FRAMES.VAGUE_OPPORTUNITY, facts: [] };
      return { level, text: 'The position is quiet.', facts: [] };
    }

    if (level === EXPLANATION_LEVELS.CATEGORY) {
      if (chances.length) {
        return { level, text: `${context.colour} may have a fork available.`, facts: chances.slice(0, 1) };
      }
      if (incoming.length) {
        return { level, text: `${context.opponent} has a ${describeThreatType(incoming[0].type)}.`, facts: incoming.slice(0, 1) };
      }
      return { level, text: 'Nothing tactical stands out.', facts: [] };
    }

    // Level 3 and 4: name the move and the targets.
    if (chances.length) {
      const fork = chances[0];
      let text = `${fork.san} forks the ${fork.targetA} and the ${fork.targetB}.`;
      if (level >= EXPLANATION_LEVELS.FULL) {
        const defence = fork.defences[0];
        text += defence
          ? ` ${context.opponent}'s best defensive resource is ${defence.san}, which ${describeDefence(defence.kind)}.`
          : ' There is no defence — the sequence is forced.';
        text += ` Estimated counterplay risk ${Math.round(fork.counterplayRisk * 100)}%.`;
      }
      return { level, text, facts: chances };
    }

    if (incoming.length) {
      const threat = incoming[0];
      let text = threat.san
        ? `${context.opponent} is threatening ${threat.san} — ${threat.summary}.`
        : capitalise(threat.summary) + '.';
      if (level >= EXPLANATION_LEVELS.FULL && threat.opportunity) {
        text += ` Counterplay risk for them is ${Math.round(threat.opportunity.counterplayRisk * 100)}%.`;
      }
      return { level, text, facts: incoming };
    }

    return { level, text: 'No immediate tactics for either side.', facts: [] };
  }

  /** A short narrative over a finished, analysed game. */
  explainGame(result, { level = this.level } = {}) {
    if (!result || !result.moves?.length) return [];
    const lines = [];
    const moments = result.keyMoments || [];

    if (result.opening?.name) {
      lines.push(`The game opened with the ${result.opening.name}${result.opening.eco ? ` (${result.opening.eco})` : ''}.`);
    }

    if (!moments.length) {
      lines.push('Neither side made a decisive error — the evaluation stayed close to level throughout.');
    } else {
      const first = moments[0];
      // A mate score is mapped onto a large finite centipawn value so deltas
      // stay comparable, which makes it nonsense to print as "pawns" — a
      // missed mate would read as a 29-pawn swing. Say what actually happened.
      const swing = first.delta >= 1500
        ? 'the position became decisive'
        : `the evaluation swung by ${(first.delta / 100).toFixed(1)} pawns`;
      lines.push(
        `The game was roughly balanced until move ${first.moveNumber}, when ` +
        `${COLOUR_NAME[first.color]} played ${first.san} and ${swing}.`
      );
      if (level >= EXPLANATION_LEVELS.CONCRETE && first.explanation) lines.push(first.explanation);
      const recovery = moments.slice(1).find((m) => m.color !== first.color);
      if (recovery) {
        lines.push(
          `${COLOUR_NAME[recovery.color]} let some of it back on move ${recovery.moveNumber} with ${recovery.san}.`
        );
      }
    }

    const themes = [...new Set((result.tacticalEvents || []).map((event) => event.label || event.type))];
    if (themes.length) lines.push(`Recurring themes: ${themes.slice(0, 4).join(', ').toLowerCase()}.`);

    for (const side of ['w', 'b']) {
      const accuracy = result.accuracy?.[side];
      if (accuracy === null || accuracy === undefined) continue;
      const counts = result.counts?.[side];
      lines.push(
        `${COLOUR_NAME[side]}: ${accuracy}% accuracy` +
        (counts ? `, ${counts.BLUNDER || 0} blunder${counts.BLUNDER === 1 ? '' : 's'} and ${counts.MISTAKE || 0} mistake${counts.MISTAKE === 1 ? '' : 's'}.` : '.')
      );
    }
    return lines;
  }
}

/* --------------------------------------------------------------- helpers */

function joinClauses(clauses) {
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;
}

function describeThreatType(type) {
  return {
    MATE_THREAT: 'mating threat',
    MATERIAL_THREAT: 'way to win material',
    HANGING_PIECE: 'piece to pick up',
    FORK_THREAT: 'fork available',
    PIN: 'pin',
    SKEWER: 'skewer',
    OVERLOADED_DEFENDER: 'overloaded defender to exploit',
    PROMOTION_THREAT: 'promotion threat',
    PAWN_THREAT: 'dangerous passed pawn',
    KING_SAFETY: 'attack building against the king',
    TRAPPED_PIECE: 'trapped piece to win'
  }[type] || 'tactical idea';
}

function describeDefence(kind) {
  return {
    CAPTURES_ATTACKER: 'simply takes the attacking piece',
    COUNTER_CHECK: 'gives check first',
    COUNTER_CAPTURE: 'grabs material back',
    MOVES_TARGET: 'moves the threatened piece to safety',
    DEFENDS_TARGET: 'adds a defender'
  }[kind] || 'holds the position';
}

export const explanationEngine = new ExplanationEngine();
export default ExplanationEngine;
