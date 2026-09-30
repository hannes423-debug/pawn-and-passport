# Floor masks: the Vienna depth experiment

Started 2026-09-30. Vienna only (vie-ext, vie-int, vie-up, vie-venue). Every
other city still uses the current renderer, and nothing here changes how
anybody walks.

## Three masks, three jobs

| mask | file | says | used for |
|---|---|---|---|
| walk mask | `<City>/<scene>-walkmask.png` | where FEET may stand | collision, paths (unchanged) |
| floor mask | `<City>/<scene>-floormask.png` | where the GROUND is, reachable or not | depth only |
| occlusion | `<City>/<scene>-occlusion-original.png` | what may be drawn in front of a player | the pixels of every depth slice |

Not walkable does not mean solid. Floor under a table, a strip behind a
railing, the floor a wall hides from this angle are all floor the feet cannot
reach, and they decide where an object meets the ground.

The occlusion source for this experiment is the artist's ORIGINAL layer,
restored from git (90f2128) next to the tool-pruned file the current renderer
uses. Neither file is ever written by the tools.

## The floor mask file

Same size and frame as the walk mask, so it can be painted on the same canvas:

- white: floor, visible or hidden behind a drawing
- black: not floor (a wall, a planter, a trunk, the void, the sky)
- grey (or transparent): unsure. The build treats grey as not floor, the old
  assumption. Painting it white or black is what the artist adds.

`tools/floor_mask.py` wrote the first versions: walkable = floor; the floor the
layer leaves visible, floor-coloured and within 24 px of walkable floor =
floor; the surround reaching the picture's edge = not floor; everything under
the drawing that is not walkable = grey. It never overwrites a mask listed
below as hand-edited.

## How depth is built from it (`tools/floor_depth.py`)

Per pixel column, each run of the layer is read downwards. A layer pixel over
floor is the object in front of the floor it hides; over not-floor it is the
object's footprint.

1. A run splits where a footprint gives way to floor below it: two things
   stacked in one column (a chair behind a table) become separate depth
   regions.
2. A region meets the ground where the floor resumes under its footprint.
3. The floor mask's main job: the floor hidden above a footprint is the
   object's drawn HEIGHT h. Seen from this angle an object of height h on
   footprint rows t..c draws its top at rows t-h..c-h and its front at c-h..c,
   so each pixel stands at `min(row + h, c)`. One drawing is then in front of
   a player at one row and behind at the next: a long table, a wall top, the
   north chair of a chess table, a doorway side. With no hidden floor the
   height is unknown and the region stands at c whole, as before. Per-row
   lines are kept to the shoe strip (0.08 character heights), always rounded
   forward, so rounding can never show feet over anything.
4. A region with no footprint in its column (leaves over the floor, the far
   rim of a round table) takes the line of what holds it, nearest first.
5. The manual `HINTS` (tools/depth_hints.py) apply to those free-hanging
   regions only; the manual `OBJECTS` apply as in the current build.

Output: `js/data/sceneLayersFloor.js` and `assets/layers-floor/*.webp`. The walk
grid inside is a copy of the current one (a test and `--check` enforce it).

## Switching

- In a Vienna scene: `L` swaps between the floor-mask depth and the current
  renderer, live, where the player stands. A toast says which one is on.
- `?depth=legacy` starts on the current renderer, `?depth=floor` on the
  experiment. Other cities ignore both.
- To switch it off for everybody: `DEPTH_DEFAULT = 'legacy'` in
  `js/ui/screens/scene.js`.

## Commands

    python3 tools/floor_mask.py [scene ...]     # first-version floor masks (skips hand-edited ones)
    python3 tools/floor_depth.py [scene ...]    # the depth data (~5 min per scene on this PC)
    python3 tools/floor_depth.py --check        # predeploy runs this
    python3 tools/dev/floor_audit.py [scene]    # the audit below, into tools/shots/floor/

After painting a floor mask: add the scene to the table below, then run
floor_depth.py and floor_audit.py.

## Hand-edited floor masks

| scene | edited | note |
|---|---|---|

## Results, 2026-09-30 (first-version masks, nothing hand-painted yet)

Audit: `tools/shots/floor/<scene>-1-masks.png` (walk vs floor), `-regions.png`
(depth by colour, white where it jumps, hatched where the height came from the
floor mask), `-3-legacy.png` / `-4-floor.png` (the same test players in both
renderers, hidden parts outlined cyan), `-5-diff.png` (every player that looks
different, current | floor, feet circled, walk edge green, floor edge blue).

Test players stand only where the game lets feet stand, picked at full
resolution in eight kinds of place: in front of, behind, beside and between
objects, in passages, by furniture, walls and plants.

| scene | players | shoe px over a front object: current | floor | look different |
|---|---|---|---|---|
| vie-ext | 68 | 3 | 0 | 5 |
| vie-int | 112 | 9 | 0 | 8 |
| vie-up | 91 | 7 (1 player) | 0 | 7 |
| vie-venue | 23 | 0 | 0 | 1 |

Floor mask against walk mask (% of the picture):

| scene | walkable | hidden floor (walkable under the drawing) | floor feet cannot reach | not floor | unsure, under the drawing | unsure, visible |
|---|---|---|---|---|---|---|
| vie-ext | 18.2 | 5.5 | 0.5 | 15.7 | 64.9 | 0.7 |
| vie-int | 32.3 | 7.4 | 0.7 | 13.4 | 53.1 | 0.4 |
| vie-up | 17.7 | 5.4 | 0.4 | 25.6 | 50.2 | 6.0 |
| vie-venue | 40.0 | 14.7 | 2.9 | 6.8 | 47.6 | 2.6 |

Where the floor feet cannot reach is: under and between the three cafe tables
and the counter front (vie-venue); round the director's armchairs and the
entrance steps (vie-int); inside the gate posts (vie-ext). The large visible
unsure area in vie-up (x 36-64 %, y 75-88 %) is the ground floor seen down the
stairwell: floor, but another level.

Objects the build gave more than one depth (per-row from the measured height,
or split where stacked):

- vie-int, 19 of 23: all 8 tournament tables (north chair to front edge, for
  example table-r1 36.0 to 43.2), the 4 practice tables, the lobby's round
  table, the east lobby wall with its settee, the director's armchairs and
  globe, the building's walls.
- vie-up, 4 of 6: the trophy display, the game table, the trophy hall's east
  chair, the building's walls.
- vie-ext, 2 of 9: the building's walls and the north-east cafe tables.
- vie-venue, 3 of 27: the counter wall, the piano, the back wall.

Manual depth the automatic rule does NOT reproduce (still needed):

- vie-ext: lamp-w, tables-ne, chess-plinth, pillar-w/e, gate-w/e, gazebo,
  gazebo-statue, hedge-ne, table-ne-back
- vie-int: globe, plant-dir-sw, prac-nw/ne/sw, lamp-stair-w/e, settee-e,
  lamp-hall-w/e, gate-w, cypress-e, table-l4, balustrade-w/e
- vie-up: armchair-sw, plant-lounge-ne, game-table, lamp-lounge-w,
  lamp-upper-w/e, railing-top, display, bust-trophy-e
- vie-venue: plant-mid, piano

The rule agrees with 54 other hints (8, 23, 14, 9); they are left in place.

Uncertain, for a person to decide:

- Grey under the drawing is half of every picture. The build treats it as
  footprint, which is exactly the old assumption; the automatic mask adds
  little the walk mask did not already say. The real test is a hand-painted
  mask (the cafe first: the floor under the tables).
- Heights come from the walk mask's overlap band. Where it was painted shorter
  than the object is tall, the object's top is placed a little too far back.
  This only matters for a player standing beside the object.
- A player standing BESIDE a wall top (vie-int diff #97): the floor build hides
  the overlapping side up to the wall's height, the current renderer only the
  bottom fifth. Physically the floor build is consistent; which reads better
  is a judgement call.
- Hanging parts nothing holds: the stairwell balustrade in vie-up (x 46-54 %,
  y 23-31 %), a statue alcove in the vie-int tournament hall (x 80-82 %,
  y 28-32 %). They keep the line of the floor under them.

Cost: the vie-int depth has 1530 pieces (current 1085), the others about the
same as now; `assets/layers-floor` is 2.2 MB.

Verdict: at every one of the 21 players that look different, the floor build
is right or equal, bar the judgement call above. It also replaces several
special rules with one (`min(row + h, c)`). But both renderers are already
near zero on the shoe check, and the gain comes from heights the walk mask's
overlap already encoded, not from new floor knowledge. Promising, not yet
proven: play Vienna with L, have one floor mask painted, and only then roll it
out to other cities.
