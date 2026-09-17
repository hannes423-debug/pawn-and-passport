/**
 * tools/puzzle-seeds.mjs - the hand-composed positions behind the six casual
 * missions. Original study positions, plus a few famous public-domain opening
 * traps written as MOVE LISTS (never hand-typed FENs, so they cannot be
 * mis-typed into an illegal position).
 *
 * Each seed names the solution the composer INTENDED. tools/verify-puzzles.mjs
 * then asks Stockfish whether that is really the only winning line, trims the
 * line where it stops being unique, and writes js/data/puzzles.js. A seed that
 * fails is reported and left out; it never ships with a wrong answer.
 *
 *   fen | moves   the starting position
 *   line          intended SAN, player and replies alternating
 */

export const PUZZLE_SEEDS = [
  /* ---------------------------------------------- NYC: forks (Central Park) */
  { mission: 'nyc', id: 'nyc-1', title: 'Royal fork', fen: '2r3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1',
    line: ['Ne7+'], hint: 'A knight check can hit two things at once.' },
  { mission: 'nyc', id: 'nyc-2', title: 'Family fork', fen: '4k3/1q3ppp/8/8/2N5/8/5PPP/6K1 w - - 0 1',
    line: ['Nd6+'], hint: 'Find the square that checks the king and eyes the queen.' },
  { mission: 'nyc', id: 'nyc-3', title: 'Check, then fork', fen: '6k1/r4p1p/6p1/8/8/8/5PPP/3Q2K1 w - - 0 1',
    line: ['Qd8+', 'Kg7', 'Qd4+'], hint: 'Drive the king to a square where the queen can hit it and the rook together.' },
  { mission: 'nyc', id: 'nyc-4', title: 'The pawn fork', fen: '8/p4k2/8/2n1b3/8/3PK3/P7/7R w - - 0 1',
    line: ['d4'], hint: 'The humblest piece can attack two at once.' },

  /* ---------------------------- London: back rank (Covent Garden courtyard) */
  { mission: 'lon', id: 'lon-1', title: 'The open file', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
    line: ['Rd8#'], hint: 'The king has no air.' },
  { mission: 'lon', id: 'lon-2', title: 'Doubled rooks', fen: '1r4k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1',
    line: ['Rd8+', 'Rxd8', 'Rxd8#'], hint: 'Two rooks on one file: the second one finishes the job.' },
  { mission: 'lon', id: 'lon-3', title: 'Queen for the win', fen: 'r5k1/5ppp/8/8/8/8/1Q3PPP/1R4K1 w - - 0 1',
    line: ['Qb8+', 'Rxb8', 'Rxb8#'], hint: 'Offer the queen where the rook must take it.' },
  { mission: 'lon', id: 'lon-4', title: 'Deflection', fen: '5rk1/6pp/3N4/8/8/8/5QPP/4R1K1 w - - 0 1',
    line: ['Qxf8+', 'Kxf8', 'Re8#'], hint: 'Remove the only defender of the back rank.' },

  /* -------------------------------------- Vienna: opening traps (the cafe) */
  { mission: 'vie', id: 'vie-1', title: "Scholar's mate", moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'],
    line: ['Qxf7#'], hint: 'f7 is only defended by the king.' },
  { mission: 'vie', id: 'vie-2', title: "Legal's mate", moves: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1'],
    line: ['Bxf7+', 'Ke7', 'Nd5#'], hint: 'Forget the queen. Where is the black king going to live?' },
  { mission: 'vie', id: 'vie-3', title: "The fool's mate", moves: ['f3', 'e5', 'g4'],
    line: ['Qh4#'], hint: 'White has opened the diagonal to their own king.' },
  { mission: 'vie', id: 'vie-4', title: 'The Petrov trap', moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'Nxe4', 'Qe2', 'Nf6'],
    line: ['Nc6+'], hint: 'Move the knight off the e-file with tempo.' },

  /* --------------------------- Istanbul: pins, skewers, discovered attacks */
  { mission: 'ist', id: 'ist-1', title: 'Pin the queen', fen: '4k3/p7/8/4q3/8/8/P4K1P/R7 w - - 0 1',
    line: ['Re1'], hint: 'Line up the rook, the queen and the king.' },
  { mission: 'ist', id: 'ist-2', title: 'Skewer', fen: '6q1/8/4k3/8/8/8/P7/1K3B2 w - - 0 1',
    line: ['Bc4+', 'Kd6', 'Bxg8'], hint: 'Check the king, and look at what stands behind it.' },
  { mission: 'ist', id: 'ist-3', title: 'Double check', fen: '2q1k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1',
    line: ['Nd6+'], hint: 'Two checks at once cannot be blocked.' },
  { mission: 'ist', id: 'ist-4', title: 'Discovered check', fen: '4k3/8/3q4/8/4N3/8/5PPP/4R1K1 w - - 0 1',
    line: ['Nxd6+'], hint: 'Move the knight and the rook behind it gives check.' },

  /* ---------------------------------- Chennai: endgame technique (Marina) */
  { mission: 'che', id: 'che-1', title: 'Take the opposition', fen: '4k3/8/3K4/4P3/8/8/8/8 w - - 0 1',
    line: ['Ke6'], hint: 'Kings face each other. The one NOT to move wins the standoff.' },
  { mission: 'che', id: 'che-2', title: 'Breakthrough', fen: '8/ppp5/8/PPP5/8/8/5k2/7K w - - 0 1',
    line: ['b6'], hint: 'Give up one pawn so another can run.' },
  { mission: 'che', id: 'che-3', title: 'Queen and king', fen: 'k7/8/1K6/8/8/8/8/2Q5 w - - 0 1',
    line: ['Qc8#'], hint: 'The king does the fencing; the queen closes the gate.' },
  { mission: 'che', id: 'che-4', title: 'Rook on the seventh', fen: '4k3/R7/4K3/8/8/8/8/8 w - - 0 1',
    line: ['Ra8#'], hint: 'The kings are in opposition. One rook move ends it.' },

  /* ------------------------ Wenzhou: sacrifices and mating patterns (river) */
  { mission: 'wen', id: 'wen-1', title: 'Smothered', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
    line: ['Nf7#'], hint: 'The king is walled in by its own pieces.' },
  { mission: 'wen', id: 'wen-2', title: "Philidor's legacy", fen: '4r2k/6pp/7N/3Q4/8/8/8/6K1 w - - 0 1',
    line: ['Qg8+', 'Rxg8', 'Nf7#'], hint: 'Put the queen where the rook has to take it.' },
  { mission: 'wen', id: 'wen-3', title: 'Arabian mate', fen: '7k/7p/5N2/8/8/8/8/6RK w - - 0 1',
    line: ['Rg8#'], hint: 'The oldest mate there is: rook and knight in the corner.' },
  { mission: 'wen', id: 'wen-4', title: 'Pawn-supported queen', fen: '6k1/5p1p/5PpQ/8/8/8/8/6K1 w - - 0 1',
    line: ['Qg7#'], hint: 'The f6 pawn is the queen\'s bodyguard.' }
];

export default PUZZLE_SEEDS;
