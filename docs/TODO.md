# To do

Open items, newest first. Checkpoint before the chess audit: git tag
`checkpoint-v1.1.17-2026-09-30` (on GitHub) and
`dist/pawn-and-passport-v1.1.17-CHECKPOINT-2026-09-30.zip`. To go back:
`git checkout checkpoint-v1.1.17-2026-09-30`.

## Chess audit (2026-09-30, v1.1.18)

Fixed in v1.1.18:
- Four book lines taught engine-refuted moves that strong players do not play
  (depth 16 check of all 996 book moves: `tools/opening-research/engine-check.mjs`,
  then depth 19-22 and a position scan of 701,532 broadcast games):
  London 1 (7...Bf5?? lost the bishop to Qxf5, and the book then taught
  8.Qc1 instead of taking it), London 7 (5...c5 6.h5 Nc6?), London 8
  (5...Na6? instead of 5...Nd5!, played in 23 of 24 games) and the
  Caro-Kann Fantasy (a 5.a3 line no game reached, with 7...e5? instead of
  7...Qh4+). Replaced by the lines strong players actually play, every move
  checked at depth 16 (worst loss 2.6 win-probability points).
- A graded move searched the engine twice when the first search stopped
  short of depth 14 (every move on a slow phone), and the grade could use
  other lines than its own classification. Grading now reuses the lines.
- Draw offers looked only at material (a bot a rook DOWN refused a draw).
  Now the bot asks its engine; a draw that would put you through a knockout
  it takes only when clearly worse, and one that wins it a final, always.
- The Brilliant grade was unreachable (every brilliant move became Epic).

- [ ] **Bot strength vs. their Elo labels: decide how to fix.** Measured
      against real rated games (`tools/dev/human_strength.mjs`: 509 positions
      from Lichess games of five rating cohorts, bots vs. the humans who
      really played there, depth-12 reference):

      | bot label | ACPL | plays like (Lichess) |
      |---|---|---|
      | 1500 | 73 | ~1230-1250 |
      | 1250 | 109 | below ~1160 (no human data that low) |
      | 1000 | 151 | below ~1160 |
      | 400-800 | 247-178 | no human data that low |

      Humans: ~1161: 95, ~1289: 52, ~1563: 54, ~1682: 39, ~1943: 41 (noisy).
      The earlier self-play calibration (`tools/dev/calibrate_bots.mjs`) put
      the ladder within ~150 of its labels; on real-game positions the bots
      from 800 up play about 130-260 below them. Two ways to make the numbers
      honest: (a) strengthen 800-1500 so each plays like its label (Normal
      and Hard get harder at the top), or (b) keep the bots and lower the
      numbers shown. Not changed yet: it is a balance decision.
- [ ] Nine more book moves cost 5-10 win-probability points (inaccuracies,
      not mistakes). All are established main-line moves (the Sveshnikov's
      11.Bd3, the Frankenstein-Dracula's 5...Nc6, the Burn French's 9...Bb7,
      ...), so they stay. Log: `engine-check.mjs --depth=16`.

## Depth (drawing in front of / behind the player)

Measured with `tools/dev/leak_check.py` and `tools/dev/feet_check.py --floor`
(results table in docs/FLOORMASK.md). In the game, `L` swaps to the previous
renderer to compare.

- [ ] **New York exterior: the two open iron gates.** They are drawn at an
      angle, so one gate spans several depths; a player standing behind a
      gate still shows through some of the bars. Worst spot in the game:
      59.9 %, 74.5 % (east gate). Options: an OBJECTS entry for each gate
      leaf, or paint the gate area in `NYC/nyc-ext-floormask.png`.
- [ ] **Vienna cafe (vie-venue): barely improved** (leak pixels 53,979 ->
      53,256). Tables, chairs and railings stand very close together. Fix:
      paint the grey in `Vienna/vie-venue-floormask.png` (floor under the
      tables white, the tables' own feet black), then
      `python3 tools/floor_depth.py vie-venue`.
- [ ] **Other worst remaining spots** (x %, y %): Chennai exterior 81.4, 52.5;
      Vienna exterior 42.3, 81.1; Wenzhou cafe 4.6, 45.0.
- [ ] **Not yet checked by eye:** feet-over-object counts that rose in the
      Chennai exterior (16 -> 29), Chennai cafe (16 -> 76, the ones seen were
      shoes over a tiny floor detail) and New York upstairs (4 -> 32).
- [ ] **Floor masks:** the grey (unsure) parts of every
      `<City>/<scene>-floormask.png` count as "not floor". Painting them
      white (floor) or black (not floor) is the fix wherever something still
      looks wrong. Add the scene to the "Hand-edited floor masks" table in
      docs/FLOORMASK.md so the tool never overwrites it.
- [ ] **Phone performance:** the new depth draws more pieces (Vienna
      interior about 1,340 against 1,085). Check a scene on a real phone.

## Release

- [ ] itch: no zip of v1.1.17 or v1.1.18 uploaded (the jam upload lock).
      Checkpoint zip of v1.1.17 is in dist/.
- [ ] Keyboard and gamepad (v1.1.18) tested with real key events and a
      simulated pad, never with a physical controller. A pad press is not a
      "user gesture" to most browsers: with only a pad, the music may wait
      for the first key or click.
- [ ] Never tested on a real phone (touch controls, layout, audio).
- [ ] Coins: nothing to buy with them yet.
