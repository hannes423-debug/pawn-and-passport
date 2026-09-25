# Pawn & Passport: A Chess Career RPG

A compact jam game forked from **Chess: World Tour**. Start as a junior player
in one of six cities, travel between six chess clubs, learn six openings, win
six Club Trophies, collect six postcards from casual venues, and win the Madrid
Grand Finale to qualify for the Big Leagues.

It is a separate project with its own entry point, data, save namespace (`PAP_`)
and identity. Chess: World Tour (`~/Työpöytä/chess-world-tour`) was only read,
never modified.

**Play it:** https://hannes423-debug.github.io/pawn-and-passport/ (GitHub Pages, served from `main`).

## Run it

```bash
cd ~/Työpöytä/Pawns
python3 tools/serve.py 8000        # no-cache static server
# open http://localhost:8000/
```

It must be served over HTTP: `file://` breaks ES module imports and the
Stockfish worker. There is no build step and no npm install.

Debug deep links (need an existing save): `?screen=map`, `?scene=nyc-int`,
`?puzzle=m-lon`.

## Test it

```bash
node tests/run.js                      # 40 rules/data/campaign/practice tests, no browser
node tools/verify-puzzles.mjs          # re-prove every puzzle with Stockfish, regenerate js/data/puzzles.js
node tools/verify-lessons.mjs          # re-check the practice tree's 337 challenges against the rules
python3 tools/opening-research/mine-puzzles.py  # club puzzle candidates from real games in each club opening
node tools/verify-club-puzzles.mjs     # prove them with Stockfish -> js/data/clubPuzzles.js (6 per club)
python3 tools/serve.py 8123 &          # then, one at a time:
python3 tools/cdp.py smoke             # every screen and all 24 scenes, screenshots, console errors
python3 tools/cdp.py match             # a real game through the board: hint, live grades, result card, save
python3 tools/cdp.py puzzle            # solves the London mission by clicking, collects the postcard
python3 tools/cdp.py trophy            # Epic/Brilliant/Clutch effects, Star Player win, trophy ceremony
python3 tools/cdp_touch.py             # phone: joystick walk + A button (landscape), tap-for-tip (portrait)
python3 tools/cdp_layout.py            # 8 viewports x every screen: no page scroll, no unreachable button, board stays still
python3 tools/cdp_practice.py [WxH]    # practice room, tutorial unlock, journal study depth, drills, puzzle practice, ASM.js engine
python3 tools/cdp_lessons.py [WxH]     # practice tree: tiers, unlocking by trophy, read/watch/solve, XP, replay
python3 tools/cdp_depth.py [scene]      # layered scenes: cut-outs, free walking with collision, depth order, hotspots
python3 tools/cdp_undo.py               # Undo ability: cost, cap per level, cooldown, takeback; Hint+Undo visible at 8 viewports
```

Screenshots go to `tools/shots/`.

## Phones and tablets

Touch is detected automatically (Settings > Controls > Touch controls: auto / on / off).
In scenes a joystick walks the waypoint graph and **A** uses the hotspot underfoot,
or walks to the nearest one. Hotspot labels are tappable too. Matches and puzzles
switch to a one-column layout in portrait and board-between-rails in landscape;
a tap on a guide-arrow square shows its opening card. The HUD gets a fullscreen
button where the browser supports it. Code: `js/ui/touch.js`, `css/touch.css`.

## Focus abilities

**Hint** and **Undo** sit side by side in every layout. Undo takes back your
last move and the reply. It costs 30 Focus (a level-1 player's whole pool), is
capped per game (1 use, 2 from level 6, 3 from level 12), has a cooldown of 5 of
your own moves, and costs 150 Match Score. Tunables: `UNDO` in
`js/data/config.js`. Keyboard: H and U.

Grading during a game never says "Missed win" (it would reveal a winning line):
those moves show as Inaccuracy, Mistake or Blunder by size. A piece left
hanging earns Brilliant/Epic/Clutch only on the move that first offered it.

## The window never scrolls

On every device the page is pinned to the viewport (`css/layout.css`); screens
are laid out to fit, and only inner panels (move list, modals, journal pages,
the city list) scroll inside their own box. The match board sits in a
fixed-size grid cell in every layout, so nothing that changes during a game can
move it. `tools/cdp_layout.py` enforces all three rules.

## Chess engine

`js/chess/engine/engineService.js` tries Stockfish 18 lite (WASM) and falls
back to the ASM.js build if the phone refuses the WASM heap; a worker that
crashes or stops answering is restarted. The match screen shows the engine's
status, so "grades don't work" always comes with a reason. `?engine=asm`
forces the fallback for testing on a device.

## Difficulty

Three modes, chosen at New Game (Normal preselected) and changeable any time
in Settings. The choice lives on the CAREER, so it is part of the save, and it
only ever affects games not yet played: a tournament already under way keeps
the field it was drawn with, and trophies, rating and history never move.
There is no rubber-banding anywhere - the strength is chosen, not adapted.

| | first club | sixth club | finale |
|---|---|---|---|
| **Easy** "Learning the ropes" | 250-400 | 800-900 | 900-1000 |
| **Normal** "Chess career" | 500-650 | 1100-1250 | 1300-1450 |
| **Hard** "Club challenge" | 700-850 | 1250-1400 | 1400-**1500** |

**Elo is absolute.** A 900 is a 900 in all three modes: the difficulty picks
which Elos you meet, never how one of them plays. `strengthForElo(elo)` takes
an Elo and nothing else, and `tests/run.js` asserts that every Elo the three
ladders can produce builds identical strength from all three. Style
(aggressive, positional, ...) chooses between moves the engine already called
reasonable - it is a character trait, not a handicap.

`DIFFICULTY` in `js/data/config.js` owns all three ladders and nothing else in
the game branches on the mode. A target Elo becomes a bot through
`js/core/difficulty.js` and the `BOT_STRENGTH` table beside it. `BOT_ELO` is
the range that table covers - **250 to 1500** - and is separate from `ELO`,
which is the player's own rating rules and has no ceiling.

Those numbers are MEASURED, not labels. Stockfish refuses to limit itself
below UCI_Elo 1320, so under about 1200 the engine is not what is being turned
down - three knobs on the bot layer are: how often an unforced error happens,
how much it may hand over (a hung queen at the bottom, a dropped pawn near the
top) and how aimless it is. Openings stay sensible at every level because the
opening book runs before any of it.

```bash
node tools/dev/calibrate_bots.mjs          # every mode and tier: ACPL vs a depth-12 reference
node tools/dev/calibrate_bots.mjs --elo 300,900,1500 --samples=40
```

Weak does not mean random. A bot takes obviously free material before it rolls
for a mistake (`seesFreeMaterialCp` and `greed`), so even a 250 normally takes
the queen you left hanging - it just does not look at what the capture walks
into. And when it does go wrong, the mistake is weighted by what it costs, so
a 300's errors are expensive and a 1400's are cheap. Measured numbers and the
whole ladder are in `docs/DESIGN.md` section 7.

## Soundtrack

Four tracks in `assets/audio/`. **Town Square Afternoon** plays everywhere
outside a match and does not restart when the player changes screen, because
asking `js/ui/music.js` for the track already sounding does nothing. In a
match, **Tactical Tension** is the default, **Tense Battle Theme** the sharp
middle and **Checkmate Approaching** the rare last one, crossfaded over 900ms.

`js/core/musicMood.js` chooses, and it is deliberately blind to the
evaluation: no centipawn score, no mate score, nothing derived from one, so
the music can never become a hidden eval bar telling the player they are
losing. It reads what is already visible on the board - checks, captures and
promotions in the last six plies, being in check, having two legal moves or
fewer, a mate actually available this move, the phase, a clock about to flag -
and adds hysteresis and a 15s dwell so it does not flicker. A quiet positional
game never leaves the first track; Morphy's Opera Game reaches the last one
only for the closing queen sacrifice.

## Practice room and openings

Every club's practice room (the Practice hotspot) offers the **practice tree**,
an unrated friendly, puzzle practice (all 24 puzzles, no postcard), the club
opening's tutorial (every line with notes; finishing it unlocks an unknown
opening at 25%) and drills (find the book move; a passed set teaches +3%,
capped at 90%). The journal's Openings page has a Study button that replays the
lines as deep as the player knows them.

### The practice tree

85 lessons from the board and the pieces up to 1500, the game's Elo ceiling.
Each one is **read it, watch it, do it**: instructions in words, an animated
demonstration with arrows on the board, and challenges to solve (a move, or a
square to tap). See `docs/DESIGN.md` section 26.

Seven tiers open with the campaign: the beginner tier (up to 600) from the
first visit, and one more per **Club Trophy**, so the 1500 tier opens with the
sixth. Nothing is compulsory: inside the open tiers a player can start
anywhere, skip a band and go back to an earlier lesson at any time, and a
finished lesson can always be replayed.

The content is generated from **Gambit Academy** (the same author's chess
trainer), where every answer was verified with Stockfish at depth >= 14 or
against the Syzygy tablebase, and each candidate move was pre-judged, so the
game looks a move up rather than grading it - no engine is needed for a
lesson.

```bash
node tools/build-lessons.mjs     # regenerate js/data/lessons.js from Gambit Academy
node tools/verify-lessons.mjs    # re-check every position and answer with THIS game's rules
```

The opening lines are data-driven: `tools/opening-research/` counted 135,928
games between 2200+ players (Lichess broadcast database, 2024-09..2026-08).
To refresh: download months into `~/.cache/pap-broadcast/`, then

```bash
python3 tools/opening-research/analyze.py      # -> tree.json
python3 tools/opening-research/report.py       # -> report.md (frequency tree)
node tools/opening-research/check-lines.mjs    # every line move vs. what strong players play (exit 1 on a flag)
node tools/opening-research/stats.mjs          # -> js/data/openingStats.js (game counts shown in Study)
```

## Depth layers and free walking

Every walkable scene (all 24: club gardens, interiors and upper floors, the
six casual venues and both Madrid scenes) is walked freely: joystick, arrow
keys or WASD move the player anywhere on the floor with collision, and a tap
walks there along an A* path (`js/core/freeWalk.js`).

Both come from two guides the artist drew per scene, in the city folder:

- `<scene>-walkmask.png`: white where a character's FEET may stand. It is the
  collision, as is; the grid erodes it by the walker's body.
- `<scene>-occlusion.png`: the scene with the floor removed. Every opaque
  pixel gets a ground line and the player is drawn behind it when their feet
  are higher up the picture than that line. A column of the layer that stands
  on unwalkable floor takes its own lowest pixel; one the player walks UNDER
  (signs over doorways, gate arches, banners, canopies) takes the hand-set line
  in `tools/depth_hints.py` (99 = always in front); one with floor above and
  below (an inlay, steps) never hides anybody.
- Potted plants are walk-behind: the build opens the floor a plant hides
  (where it carries on either side of it) so the player can step behind the
  pot and be covered by it; only the pot's base blocks. Planters and trees in
  beds keep the mask as drawn.

```bash
python3 tools/build_occlusion.py --preview   # atlases + js/data/sceneLayers.js; previews in tools/shots/occlusion-<scene>.png
python3 tools/build_occlusion.py nyc-int     # one scene (about 10 s each)
python3 tools/build_occlusion.py --check     # fast: guides unchanged since the build, walk grid not hand-edited
python3 tools/cdp_depth.py                   # browser: slices, walking with collision, depth order, every hotspot
node tools/dev/clearance.mjs                 # any floor walled off from the spawn?
open '...?debugCollision=1'                  # paint the walk grid over the art, in play
```

The preview stands a magenta figure on a grid of walkable spots, each drawn in
its real depth order, and tints the pixels that are not simply "stands on the
floor": blue = a depth hint, orange = a lintel with no hint, green = on the
floor. The pixels drawn in play are the scene's own, cut by the layer's alpha:
the layer is a redraw and pasting it would show a seam round every object.

## Build for itch.io

```bash
python3 tools/build_assets.py          # only after new scene/UI art arrives
python3 tools/build_characters.py      # only after new character sheets arrive
python3 tools/build_pixel_icons.py     # only after a new UI icon sheet arrives
python3 tools/build_occlusion.py       # after new walk masks or occlusion layers
python3 tools/build_city_popup.py      # after a new city preview frame
./tools/build-itch.sh                  # -> dist/pawn-and-passport-<version>.zip (about 65 MB)
```

Most of that is art: 12 MB of occlusion atlases, 11 MB of scene paintings, 13 MB
of music and 18 MB of Stockfish. Nothing is preloaded that does not need to
be - a track is fetched the first time it plays, not at boot.

`index.html` is at the ROOT of that zip, which is what itch.io serves; the
build asserts it, and refuses to ship a wrapper folder, a missing soundtrack
or a dev page. `tools/predeploy.sh` runs first and additionally checks that
the generated collision data still matches its generator and that no scene has
a doorway a body cannot fit through.

## Layout

```
index.html              entry point
css/pap.css             the whole look (parchment, brass, pixel fonts)
css/board.css           World Tour board CSS + the ornate-board skin
css/touch.css           phone/tablet layout and the scene joystick
js/main.js              boot + screen registry
js/data/                ALL campaign content and every tunable number
  config.js             levels, XP, DIFFICULTY (the three Elo ladders), Focus,
                        hint cost, scoring, BOT_STRENGTH (the measured bot table)
  clubs.js              6 clubs + the Madrid finale (13 locations)
  openings.js           6 openings, lines in SAN
  starPlayers.js        6 rivals with linear dialogue
  missions.js           6 casual-venue puzzle missions
  puzzles.js            GENERATED by tools/verify-puzzles.mjs
  postcards.js          6 postcards + the Beyond the Tour secret
  scenes.js             24 walkable scenes: waypoints + hotspots
js/core/                pure rules, no DOM (Node-tested)
  career.js save.js hints.js grading.js scoring.js openingBook.js dialogue.js
  difficulty.js         a target Elo -> a bot profile
  musicMood.js          which match track plays; reads the BOARD, never the evaluation
  freeWalk.js           the walk grid: solid mask, eroded by the walker's size
js/game/match.js        one game: bot, live grading, Focus, hints, guide arrows
js/ui/                  app shell, board, effects, sprites, screens/
  audio.js              synthesised sound effects
  music.js              the four-track soundtrack: crossfades, autoplay, volume
  icons.js              the pixel-art UI icon set: pixelIcon('trophy')
  difficultyPicker.js   Easy / Normal / Hard, shared by new-game and Settings
js/chess/               the reused Chess: World Tour chess core (see docs/DESIGN.md)
vendor/                 chess.js, Stockfish 18 lite single-threaded WASM
assets/                 web copies of the art (tools/build_assets.py writes them)
tools/                  asset builder, puzzle verifier, headless driver, itch packager
docs/DESIGN.md          what was reused, removed, and how every system works
docs/LICENSES.md        licences and art provenance
```

The source art stays where it was dropped (root PNGs and the city folders).
