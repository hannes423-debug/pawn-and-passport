/**
 * templates.js — ExplanationTemplateDatabase.
 *
 * Templates are the only place player-facing chess prose exists. Everything
 * else in the reasoning pipeline produces data. A template is a string with
 * {VARIABLE} slots plus the fact type it consumes, so the pipeline can pick
 * one, fill it and be sure every word is backed by a measurement.
 *
 * Keeping them here also means the whole game can be translated, re-voiced
 * per coach, or handed to an optional LLM for rephrasing, without touching a
 * single line of analysis code.
 */

import { FACT } from './facts.js';

/**
 * @typedef {Object} Template
 * @property {string} id
 * @property {string} fact         the FACT type it renders
 * @property {number} minLevel     lowest explanation level it may appear at
 * @property {string[]} forms      interchangeable phrasings; slots in {BRACES}
 * @property {string} [clause]     short connective form used inside a sentence
 */

/** {MOVE} {PIECE} {TARGET} {TARGET_PIECE} {THREAT} {AMOUNT} {A} {B} {COLOUR} {OPPONENT} */
export const TEMPLATES = Object.freeze([
  /* ---------------------------------------------------------- tactics */
  {
    id: 'fork', fact: FACT.FORKS, minLevel: 2,
    forms: [
      '{MOVE} forks the {A} and the {B}',
      '{MOVE} attacks the {A} and the {B} at the same time',
      'the {PIECE} on {TARGET} hits both the {A} and the {B}'
    ],
    clause: 'creates a fork against the {A} and the {B}'
  },
  {
    id: 'fork-with-cause', fact: FACT.FORKS, minLevel: 4,
    forms: ['{MOVE} forks the {A} and the {B}; {OPPONENT}’s only real resource is {DEFENCE}'],
    clause: 'forks the {A} and the {B}, and {OPPONENT} has one defensive resource: {DEFENCE}'
  },
  {
    id: 'pin', fact: FACT.PINS, minLevel: 2,
    forms: [
      '{MOVE} pins the {TARGET_PIECE} on {TARGET}',
      'the {TARGET_PIECE} on {TARGET} cannot move without exposing the {BEHIND}'
    ],
    clause: 'pins the {TARGET_PIECE} on {TARGET} against the {BEHIND}'
  },
  {
    id: 'skewer', fact: FACT.SKEWERS, minLevel: 2,
    forms: ['{MOVE} skewers the {TARGET_PIECE} on {TARGET}; when it moves the {BEHIND} behind it falls'],
    clause: 'skewers the {TARGET_PIECE} to the {BEHIND} behind it'
  },
  {
    id: 'discovered-attack', fact: FACT.ATTACKS, minLevel: 2,
    forms: ['moving the {PIECE} uncovers an attack on {TARGET}'],
    clause: 'uncovers an attack on {TARGET}'
  },
  {
    id: 'sacrifice', fact: FACT.SACRIFICES, minLevel: 2,
    forms: [
      '{MOVE} gives up material to open lines and create threats',
      '{MOVE} offers the {PIECE} for the initiative'
    ],
    clause: 'sacrifices the {PIECE} on {TARGET}'
  },
  {
    id: 'wins-material', fact: FACT.WINS_MATERIAL, minLevel: 1,
    forms: ['{MOVE} wins material on {TARGET}', '{MOVE} picks up the {CAPTURED}'],
    clause: 'wins material on {TARGET}'
  },
  {
    id: 'loses-material', fact: FACT.LOSES_MATERIAL, minLevel: 1,
    forms: ['{MOVE} drops material on {TARGET}'],
    clause: 'loses material on {TARGET}'
  },
  {
    id: 'hanging', fact: FACT.HANGS_PIECE, minLevel: 1,
    forms: [
      'the {PIECE} on {TARGET} is left undefended',
      '{MOVE} leaves the {PIECE} on {TARGET} hanging'
    ],
    clause: 'leaves the {PIECE} on {TARGET} undefended'
  },
  {
    id: 'removing-defender', fact: FACT.WINS_MATERIAL, minLevel: 3,
    forms: ['{MOVE} takes away the defender of {TARGET}'],
    clause: 'removes the defender of {TARGET}'
  },
  // NOTE: there is deliberately no 'deflection' template bound to ALLOWS.
  // Deflection is a MOTIF, carried on the move's motif list; ALLOWS is the fact
  // "this move handed the opponent a threat". Binding the two together made the
  // engine describe a move that allowed mate in one as "deflects a defender",
  // because pick() prefers the most specific template and this one ignored the
  // {THREAT} slot entirely.
  {
    id: 'zwischenzug', fact: FACT.GAINS_TEMPO, minLevel: 3,
    forms: ['{MOVE} inserts a forcing move before recapturing'],
    clause: 'inserts a forcing in-between move'
  },
  {
    id: 'mate-threat', fact: FACT.CREATES_MATE_THREAT, minLevel: 1,
    forms: ['{MOVE} builds a mating attack against the king on {TARGET}'],
    clause: 'builds a mating attack'
  },
  {
    id: 'mate', fact: FACT.DELIVERS_MATE, minLevel: 1,
    forms: ['{MOVE} is checkmate'],
    clause: 'is checkmate'
  },
  {
    id: 'check', fact: FACT.GIVES_CHECK, minLevel: 2,
    forms: ['{MOVE} gives check'],
    clause: 'gives check'
  },

  /* -------------------------------------------------------- protection */
  {
    id: 'defends', fact: FACT.DEFENDS, minLevel: 2,
    forms: [
      '{MOVE} protects the {TARGET_PIECE} on {TARGET}',
      'the {PIECE} covers {TARGET}'
    ],
    clause: 'protects the {TARGET_PIECE} on {TARGET}'
  },
  {
    id: 'prevents', fact: FACT.PREVENTS, minLevel: 2,
    forms: [
      '{MOVE} stops {THREAT}',
      '{MOVE} takes {THREAT} away from {OPPONENT}'
    ],
    clause: 'prevents {THREAT}'
  },
  {
    // Only for a queen infiltration — otherwise the generic 'prevents {THREAT}'
    // reads better ("prevents Bxe4", not "prevents Black's bishop entering on e4").
    id: 'prevents-queen-entry', fact: FACT.PREVENTS, minLevel: 3,
    when: (fact) => fact.threatPiece === 'queen' && !!fact.target && !String(fact.target).includes('/'),
    forms: ['{MOVE} keeps {OPPONENT}’s {THREAT_PIECE} out of {TARGET}'],
    clause: 'prevents {OPPONENT}’s {THREAT_PIECE} from entering on {TARGET}'
  },
  {
    id: 'allows', fact: FACT.ALLOWS, minLevel: 1,
    forms: [
      '{MOVE} allows {THREAT}',
      'after {MOVE}, {OPPONENT} gets {THREAT}'
    ],
    clause: 'allows {THREAT}'
  },
  {
    // A mate threat deserves saying out loud rather than being folded into the
    // generic "allows".
    id: 'allows-mate', fact: FACT.ALLOWS, minLevel: 2,
    when: (fact) => typeof fact.threat === 'string' && fact.threat.includes('#'),
    forms: ['{MOVE} allows {THREAT}, which is mate'],
    clause: 'allows {THREAT}, which is mate'
  },
  {
    id: 'prophylaxis', fact: FACT.PROPHYLAXIS, minLevel: 3,
    forms: ['{MOVE} deals with {OPPONENT}’s idea before improving anything of its own'],
    clause: 'stops the opponent’s plan before starting its own'
  },

  /* ------------------------------------------------------- positional */
  {
    id: 'activity', fact: FACT.IMPROVES_ACTIVITY, minLevel: 2,
    forms: ['{MOVE} activates the {PIECE}', 'the {PIECE} gets a much better square on {TARGET}'],
    clause: 'activates the {PIECE}'
  },
  {
    id: 'develops', fact: FACT.DEVELOPS, minLevel: 2,
    forms: ['{MOVE} develops the {PIECE}'],
    clause: 'develops the {PIECE}'
  },
  {
    id: 'castles', fact: FACT.CASTLES, minLevel: 2,
    forms: ['castling gets the king to safety and connects the rooks'],
    clause: 'brings the king to safety'
  },
  {
    id: 'centre', fact: FACT.CONTROLS_CENTRE, minLevel: 2,
    forms: ['{MOVE} takes more control of the centre'],
    clause: 'gains central control'
  },
  {
    id: 'king-weakening', fact: FACT.WEAKENS_KING, minLevel: 1,
    forms: [
      '{MOVE} loosens the squares around the king',
      '{MOVE} weakens the shelter in front of the king on {TARGET}'
    ],
    clause: 'weakens the squares around the king'
  },
  {
    id: 'king-shelter', fact: FACT.SHELTERS_KING, minLevel: 2,
    forms: ['{MOVE} improves the king’s shelter'],
    clause: 'improves king safety'
  },
  {
    id: 'trade', fact: FACT.TRADES, minLevel: 2,
    forms: ['{MOVE} trades a pair of pieces'],
    clause: 'exchanges a pair of pieces'
  },
  {
    id: 'simplify', fact: FACT.SIMPLIFIES, minLevel: 2,
    forms: ['{MOVE} simplifies toward an easier position'],
    clause: 'simplifies the position'
  },
  {
    id: 'promotion', fact: FACT.PROMOTES, minLevel: 1,
    forms: ['the pawn promotes on {TARGET}'],
    clause: 'promotes the pawn on {TARGET}'
  },
  {
    id: 'passed-pawn', fact: FACT.ADVANCES_PASSED_PAWN, minLevel: 2,
    forms: ['{MOVE} pushes the passed pawn closer to promotion'],
    clause: 'advances the passed pawn'
  },
  {
    id: 'tempo', fact: FACT.GAINS_TEMPO, minLevel: 2,
    forms: ['{MOVE} gains a tempo'],
    clause: 'gains a tempo'
  },
  {
    id: 'eval-up', fact: FACT.EVALUATION_IMPROVES, minLevel: 1,
    forms: ['the evaluation improves by {PAWNS}'],
    clause: 'improves the evaluation'
  },
  {
    id: 'eval-down', fact: FACT.EVALUATION_WORSENS, minLevel: 1,
    forms: ['the evaluation drops by {PAWNS}'],
    clause: 'costs {PAWNS}'
  }
]);

/** Sentence frames the engine assembles clauses into. */
export const FRAMES = Object.freeze({
  BETTER_MOVE: '{BETTER} would have been stronger because it {CLAUSES}.',
  BETTER_MOVE_SHORT: '{BETTER} was stronger here.',
  PLAYED_COST: '{MOVE} {CLAUSES}.',
  PLAYED_GOOD: '{MOVE} {CLAUSES}.',
  BEST_MOVE: '{MOVE} is the best move here: it {CLAUSES}.',
  THREAT_WARNING: '{OPPONENT} is threatening {THREAT}.',
  VAGUE_THREAT: 'Your move allowed a tactical threat.',
  VAGUE_OPPORTUNITY: 'There may be a tactical opportunity here.',
  NO_COMMENT: ''
});

const byFact = new Map();
for (const template of TEMPLATES) {
  if (!byFact.has(template.fact)) byFact.set(template.fact, []);
  byFact.get(template.fact).push(template);
}

/**
 * The template database. `pick` is deterministic given the same seed, so a
 * regression test can assert on exact prose while the game still varies its
 * phrasing between games.
 */
export const ExplanationTemplateDatabase = {
  all() { return TEMPLATES; },

  /**
   * Every template that can render `factType` at `level`.
   * A template may carry a `when(fact)` guard, so a specific phrasing only
   * fires on the facts it actually reads well for.
   */
  forFact(factType, level = 3, fact = null) {
    return (byFact.get(factType) || [])
      .filter((t) => t.minLevel <= level)
      .filter((t) => !t.when || (fact && t.when(fact)));
  },

  byId(id) { return TEMPLATES.find((t) => t.id === id) || null; },

  /** Pick one template for a fact: the most specific one the level allows. */
  pick(factType, level = 3, fact = null) {
    const options = this.forFact(factType, level, fact);
    if (!options.length) return null;
    return options.reduce((a, b) => (b.minLevel > a.minLevel ? b : a));
  },

  /**
   * Render one fact as a CLAUSE ('protects the pawn on e4').
   * @returns {string|null} null when nothing can be said about this fact
   */
  clause(fact, level = 3, context = {}) {
    const template = this.pick(fact.type, level, fact);
    if (!template || !template.clause) return null;
    return fill(template.clause, fact, context);
  },

  /** Render one fact as a standalone SENTENCE. */
  sentence(fact, level = 3, context = {}) {
    const template = this.pick(fact.type, level, fact);
    if (!template) return null;
    return capitalise(fill(template.forms[0], fact, context)) + '.';
  },

  frame(name, values) { return fill(FRAMES[name] || name, {}, values); }
};

/** Substitute {SLOTS} from the fact and the surrounding context. */
export function fill(template, fact = {}, context = {}) {
  const values = {
    MOVE: context.move || fact.san || context.san || 'the move',
    BETTER: context.better || '',
    PIECE: fact.piece || context.piece || 'piece',
    TARGET: fact.target || context.target || '',
    TARGET_PIECE: fact.targetPiece || fact.captured || 'piece',
    CAPTURED: fact.captured || 'material',
    BEHIND: fact.behind || 'piece behind it',
    THREAT: fact.threat || context.threat || 'the threat',
    THREAT_PIECE: fact.threatPiece || 'queen',
    A: fact.targetA || 'first target',
    B: fact.targetB || 'second target',
    DEFENCE: fact.defence || context.defence || 'a defensive move',
    AMOUNT: fact.amount !== undefined ? String(fact.amount) : '',
    PAWNS: fact.amount !== undefined ? (Math.abs(fact.amount) / 100).toFixed(2) : '',
    COLOUR: context.colour || 'You',
    OPPONENT: context.opponent || 'your opponent',
    CLAUSES: context.clauses || ''
  };
  return template.replace(/\{([A-Z_]+)\}/g, (whole, key) =>
    (values[key] !== undefined && values[key] !== null ? String(values[key]) : whole));
}

export function capitalise(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export default ExplanationTemplateDatabase;
