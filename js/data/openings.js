/**
 * openings.js - the six club openings.
 *
 * Deliberately small: a handful of main lines per opening, written as SAN from
 * the starting position and validated by tests/data.test.js (every move legal).
 * Lines contain BOTH sides' moves, so a club opponent can steer toward its
 * opening whichever colour it has: as the opening side it plays the line, as
 * the other side it plays the moves that invite it.
 *
 * Three are played as White and three as Black, which is also how the journal
 * shelves them (WHITE 1-3, BLACK 1-3).
 *
 * `lineNames[i]` names `lines[i]`. Line 0 is the MAIN line: a suggestion on it
 * is described by the opening alone, and variation names only appear once the
 * game has left it (see ClubBook.describe).
 *
 * House spelling follows Chess: World Tour: "Defence".
 */

export const OPENINGS = Object.freeze([
  {
    id: 'italian', name: 'Italian Game', side: 'w', eco: 'C50', shelf: 1,
    description: 'Knights out, bishop to c4, eyes on f7. The first opening most players ever love.',
    idea: 'Develop fast, castle, and aim everything at the weak f7 square.',
    reachedAt: 5,
    lineNames: ['Giuoco Piano: main line with c3 and d4', 'Giuoco Pianissimo: the slow d3 build-up', 'Two Knights Defence: quiet 4.d3'],
    lines: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+', 'Bd2', 'Bxd2+', 'Nbxd2'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'O-O', 'd6', 'c3', 'O-O', 'Re1', 'a6'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Be7', 'O-O', 'O-O', 'Re1', 'd6', 'c3']
    ]
  },
  {
    id: 'london', name: 'London System', side: 'w', eco: 'D02', shelf: 2,
    description: 'The same calm setup against almost anything: d4, Bf4, e3, and a pyramid of pawns.',
    idea: 'Build the setup first, fight later. Your bishop leaves before the pawn wall closes.',
    reachedAt: 3,
    lineNames: ['Main line against ...d5, ...e6 and ...c5', "Against the King's Indian setup (...g6)", 'The ...c5 and ...Qb6 counterattack'],
    lines: [
      ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6', 'Bg3', 'O-O', 'Bd3'],
      ['d4', 'Nf6', 'Bf4', 'g6', 'e3', 'Bg7', 'Nf3', 'O-O', 'Be2', 'd6', 'h3', 'Nbd7', 'O-O'],
      ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'c5', 'e3', 'Nc6', 'c3', 'Qb6', 'Qb3', 'c4', 'Qc2']
    ]
  },
  {
    id: 'vienna', name: 'Vienna Game', side: 'w', eco: 'C25', shelf: 3,
    description: 'The knight comes to c3 before f3, keeping the f-pawn free to march.',
    idea: 'Knight to c3, then choose: a slow Bc4 build-up, or f4 and a fight in the centre.',
    reachedAt: 3,
    lineNames: ['Vienna Gambit: 3.f4 d5', '2...Nc6 with 3.Bc4', '2...Nf6 with 3.Bc4 Bc5'],
    lines: [
      ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4', 'Nf3', 'Be7', 'd4', 'O-O', 'Bd3'],
      ['e4', 'e5', 'Nc3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Bb4', 'Nf3', 'd6', 'O-O', 'Bxc3', 'bxc3'],
      ['e4', 'e5', 'Nc3', 'Nf6', 'Bc4', 'Bc5', 'd3', 'd6', 'Nf3', 'O-O', 'O-O', 'Nc6']
    ]
  },
  {
    id: 'sicilian', name: 'Sicilian Defence', side: 'b', eco: 'B20', shelf: 1,
    description: 'Answer 1.e4 with c5 and fight for the centre from the side. Sharp, lopsided, alive.',
    idea: 'Trade your c-pawn for White\'s d-pawn and use the half-open c-file.',
    reachedAt: 2,
    lineNames: ['Najdorf: 6.Be2 e5', 'Accelerated Dragon', 'Alapin Variation (2.c3)', 'Closed Sicilian (2.Nc3 and g3)'],
    lines: [
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2', 'e5', 'Nb3', 'Be7'],
      ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'g6', 'Nc3', 'Bg7', 'Be3', 'Nf6', 'Bc4', 'O-O'],
      ['e4', 'c5', 'c3', 'Nf6', 'e5', 'Nd5', 'd4', 'cxd4', 'Nf3', 'Nc6', 'cxd4', 'd6'],
      ['e4', 'c5', 'Nc3', 'Nc6', 'g3', 'g6', 'Bg2', 'Bg7', 'd3', 'd6']
    ]
  },
  {
    id: 'caro', name: 'Caro-Kann Defence', side: 'b', eco: 'B12', shelf: 2,
    description: 'c6, then d5. Rock-solid, and the light-squared bishop gets out before e6.',
    idea: 'Challenge the centre with d5 on a pawn that is already protected.',
    reachedAt: 2,
    lineNames: ['Classical Variation (4...Bf5)', 'Advance Variation (3.e5)', 'Exchange Variation (3.exd5)', 'Two Knights Variation (2.Nc3 and Nf3)'],
    lines: [
      ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7'],
      ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5', 'O-O', 'Nc6'],
      ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'Bf4', 'Bg4'],
      ['e4', 'c6', 'Nc3', 'd5', 'Nf3', 'Bg4', 'h3', 'Bxf3', 'Qxf3', 'e6', 'd4', 'Nf6']
    ]
  },
  {
    id: 'french', name: 'French Defence', side: 'b', eco: 'C00', shelf: 3,
    description: 'e6 and d5: a patient wall in front of the king, and a counter-punch with c5.',
    idea: 'Let White overextend, then hit the pawn chain at its base with c5.',
    reachedAt: 2,
    lineNames: ['Classical Variation (4.Bg5)', 'Advance Variation (3.e5)', 'Exchange Variation (3.exd5)', 'Tarrasch Variation (3.Nd2)'],
    lines: [
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e5', 'Nfd7', 'Bxe7', 'Qxe7', 'f4', 'O-O'],
      ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Qb6', 'a3', 'c4'],
      ['e4', 'e6', 'd4', 'd5', 'exd5', 'exd5', 'Nf3', 'Nf6', 'Bd3', 'Bd6', 'O-O', 'O-O'],
      ['e4', 'e6', 'd4', 'd5', 'Nd2', 'Nf6', 'e5', 'Nfd7', 'Bd3', 'c5', 'c3', 'Nc6']
    ]
  }
]);

export const openingById = (id) => OPENINGS.find((o) => o.id === id) || null;

export default OPENINGS;
