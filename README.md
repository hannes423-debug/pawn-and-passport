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
node tests/run.js                      # 25 rules/data/campaign tests, no browser
node tools/verify-puzzles.mjs          # re-prove every puzzle with Stockfish, regenerate js/data/puzzles.js
python3 tools/serve.py 8123 &          # then, one at a time:
python3 tools/cdp.py smoke             # every screen and all 24 scenes, screenshots, console errors
python3 tools/cdp.py match             # a real game through the board: hint, live grades, result card, save
python3 tools/cdp.py puzzle            # solves the London mission by clicking, collects the postcard
python3 tools/cdp.py trophy            # Epic/Brilliant/Clutch effects, Star Player win, trophy ceremony
python3 tools/cdp_touch.py             # phone: joystick walk + A button (landscape), tap-for-tip (portrait)
python3 tools/cdp_layout.py            # 8 viewports x every screen: no page scroll, no unreachable button, board stays still
python3 tools/cdp_practice.py [WxH]    # practice room, tutorial unlock, journal study depth, drills, puzzle practice, ASM.js engine
```

Screenshots go to `tools/shots/`.

## Phones and tablets

Touch is detected automatically (Settings > Controls > Touch controls: auto / on / off).
In scenes a joystick walks the waypoint graph and **A** uses the hotspot underfoot,
or walks to the nearest one. Hotspot labels are tappable too. Matches and puzzles
switch to a one-column layout in portrait and board-between-rails in landscape;
a tap on a guide-arrow square shows its opening card. The HUD gets a fullscreen
button where the browser supports it. Code: `js/ui/touch.js`, `css/touch.css`.

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

## Practice room and openings

Every club's practice room (the Practice hotspot) offers an unrated friendly,
puzzle practice (all 24 puzzles, no postcard), the club opening's tutorial
(every line with notes; finishing it unlocks an unknown opening at 25%) and
drills (find the book move; a passed set teaches +3%, capped at 90%). The
journal's Openings page has a Study button that replays the lines as deep as
the player knows them.

The opening lines are data-driven: `tools/opening-research/` counted 135,928
games between 2200+ players (Lichess broadcast database, 2024-09..2026-08).
To refresh: download months into `~/.cache/pap-broadcast/`, then

```bash
python3 tools/opening-research/analyze.py      # -> tree.json
python3 tools/opening-research/report.py       # -> report.md (frequency tree)
node tools/opening-research/check-lines.mjs    # every line move vs. what strong players play (exit 1 on a flag)
node tools/opening-research/stats.mjs          # -> js/data/openingStats.js (game counts shown in Study)
```

## Build for itch.io

```bash
python3 tools/build_assets.py          # only after new scene/UI art arrives
python3 tools/build_characters.py      # only after new character sheets arrive
./tools/build-itch.sh                  # -> dist/pawn-and-passport-<version>.zip (about 20 MB)
```

## Layout

```
index.html              entry point
css/pap.css             the whole look (parchment, brass, pixel fonts)
css/board.css           World Tour board CSS + the ornate-board skin
css/touch.css           phone/tablet layout and the scene joystick
js/main.js              boot + screen registry
js/data/                ALL campaign content and every tunable number
  config.js             levels, XP, Elo bands, Focus, hint cost, scoring, bot strength
  clubs.js              6 clubs + the Madrid finale (13 locations)
  openings.js           6 openings, lines in SAN
  starPlayers.js        6 rivals with linear dialogue
  missions.js           6 casual-venue puzzle missions
  puzzles.js            GENERATED by tools/verify-puzzles.mjs
  postcards.js          6 postcards + the Beyond the Tour secret
  scenes.js             24 walkable scenes: waypoints + hotspots
js/core/                pure rules, no DOM (Node-tested)
  career.js save.js hints.js grading.js scoring.js openingBook.js difficulty.js dialogue.js
js/game/match.js        one game: bot, live grading, Focus, hints, guide arrows
js/ui/                  app shell, board, effects, sprites, audio, screens/
js/chess/               the reused Chess: World Tour chess core (see docs/DESIGN.md)
vendor/                 chess.js, Stockfish 18 lite single-threaded WASM
assets/                 web copies of the art (tools/build_assets.py writes them)
tools/                  asset builder, puzzle verifier, headless driver, itch packager
docs/DESIGN.md          what was reused, removed, and how every system works
docs/LICENSES.md        licences and art provenance
```

The source art stays where it was dropped (root PNGs and the city folders).
