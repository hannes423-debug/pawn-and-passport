# Pawn & Passport: design and implementation notes

Everything numeric below is read from `js/data/config.js`. Change it there, not here.

---

## 1. Reused from Chess: World Tour

Copied into `js/chess/` (the original was never modified):

| Module | Used for |
|--------|----------|
| `core/` rules (chess.js wrapper), `ChessGame`, `MoveRecord`, `GameResult`, time controls | every game and puzzle |
| `engine/` Stockfish worker, `EngineService` (cache, queue, NullEngine fallback), analysis levels | bots, hints, grading |
| `bots/ChessBot` + `BotProfile` | opponents: MultiPV candidate pool + personality archetypes + unforced-error roll |
| `analysis/` `moveClassifier` (win-probability based), `brilliance` (sound-sacrifice detector), `GameReview.annotate`, motif/threat/fork detectors | live move grading |
| `render/board2d`, `inputController`, `feedback` colour table | the board (all four input gestures and keyboard play), verdict tints, arrows |
| `explain/` | still called inside `GameReview.annotate`; its text is not shown |
| `css/board.css` (first 372 lines) | board layout, highlights, arrows, piece animation |
| `tools/serve.py`, `tests/nodeTransport.js`, the `cdp.py` harness pattern | dev tooling |

Changes made to the copies: `chessBot.js` lost the DNA branch; `feedback.js`
gained a `clutch` tier; `board2d.drawArrow` gained a numbered badge for hint
steps; `pieceSets.js` gained the `pixel` set; PGN headers say Pawn & Passport.

## 2. Disabled or excluded

Not copied at all, so it cannot run: the RPG core (`js/rpg/`: attributes, stats,
codex, perks, condition, Intuition, Focus engine, rolls, migration), **Aura**,
skills, perk trees, abilities and loadouts (`chess/rpg/`), `MatchSession`,
`HintManager`, guidance sliders, Chess DNA (`dnaBot.js`, `career/dna/`, style
profiles, fictional-player database), Ultimate Chess / HUT-FUT, online,
the overworld (`career/`), journeys, mastery tests, simuls, the opening and
puzzle databases, the 3D board, the World Tour menus and news.

A test (`tests/run.js`, "no Aura, attributes, perks or DNA") fails if any of
those names reappear in the jam's rules, match or bot files.

## 3. Structure and launch

See `README.md`.

## 4. The six clubs

| City | Club | Casual venue | Opening | Star Player | Trophy |
|------|------|--------------|---------|-------------|--------|
| New York | Manhattan Chess Club | Bethesda Terrace, Central Park | Italian Game (W) | Maya Castellano | The Liberty Cup |
| London | Royal Chess Club | South Bank Embankment | London System (W) | Oliver Pembrook | The Big Ben Shield |
| Vienna | Vienna Chess Club | Café Stephansplatz | Vienna Game (W) | Clara Vogelsang | The Golden Waltz |
| Istanbul | Istanbul Chess Club | Galata Tea Garden | Sicilian Defence (B) | Emre Kaplan | The Crescent Trophy |
| Chennai | Chennai Chess Club | Marina Beach Promenade | Caro-Kann Defence (B) | Priya Raghavan | The Temple Lamp |
| Wenzhou | Wenzhou Chess Club | Ou River Pavilion | French Defence (B) | Zhou Lan | The Jade Dragon |
| Madrid | Palacio del Ajedrez | none (finale only) | none | all six return | The Big League Qualifier |

13 locations: 6 clubs + 6 venues + the finale.

## 5. The six openings

Three per colour, matching the journal's WHITE 1-3 / BLACK 1-3 shelves. Each has
3-4 short main lines (12-15 plies) written in SAN and validated as legal chess.
They were picked because they are recognisable, amateur-friendly, distinct,
and need only a handful of lines. Lines contain both sides' moves, so a club
opponent steers toward its opening whichever colour it has (as White at the
Sicilian club it plays 1.e4 and follows the Sicilian if you answer c5).

Club regulars take a book move with 90% probability, Star Players with 100%,
only while the position is in their lines; the moment it leaves theory the
engine plays. Book moves are theory, so nothing objectively bad is forced.

## 6. The six Star Players

Fictional; none modelled on a real player. Each has a name, title, short
personality, club, opening, archetype (the existing bot styles), a
procedural portrait, and linear dialogue for: intro, challenge,
already-knows-your-opening, rematch, you-won, you-lost, after-being-beaten,
finale reunion, all-postcards.

Maya Castellano (aggressive), Oliver Pembrook (positional), Clara Vogelsang
(tactical), Emre Kaplan (aggressive), Priya Raghavan (defensive), Zhou Lan (practical).

## 7. Difficulty

Strength is set by campaign **tier** = Club Trophies already won when the
tournament is entered, because clubs can be visited in any order. The run's
opponents are fixed at entry.

| Tier (trophies held) | Regulars | Star Player |
|------|----------|------|
| 0 | 500-700 | 800 |
| 1 | 600-800 | 900 |
| 2 | 700-900 | 1000 |
| 3 | 800-1050 | 1150 |
| 4 | 900-1150 | 1250 |
| 5 | 1000-1250 | 1375 |
| Finale | quarter 1400, semi 1450, final 1500 | |

Stockfish's own `UCI_Elo` stops at 1320, so an Elo is mapped
(`config.BOT_STRENGTH`, interpolated) to the World Tour bot's knobs: candidate
pool width, sampling temperature (`strength`), maximum eval loss accepted, and
the unforced-error chance (34% at 400 Elo down to 4.5% at 1500). These are
target bands, not calibrated ratings (see TODO).

Tournament: two regular rounds (a win or a draw clears), then the Star Player
(must be won). A failed round stays current and can be replayed.

Finale: three knockout rounds against returning Star Players; each must be
won and can be replayed. The final is always your HOME club's Star Player.

## 8. Level cap and XP

Cap **15**. Cumulative XP to reach each level:
`100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250, 3850, 4500, 5200, 6000`.

Per game: `(30 + result + grade bonuses) x kind multiplier`
- result: win 60, draw 30, loss 10
- grades: Epic 60, Brilliant 40, Clutch 30, Best 4, Excellent 2
- multiplier: friendly 0.8, tournament 1.25, Star Player 1.5, finale 1.75

One-offs: Club Trophy 250, finale win 600, first solve of a puzzle 25,
completing a mission 120. Trophies, finale and puzzles alone reach level 11;
the main path's games push a player to about 13, side content to 15.

## 9. Focus

Max Focus = `30 + 6 x (level - 1)`: 30 at level 1, 114 at level 15.
Refilled to max at the start of every game. Earned back mid-game only by
strong moves found WITHOUT the hint: Best +2, Excellent +1, Clutch +5,
Brilliant +5, Epic +6.

## 10. Hint continuation

One ability: **Ask for Hint** (button or `H`). The engine line is drawn as
numbered arrows (cyan = your moves, dashed orange = expected replies).

| Level | Shown |
|-------|-------|
| 1-4 | best move (1 ply) |
| 5-9 | move + expected reply (2 plies) |
| 10-14 | move, reply, your next move (3 plies) |
| 15 | three of your own moves (5 plies) |

Hints use the same strong engine as grading (depth 14, `config.HINTS.search`).
Level decides how much of the line is SHOWN, never how good the suggestion is,
and hints are not tied to the player's Elo.

Hovering a suggested square (hint arrow or gold guide arrow) opens a card:
the openings in your repertoire that contain the move are explained (name,
ECO, idea); other openings get one "also part of" line. Variation names only
appear once the game has left that opening's main line.

## 11. Hint cost

```
cost = round( 10
            x familiarity   in a known line: max(0.4, 1 - 0.6 x mastery); otherwise 1
            x specialty     your starting club's opening: 0.9
            x phase         opening 1.0 / middlegame 1.2 / endgame 1.4 (in book counts as opening)
            x complexity    1.15 when positionComplexity >= 0.55
            x depth         1 ply 1.0 / 2 plies 1.2 / 3 plies 1.4 / 5 plies 1.7 )
minimum 2
```

The button shows the cost and the factors before you pay.

## 12. Opening mastery

States: Unknown 0, Glimpsed 1+, Partially known 25+, Studied 40+, Mastered 100.
- Starting club's opening begins at **40%**, every other at 0.
- A game that reaches an opening's line (past its `reachedAt` ply) adds +4%,
  capped at 90%. Play alone never masters an opening.
- Winning the Club Trophy sets that opening to **100%**.

What mastery does: cheaper hints in that line; free gold **guide arrows**
(40%+: the main continuation; 100%: every prepared branch); the opening
banner and journal shelf.

### Repertoire (equipped openings)

Any opening known at all (mastery > 0) can be equipped from the Journal's
Openings page. Slots: 1 at level 1, 2 at 3, 3 at 5, 4 at 8, 5 at 11, all 6 at
13 (`config.REPERTOIRE`). Only EQUIPPED openings draw guide arrows and discount
hints. Mastery sets how deep the arrows know a line (mastery x longest line,
at least 2 plies); below 100% only the line being followed is shown, at 100%
every branch. Winning a trophy auto-equips its opening when a slot is free.
Saves from before this change are migrated (home opening first).

## 13. Club Trophy progression

Enter tournament -> clear two regular rounds -> beat the Star Player ->
trophy + opening to 100% + 250 XP, exactly once (`awardTrophy` refuses a
second payout). The sixth trophy unlocks Madrid on the world map.

## 14. The six puzzle missions

Every position is original or a public-domain opening trap written as a move
list, and every solution was proven by Stockfish at depth 18
(`tools/verify-puzzles.mjs`): each player move is the unique winner or an
immediate mate, and every reply is the engine's best defence. 7 of the first
24 compositions were caught as wrong or ambiguous and fixed.

| Venue | Mission | Theme | Puzzles |
|-------|---------|-------|---------|
| Central Park | The Fountain Hustle (Marcus "Two-Minute" Bell) | Forks | Royal fork, Family fork, Check then fork, The pawn fork |
| South Bank | Mind the Back Rank (Nell the Busker) | Back-rank mates | The open file, Doubled rooks, Queen for the win, Deflection |
| Café Stephansplatz | The Coffeehouse Traps (Herr Anton) | Opening traps | Scholar's mate, Legal's mate, Fool's mate, The Petrov trap |
| Galata Tea Garden | Lines over Tea (Aunt Selin) | Pins, skewers, discoveries | Pin the queen, Skewer, Double check, Knight unmasks |
| Marina Beach | Endgames by the Sea (Coach Vel) | Endgame technique | Take the opposition, Breakthrough, Queen and king, Rook on the seventh |
| Ou River | Offerings at the River (Old Master Hu) | Sacrifices and mating patterns | Smothered, Philidor's legacy, Arabian mate, Pawn-supported queen |

In a puzzle, the solution move or any immediate mate is accepted; the hint is
free (text first, then the piece).

## 15. Postcard concepts

Each front is the venue's view (New York's uses the Central Park art; the others
are cropped from their city cards), captioned
"Greetings from ...", with a stamp code (NYC, LON, VIE, IST, MAA, WNZ) and a
sender: the mission's host.

## 16. Secret messages

Read in journal order, their first letters spell **B-E-Y-O-N-D**.

1. **B**orn on park benches, most players never leave the park. You will. Keep this card: there are five more, and somebody is counting.
2. **E**very club you have visited sits on a much larger map. Past the amateur circuit the boards are ranked, and the rankings travel with you.
3. **Y**ou collect openings. Out there, they say, people collect PLAYERS: every rival worth remembering, written down on a card of their own.
4. **O**ut past the Bosphorus a tournament is not always one board. Sometimes it is five boards, one flag, and a team that wins or loses together.
5. **N**ot every season ends in a final. Some end in an invitation, with gold edges and a date, to a hall where nobody is an amateur.
6. **D**on't unpack yet. The circuit you are winning is only the first page of a very thick passport.

## 17. The all-postcards reveal

A hidden **Beyond the Tour** journal tab appears only when all six are held:
the word BEYOND stamped letter by letter, "You have only seen the amateur
circuit.", six blurred silhouette cards (international leagues, a player you
can collect, elite invitationals, teams under one flag, events that arrive
with the seasons, a world circuit), and "Same game. A bigger world. See you on
the World Tour." with an explicit note that nothing on the page is a promise.
No gameplay reward. Star Players get an extra line about the postcards, and
the ending acknowledges it.

## 18. Grand Finale

Madrid is locked on the map until 6/6 trophies. Courtyard -> golden hall;
the players' lounge holds all six rivals (reunion dialogue), the stage runs
three knockout rounds at 1400 / 1450 / 1500 against Star Players, the final
always against your home club's rival. Winning the final: +600 XP,
`career.completed`, then "You have qualified for the Big Leagues." and the
credits. No professional career continues.

## 19. Live grading, Brilliant tracker, Match Score

- Every PLAYER move is annotated in the background by the World Tour
  `GameReview.annotate` (Stockfish depth 14, `config.GRADING.search`) and graded with its hierarchy: Brilliant (sound
  sacrifice), Best, Excellent, Good, Book, Forced, Inaccuracy, Missed win,
  Mistake, Blunder, plus **Epic** (a brilliant move that was also the engine's
  move, from `feedback.js`) and the new **Clutch**: an only-move under
  pressure (engine's choice, runner-up at least 15 win-probability points
  worse, mover at 62% or less before, still 30% or more after).
- Board effects: Epic (gold flash, particles, light rays, big word), Brilliant
  (purple), Clutch (pink shockwave rings), Best/Good/Mistake chips, Blunder shake.
- Career totals: Epic, Brilliant, Clutch, Best, Excellent, Blunders, career
  score, average score, best game (with opponent), average/best accuracy,
  record, peak Elo, puzzles, hints used, rival record.
- Match Score (`js/core/scoring.js`): result (win 1000 / draw 500 / loss 150)
  + accuracy x 15 + per grade (Epic 450, Brilliant 300, Clutch 250, Best 40,
  Excellent 25, Good 10, Book 5, Inaccuracy -20, Mistake -60, Missed win -60,
  Blunder -120) + checkmate 150 + upset bonus (Elo gap, max 300) - 40 per hint.
  Letters: S 3200+, A 2600+, B 2000+, C 1400+, D.

**Note:** Chess: World Tour did not actually contain a "Clutch" grade, a
"Great" grade or a Match Score calculator. Epic and Brilliant were real and
are preserved as they were; Clutch and the Match Score are new, built on the
existing classifier and colour table. (World Tour's `career/rewards.js` adds
XP for `counts.GREAT`, which the classifier never produces: a dead term there.)

## 20. Save namespace

`localStorage`, two keys, both prefixed `PAP_` (World Tour uses `cwt.*`):

- `PAP_career_v1`: name, avatar (boy/girl), startClubId, location, visited,
  level, xp, elo, openings (mastery %), trophies, postcards (+ read), 
  secretRevealSeen, puzzlesSolved, tournaments (run state per club),
  finale (unlocked, opponents, round, results, won), stars (met, beaten,
  losses), stats (games, W/D/L, per-grade totals incl. Epic/Brilliant/Clutch,
  careerScore, bestScore, accuracy, hints, puzzles, peakElo), completed.
  Max Focus is derived from level, so it is not stored twice.
- `PAP_settings_v1`: volume, sfx, music, pieceAnimation, coordinates,
  moveGrades, guideArrows, reducedMotion, textSpeed.

## 21. Remaining TODOs

**MUST before jam submission**
- Play a full campaign by hand in a real browser (the headless tests drive every
  flow, but nobody has played 20 real games through it).
- Calibrate difficulty: the Elo bands are targets; whether a "700" bot plays
  like 700 has not been measured.
- Casual venue art: Central Park has its own; London, Vienna, Istanbul, Chennai and
  Wenzhou still walk on their city cards.
- Six supplied character sheets cover the player and 36 NPCs, so several NPCs
  share a base sprite in a recoloured jacket; more distinct NPC art would help.
- Confirm rights/provenance of the supplied art (unrecorded, as in World Tour).
- Upload the zip to itch and test inside itch's iframe; listen to the audio in a
  real browser (headless cannot).

**SHOULD finish**
- Tune scene waypoints after playtesting: some walk lines cross furniture.
- Phone/portrait layout for the match and scene screens (desktop-first, not phone-tested).
- The tournament desk fixes the run's tier as soon as it is opened, even on "Not yet".
- A short "How to play" page (hotkeys: 1-9 hotspots, M map, J journal, H hint).
- Draw offers use a simple material/length rule, not the engine.
- London needs its own interior (it uses the generic floor plan), and NYC's
  upstairs art was filed in the London folder.

**OPTIONAL polish**
- A real music track; more SFX variation.
- Hand-drawn portraits for the six Star Players.
- Show the actual won trophies inside each upstairs Trophy Hall scene.
- Gamepad input.
- Strip `explain/` out of `GameReview.annotate` to save CPU.

## 22. Bugs and regressions found while building

- The first body font (Pixelify Sans) drew 5 like S and closed C/G at UI sizes
  ("650 Elo" read "6S0"): replaced with Jersey 15.
- The postcard in the reward modal rendered at zero width: fixed.
- Bold text on the Beyond page rendered dark-on-dark: fixed.
- 7 of 24 hand-composed puzzles were wrong (capturable forking piece, an
  illegal position, second winning moves, a queen the king could simply take):
  caught by the Stockfish verifier and recomposed.
- In World Tour (not fixed, not ours): `rewards.js` counts a `GREAT` grade that never exists.

## 23. World Tour systems still present in the jam build

Nothing player-visible. Code that is inert or unused:
- `js/chess/explain/` runs inside `annotate` and its text is discarded.
- `BotProfile` still defines Master/Grandmaster/Engine presets and
  `analysisLevels` the stronger levels; nothing selects them (Elo is capped at 1500).
- The Chessnut SVG piece set ships as an unused fallback.
- `inputController` keyboard play (arrow keys + Enter on a focused board) is
  kept on purpose.

## 24. Characters

`characters/*.png` (supplied sheets, never edited) are sliced by
`python3 tools/build_characters.py` into `assets/characters/<id>.png`: 12 x 4
cells of 72x108 (idle 0-3, walk 4-11; rows down/left/right/up), feet on one
baseline. Frames are detected, not hand-measured. Fixes applied while slicing:
the older man's left row on the combined sheet is a different man, so it is
mirrored from his right row; the student-with-board sheet's left idle faces
right, so it is mirrored too. Ten NPC variants are hue-rotated jackets.

- Player: `boy` (chess student boy) or `girl` (chess student girl). No NPC uses them
  (a test enforces it).
- Everyone else names a sheet in `look.sprite` (stars, 24 regulars, 6 venue hosts).
  Characters without a sheet fall back to the procedural sprite in `js/ui/sprites.js`.
- Scene actors play the idle loop standing and the 8-frame walk while moving;
  portraits are cropped from the first idle frame.

## 25. Grading fixes (2026-09-15, from playtest)

Reported: Best/Excellent on ~90% of moves for a 1200 player. Three causes:

1. **The bot's search cancelled the grading search.** World Tour's engine
   stopped the search in flight whenever a new one started, so the bot's
   reply cut the review of the player's move short. Searches are now queued;
   only a caller passing `preempt: true` cancels.
2. **Win probability flattens in decided games.** From -1700 a move walking
   into mate in five lost 0.1 points and graded Best. Loss is now
   `max(winProbLoss, min(cpLoss, 800) / 20)`, and the logistic uses the common
   0.00368208 slope instead of 350cp.
3. **Bands were lenient.** Best = the engine's move (or within 0.3), Excellent
   2, Good 5, Inaccuracy 10, Mistake 20; complexity widening 10% (was 35%).

Also fixed: a checkmating move graded MISS (the mated position's "mate 0"
negated into "the mover is mated").

`node tools/dev/grading-probe.mjs [games] [seed]` plays simulated games through
the real match flow and prints the grade distribution and the depth reached.
A simulated 600 player went from 59% Best+Excellent to 38%, with mistakes and
blunders now showing up. The simulated players are bots picking from engine
candidates, so this checks the direction of the change, not a real rating.
