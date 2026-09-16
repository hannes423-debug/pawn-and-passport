/**
 * openings.js - the six club openings.
 *
 * WHAT IS IN HERE, AND WHY. The lines follow what strong players actually
 * choose today, measured, not remembered: tools/opening-research/ counted
 * every standard game from the Lichess broadcast database, September 2024 to
 * August 2026, where BOTH players were rated 2200+ (135,928 games; report.md
 * there has the full frequency tree). Line 0 of each opening is the branch
 * those games chose most; the rest are the other branches that a large share
 * of them chose. Where the database thins out deep in a line, the moves follow
 * established theory, cross-checked against opening references.
 *
 * Lines are SAN from the starting position and contain BOTH sides' moves, so
 * a club opponent can steer toward its opening whichever colour it has.
 * tests/run.js replays every line (every move must be legal).
 *
 * Three are played as White and three as Black, which is also how the journal
 * shelves them (WHITE 1-3, BLACK 1-3).
 *
 *   lineNames[i]   names lines[i]. Line 0 is the MAIN line: a suggestion on it is
 *                  described by the opening alone, and variation names only
 *                  appear once the game has left it (see ClubBook.describe).
 *   lineIntro[i]   one or two sentences shown before the first move of a line
 *   lineNotes[i]   { plyIndex: text } shown after lines[i][plyIndex] is played
 *   tutorial       the introduction the practice-room tutorial opens with
 *
 * House spelling follows Chess: World Tour: "Defence".
 */

export const OPENINGS = Object.freeze([
  /* ============================================================ ITALIAN == */
  {
    id: 'italian', name: 'Italian Game', side: 'w', eco: 'C50', shelf: 1,
    description: 'Knights out, bishop to c4, eyes on f7. The first opening most players ever love, and still a grandmaster favourite.',
    idea: 'Develop fast, castle, build slowly with c3 and d3, and only then break with d4 or push on the kingside.',
    reachedAt: 5,
    tutorial: [
      'The Italian Game starts 1.e4 e5 2.Nf3 Nc6 3.Bc4. The bishop aims at f7, the one square only Black\'s king defends.',
      'Modern Italian play is not a quick attack. White builds a small, flexible centre with c3 and d3, castles, brings the queen\'s knight round to g3, and chooses the moment for d4. Black usually mirrors the setup.',
      'Against 3...Bc5 and against 3...Nf6 the ideas are the same, so learn the plans, not just the moves.'
    ],
    lineNames: [
      'Giuoco Pianissimo: 4.c3 Nf6 5.d3 d6 6.O-O a5',
      'Giuoco Pianissimo: 6...a6 and the bishop to a7',
      'Giuoco Pianissimo: the early pin 6.Bg5',
      'Giuoco Piano: 5.d4 exd4 6.e5',
      'Giuoco Piano: 6.cxd4 Bb4+ 7.Nbd2',
      'Giuoco Piano: 7.Bd2, the classical exchange',
      'Two Knights: 4.d3 Be7 with a4',
      'Two Knights: 4.d3 Be7 5.O-O O-O 6.Nc3',
      'Two Knights: 4.d3 h6, the slow waiting move',
      'Two Knights: 4.d3 Bc5 5.Nc3 and Na4',
      'Two Knights: 4.Ng5, the sharp old attack'
    ],
    lineIntro: [
      'The most played Italian among strong players today. Both sides build slowly; the fight comes later.',
      'Black spends a tempo on ...a6 so the bishop can drop back to a7, safe from a d4 push.',
      'White pins the f6 knight before castling. Black asks the question with ...h6 at once.',
      'The open Giuoco Piano: White strikes in the centre at once and Black hits back with ...d5.',
      'White takes back with the pawn and meets the check with the knight, keeping pieces on.',
      'The old main line: bishops come off and the centre opens early.',
      'Against 3...Nf6, 4.d3 is by far the most common reply. With ...Be7 Black keeps things compact.',
      'White develops the knight to c3 instead of playing c3: a quicker, more direct setup.',
      'Black keeps White\'s pieces off g5 and decides later where the bishop goes.',
      'White answers ...Bc5 with Nc3 and hunts the bishop with Na4.',
      'About one game in ten after 3...Nf6 at master level, and everywhere in club chess: White attacks f7 at once.'
    ],
    lines: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'a5', 'Re1', 'O-O', 'h3', 'h6', 'Nbd2', 'Be6'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'a6', 'a4', 'Ba7', 'Re1', 'O-O', 'h3', 'h6', 'Nbd2', 'Re8'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'Bg5', 'h6', 'Bh4', 'a6', 'Nbd2', 'Ba7', 'O-O', 'O-O'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'e5', 'd5', 'Bb5', 'Ne4', 'cxd4', 'Bb6', 'Nc3', 'O-O', 'Be3', 'Bg4', 'h3', 'Bh5'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+', 'Nbd2', 'd5', 'exd5', 'Nxd5', 'O-O', 'O-O', 'a3'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+', 'Bd2', 'Bxd2+', 'Nbxd2', 'd5', 'exd5', 'Nxd5', 'Qb3', 'Na5', 'Qa4+', 'Nc6'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Be7', 'O-O', 'O-O', 'Re1', 'd6', 'a4', 'Na5', 'Ba2', 'c5', 'c3', 'Nc6', 'Na3', 'h6'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Be7', 'O-O', 'O-O', 'Nc3', 'd6', 'a4', 'Bg4', 'h3', 'Bxf3', 'Qxf3', 'Nd4', 'Qd1', 'c6', 'Ba2', 'Ne6'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'h6', 'O-O', 'd6', 'a4', 'g6', 'Nc3', 'Bg7', 'h3', 'O-O', 'Be3'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'Nc3', 'd6', 'Na4', 'Bb6', 'a3', 'O-O', 'O-O', 'h6'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Na5', 'Bb5+', 'c6', 'dxc6', 'bxc6', 'Bd3', 'Nd5', 'Nf3', 'Bd6', 'O-O', 'O-O']
    ],
    lineNotes: [
      {
        2: 'The knight attacks e5 and gets ready to castle.',
        4: 'The Italian bishop: it points at f7 and controls d5.',
        5: 'Black copies the idea with the bishop to c5, also looking at f2.',
        6: 'c3 prepares d4 one day and gives the bishop a retreat square on c2 later.',
        8: 'The modern d3: no early fight in the centre. White keeps e4 solid and develops everything first.',
        11: '...a5 grabs space on the queenside and makes a b4 push from White harder.',
        12: 'The rook supports e4 and prepares Nbd2-f1-g3, the typical knight route in the Italian.',
        14: 'h3 takes g4 away from Black\'s bishop and knight.',
        16: 'The knight starts its trip: d2, f1, then g3 or e3.',
        17: '...Be6 offers to swap White\'s best bishop. Both sides now manoeuvre; the plan to remember is Nf1-g3 and a later d4.'
      },
      { 11: '...a6 gives the c5 bishop the a7 square.', 12: 'a4 stops ...b5 and gains queenside space.', 13: 'On a7 the bishop keeps its diagonal and cannot be hit by d4 or b4.', 19: 'Black overprotects e5 and prepares ...Be6.' },
      { 10: 'The pin annoys the f6 knight before White has castled.', 11: '...h6 asks at once: keep the pin or give up the bishop.', 12: 'White keeps the pin. Black must be careful about ...g5 weakening the king.', 15: 'Another bishop to a7, out of reach of d4.' },
      { 8: 'The open Italian: d4 at once.', 10: 'White gains space with tempo, hitting the f6 knight.', 11: '...d5 is the right counter: open lines while White\'s king is still in the centre.', 13: 'The knight jumps into e4, a strong outpost.', 16: 'White develops and hits the e4 knight. Black castles and keeps the piece active.' },
      { 11: 'The check forces White to block.', 12: 'Blocking with the knight keeps more pieces on the board than Bd2.', 13: '...d5 frees Black\'s game.', 18: 'a3 asks the bishop to decide. Chances are balanced.' },
      { 12: 'The classical block with the bishop.', 14: 'After the swap White has a big centre but it can become a target.', 15: '...d5! breaks the centre before White is ready.', 18: 'The queen hits d5 and b7 together.', 19: '...Na5 hits the queen back. Black is fine.' },
      { 6: 'Against the Two Knights, 4.d3 is the modern choice: calm and solid.', 7: '...Be7 keeps the bishop safe from d4 tricks.', 12: 'a4 gives the c4 bishop the a2 square and gains space.', 13: '...Na5 chases the bishop.', 14: 'On a2 the bishop keeps looking at f7.', 15: '...c5 grabs the d4 square.' },
      { 10: 'Nc3 develops quickly and aims at d5.', 13: 'The pin on the f3 knight.', 17: 'The knight lands on d4, the hole in White\'s camp.', 21: 'Black has a solid, harmonious position.' },
      { 7: '...h6 stops Ng5 and Bg5 before Black commits the bishop.', 11: 'Black switches to a fianchetto with ...g6 and ...Bg7.', 16: 'Both sides are fully developed. It is a slow game.' },
      { 8: 'Nc3 instead of c3: quick development.', 10: 'Na4 hunts the bishop so White can win the bishop pair.', 11: 'The bishop steps back to b6.', 12: 'a3 prepares Nxb6 and keeps the bishop pair option.' },
      { 6: '4.Ng5 attacks f7 twice.', 7: '...d5 is the principled answer: block the bishop.', 9: 'Not ...Nxd5, which walks into the Fried Liver attack (Nxf7). ...Na5 hits the bishop instead.', 13: 'Black has given a pawn for fast development.', 14: 'Bd3 is the modern retreat: strong players chose it four times out of five. The bishop blocks the d-pawn but stays active.', 15: '...Nd5 centralises and prepares ...f5 or ...Nf4.', 17: '...Bd6 protects e5.', 19: 'Both sides castle. White keeps the extra pawn; Black has a big centre and active pieces.' }
    ]
  },

  /* ============================================================= LONDON == */
  {
    id: 'london', name: 'London System', side: 'w', eco: 'D02', shelf: 2,
    description: 'The same calm setup against almost anything: d4, Bf4, e3, and a pyramid of pawns.',
    idea: 'Build the setup first, fight later. The dark bishop leaves before e3 closes it in; then c3, Nbd2, Bd3 and castle.',
    reachedAt: 3,
    tutorial: [
      'The London System is 1.d4 with the bishop to f4 on move two or three, followed by e3, Nf3, c3, Nbd2 and Bd3.',
      'The golden rule: get the bishop out to f4 BEFORE playing e3, or it is locked behind the pawns.',
      'The pawns on c3, d4 and e3 form a solid triangle. Watch out for ...c5 and ...Qb6, which attacks b2 once the bishop has left c1.',
      'The Jobava London puts the knight on c3 instead of d2: sharper, with Nb5 jumps and even a g4 push.'
    ],
    lineNames: [
      'Main line: 1...d5 2.Nf3 Nf6 3.Bf4 c5',
      '...c5 and ...Qb6: the b2 attack',
      '1...d5 with ...e6 and ...Bd6: 5.Ne5',
      "Against the King's Indian setup (...g6)",
      "Against the Queen's Indian setup (...b6)",
      'Jobava London: 2.Nc3 d5 3.Bf4 c5',
      'Jobava London: 3...e6 4.Nb5',
      'Jobava London against ...g6',
      'Early ...c5 and ...Qb6: the pawn grab'
    ],
    lineIntro: [
      'The most common London among 2200+ players: Black meets the setup with ...c5 and ...Nc6.',
      'Black hits b2 with the queen as soon as the bishop has left c1. White answers queen against queen.',
      'Black copies with ...e6 and ...Bd6, offering to swap White\'s London bishop.',
      "Black fianchettoes: the London stays calm and castles quickly.",
      "Black fianchettoes the queen's bishop; White keeps the setup and castles.",
      'The Jobava: the knight to c3 keeps the c-pawn free and prepares Nb5.',
      'White jumps to b5 at once, eyeing c7.',
      'Against ...g6 the Jobava goes h4 and aims for an attack on the fianchetto.',
      'Black grabs the b2 pawn early. White gets fast development and play against the queen.'
    ],
    lines: [
      ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'c5', 'e3', 'Nc6', 'Nbd2', 'e6', 'c3', 'Bd6', 'Bg3', 'O-O', 'Bd3', 'b6', 'Ne5', 'Bb7', 'f4'],
      ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5', 'c3', 'Nc6', 'Nd2', 'Qb6', 'Qb3', 'c4', 'Qc2', 'Bf5', 'Qc1', 'e6', 'Ngf3', 'Be7'],
      ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'Bd6', 'Ne5', 'O-O', 'Nd2', 'c5', 'c3', 'Nc6', 'Bd3'],
      ['d4', 'Nf6', 'Bf4', 'g6', 'e3', 'Bg7', 'Nf3', 'O-O', 'Be2', 'd6', 'h3', 'Nbd7', 'O-O', 'c5', 'c3', 'b6', 'a4', 'Bb7'],
      ['d4', 'Nf6', 'Nf3', 'e6', 'Bf4', 'b6', 'e3', 'Bb7', 'h3', 'Be7', 'Bd3', 'O-O', 'O-O', 'c5', 'c3', 'd6'],
      ['d4', 'Nf6', 'Nc3', 'd5', 'Bf4', 'c5', 'e3', 'cxd4', 'exd4', 'a6', 'Nf3', 'Nc6', 'Bd3', 'Bg4', 'O-O', 'e6'],
      ['d4', 'Nf6', 'Nc3', 'd5', 'Bf4', 'e6', 'Nb5', 'Na6', 'e3', 'c6', 'Nc3', 'Nc7', 'Nf3', 'Bd6'],
      ['d4', 'Nf6', 'Bf4', 'g6', 'Nc3', 'd5', 'e3', 'Bg7', 'h4', 'c5', 'h5', 'Nc6'],
      ['d4', 'Nf6', 'Bf4', 'c5', 'e3', 'Qb6', 'Nc3', 'Qxb2', 'Nb5', 'Na6', 'Rb1', 'Qxa2']
    ],
    lineNotes: [
      { 2: 'The knight comes first here; the bishop follows next move.', 4: 'The London bishop, out before e3.', 5: '...c5: the most common way to challenge the centre.', 6: 'e3 completes the pyramid base.', 8: 'The knight goes to d2, not c3, so the c-pawn can support d4.', 10: 'c3: now d4 is rock solid.', 11: '...Bd6 offers to swap the London bishop.', 12: 'Bg3 keeps the bishop: if Black takes, the h-file opens for White\'s rook.', 14: 'Bd3 aims at h7, the target of every London attack.', 16: 'The knight jumps to e5, a big outpost.', 18: 'f4 builds a Stonewall: e5 is supported and a kingside attack can follow.' },
      { 5: '...c5 before the knight comes out.', 9: '...Qb6 hits b2, which the c1 bishop used to defend.', 10: 'Qb3 offers a queen swap that would ruin Black\'s pawns.', 11: '...c4 kicks the queen and gains queenside space.', 13: 'Black develops with tempo on the queen.', 16: 'White finishes development. Black has space, White a solid centre.' },
      { 5: '...e6: calm and solid.', 7: '...Bd6 challenges f4.', 8: 'Ne5 at once: the knight takes its outpost before Black can stop it. If ...Bxf4 exf4, White gets a grip on e5.', 10: 'Nd2 backs up the knight and can go to f3 later.', 12: 'c3: the pyramid is complete.', 14: 'Bd3 aims at h7: a typical London attacking setup.' },
      { 3: 'The King\'s Indian fianchetto.', 8: 'A modest Be2: against ...g6 the bishop is less useful on d3.', 10: 'h3 gives the f4 bishop an escape square on h2.', 16: 'a4 gains queenside space and stops ...b5.' },
      { 5: 'The Queen\'s Indian setup: the bishop goes to b7.', 8: 'h3 again: the bishop can retreat to h2 if Black plays ...Nh5.', 15: 'Both sides are solid; White usually plays for Nbd2 and e4.' },
      { 2: 'The Jobava London: Nc3 before Bf4.', 5: '...c5 hits the centre at once.', 8: 'exd4 opens the e-file and frees the f1 bishop.', 9: '...a6 stops the Nb5 jump.', 13: 'Black pins the knight. White castles and plays for piece activity.' },
      { 5: '...e6 leaves c7 thin.', 6: 'Nb5 at once, hitting c7.', 7: '...Na6 defends c7.', 11: 'The knight has made its point: Black\'s pieces are a little passive.' },
      { 4: 'The Jobava against the fianchetto.', 8: 'h4: the plan is h5 and opening the h-file.', 10: 'h5 at once: the attack is on.' },
      { 3: 'The early ...c5.', 5: '...Qb6 hits b2.', 6: 'Nc3 lets the pawn go.', 7: 'Black takes: the queen is now far from home.', 8: 'Nb5 threatens Nc7+.', 10: 'Rb1 attacks the queen again. White has strong compensation.' }
    ]
  },

  /* ============================================================= VIENNA == */
  {
    id: 'vienna', name: 'Vienna Game', side: 'w', eco: 'C25', shelf: 3,
    description: 'The knight comes to c3 before f3, keeping the f-pawn free to march.',
    idea: 'Knight to c3, then choose: a slow Bc4 build-up, a g3 fianchetto, or f4 and a fight in the centre.',
    reachedAt: 3,
    tutorial: [
      'The Vienna Game is 1.e4 e5 2.Nc3. The knight defends e4 and, because it is not on f3, the f-pawn can advance to f4.',
      'White has three plans: Bc4 and d3 for a slow Italian-style game, g3 and Bg2 for a quiet fianchetto, or f4 for a sharp gambit.',
      'Strong players today use all three. The most famous trap, the Frankenstein-Dracula, comes after 2...Nf6 3.Bc4 Nxe4 4.Qh5.'
    ],
    lineNames: [
      '2...Nf6 3.Bc4 Nc6 4.d3 Bb4',
      'Frankenstein-Dracula, calm: 5.Bb3 Be7',
      'Frankenstein-Dracula: 5...Nc6 6.Nb5 g6',
      '2...Nf6 3.Bc4 Bc5 4.d3',
      'Vienna Gambit: 3.f4 d5',
      'Mieses: 3.g3 d5',
      'Mieses: 3.g3 Bc5',
      '3.d4 exd4 4.Qxd4 Nc6 5.Qd3',
      '2...Nc6 3.Bc4 Nf6 4.d3 Bb4 5.Ne2',
      '2...Nc6 3.g3 Bc5',
      'Vienna Gambit against 2...Nc6: Hamppe-Allgaier'
    ],
    lineIntro: [
      'The quiet Vienna: an Italian-style game with the knight already on c3.',
      'Black grabs e4, White threatens mate, and Black gives the pawn back for easy development.',
      'The wild main line: Black keeps the extra piece, White wins the rook on a8.',
      'Black puts the bishop on c5 and plays ...c6 and ...d5 to take the centre.',
      'The real Vienna Gambit: White pushes f4 and Black answers in the centre with ...d5.',
      'White fianchettoes the bishop on g2; Black takes the centre with ...d5.',
      'Black develops the bishop actively and castles quickly.',
      'White takes on d4 with the queen and castles long.',
      'Against 2...Nc6 the Bc4 setup leads to a calm game.',
      'A slow fianchetto against 2...Nc6.',
      'A romantic sacrifice that is still seen in club and online chess: the knight takes on f7.'
    ],
    lines: [
      ['e4', 'e5', 'Nc3', 'Nf6', 'Bc4', 'Nc6', 'd3', 'Bb4', 'Nf3', 'd6', 'O-O', 'Bxc3', 'bxc3', 'O-O', 'Bg5', 'h6', 'Bh4'],
      ['e4', 'e5', 'Nc3', 'Nf6', 'Bc4', 'Nxe4', 'Qh5', 'Nd6', 'Bb3', 'Be7', 'Qxe5', 'O-O', 'd4', 'Nc6'],
      ['e4', 'e5', 'Nc3', 'Nf6', 'Bc4', 'Nxe4', 'Qh5', 'Nd6', 'Bb3', 'Nc6', 'Nb5', 'g6', 'Qf3', 'f5', 'Qd5', 'Qe7', 'Nxc7+', 'Kd8', 'Nxa8', 'b6'],
      ['e4', 'e5', 'Nc3', 'Nf6', 'Bc4', 'Bc5', 'd3', 'c6', 'Nf3', 'd5', 'Bb3', 'dxe4', 'Nxe4', 'Nxe4', 'dxe4'],
      ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4', 'Nf3', 'Be7', 'd4', 'O-O', 'Bd3', 'f5', 'exf6', 'Bxf6', 'O-O'],
      ['e4', 'e5', 'Nc3', 'Nf6', 'g3', 'd5', 'exd5', 'Nxd5', 'Bg2', 'Nxc3', 'bxc3', 'Nc6', 'Nf3', 'Bc5', 'O-O', 'O-O'],
      ['e4', 'e5', 'Nc3', 'Nf6', 'g3', 'Bc5', 'Bg2', 'Nc6', 'Nge2', 'd6', 'O-O', 'O-O', 'd3'],
      ['e4', 'e5', 'Nc3', 'Nf6', 'd4', 'exd4', 'Qxd4', 'Nc6', 'Qd3', 'Bb4', 'Bd2', 'O-O', 'O-O-O', 'Re8', 'Nge2', 'd6'],
      ['e4', 'e5', 'Nc3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Bb4', 'Ne2', 'd5', 'exd5', 'Nxd5', 'O-O'],
      ['e4', 'e5', 'Nc3', 'Nc6', 'g3', 'Bc5', 'Bg2', 'd6', 'Nge2', 'Nf6', 'd3', 'O-O', 'O-O'],
      ['e4', 'e5', 'Nc3', 'Nc6', 'f4', 'exf4', 'Nf3', 'g5', 'h4', 'g4', 'Ng5', 'h6', 'Nxf7', 'Kxf7']
    ],
    lineNotes: [
      { 2: 'The Vienna knight: it guards e4 and leaves the f-pawn free.', 4: 'Bc4: the calm, Italian-style Vienna.', 6: 'd3 secures e4 once and for all.', 7: '...Bb4 pins and threatens to double White\'s pawns.', 11: 'Black takes: White gets doubled pawns but the bishop pair and a strong centre.', 14: 'The pin on the f6 knight is White\'s main idea in this structure.' },
      { 5: '...Nxe4 grabs the centre pawn: a fork trick.', 6: 'Qh5 threatens Qxf7 mate!', 7: '...Nd6 is forced: it blocks the bishop and guards f7.', 9: '...Be7 gives the pawn back and develops.', 10: 'White regains the pawn, but the queen will be chased.', 13: 'Black is well developed. Equal.' },
      { 9: '...Nc6 keeps the extra material.', 10: 'Nb5 attacks the d6 knight and eyes c7.', 11: '...g6 stops Qxf7 and Qxe5+ tricks.', 13: '...f5 blocks the queen\'s diagonal.', 16: 'Nxc7+: White forks king and rook.', 18: 'White wins the rook on a8, but the knight is trapped there.', 19: '...b6 traps the knight. Black gets two minor pieces for rook and pawn: a wild, balanced fight.' },
      { 5: '...Bc5 aims at f2.', 7: '...c6 prepares ...d5 to take the centre.', 9: '...d5! Black strikes first.', 14: 'The queens may come off. A calm, equal game.' },
      { 4: 'The Vienna Gambit: f4!', 5: '...d5 is the best answer: counter-attack in the centre.', 6: 'White takes on e5 and gains space.', 7: 'The knight lands on e4, attacking c3.', 12: 'Bd3 hits the e4 knight.', 13: '...f5 supports it.', 14: 'White takes en passant and the f-file opens for both sides.' },
      { 4: 'The Mieses: a quiet fianchetto.', 5: '...d5: take the centre while White fianchettoes.', 8: 'The g2 bishop now bears down the long diagonal.', 10: 'bxc3: doubled pawns, but a half-open b-file and a strong centre.', 15: 'Both castled. The b-file and the g2 bishop give White play.' },
      { 5: '...Bc5: fast development.', 8: 'Nge2 keeps the f-pawn free for f4.', 12: 'A quiet game where White may later push f4.' },
      { 4: 'd4 opens the centre immediately.', 6: 'The queen takes back but will be chased.', 8: 'Qd3: the queen stays central.', 12: 'Opposite-side castling: both sides will attack.' },
      { 4: 'Against 2...Nc6, Bc4 again.', 8: 'Ne2 avoids doubled pawns after ...Bxc3.', 9: '...d5 frees Black.', 12: 'A calm position with chances for both.' },
      { 4: 'The fianchetto again.', 8: 'Nge2 keeps the f4 idea.', 12: 'A slow manoeuvring game.' },
      { 4: 'The Vienna Gambit against 2...Nc6.', 5: 'Black accepts.', 7: '...g5 defends the f4 pawn.', 8: 'h4 undermines the g5 pawn.', 11: '...h6 attacks the knight.', 12: 'Nxf7! The Hamppe-Allgaier sacrifice.', 13: 'White has a piece less but the black king is exposed. Sharp and unclear.' }
    ]
  },

  /* =========================================================== SICILIAN == */
  {
    id: 'sicilian', name: 'Sicilian Defence', side: 'b', eco: 'B20', shelf: 1,
    description: 'Answer 1.e4 with c5 and fight for the centre from the side. Sharp, lopsided, alive: the most played defence in master chess.',
    idea: "Trade your c-pawn for White's d-pawn and use the half-open c-file; learn the main line and the anti-Sicilians White tries to avoid it with.",
    reachedAt: 2,
    tutorial: [
      'The Sicilian is 1.e4 c5. Black does not copy White\'s centre; the c-pawn fights for d4 from the side.',
      'In the Open Sicilian (2.Nf3 and 3.d4) Black swaps the c-pawn for White\'s d-pawn. Black gets an extra central pawn and the half-open c-file; White gets faster development and attacking chances.',
      'Black chooses a system on move two: 2...d6 (Najdorf, Dragon, Classical), 2...Nc6 (Sveshnikov, Accelerated Dragon, Kalashnikov) or 2...e6 (Taimanov, Kan).',
      'Many White players avoid the main lines with 3.Bb5 (Rossolimo and Moscow), 2.c3 (Alapin) or 2.Nc3 (Closed and Grand Prix). You need an answer to those too.'
    ],
    lineNames: [
      'Najdorf: English Attack, 6.Be3 e5 7.Nb3',
      'Najdorf: 6.Be3 e5 7.Nf3',
      'Najdorf: 6.Bg5 e6 7.f4',
      'Najdorf: 6.Be2 e5',
      'Najdorf: 6.h3 e5',
      'Classical: Richter-Rauzer, 6.Bg5 e6',
      'Dragon: Yugoslav Attack',
      'Moscow Variation: 3.Bb5+ Nd7',
      'Moscow Variation: 3.Bb5+ Bd7',
      'Rossolimo: 3.Bb5 g6',
      'Rossolimo: 3.Bb5 e6',
      'Rossolimo: 4.Bxc6 dxc6',
      'Sveshnikov: 9.Bxf6 gxf6 10.Nd5',
      'Sveshnikov: 7.Nd5',
      'Kalashnikov: 4...e5 5.Nb5 d6',
      'Accelerated Dragon: Maroczy Bind',
      'Taimanov: 5...Qc7 6.Be3 a6 7.Qf3',
      'Kan: 4...a6 5.Bd3',
      'Four Knights: 6.Nxc6 bxc6 7.e5',
      'Alapin: 2.c3 Nf6',
      'Alapin: 2.c3 d5',
      'Grand Prix Attack: 2.Nc3 Nc6 3.f4',
      'Closed Sicilian: 2.Nc3 Nc6 3.g3'
    ],
    lineIntro: [
      'The Najdorf is the most played Sicilian by strong players, and 6.Be3 the most common reply: White plans f3, Qd2 and long castling.',
      'The quieter 7.Nf3: White keeps the knight centralised and castles short.',
      'The classical Najdorf with 6.Bg5: White pins and prepares f4.',
      'The positional 6.Be2: White castles short and plays for control of d5.',
      '6.h3 prepares g4: a modern try that is now a main line.',
      'Black develops the knight to c6 instead of ...a6. White pins with Bg5 and castles long.',
      'Black fianchettoes; White castles long and storms the kingside. The sharpest Sicilian of all.',
      'White avoids the Open Sicilian with a check. The most common answer blocks with the knight.',
      'Blocking with the bishop invites swaps and a calmer game.',
      'Against 2...Nc6, 3.Bb5 is as common as 3.d4 at master level. Black fianchettoes.',
      'Black meets the Rossolimo with ...e6 and ...Nge7.',
      'White gives up the bishop at once to double Black\'s pawns.',
      'The Sveshnikov: Black takes a hole on d5 in return for piece activity and the bishop pair.',
      'White jumps into d5 at once for a positional game.',
      'Like the Sveshnikov, but with ...e5 a move earlier.',
      'Black fianchettoes before ...d6; White clamps d5 with c4.',
      'A flexible system: the queen goes to c7 and ...a6 keeps the knight off b5.',
      'Black keeps the knight on b8 and plays ...a6 and ...Bc5.',
      'After Nxc6 and e5 the knight is kicked and Black must play precisely.',
      'The Alapin avoids all the theory above: White builds a centre with c3 and d4.',
      'Black meets the Alapin by hitting the centre with ...d5.',
      'The Grand Prix: an aggressive kingside setup with f4.',
      'The Closed Sicilian: a slow kingside build-up with g3.'
    ],
    lines: [
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be6', 'f3', 'h5', 'Qd2', 'Nbd7'],
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nf3', 'Be7', 'Bc4', 'O-O', 'O-O', 'Be6'],
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Bg5', 'e6', 'f4', 'Be7', 'Qf3', 'Qc7', 'O-O-O', 'Nbd7', 'g4', 'b5'],
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2', 'e5', 'Nb3', 'Be7', 'O-O', 'O-O', 'Be3', 'Be6'],
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e5', 'Nde2', 'h5', 'g3', 'Be7', 'Bg2', 'Be6'],
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'Nc6', 'Bg5', 'e6', 'Qd2', 'a6', 'O-O-O', 'Bd7', 'f4', 'b5'],
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'f3', 'O-O', 'Qd2', 'Nc6', 'Bc4', 'Bd7', 'O-O-O', 'Rc8', 'Bb3', 'Ne5'],
      ['e4', 'c5', 'Nf3', 'd6', 'Bb5+', 'Nd7', 'O-O', 'a6', 'Bd3', 'Ngf6', 'c3', 'b5', 'Bc2', 'Bb7', 'd4', 'e6'],
      ['e4', 'c5', 'Nf3', 'd6', 'Bb5+', 'Bd7', 'Bxd7+', 'Qxd7', 'O-O', 'Nc6', 'c3', 'Nf6', 'Re1', 'e6', 'd4', 'cxd4', 'cxd4', 'd5', 'e5', 'Ne4'],
      ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'g6', 'O-O', 'Bg7', 'Re1', 'e5', 'Bxc6', 'dxc6', 'd3', 'Qc7'],
      ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'e6', 'O-O', 'Nge7', 'Re1', 'a6', 'Bf1', 'd5', 'exd5', 'Nxd5'],
      ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'g6', 'Bxc6', 'dxc6', 'd3', 'Bg7', 'h3', 'Nf6', 'Nc3', 'O-O', 'Be3', 'b6'],
      ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5', 'Ndb5', 'd6', 'Bg5', 'a6', 'Na3', 'b5', 'Bxf6', 'gxf6', 'Nd5', 'f5', 'Bd3', 'Be6', 'O-O', 'Bxd5', 'exd5', 'Ne7'],
      ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5', 'Ndb5', 'd6', 'Nd5', 'Nxd5', 'exd5', 'Ne7', 'c4', 'Ng6', 'Qa4', 'Bd7', 'Qb4', 'Qb8'],
      ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'e5', 'Nb5', 'd6', 'N1c3', 'a6', 'Na3', 'Be6', 'Nc4', 'b5'],
      ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'g6', 'c4', 'Bg7', 'Be3', 'Nf6', 'Nc3', 'O-O', 'Be2', 'd6', 'O-O', 'Bd7'],
      ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6', 'Nc3', 'Qc7', 'Be3', 'a6', 'Qf3', 'Ne5', 'Qg3', 'h5'],
      ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'a6', 'Bd3', 'Bc5', 'Nb3', 'Ba7', 'Qe2', 'Nc6'],
      ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'Nc6', 'Nxc6', 'bxc6', 'e5', 'Nd5', 'Ne4', 'Qc7', 'f4', 'Qb6', 'c4', 'Bb4+', 'Ke2'],
      ['e4', 'c5', 'c3', 'Nf6', 'e5', 'Nd5', 'd4', 'cxd4', 'Nf3', 'Nc6', 'cxd4', 'd6', 'Bc4', 'Nb6', 'Bb5', 'dxe5', 'Nxe5', 'Bd7'],
      ['e4', 'c5', 'c3', 'd5', 'exd5', 'Qxd5', 'd4', 'Nf6', 'Nf3', 'e6', 'Na3'],
      ['e4', 'c5', 'Nc3', 'Nc6', 'f4', 'g6', 'Nf3', 'Bg7', 'Bb5', 'Nd4', 'O-O', 'Nxb5', 'Nxb5', 'd6', 'd3'],
      ['e4', 'c5', 'Nc3', 'Nc6', 'g3', 'g6', 'Bg2', 'Bg7', 'd3', 'd6', 'f4', 'e6', 'Nf3', 'Nge7', 'O-O', 'O-O']
    ],
    lineNotes: [
      { 1: 'The Sicilian: c5 controls d4 without mirroring White.', 4: 'White opens the centre.', 5: 'Black trades a wing pawn for a centre pawn: the basic Sicilian bargain.', 7: '...Nf6 attacks e4, so White must defend it with Nc3.', 9: 'The Najdorf move ...a6: it stops Nb5 and Bb5 and prepares ...e5 or ...b5.', 10: 'The English Attack starts with Be3: next come f3, Qd2 and long castling.', 11: '...e5 kicks the knight and takes central space. d5 becomes the key square.', 12: 'Nb3: the most common retreat.', 13: '...Be6 fights for d5.', 14: 'f3 stops ...Ng4 and supports g4.', 15: '...h5! the modern answer: it stops g4 before White gets the attack going.', 17: 'Black develops. The fight is about d5 and whose attack comes first.' },
      { 12: 'Nf3 keeps the knight near the centre.', 14: 'Bc4 aims at d5 and f7.', 16: 'White castles short: a positional game about the d5 square.' },
      { 10: 'Bg5 pins the f6 knight.', 12: 'f4 prepares e5 or f5.', 14: 'Qf3 and long castling: the classical attacking setup.', 19: '...b5: Black\'s queenside counterattack starts. Sharp!' },
      { 10: 'Be2 is calm: White castles short.', 11: '...e5 again.', 12: 'Nb3 keeps the knight safe.', 17: 'A positional battle for d5.' },
      { 10: 'h3 prepares g4.', 12: 'Nde2 keeps the knight flexible.', 13: '...h5 stops g4 once and for all.', 16: 'The bishop goes to g2 to control d5.' },
      { 9: '...Nc6: the Classical Sicilian.', 10: 'The Richter-Rauzer: Bg5 pins.', 14: 'White castles long.', 17: '...b5: race of attacks on opposite wings.' },
      { 9: 'The Dragon: ...g6 and the bishop on the long diagonal.', 12: 'f3, Qd2, O-O-O: the Yugoslav Attack.', 16: 'Bc4 aims at the black king\'s diagonal.', 19: '...Rc8 prepares an exchange sacrifice on c3.', 21: 'The knight heads for c4. Both kings will be attacked.' },
      { 4: 'The Moscow Variation: a check to avoid the Open Sicilian.', 5: '...Nd7 keeps the bishops on.', 7: '...a6 asks the bishop to decide.', 11: '...b5 gains queenside space.', 15: 'A strategic game; Black is solid.' },
      { 5: 'Blocking with the bishop invites a swap.', 7: 'Black recaptures with the queen.', 17: 'Black strikes with ...d5: the position resembles a French.', 19: 'The knight on e4 is strong.' },
      { 4: 'The Rossolimo: the bishop pins the c6 knight against nothing yet, but threatens to double Black\'s pawns.', 5: '...g6: fianchetto.', 9: '...e5 grabs space.', 10: 'White takes on c6.', 13: 'Black has the bishop pair; White a better pawn structure.' },
      { 5: '...e6 and ...Nge7: Black recaptures on c6 with a knight.', 9: '...a6 forces the bishop to decide.', 11: '...d5 takes the centre.' },
      { 6: 'White gives the bishop at once.', 7: 'Black takes towards the centre with the d-pawn.', 15: 'Black\'s bishops against White\'s structure.' },
      { 9: 'The Sveshnikov: ...e5 kicks the knight.', 10: 'Ndb5 threatens Nd6+.', 11: '...d6 stops it but leaves a hole on d5.', 13: '...a6 chases the knight to a3, where it is offside.', 15: '...b5 stops Nc4.', 17: 'Black accepts doubled pawns for the bishop pair and an open g-file.', 19: '...f5 breaks White\'s centre.', 25: 'The classical Sveshnikov structure: Black plays for ...f5-f4 and the kingside.' },
      { 12: 'Nd5: White trades into a quieter structure.', 15: '...Ne7 heads for g6 or f5.', 21: 'A long strategic game.' },
      { 7: 'The Kalashnikov: ...e5 at once.', 8: 'Nb5 aims at d6.', 13: '...Be6 develops and eyes c4.', 15: '...b5: Black gains space with tempo.' },
      { 7: 'The Accelerated Dragon: ...g6 before ...d6.', 8: 'c4: the Maroczy Bind, clamping d5.', 17: 'Black plays for ...a6 and ...b5 or the ...Nxd4 and ...Bc6 regrouping.' },
      { 5: 'The Taimanov: ...Nc6.', 9: '...Qc7: flexible.', 12: 'Qf3 and long castling: aggressive.', 13: '...Ne5 kicks the queen.', 15: '...h5 stops White\'s g4 ideas.' },
      { 7: 'The Kan: ...a6.', 9: '...Bc5 develops actively.', 11: 'Ba7 keeps the bishop on the diagonal.' },
      { 7: 'The Four Knights Sicilian.', 10: 'Nxc6 and e5: White chases the f6 knight.', 13: '...Nd5 centralises.', 18: 'c4 attacks the d5 knight.', 20: 'A sharp line where both kings are unusual.' },
      { 2: 'The Alapin: c3 prepares d4 with a pawn.', 3: '...Nf6 hits e4 immediately.', 4: 'e5 kicks the knight.', 7: 'Black swaps the c-pawn.', 12: 'Bc4 hits the d5 knight.', 17: 'Black is fully equal.' },
      { 3: '...d5 hits the centre at once.', 5: 'The queen takes back; with the c-pawn on c3, White has no Nc3 to hit it.', 9: '...e6 opens the f8 bishop: every strong player in the sample chose it.', 10: 'Na3!? heads for b5 or c2 and prepares to kick the queen.' },
      { 2: '2.Nc3: White avoids the Open Sicilian.', 4: 'f4: the Grand Prix Attack.', 9: '...Nd4 takes the bishop pair.', 13: 'Black has the bishop pair and a solid position.' },
      { 4: 'g3: the Closed Sicilian.', 10: 'f4: White builds a kingside pawn storm.', 15: 'Black plays on the queenside with ...Rb8 and ...b5.' }
    ]
  },

  /* ========================================================== CARO-KANN == */
  {
    id: 'caro', name: 'Caro-Kann Defence', side: 'b', eco: 'B12', shelf: 2,
    description: 'c6, then d5. Rock-solid, and the light-squared bishop gets out before ...e6.',
    idea: 'Challenge the centre with ...d5 on a pawn that is already protected. Develop the c8 bishop before ...e6, then hit the centre with ...c5.',
    reachedAt: 2,
    tutorial: [
      'The Caro-Kann is 1.e4 c6 2.d4 d5. The c6 pawn supports d5, so Black takes the centre without accepting weaknesses.',
      'Its big advantage over the French: the c8 bishop comes out to f5 or g4 BEFORE Black plays ...e6.',
      'Among strong players the Advance Variation (3.e5) is White\'s most popular try, often with the aggressive 4.h4. You must also know the Classical (3.Nc3 dxe4 4.Nxe4), the Exchange and Panov, and the Two Knights.'
    ],
    lineNames: [
      'Advance: 4.h4 h5 5.Bd3',
      'Advance: 4.h4 h5 5.c4',
      'Advance: Short Variation, 4.Nf3 e6 5.Be2 Nd7',
      'Advance: 4.Nf3 e6 5.Be2 c5',
      'Advance: 4.Nd2 e6 5.Nb3',
      'Advance: Botvinnik-Carls, 3...c5 4.Nf3',
      'Advance: 3...c5 4.dxc5',
      'Classical: 4...Nf6 5.Nxf6+ exf6',
      'Classical: 4...Bf5 5.Ng3 Bg6 6.h4',
      'Exchange: 3.exd5 cxd5 4.Bd3',
      'Panov-Botvinnik Attack: 4.c4',
      'Two Knights: 2.Nf3 d5 3.Nc3 Bg4',
      'Two Knights: 3.d3 dxe4',
      'Fantasy Variation: 3.f3'
    ],
    lineIntro: [
      'The most common Caro-Kann among strong players: 3.e5 Bf5 4.h4, gaining space on the kingside.',
      'White strikes with c4 at once, opening the position.',
      'The quiet Short Variation: White develops and castles, keeping the space advantage.',
      'Black hits the centre with ...c5 at once.',
      'White threatens to trap or harass the f5 bishop.',
      'Black pushes ...c5 at once and keeps the bishop at home.',
      'White takes on c5 and plays for development.',
      'Black takes with the e-pawn for quick development and a safe king.',
      'The old main line: Black\'s bishop is chased to h7 but stays strong.',
      'White swaps on d5 and builds a Carlsbad structure.',
      'The Panov: an isolated queen\'s pawn position with active pieces.',
      'White keeps the d-pawn back and develops knights first.',
      'The quiet 3.d3 aims for a King\'s Indian Attack setup.',
      'f3 supports e4 with a pawn: aggressive but loosening.'
    ],
    lines: [
      ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'Bd3', 'Bxd3', 'Qxd3', 'Qa5+', 'Nd2', 'e6', 'Nf3', 'Nh6', 'O-O', 'Nf5', 'Nb3', 'Qa6', 'Qc3'],
      ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'c4', 'e6', 'Nc3', 'dxc4', 'Bxc4', 'Nd7', 'Nge2', 'Be7', 'g3', 'Nh6'],
      ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'Nd7', 'O-O', 'a5', 'a4', 'f6'],
      ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5', 'Be3', 'cxd4', 'Nxd4', 'Ne7', 'O-O', 'Nbc6'],
      ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nd2', 'e6', 'Nb3', 'Nd7', 'Nf3', 'Ne7', 'Be2', 'h6'],
      ['e4', 'c6', 'd4', 'd5', 'e5', 'c5', 'Nf3', 'cxd4', 'Qxd4', 'Nc6', 'Qf4', 'e6', 'Nc3', 'Nge7', 'Bd3', 'Ng6'],
      ['e4', 'c6', 'd4', 'd5', 'e5', 'c5', 'dxc5', 'e6', 'a3', 'Bxc5', 'Qg4', 'Ne7', 'Nf3', 'Nbc6', 'Bd3'],
      ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Nxf6+', 'exf6', 'c3', 'Bd6', 'Bd3', 'O-O', 'Qc2', 'Re8+', 'Ne2', 'h6'],
      ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7', 'h5', 'Bh7', 'Bd3', 'Bxd3', 'Qxd3', 'e6', 'Bd2', 'Ngf6', 'O-O-O', 'Be7'],
      ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'Bf4', 'Bg4', 'Qb3', 'Qd7', 'Nd2', 'e6', 'Ngf3', 'Bd6', 'Bxd6', 'Qxd6', 'O-O', 'O-O', 'Rfe1'],
      ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'Nc6', 'Nf3', 'Bg4', 'cxd5', 'Nxd5', 'Qb3', 'Bxf3', 'gxf3', 'e6', 'Qxb7', 'Nxd4', 'Bb5+', 'Nxb5', 'Qc6+', 'Ke7', 'Qxb5'],
      ['e4', 'c6', 'Nf3', 'd5', 'Nc3', 'Bg4', 'h3', 'Bxf3', 'Qxf3', 'e6', 'd4', 'Nf6', 'Bd3', 'dxe4', 'Nxe4', 'Qxd4', 'c3', 'Qd8'],
      ['e4', 'c6', 'Nf3', 'd5', 'd3', 'dxe4', 'dxe4', 'Qxd1+', 'Kxd1', 'Nf6', 'Nbd2', 'g6', 'Ne5'],
      ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'a3', 'Bxc3+', 'bxc3', 'dxe4', 'fxe4', 'e5', 'Nf3', 'exd4']
    ],
    lineNotes: [
      { 1: 'The Caro-Kann: c6 prepares ...d5 with support.', 3: '...d5: the centre is challenged on a protected pawn.', 4: 'The Advance: White gains space and blocks the centre.', 5: 'The key Caro-Kann move: the bishop comes out BEFORE ...e6.', 6: 'h4! White threatens g4 and h5 to trap the bishop.', 7: '...h5 stops g4 but leaves g5 for White\'s pieces.', 8: 'Bd3 offers to swap Black\'s good bishop.', 11: '...Qa5+: a clever check that stops an early Bg5.', 12: 'Nd2 blocks and keeps the queenside intact.', 15: 'The knight heads for f5, a great square now that the bishop has gone.', 17: 'On f5 the knight eyes d4 and cannot be kicked by a pawn.', 19: '...Qa6 offers a queen trade: Black is happy in the endgame.', 20: 'White avoids the swap. Black plays ...c5 next with a solid game.' },
      { 8: 'c4 strikes the centre while Black\'s bishop is away.', 11: '...dxc4 opens the position for Black\'s pieces too.', 15: '...Be7 eyes h4, the pawn White pushed.', 16: 'g3 protects h4 and prepares Nf4.', 17: '...Nh6 heads for f5, the square the bishop left.' },
      { 6: 'Nf3: calm development.', 8: 'Be2 and O-O: the Short Variation.', 11: '...a5 gains space.', 12: 'a4 stops ...a4 and fixes the queenside.', 13: '...f6 hits the e5 pawn at once, before White can support it.' },
      { 9: '...c5: the Caro-Kann break, hitting d4.', 10: 'Be3 supports d4.', 13: '...Ne7 heads for c6 or f5.' },
      { 6: 'Nd2 prepares Nb3 and g4 ideas.', 8: 'Nb3 stops ...c5.', 13: '...h6 gives the bishop a retreat.' },
      { 5: '...c5 at once: Black spends two moves on the c-pawn but hits d4 immediately.', 8: 'The queen takes back and is harassed.', 10: 'Qf4 keeps the queen active.', 15: 'Black\'s knight attacks the queen and e5.' },
      { 6: 'dxc5: White takes the pawn.', 9: 'Black regains it with the bishop.', 10: 'Qg4 hits g7.', 11: '...Ne7 defends.' },
      { 4: 'The Classical: Nc3.', 5: 'Black takes on e4.', 7: '...Nf6 challenges the strong knight.', 9: '...exf6: Black accepts doubled pawns for fast development and a safe king.', 15: 'The check gains time.', 17: '...h6 keeps pieces off g5. A solid game.' },
      { 7: '...Bf5: the old Classical.', 8: 'Ng3 hits the bishop.', 10: 'h4 threatens h5 trapping the bishop.', 11: '...h6 prepares a retreat to h7.', 14: 'h5 fixes the bishop on h7.', 18: 'White swaps the bishop.', 22: 'White castles long; Black castles short. A classic, balanced game.' },
      { 4: 'The Exchange: exd5.', 5: 'cxd5: a symmetrical Carlsbad structure.', 10: 'Bf4 develops outside the pawn chain.', 11: '...Bg4 develops before ...e6.', 12: 'Qb3 hits b7.', 17: '...Bd6 offers to swap the active f4 bishop.', 22: 'A calm Carlsbad middlegame. Black\'s plan is the minority attack: ...Rab8, ...b5 and ...b4.' },
      { 6: 'c4: the Panov-Botvinnik, an isolated pawn position.', 11: '...Bg4 hits d4.', 14: 'Qb3 hits d5 and b7.', 18: 'Qxb7: White grabs a pawn.', 19: '...Nxd4 counterattacks.', 22: 'Qc6+ forks king and knight.', 24: 'White wins the piece back. A sharp, forcing line where Black has play for the pawn.' },
      { 2: 'The Two Knights: 2.Nf3 without d4.', 5: '...Bg4 pins the knight.', 7: 'Black gives the bishop to double nothing but gain time.', 13: '...dxe4 opens the centre.', 15: '...Qxd4 grabs a pawn.', 17: 'White has development for the pawn.' },
      { 4: '3.d3: a slow King\'s Indian Attack setup.', 7: 'Black trades queens: the game is equal and calm.', 11: '...g6: the bishop goes to g7.', 12: 'Ne5 eyes f7 and c6. The endgame is equal.' },
      { 4: 'The Fantasy: f3 supports e4.', 5: '...e6 and ...Bb4 put pressure on e4.', 11: 'Black takes on e4.', 13: '...e5! hits d4 while White\'s king is uncastled.' }
    ]
  },

  /* ============================================================= FRENCH == */
  {
    id: 'french', name: 'French Defence', side: 'b', eco: 'C00', shelf: 3,
    description: 'e6 and d5: a patient wall in front of the king, and a counter-punch with c5.',
    idea: 'Let White overextend, then hit the pawn chain at its base with ...c5 and ...f6.',
    reachedAt: 2,
    tutorial: [
      'The French is 1.e4 e6 2.d4 d5. Black challenges e4 at once from a solid base.',
      'If White pushes e5, the centre locks. Black attacks the base of the chain with ...c5 (hitting d4) and later ...f6 (hitting e5).',
      'The downside: the c8 bishop is shut in by e6. Many French plans try to trade it or free it.',
      'Against strong players you meet 3.Nc3 (with 3...Nf6 or the Winawer 3...Bb4), the Advance 3.e5, and the Tarrasch 3.Nd2.'
    ],
    lineNames: [
      'Steinitz: 4.e5 Nfd7 5.f4 c5 7.Be3 a6',
      'Steinitz: 7.Be3 cxd4 8.Nxd4 Qb6',
      'Steinitz: 7.Be3 Be7',
      'Classical: Burn Variation, 4.Bg5 dxe4 5...Be7',
      'Classical: Burn Variation, 5...Nbd7',
      'Winawer: Poisoned Pawn, 7.Qg4 Qc7',
      'Winawer: 7.Qg4 O-O',
      'Winawer: positional 7.Nf3',
      'Advance: 5...Bd7 6.Be2 Nge7 7.O-O',
      'Advance: 7.Na3',
      'Advance: 5...Qb6 6.a3 c4',
      'Advance: 6.Bd3 cxd4 7.O-O gambit',
      'Tarrasch: 3...c5 4.exd5 Qxd5',
      'Tarrasch: 3...c5 4.exd5 exd5',
      'Tarrasch: 3...Nf6 4.e5 Nfd7',
      'Exchange: 3.exd5 exd5',
      'Rubinstein: 3...dxe4'
    ],
    lineIntro: [
      'The most played French among strong players: White builds a big centre with f4 and Black attacks it.',
      'Black swaps on d4 and hits b2 with the queen.',
      'Black develops the bishop before deciding on the centre.',
      'The Burn: Black gives up the centre with ...dxe4 for quick, solid development.',
      'Black keeps the knight pair and plays ...h6 and ...c5.',
      'The Winawer: Black pins and takes on c3, giving up the g7 pawn for counterplay.',
      'Black castles instead of defending g7 with the queen.',
      'A positional approach against the Winawer.',
      'The Advance French: White locks the centre at once.',
      'White reroutes the knight via a3 to c2.',
      'Black hits d4 and b2 and locks the queenside with ...c4.',
      'White develops instead of defending d4 and offers pawns for a lead in development.',
      'The Tarrasch: Nd2 keeps c3 free for a pawn. Black answers ...c5 and takes back with the queen.',
      'Black takes with the pawn and accepts an isolated d-pawn.',
      'A closed Tarrasch structure: Black hits the chain with ...c5 and ...f6.',
      'The Exchange: a symmetrical, open position.',
      'Black gives up the centre at once for solid development.'
    ],
    lines: [
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'e5', 'Nfd7', 'f4', 'c5', 'Nf3', 'Nc6', 'Be3', 'a6', 'Qd2', 'b5', 'dxc5', 'Bxc5', 'Bxc5', 'Nxc5', 'Qf2'],
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'e5', 'Nfd7', 'f4', 'c5', 'Nf3', 'Nc6', 'Be3', 'cxd4', 'Nxd4', 'Qb6', 'Qd2', 'Qxb2', 'Rb1', 'Qa3', 'Bb5'],
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'e5', 'Nfd7', 'f4', 'c5', 'Nf3', 'Nc6', 'Be3', 'Be7', 'Qd2', 'O-O'],
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'dxe4', 'Nxe4', 'Be7', 'Bxf6', 'gxf6', 'Nf3', 'a6', 'Bc4', 'b5', 'Bb3', 'Bb7', 'Qe2'],
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'dxe4', 'Nxe4', 'Nbd7', 'Nf3', 'h6', 'Nxf6+', 'Nxf6', 'Bh4', 'c5', 'Bb5+', 'Bd7', 'Bxd7+', 'Qxd7'],
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3', 'Ne7', 'Qg4', 'Qc7', 'Qxg7', 'Rg8', 'Qxh7', 'cxd4', 'Ne2', 'Nbc6', 'f4', 'Bd7'],
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3', 'Ne7', 'Qg4', 'O-O', 'Bd3', 'Nbc6', 'Qh5', 'Ng6'],
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3', 'Ne7', 'Nf3', 'Nbc6', 'a4', 'Bd7', 'Bd3', 'Qa5', 'Bd2', 'c4', 'Be2', 'f6'],
      ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Bd7', 'Be2', 'Nge7', 'O-O', 'Ng6', 'g3', 'Be7', 'h4'],
      ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Bd7', 'Be2', 'Nge7', 'Na3', 'cxd4', 'cxd4', 'Nf5', 'Nc2', 'Be7', 'O-O', 'O-O', 'Bd3', 'f6'],
      ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Qb6', 'a3', 'c4', 'Nbd2', 'Na5', 'Rb1', 'Bd7'],
      ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Qb6', 'Bd3', 'cxd4', 'O-O', 'Bd7', 'Re1', 'Nge7', 'h4'],
      ['e4', 'e6', 'd4', 'd5', 'Nd2', 'c5', 'exd5', 'Qxd5', 'Ngf3', 'cxd4', 'Bc4', 'Qd6', 'O-O', 'Nf6', 'Nb3', 'Nc6', 'Nbxd4', 'Nxd4', 'Nxd4', 'a6'],
      ['e4', 'e6', 'd4', 'd5', 'Nd2', 'c5', 'exd5', 'exd5', 'Ngf3', 'Nc6', 'Bb5', 'Qe7+', 'Be2', 'cxd4', 'O-O', 'Qc7', 'Nb3', 'Bd6', 'Nbxd4', 'a6'],
      ['e4', 'e6', 'd4', 'd5', 'Nd2', 'Nf6', 'e5', 'Nfd7', 'Bd3', 'c5', 'c3', 'Nc6', 'Ne2', 'cxd4', 'cxd4', 'f6', 'exf6', 'Nxf6', 'Nf3', 'Bd6', 'O-O'],
      ['e4', 'e6', 'd4', 'd5', 'exd5', 'exd5', 'Nf3', 'Nf6', 'Bd3', 'Bd6', 'O-O', 'O-O', 'Bg5', 'Bg4', 'Nbd2', 'Nbd7', 'c3', 'c6'],
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Nf3', 'Ngf6', 'Nxf6+', 'Nxf6', 'Be3', 'Bd7']
    ],
    lineNotes: [
      { 1: 'The French: e6 prepares ...d5.', 3: '...d5 challenges e4.', 5: '...Nf6 attacks e4 again.', 6: 'e5 kicks the knight: the Steinitz.', 8: 'f4 supports e5 with a big pawn centre.', 9: '...c5! hits the base of the chain.', 12: 'Be3 supports d4.', 13: '...a6 prepares ...b5 and queenside space.', 15: '...b5: Black expands.', 16: 'White releases the tension to open lines.', 20: 'Qf2: a rich middlegame with chances for both.' },
      { 13: '...cxd4 releases the tension.', 15: '...Qb6 pins the knight and hits b2.', 17: 'Black grabs b2: a sharp, principled choice.', 19: 'The queen retreats to a3.', 20: 'White has development for the pawn.' },
      { 13: '...Be7: flexible development.', 15: 'Black castles and waits to decide the centre.' },
      { 6: 'Bg5: the Classical French, pinning f6.', 7: '...dxe4: the Burn Variation.', 9: '...Be7 breaks the pin.', 11: 'gxf6: Black accepts doubled pawns for the bishop pair and the g-file.', 13: '...a6 and ...b5 put the bishop on b7.', 17: 'The b7 bishop is Black\'s best piece.' },
      { 9: '...Nbd7 keeps both knights.', 11: '...h6 asks the bishop.', 15: '...c5 frees Black\'s game.', 19: 'Solid and equal.' },
      { 5: 'The Winawer: ...Bb4 pins the c3 knight.', 6: 'e5 closes the centre.', 7: '...c5 hits d4.', 9: 'Black takes: White gets the bishop pair and doubled pawns.', 11: '...Ne7 heads for f5.', 12: 'Qg4 hits g7.', 13: '...Qc7: the Poisoned Pawn. Black lets g7 go.', 14: 'Qxg7 Rg8 Qxh7: White grabs two pawns.', 17: '...cxd4: Black gets huge central counterplay.', 21: 'One of the sharpest lines in chess.' },
      { 13: '...O-O defends g7 by castling.', 16: 'Qh5 prepares a kingside attack.', 17: '...Ng6 blocks.' },
      { 12: 'Nf3: calm development.', 14: 'a4 prepares Ba3 on the dark squares.', 19: '...c4 locks the queenside.', 21: '...f6 hits the chain.' },
      { 4: 'The Advance: e5.', 5: '...c5 at once.', 7: '...Nc6 adds pressure on d4.', 9: '...Bd7 prepares ...Nge7 and ...Nf5.', 11: '...Nge7 heads for f5 or g6.', 13: '...Ng6 hits e5.' },
      { 12: 'Na3 heads for c2 to support d4.', 15: '...Nf5 hits d4.', 17: '...Be7 and castling come first.', 21: '...f6 hits the head of the chain.' },
      { 9: '...Qb6: hits d4 and b2.', 10: 'a3 prepares b4.', 11: '...c4 locks the queenside.', 13: '...Na5 heads for b3.', 15: 'A strategic game about the queenside.' },
      { 10: 'Bd3: White develops and lets d4 go.', 11: '...cxd4 opens the c-file.', 12: 'O-O: in the sample every strong White player castled instead of recapturing.', 13: '...Bd7 develops; Black does not grab more pawns.', 16: 'h4 gains kingside space; the rook can swing over via h3.' },
      { 4: 'The Tarrasch: Nd2.', 5: '...c5 at once.', 7: 'The queen recaptures.', 10: 'Bc4 hits the queen.', 16: 'White wins back the d4 pawn.', 19: '...a6: an equal game with an open centre.' },
      { 7: '...exd5: an isolated pawn after ...cxd4.', 10: 'Bb5 pins the knight.', 11: 'The queen check forces Be2.', 18: 'White blockades the d4 square.' },
      { 5: '...Nf6.', 6: 'e5 kicks the knight.', 9: '...c5 hits d4.', 15: '...f6 attacks the head of the chain.', 17: 'Black has freed the position.' },
      { 4: 'The Exchange: exd5.', 5: 'Symmetrical pawns.', 13: 'Both sides pin.', 17: 'A quiet, equal game.' },
      { 5: '...dxe4: the Rubinstein.', 7: '...Nd7 prepares ...Ngf6.', 11: 'Black recaptures with the knight: no weaknesses.', 12: 'Be3 prepares Qd2 and long castling.', 13: '...Bd7 heads for c6, the best diagonal for the French bishop.' }
    ]
  }
]);

export const openingById = (id) => OPENINGS.find((o) => o.id === id) || null;

export default OPENINGS;
