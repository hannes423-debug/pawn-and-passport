# Development report: first 1.0-roadmap session (v1.3.0, 2026-11-05)

Scope: the brief's Part 6 sequence (audit, rendering, animation, saves,
RNG and focus, safe high-value improvements, tests). Branch
`ccr-132ffaf9-xyas7p`, five commits on top of `94e1fba`.

## 1. Technical overview

A static web game: vanilla ES modules, no build step, no npm dependencies,
served over HTTP. `index.html` > `js/main.js` registers 12 screens and boots
the app shell (`js/ui/app.js`).

| System | Where | Notes |
|---|---|---|
| Screens and shell | `js/ui/app.js`, `js/ui/screens/*` | `app.go(name, params)`; one HUD, modal overlays, toasts, dialogue |
| Scenes, walking | `js/ui/screens/scene.js` (1700 lines), `js/core/freeWalk.js`, `js/data/scenes.js` | 24 walkable scenes; free walking on a grid eroded from the artist's walk masks |
| Depth / occlusion | `js/data/sceneLayers*.js` (generated), `tools/build_occlusion.py`, `tools/depth_hints.py`, x-ray in `scene.js` `paintXray` | **owned by another team member**: inspected only (section 6) |
| Characters | `js/ui/sprites.js`, `tools/build_characters.py`, `js/core/locomotion.js` (new) | 17 sheets, 4 directions, idle + walk; see docs/CHARACTER_SPEC.md |
| Career and saves | `js/core/career.js`, `js/core/save.js`, `js/core/history.js` (new) | one JSON career in localStorage (`PAP_` keys); `migrateCareer` is an idempotent repair, not stepwise |
| Tournaments | `js/core/tournament.js` | Swiss and knockout, NPC games simulated from Elo |
| Chess | `js/chess/*` (from Chess: World Tour), `vendor/chessjs`, Stockfish 18 lite WASM (+ ASM.js fallback) in a worker | `engineService` shared, cached, restarts a dead worker |
| Match | `js/game/match.js` (PapMatch), `js/ui/screens/match.js` | bot, live grading, Focus, Hint, Undo, opening guide |
| Grading / feedback | `js/chess/analysis/*`, `js/core/grading.js` | win-probability bands from a depth-14 MultiPV search |
| RNG | `js/core/focusHints.js` (hint rolls), `tournament.js` (NPC results), `career.js` (opponent Elo), `chessBot.js` | every roll takes an injectable `random`; no literal dice system |
| Focus abilities | Hint and Undo (`config.HINTS`, `config.UNDO`) | Focus pool by level, regen on strong moves |
| Items / equipment | coin shop only (`js/core/shop.js`): piece sets and boards, cosmetic | no inventory, no equipment slots |
| Locations | `js/data/clubs.js`: 6 clubs + 6 casual venues + Madrid finale | 13 locations, 24 scenes |
| NPCs | `js/data/members.js` (12 per club), `starPlayers.js` (6 rivals) | linear dialogue (`js/core/dialogue.js`) |
| Quests | 6 venue puzzle missions, 6 postcards spelling a secret | no questline system |
| Networking | none | only static `fetch` of manifests |
| Input | `js/ui/controls.js` (keys, pads), `js/ui/touch.js` | whole game playable without a mouse |

Key dependencies: scenes depend on the generated depth data and the character
size (`actorHeight`, which also sizes the walker's collision body); the match
depends on the engine for grading, hints and bot moves (with fallbacks); the
career is the single source of truth for progress and is saved after every
meaningful change.

## 2. Completed

Each item: what was wrong, what changed, files, tests.

**2.1 Characters were blurry** (Task 3)
- Wrong: actor canvases were rasterised at CSS size, then enlarged by the
  browser: 29x44 bitmap shown 132 device px tall on a landscape phone.
- Changed: canvases at device resolution (DPR, capped at 3), same CSS size.
- Files: `js/ui/sprites.js`, `js/ui/screens/scene.js`.
- Tested: before/after crops at 4 viewports; `cdp_depth.py` (24 scenes,
  walking, depth order, every hotspot), `cdp_touch.py`, smoke: 0 failures;
  x-ray outline checked behind the Chennai chairs at 2x.
- Limitation: the source art is not on a pixel grid (docs/CHARACTER_SPEC.md
  section 2); only new art makes it truly crisp.

**2.2 Animation bugs** (Task 4)
- Wrong: diagonal row flicker; legs at full pace at partial joystick tilt;
  walking on the spot into walls; 45 walk frames hovering 3-5 px.
- Changed: `js/core/locomotion.js` (eight-way facing with hysteresis,
  mirroring, row fallback, distance-locked stride); the slicer keeps feet on
  the baseline; 15 sheets rebuilt (portraits unchanged).
- Files: `js/core/locomotion.js`, `js/ui/sprites.js`, `js/ui/screens/scene.js`,
  `tools/build_characters.py`, `assets/characters/*.png`.
- Tested: 4 unit tests; feet measurement over all 816 frames (0 frames more
  than 1 px off, was 47); drivers as above.
- Eight-direction architecture ready; no directional sprites fabricated.

**2.3 Undo exploit in the Focus system** (Task 7)
- Wrong: hint shown > play another move (75% refund) > Undo > play the shown
  move: graded as the player's own find (EPIC +450 Match Score against
  Undo's -150, XP, Focus regen), and the refund was kept.
- Changed: shown moves remembered per position and graded FOCUS when
  replayed; Undo returns the refund; Undo's Focus check counts the clawback.
- Files: `js/game/match.js`. Tested: a failing test first, then passing;
  `cdp_undo.py` at 8 viewports.

**2.4 Saves could be lost** (Task 5)
- Wrong: a career slot that was not JSON read as "no career", and the next
  New Game overwrote it; a career `migrateCareer` threw on stopped the game
  from starting ("Could not start").
- Changed: rolling backup of the previous save; unreadable slots kept aside
  verbatim; recovery from the backup, with a notice to the player.
- Files: `js/core/save.js`, `js/ui/app.js`. Tested: recovery, quarantine,
  no-save and **old-save compatibility** unit tests.

**2.5 Match history and game viewer** (Tasks 5, 6)
- Added: a versioned history store under its own key; Journal > Games; a
  viewer to step through games, jump to the next graded error, copy PGN,
  run an on-demand Stockfish check (engine name and depth shown; live grades
  labelled as live feedback, never mixed with engine output).
- Files: `js/core/history.js`, `js/ui/gameViewer.js`,
  `js/ui/screens/journal.js`, `js/ui/screens/match.js`, `css/pap.css`.
- Tested: unit tests (cap, dedupe, migration, PGN replays in chess.js);
  end-to-end at 1440x900 and 390x844@3 (15 checks, 0 console errors).
- Limitation: games played before v1.3.0 were never stored move by move, so
  they cannot appear.

**2.6 Board as PNG** (Task 6)
- Added: `js/ui/boardImage.js` redraws a FEN on the board art (1040x1022)
  with the career's pieces/board, last move and coordinates; copied to the
  clipboard or saved as a file. On the result card and in the viewer.
- Tested: clipboard image read back (1040x1022); file fallback is a PNG;
  orientation, themes and piece sets checked visually.

**2.7 Character builder could empty the asset folder**
- Wrong: stale sheets were deleted before building; a missing OpenCV module
  mid-run left committed characters deleted (it happened during this audit;
  restored from Git).
- Changed: build in memory, then replace. Tested: byte-identical output;
  simulated failure leaves all 17 sheets.

**2.8 Probability audit** (Task 7): see section 4; no defects in the
arithmetic, 3 tests added to keep it that way.

## 3. Partially completed

- **Character specification** (docs/CHARACTER_SPEC.md): written and grounded
  in measurements; integer-scale drawing for future 32x48 art is specified
  but not implemented (no such art yet).
- **Save schema versioning**: the new history store is versioned with a
  migration; the career itself still uses idempotent repairs
  (`migrateCareer`). `GAME.saveVersion` is 3 while code comments describe a
  "v3 -> v4" step: harmless today, but before equipment/inventory/quests are
  added, switch to an ordered list of numbered migrations (each run once,
  version bumped per step) and keep the repair pass after it.
- **Unreadable save export**: the copy is kept (`PAP_career_v1_unreadable`)
  but there is no button to download it yet (Settings is the natural place).

## 4. Investigated, not implemented

**RNG and focus (what the system actually does)**
- Hint rolls: one roll per playable candidate (within 8 win-probability
  points of the best, max 3); odds by level, each row sums to 1 and improves
  monotonically; 200k-roll simulation matches the configured rates.
- Refunds: 0 / 30% / 50% for the 1st/2nd/3rd idea, 75% for ignoring all
  ideas or a blank roll; never exceeds the cost. Note: ignoring every
  suggestion refunds the most - intended ("you trusted yourself"), but it
  means a hint is cheapest when its idea is not used.
- Hint cost: base 10 x familiarity x specialty x phase x complexity x rolls;
  multiplicative, bounded (min 2), no exploitable stacking found.
- No probability is shown to the player as a number, so there is nothing to
  mismatch on screen.
- NPC tournament games use a **300-point** logistic (`SIM.scale`) while the
  player's Elo uses the standard 400: favourites win NPC games more often
  than their ratings imply. Probably deliberate (tidier brackets); a design
  call, left unchanged.

**Move feedback**: grades come from a depth-14, MultiPV-3 Stockfish search
in win-probability terms with a gentle centipawn floor; missed wins are
shown as plain mistakes to avoid revealing a win; special grades are
de-duplicated per offered piece. No contradictions found in code. A
statistical accuracy study against a deeper reference was not run this
session (`tools/dev/grading-probe.mjs` exists for it).

**Content phases (3-7)**: the world is 6 clubs, 6 venues and the finale
(24 scenes). Each new city needs, per scene, a painting, a walk mask and an
occlusion layer plus depth hints (docs/WALKMASKS.md, docs/OCCLUSION.md), so
15 cities is mainly an **art** project; there is no questline, inventory or
equipment system yet. These need design decisions first (section 5).

**Online (Phase 8)**: no networking code exists; nothing started, per the
brief.

## 5. Blocked / needs a decision

- **New character art** to the spec (32x48 grid, five rows + mirror): needed
  for truly crisp characters, eight-direction movement and layered
  customisation. The code side is ready for the directions.
- **Idle animation**: the sheets have 4 idle frames but the game shows one
  ("characters hold still"). Turning the others on is a one-line change
  once someone decides it looks right.
- **Equipment and items**: needs a design for slots and how small bonuses
  stay subordinate to chess (the brief's rule) before a schema is added.
- **Region structure**: which 15 cities, and how the existing 6-trophy
  progression extends to three regions.

## 6. Occlusion: notes for the team member who owns it

No occlusion code or data was changed. One compatibility point:

- Actor canvases are now **device-pixel bitmaps** with an explicit CSS size.
  `paintXray` now reads the actor's CSS size from `a.cssW` / `a.height`
  instead of `a.canvas.width/height`, and draws the figure at that CSS size.
  Any new code that maps an actor onto the stage must use those (CSS px),
  not the canvas's bitmap size.
- Actor z-index, the foot anchor (`translate(-50%, -92%)`) and the walker's
  collision size are unchanged.
- Pre-existing, not caused by this work (reproduced on the untouched
  commit): `tools/cdp_layout.py` reports the `vie-venue` label "Cafe chess
  table" under the HUD at 640x360 and 1280x720.

## 7. Other findings

- Credits are not reachable from the title once a career exists (the slot
  becomes Journal). Small UI fix; Phase 9 wants credits reachable.
- README said 40 unit tests; there are 99 now (86 before this session).
- The repo's browser drivers need `google-chrome` and `websocket-client`;
  in the cloud container a wrapper around the bundled Chromium (with
  `--no-sandbox`) works. The character builder also needs `scipy` and
  `opencv-python-headless`.

## 8. Test record

| Check | Result |
|---|---|
| `node tests/run.js` | 99 passed, 0 failed |
| `tools/predeploy.sh` | PREDEPLOY OK |
| `cdp.py smoke` (every screen, 24 scenes) | 0 failures |
| `cdp.py match`, `cdp.py trophy` | 0 failures |
| `cdp_depth.py`, `cdp_touch.py`, `cdp_undo.py`, `cdp_controls.py` | 0 failures |
| `cdp_layout.py` (8 viewports) | 2 pre-existing failures (section 6), identical on the untouched commit |
| History/PNG end-to-end (1440x900, 390x844@3) | 15/15 checks, 0 console errors |
| Character feet audit (816 frames) | 0 frames > 1 px off baseline (was 47) |
