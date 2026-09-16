/**
 * moveRecord.js — the structured record of one played move.
 *
 * This is the unit every later system consumes: analysis attaches an
 * evaluation to it, the classifier attaches a verdict, the explanation engine
 * attaches facts, the result screen counts them, and the Python pre-baking
 * tools read and write the same JSON shape.
 *
 * Nothing here is renderer-aware. A 3D board would produce identical records.
 */

/**
 * @typedef {Object} MoveRecordJSON
 * @property {number} ply             1-based half-move counter
 * @property {number} moveNumber      full-move number as printed in PGN
 * @property {'w'|'b'} color
 * @property {string} from
 * @property {string} to
 * @property {string} san
 * @property {string} uci
 * @property {string} piece           piece type that moved
 * @property {string} fenBefore
 * @property {string} fenAfter
 * @property {string|null} capturedPiece
 * @property {string|null} promotion
 * @property {boolean} check
 * @property {boolean} checkmate
 * @property {number} timestamp       epoch ms the move was committed
 * @property {number} thinkMs         time this move consumed on the clock
 * @property {{w:number|null,b:number|null}} clockBefore
 * @property {{w:number|null,b:number|null}} clockAfter
 *
 * Filled in later by the analysis layer (all optional):
 * @property {?Object} engineEvaluation   { cp, mate, depth, nodes } from the mover's POV
 * @property {?string} bestMove           UCI of the engine's first choice
 * @property {?string} bestMoveSan
 * @property {?number} evaluationDelta    centipawns lost versus bestMove (>= 0)
 * @property {?string} mistakeClassification
 * @property {?Array} tacticalMotifs
 * @property {?Object} explanation        { level, text, facts }
 */

export class MoveRecord {
  constructor(fields = {}) {
    // --- always present, written when the move is made -------------------
    this.ply = fields.ply ?? 0;
    this.moveNumber = fields.moveNumber ?? Math.ceil((this.ply || 1) / 2);
    this.color = fields.color ?? 'w';
    this.from = fields.from ?? null;
    this.to = fields.to ?? null;
    this.san = fields.san ?? null;
    this.uci = fields.uci ?? (this.from && this.to ? this.from + this.to + (fields.promotion || '') : null);
    this.piece = fields.piece ?? null;
    this.fenBefore = fields.fenBefore ?? null;
    this.fenAfter = fields.fenAfter ?? null;
    this.capturedPiece = fields.capturedPiece ?? null;
    this.promotion = fields.promotion ?? null;
    this.check = !!fields.check;
    this.checkmate = !!fields.checkmate;
    this.castle = fields.castle ?? null;          // 'k' | 'q' | null
    this.enPassant = !!fields.enPassant;
    this.timestamp = fields.timestamp ?? Date.now();
    this.thinkMs = fields.thinkMs ?? 0;
    this.clockBefore = fields.clockBefore ?? { w: null, b: null };
    this.clockAfter = fields.clockAfter ?? { w: null, b: null };

    // --- attached later by analysis; null until then ----------------------
    this.engineEvaluation = fields.engineEvaluation ?? null;
    this.bestMove = fields.bestMove ?? null;
    this.bestMoveSan = fields.bestMoveSan ?? null;
    this.evaluationDelta = fields.evaluationDelta ?? null;
    this.mistakeClassification = fields.mistakeClassification ?? null;
    this.tacticalMotifs = fields.tacticalMotifs ?? null;
    this.threats = fields.threats ?? null;
    this.explanationFacts = fields.explanationFacts ?? null;
    this.explanation = fields.explanation ?? null;
    this.book = fields.book ?? null;              // { name, eco } when in the opening book
  }

  /**
   * Build a record from a chess.js verbose move plus the surrounding context.
   * @param {Object} move chess.js Move
   */
  static fromChessJs(move, {
    ply, fenBefore, fenAfter, check = false, checkmate = false,
    thinkMs = 0, clockBefore, clockAfter, timestamp = Date.now()
  }) {
    const flags = move.flags || '';
    return new MoveRecord({
      ply,
      moveNumber: Math.ceil(ply / 2),
      color: move.color,
      from: move.from,
      to: move.to,
      san: move.san,
      uci: move.from + move.to + (move.promotion || ''),
      piece: move.piece,
      fenBefore,
      fenAfter,
      capturedPiece: move.captured || null,
      promotion: move.promotion || null,
      check, checkmate,
      castle: flags.includes('k') ? 'k' : flags.includes('q') ? 'q' : null,
      enPassant: flags.includes('e'),
      thinkMs, clockBefore, clockAfter, timestamp
    });
  }

  get isCapture() { return !!this.capturedPiece; }
  get isPromotion() { return !!this.promotion; }
  get isCastle() { return !!this.castle; }

  /** '17. Re1' / '17... h6' — the way move lists print it. */
  get numbered() {
    return this.color === 'w' ? `${this.moveNumber}. ${this.san}` : `${this.moveNumber}... ${this.san}`;
  }

  toJSON() { return { ...this }; }
}

export default MoveRecord;
