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
| London | Royal Chess Club | Covent Garden Chess Courtyard | London System (W) | Oliver Pembrook | The Big Ben Shield |
| Vienna | Vienna Chess Club | Café Stephansplatz | Vienna Game (W) | Clara Vogelsang | The Golden Waltz |
| Istanbul | Istanbul Chess Club | Bosphorus Tea Garden | Sicilian Defence (B) | Emre Kaplan | The Crescent Trophy |
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

## 7. Difficulty: Elo is absolute

**The rule.** An opponent's Elo is the only thing that decides how it plays.
`strengthForElo(elo)` takes an Elo and nothing else - no mode, no tier, no
character - so a 900 met in Easy, a 900 met in Normal and a 900 met in Hard
are built from the same row of the same table and play the same chess.
Campaign difficulty decides **which Elos you meet**, never how one of them
plays. Style (aggressive, positional, tactical, defensive, ...) reorders moves
the engine has already called reasonable; it is a character trait, and it
cannot turn a stated 900 into an 1100 because it never touches the candidate
pool or the eval-loss filter. `tests/run.js` asserts both halves: that
`strengthForElo.length === 1`, that no file in the strength pipeline reads the
campaign difficulty, and that every Elo the three ladders can produce builds
byte-identical strength fields from all three.

**Two ratings, two constants.** `config.ELO` is the PLAYER's rating rules
(start 600, floor 100, K per game kind) and has no ceiling. `config.BOT_ELO`
is the opponent range this game can build: **min 250, max 1500**. They used to
be one `ELO.cap`, so moving the opponent ceiling silently moved the player's
rules with it. Every number that leaves `career.js` goes through `botElo()`,
which clamps into that range - a club member's spread used to be able to sail
past the ceiling and then be printed on screen and silently clamped.

Within a mode, strength is set by campaign **tier** = Club Trophies already won
when the tournament is entered, because clubs can be visited in any order. The
run's opponents are fixed at entry.

### Easy - for somebody who has just learned the rules

| Tier | Regulars | Star Player |
|------|----------|------|
| 0 | 250-400 | 400 |
| 1 | 400-500 | 500 |
| 2 | 500-600 | 600 |
| 3 | 600-700 | 700 |
| 4 | 700-800 | 800 |
| 5 | 800-900 | 900 |
| Finale | quarter 900, semi 950, final 1000 | |

### Normal - the intended career

| Tier | Regulars | Star Player |
|------|----------|------|
| 0 | 500-650 | 650 |
| 1 | 650-800 | 800 |
| 2 | 800-900 | 900 |
| 3 | 900-1000 | 1000 |
| 4 | 1000-1100 | 1100 |
| 5 | 1100-1200 | 1250 |
| Finale | quarter 1300, semi 1375, final 1450 | |

### Hard - for a club player

| Tier | Regulars | Star Player |
|------|----------|------|
| 0 | 700-800 | 850 |
| 1 | 800-900 | 950 |
| 2 | 900-1000 | 1050 |
| 3 | 1000-1100 | 1150 |
| 4 | 1100-1250 | 1300 |
| 5 | 1250-1400 | 1400 |
| Finale | quarter 1400, semi 1450, final **1500** | |

Club members spread `MEMBERS.belowBand` (100) under and `aboveBand` (60) over
their tier's band, so the weakest person in an Easy club is a 250 and the
strongest in a Hard one is a 1460. Nothing anywhere reaches 1500 except the
Hard final, which is the campaign ceiling exactly.

### How an Elo becomes a bot

Stockfish's own `UCI_Elo` stops at 1320 and it refuses to go below, so every
rung under that is the bot layer, not the engine. `config.BOT_STRENGTH` is
ten anchors from 250 to 1500, interpolated: candidate pool width, sampling
temperature (`strength`), maximum eval loss accepted, the unforced-error
chance and how expensive that error may be - plus two columns that exist to
keep a weak bot **bad rather than random**:

- `seesFreeMaterialCp` - how much has to be hanging before this opponent
  notices (320cp at 250, 100cp at 1500), and `greed` - how often it then takes
  it (0.72 to 0.94). The check runs BEFORE the unforced-error roll, so no bot
  can leave a free queen standing because a dice roll said so. A weak player
  grabs the piece and finds out about the fork afterwards, which is what a 300
  actually does.
- The error itself is **weighted by what it costs**, not picked uniformly.
  `blunderSeverityCp` used to be only a ceiling, and a ceiling of 980 excludes
  nothing a beginner would play - which is why every rung under about 900 used
  to measure the same. Now a move that concedes near the whole budget is
  roughly seven times likelier than a safe one for a 250, and about twice as
  likely for a 1500 (`CARELESSNESS` in `chessBot.js`). That is the difference
  between a 300 and a 1300 when both of them go wrong.

### Measured

`node tools/dev/calibrate_bots.mjs --elo 300,500,700,900,1100,1300,1500
--samples=40` (1200 sampled moves each, depth-12 reference):

| label | ACPL | blunders | the tool's Elo estimate |
|-------|------|----------|-------------------------|
| 300 | 269 | 53% | 381 |
| 500 | 242 | 48% | 456 |
| 700 | 188 | 35% | 611 |
| 900 | 160 | 29% | 749 |
| 1100 | 120 | 19% | 971 |
| 1300 | 94 | 15% | 1168 |
| 1500 | 75 | 10% | 1355 |

Strictly monotone with even separation, which is what was tuned for. The
estimate column runs about 130 points under the label from 700 up; that offset
is flat across the whole ladder, which points at the tool's ACPL-to-Elo anchors
rather than at the table (the tool says so itself: treat that column as a band,
not a rating). Relative strength is the design target - a 900 is clearly above
a 700 and clearly below an 1100 - not FIDE calibration.

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
Brilliant +5, Epic +6. A move the hint showed is graded **FOCUS** (in the
plan's colour), earns no Focus and no grade bonus, and does not count as a
Best/Epic in the stats or the Match Score.

## 10. Focus hint: rolls and plans (reworked 2026-09-19)

**Ask for Hint** (button or `H`) asks the engine for its playable candidates
(MultiPV 3; a candidate is playable within `HINTS.playableLoss` = 8
win-probability points of the best) and rolls once per candidate, up to the
level's count: 1 roll at levels 1-4, 2 at 5-9, 3 at 10+. Roll 1 is the best
move, roll 2 the runner-up, roll 3 the third. Each roll is independent:

| Level | fail | green | purple | gold |
|-------|------|-------|--------|------|
| 1-4   | 30%  | 55%   | 12%    | 3%   |
| 5-9   | 25%  | 50%   | 18%    | 7%   |
| 10-14 | 20%  | 42%   | 26%    | 12%  |
| 15    | 10%  | 35%   | 35%    | 20%  |

A failed roll shows nothing for its candidate. The quality is how far the
plan reaches: green 1 of your moves, purple 2, gold 3, in the UI pack's
green / purple / gold arrows and squares. Only the next move is drawn; after
the opponent replies, the plan you followed draws its next move by itself
(a fresh engine search of the new position), numbered 2, then 3.

**Focus back**, settled by your next move only: playing the 2nd suggestion
refunds 30% of the cost, the 3rd 50%, none of them 75% (you trusted
yourself); the best one refunds nothing. If every roll fails, 75% comes back
at once. Numbers: `config.HINTS.refund`.

Hovering a suggested square opens a card: the plan, and the openings in your
repertoire that contain the move. The opening guide is BLUE (main line) and
grey (other prepared branches), so green, purple and gold only ever mean a
Focus plan.

**Mastered openings keep guiding** (`config.GUIDE`): the guide is the book,
and a regular opponent leaves the book on about 1 move in 10 (BOOK.
regularPreference 0.9), which is why arrows used to vanish and return on a
transposition. At 100% mastery, once the game has been in the opening for 2
plies, an opponent leaving the book no longer ends the guide: the engine's
move is drawn in blue until the game passes the opening's longest line.

## 11. Hint cost

```
cost = round( 10
            x familiarity   in a known line: max(0.4, 1 - 0.6 x mastery); otherwise 1
            x specialty     your starting club's opening: 0.9
            x phase         opening 1.0 / middlegame 1.2 / endgame 1.4 (in book counts as opening)
            x complexity    1.15 when positionComplexity >= 0.55
            x rolls         1 roll 1.0 / 2 rolls 1.3 / 3 rolls 1.6 )
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
| Covent Garden | Mind the Back Rank (Nell the Busker) | Back-rank mates | The open file, Doubled rooks, Queen for the win, Deflection |
| Café Stephansplatz | The Coffeehouse Traps (Herr Anton) | Opening traps | Scholar's mate, Legal's mate, Fool's mate, The Petrov trap |
| Bosphorus Tea Garden | Lines over Tea (Aunt Selin) | Pins, skewers, discoveries | Pin the queen, Skewer, Double check, Knight unmasks |
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
baseline. Frames are detected, not hand-measured. The large illustration in the
top-left corner of each sheet is cut out as the character's dialogue portrait,
`assets/characters/portraits/<id>.png`, so the person talking is the person
walking. Only the artist's sheets are used: no recolours, no generated variants
(stale files from older builds are deleted on every run).

Seven characters (2026-09-17): `boy`, `girl` (the player choices), `young-blue`,
`young-red`, `old-green`, `old-scarf`, `woman`.

- Every NPC names one of them in `look.sprite` (6 stars, 24 regulars, 6 venue
  hosts, the guide). With 37 roles and seven characters they repeat; roles are
  matched by gender and age, and within one club floor the star and the two
  regulars shown there are all different.
- An NPC never wears the player's own sprite: `setPlayerAvatar` swaps `boy` for
  `young-blue` and `girl` for `woman` on NPCs (tested).
- A look naming a sheet that does not exist draws `young-blue`, never the old
  procedural painter.
- Scene actors play the idle loop standing and the 8-frame walk while moving.

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

## 26. The practice tree

Every club's practice room opens the same tree (`js/ui/screens/practice.js`);
one lesson is played by `js/ui/screens/lesson.js`. Unlocking and progress are
`js/core/lessons.js`, tunables `PRACTICE` in `js/data/config.js`, content
`js/data/lessons.js`.

**A lesson is three things**, and a player may do them in any order:

| Step | What it is |
|------|------------|
| Instructions | the idea in two or three sentences; opening the page marks it read |
| Watch | the animated demonstration: frames with the move played on the board, coloured arrows and marked squares, stepped by hand or auto-played; reaching the last frame marks it watched |
| Challenges | positions to solve. A **move** challenge accepts the verified answer and answers a wrong move with the authored reason; a **square** challenge is tapped, and a swapped coordinate ("4e" for "e4") is told apart from a wrong square |

**Tiers and unlocking.** Seven tiers, by rating band, opened by Club Trophies -
one per tournament completed:

| Tier | Bands | Opens at |
|------|-------|----------|
| Beginner | 0-600 | from the start |
| Club player | 700-800 | 1 trophy |
| Endgames and plans | 900-1000 | 2 |
| Sharper tactics | 1100-1200 | 3 |
| Planning | 1300 | 4 |
| Exact calculation | 1400 | 5 |
| Practical play | 1500 | 6 |

37 lessons are open at the start and all 85 once the sixth trophy is won,
which lines the tree's ceiling up with the campaign's (the Madrid final is
1500). Nothing inside an open tier is gated behind anything else: a player can
start at any lesson, skip whole bands, and return to an earlier lesson - or
replay a finished one - whenever they want. Tiers never close.

**Progress and XP.** `career.lessons[id] = { read, watched, solved: {}, done }`.
First solve of a challenge pays `PRACTICE.xpChallenge` (6), and the first time
a lesson has been read, watched and fully solved pays `PRACTICE.xpLesson` (40).
Replays pay nothing and are never blocked. `career.stats.lessonsDone` and
`lessonChallenges` keep the totals.

**Where the content comes from.** The lessons are generated by
`tools/build-lessons.mjs` from **Gambit Academy**, the same author's chess
trainer, whose pipeline verified every answer with Stockfish (depth >= 14) or
the Syzygy tablebase. The converter flattens each lesson into data this game
can play on its own:

- the demo frames are pre-resolved to FENs, so the runner only renders and
  animates (a frame that rewinds the demo carries its own `before` position)
- every candidate move is pre-judged by Academy's `judge()` at the lesson's
  band, and the outcome and wording are stored in `verdicts`

So this game needs no chess judgement and no engine for a lesson, and nothing
on screen can contradict the verification. `node tools/verify-lessons.mjs`
re-checks the result against **this** game's rules: every FEN legal, every demo
frame reachable by the move it claims, every answer and judged move legal,
every square target real, and the tier table reaching 1500 at six trophies.
`tests/run.js` covers the unlock ladder, the "any order" rule and the XP
accounting; `tools/cdp_lessons.py` drives the whole thing in a browser.

## 26b. The UI icon set

Every symbol the game draws is a pixel-art icon from one sheet. No emoji, no
Unicode glyph standing in for artwork, no icon font, no external library.

`ui-pixel-icons.png` (the artist's sheet, never edited) is cut by
`python3 tools/build_pixel_icons.py` into `assets/ui/icons/<name>.png`, 18
icons at **32x32** native. Each cell is found by its own alpha - the rows and
columns are segmented, not hand-measured - trimmed to the drawing and padded
to a square, so the play triangle and the club building end up the same
optical size. Stale files are deleted on every run, so a renamed icon cannot
leave its old file behind to be referenced by accident.

`js/ui/icons.js` is the only place that knows a path:

```js
pixelIcon('trophy')                        // decorative: aria-hidden
pixelIcon('map', { size: 'sm' })
pixelIcon('settings', { label: 'Settings' })   // role=img, announced
sideIcon('w')                              // White or Black from a colour letter
```

Sizes are CSS pixels: `sm` 16, `md` 24, `lg` 32, `xl` 48, `hero` 64, plus `em`
(1.4em) for the journal's book pages, which are laid out in container-query
units and would otherwise drift out of step with their own text. Everything is
`image-rendering: pixelated`, so the art never gets the browser's smoothing.
Decorative icons are `aria-hidden` and contribute nothing to the accessible
name; an icon that IS the control passes `label` and the button keeps its own
`aria-label`. Icon-only buttons get `.pp-btn--icon` (44px minimum).

Naming an icon that does not exist throws at the call site, and
`tools/validate-content.mjs` (so `predeploy.sh`) fails if any name in `ICONS`
has no PNG. `build-itch.sh` re-checks inside the built zip, because the paths
are templated and the build's "is every asset shipped" sweep skips those by
design.

### NPC names are revealed, not printed

A club floor holds twelve members, and a name plate over every head hides the
room. A member now wears only the speech-bubble icon; the NAME appears when
the player walks up to them (`.is-near`, within `NAME_RADIUS` = 22% of the
scene height, refreshed by the scene's own walk tick), hovers them, or focuses
them with the keyboard - and when the dialogue opens, the name is the
dialogue's own header. Everything else - the tournament desk, the exits, the
practice room - keeps its label, because those are signposts and a signpost
nobody can read is not a signpost. The dock at the bottom still lists every
member by name, so nothing is reachable only by walking.
`tools/cdp_members.py` asserts that no name is on screen before the player
approaches, and that approaching one shows exactly that one.

## 27. Club members, coins and real tournaments (2026-09-18)

**Members** (`js/data/members.js`): every club has 12, its four regulars plus
eight new ones, cast from the artist's sheets to fit the city (Chennai: 10 of
12 Indian, plus exchange students from Osaka and Wenzhou). Each has a strength
`rel` (0..1), a specialty opening the bot plays from book, and two lines about
the city, their opening or the game (sometimes followed by a general tip).
They stand in the garden, club floors and venue on spots generated by
`tools/place-members.mjs` (writes `js/data/memberSpots.js`; pin by hand in its
PINS). Re-run it after changing a member's `where` or a scene's layers.

**Coins**: start at 100. Talking to a member ends in a challenge; the stake is
10-40 by their Elo (`COINS`), a draw returns it, coins never go negative.
Challenges are rated lightly (K 16). Coins also come from tournament prize
money (8 per point, +40 finalist, +120 champion) and first puzzle solves (+5,
mission +25). Nothing to buy yet.

**Tournaments** (`js/core/tournament.js`, pure): NYC, Vienna and Chennai run a
16-player Swiss, London, Istanbul and Wenzhou a 32-player knockout (draw goes
to Black). Five rounds, then the final against the Star Player; the trophy
only for WINNING the final. The field is the player, all 12 members and
visiting players. Every NPC game is simulated on Elo (`SIM`: scale 300, draws
falling with the gap): 100 points below wins ~25%, 400 below ~3%. A failed
run (placed, eliminated, runner-up) is finished and played out, and the desk
offers a fresh event. Every tournament game teaches the club opening (+6/+4/+3
for win/draw/loss) up to 60%; only the trophy makes it 100. Saves at
saveVersion 3 drop old three-game runs and add coins.

**Opening card**: 📖 Notes (next to Guide arrows) hides the card on suggested
squares; on touch the pinned card has its own Hide button. Remembered in
settings (`openingNotes`). Arrows are unaffected.

Verify: `node tests/run.js`, `python3 tools/cdp_members.py [390x844] [--scenes]`.

## 28. Stability pass (2026-09-19)

**The opponent always moves** (`js/game/match.js`): `maybePlayBot` gives the
engine 30 s and a retry, then plays `fallbackMove()` (mate > captures by value >
checks > centralising, deterministic) and emits `bot-fallback`; the screen
tells the player. Stale calls (Undo, a newer call) never move into a new
position, and only the owning call clears `thinking`. A screen watchdog
restarts a stalled bot and, after three stalls, offers "Try again / Leave the
game". A failed hint search costs nothing.

**A game pays out once** (`career.commitMatchResult`): Elo, XP, mastery,
coins, tournament and finale progress are committed in one call keyed by the
match's `gameId`; a second call is a no-op returning the first result. The
screen commits and saves BEFORE any presentation, wraps the rest, and on any
error returns the player to the venue (or the ending). `summary()` waits at
most 8 s for grading.

**Saving is reported** (`save.storageStatus`, `onStorageStatus`): the memory
fallback and failed writes (quota, blocked storage) show one persistent
"Not saving" strip; it disappears when a write succeeds again.

**Resume and repair**: `nextStep(career)` is the next useful action;
`validateCareer` lists anything that could not resume; `migrateCareer` repairs
broken runs and unknown locations. Tests reload the career after every
transition of a full campaign.

**Scene art** never blocks: after 2.5 s the room is shown from
`assets/manifest.json` sizes with a placeholder and a Retry button.

## 28b. Prop footprints are read off the art (2026-09-22) - SUPERSEDED by 28c

A prop blocks the player through its `foot`, a percent rect in
`tools/build_layers.py`'s LAYERS table. **147 props declared none at all** and
so blocked nothing: pillars, a fountain, a street tree, the club gates and
their cypresses, and most of the plants and lamps. You walked through them.

The footprint is now DERIVED from the prop's own art. Every prop is cut to its
own PNG, so the pixels where it meets the floor are known exactly: take the
opaque ones within 1.5% of the scene's height above its lowest pixel - an
ankle, not a share of the object, so a tall lamp is measured at its base and
not up its post - and that rect is what blocks. 108 props gained one.

Three rules, in the LAYERS table's fourth slot:

| slot | meaning |
|------|---------|
| a rect | hand-tuned; it WINS, and nothing is derived |
| `None` | derive it from the art |
| `OVER` | no footprint on purpose: the player walks under or behind it |

A declared rect wins rather than being unioned with the derived one because
these were placed against a level whose doorways are tight - growing one by
0.29% was enough to seal the Director's office in nyc-int.

`OVER` is for archways, hanging signs and wall banners, plus four decorations
that stand IN a passage the level cannot spare (nyc-int's statue is 0.97%
wide and its doorway had less slack than that; vie-up's upper plants and east
aisle plant close the only routes to the lounges, the trophy hall and one
member). `tools/dev/clearance.mjs` is what found all four.

**The floor barely moved**: the largest loss of walkable area in any scene was
0.8% (vie-up), and 12 of 24 scenes did not change at all. The feet landed on
furniture, not on walkways.

**Verify**: `node tools/dev/prop_clearance.mjs` measures, for every prop, how
much of its base band the player can stand in. A prop with no footprint reads
near 100%. It runs in `predeploy.sh` at `--fail-over=50`; the 13 props left in
the 10-46% band are a lamp's flared base or an armchair's arm sticking past
the rect that blocks it, which is the ordinary overlap of a three-quarter view.
`tools/dev/audit_layers.py` draws the same thing over the scene art.

## 28c. Artist walk masks and occlusion layers (2026-09-25)

The GrabCut cut-outs, floor polygons, blocks and footprints of 28b are gone.
The artist drew two guides per scene (in the city folder):

- `<scene>-walkmask.png` - white where FEET may stand. It is the collision,
  stored as run lengths per row of the 300x225 grid; `freeWalk.js` erodes it by
  the walker's body. The erosion now rounds to the NEAREST cell: rounding up
  made the body ~30% fatter than the one the masks were drawn for and sealed
  nyc-int's tournament hall doorway.
- `<scene>-occlusion.png` - the scene with the floor removed. Every opaque
  pixel gets a ground line (`tools/build_occlusion.py`, rules in its header):
  a column that stands on unwalkable floor takes its own lowest pixel; one the
  player walks under takes a hand-set line from `tools/depth_hints.py` (the old
  LAYERS bases: signs, gate arches at 99, banners, canopies), else the line of
  whatever holds it up either side (porch pillars, the wall round a doorway);
  one with floor above and below (an inlay, steps) never hides anybody.

Slices are the scene's OWN pixels cut by the layer's alpha (the layer is a
redraw, 35-80 levels off), grouped by ground line and snapped down to the next
feet row that can actually overlap them, packed into one lossy WebP atlas per
scene (12 MB total, was 23 MB of PNG cut-outs) and drawn as divs with the atlas
as background. Four layers were drawn at a slightly different size and are
fitted with an ECC affine first (WARP). Characters take z = 2*round(10y)+1 and
slices 2*round(10*line), so a character level with a line stands in front.

Tolerated: the strip behind lon-venue's telephone box is standable but
unreachable (a 1116-cell nook, allowed by name in tests/run.js). vie-venue's
mask leaves the cafe little open floor: `vie-can` is pinned in
tools/place-members.mjs.

**Gates**: `tools/predeploy.sh` (content gate + unit tests + syntax) must pass
before pushing main; `tools/validate-content.mjs` fails on any bad puzzle,
line, drill or lesson. Browser: `tools/cdp_campaign.py all` plays the whole
campaign through the UI from every starting city (with losses, re-entry, a
lost Star final and a lost Madrid round), `tools/cdp_resilience.py` the
failure paths, `tools/cdp_layout.py` the 8-viewport matrix.
