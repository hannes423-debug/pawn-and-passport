# Floor-mask depth

Every scene's depth (what is drawn in front of a player) is built from three
separate sources. Started 2026-09-30 as a Vienna experiment (v1.1.15); rolled
out to every club the same day (v1.1.17) after the Vienna test. Nothing here
changes how anybody walks: the walk grid is a copy of the previous one.

## Three masks, three jobs

| source | file | says | used for |
|---|---|---|---|
| walk mask | `<City>/<scene>-walkmask.png` | where FEET may stand | collision, paths (unchanged) |
| floor mask | `<City>/<scene>-floormask.png` | where the GROUND is, reachable or not | depth only |
| occlusion | the artist's layer, as drawn | what may be drawn in front of a player | the pixels of every depth slice |
| ceiling | `CEILING` in tools/depth_hints.py | the cut tops of the walls | always in front |

The occlusion source is the artist's layer as they drew it: for the 7 layers
the artist cleaned by hand (docs/OCCLUSION.md) that is `<scene>-occlusion.png`;
for the 17 the tool pruned it is `<scene>-occlusion-original.png`, restored
from git (90f2128). No tool ever writes either.

Not walkable does not mean solid. Floor under a table, a strip behind a
railing, the floor a wall hides from this angle are all floor the feet cannot
reach, and they decide where an object meets the ground.

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

## The ceiling (user, 2026-09-30)

In the club interiors the tops of the walls are drawn as a dark band, the
"ceiling": navy in Vienna, New York, Istanbul and the Madrid finale hall. The
ceiling is ALWAYS in front of a player. The wall face under it (the beige
pillar at a Vienna doorway, the end of the wall north of the opening) is not
ceiling: it stands where it meets the floor, so a player in the doorway is in
front of it.

Found by colour: `CEILING[scene] = {'lab', 'px', 'med', 'min'}` (OpenCV Lab
centre, per-pixel radius, the radius a whole piece's median must be within,
the smallest piece as a share of the picture). New York's navy banners are
bluer than its ceiling and drop out on the median test. The ceiling's own
side outline (a bevel line in another colour, 4-5 px) joins it sideways only,
never downwards onto the wall face. London and Chennai draw low walls with
light stone caps, Wenzhou dark wood the colour of its furniture: no ceiling by
colour there. Check a scene: `python3 tools/dev/ceiling_view.py <scene>`.

## How depth is built (`tools/floor_depth.py`)

Per pixel column, each run of the layer (the ceiling excluded, it is 99) is
read downwards. A layer pixel over floor is the object in front of the floor
it hides; over not-floor it is the object's footprint.

1. A run splits where a footprint gives way to floor below it: two things
   stacked in one column (a chair behind a table) become separate regions.
2. A region meets the ground where the floor resumes under its footprint.
   What is drawn below that, over walkable floor (a base moulding, a shadow,
   the floor in a doorway under its jamb), is floor-level and stands with it.
3. The floor hidden above a footprint is the object's drawn HEIGHT h. An
   object of height h on footprint rows t..c draws its top at rows t-h..c-h
   and its front at c-h..c, so each pixel stands at `min(row + h, c)`: in
   front of a player at one row, behind at the next (a long table, a wall top,
   the north chair of a chess table). With no hidden floor it stands at c.
4. A region with no footprint at all (leaves over the floor, a lintel) takes
   the line of what holds it, nearest first; the manual `HINTS` apply to these.
   If the PRUNED layer erased it (no player ever stands behind it) and it lies
   on walkable floor, it is floor drawn into the layer (tiles running into a
   doorway, stair treads) and is dropped.
5. The manual `OBJECTS` apply as before.
6. Clean-up, all of it rounding FORWARD (covering a little more, never showing
   feet over anything): the layer's soft edge (alpha 16-127) joins the object
   it is the edge of; a thin dip (a line lower than on both sides, up to 4 px
   either way, at most a character height) comes forward to its sides; every
   line is rounded UP to the 0.2 % bin before slicing (slicing used to round
   down and put an object 2 px behind where it stands).

Output: `js/data/sceneLayersFloor.js` and `assets/layers-floor/*.webp`.

## Switching

- In any scene: `L` swaps between the floor-mask depth and the previous
  renderer, live, where the player stands. A toast says which one is on.
- `?depth=legacy` starts on the previous renderer, `?depth=floor` on this one.
- To go back for everybody: `DEPTH_DEFAULT = 'legacy'` in
  `js/ui/screens/scene.js`. The previous data (js/data/sceneLayers.js,
  assets/layers) is still built and checked, so it keeps working.

## Commands

    python3 tools/floor_mask.py [scene ...]      # first-version floor masks (skips hand-edited ones)
    python3 tools/floor_depth.py [scene ...]     # the depth data (~25 s a scene)
    python3 tools/floor_depth.py --check         # predeploy runs this
    python3 tools/dev/leak_check.py [scene] [--legacy] [--shots]   # thin lines of a player showing through
    python3 tools/dev/door_audit.py [scene]      # every doorway walked through, both renderers
    python3 tools/dev/door_probe.py SCENE x0 y0 x1 y1 [step]      # every spot of one small area
    python3 tools/dev/ceiling_view.py SCENE      # what counts as ceiling
    python3 tools/dev/floor_audit.py [scene]     # the Vienna-era audit: masks, regions, test players

After painting a floor mask or delivering a new layer: add the scene to the
table below (masks), then run floor_depth.py and leak_check.py.

## Hand-edited floor masks

| scene | edited | note |
|---|---|---|

## Results

Measured 2026-09-30 on every standable spot of the game's own walk grid (a
spot every 3 px), with the game's own sprite, size and foot anchor:

- **leak px**: `tools/dev/leak_check.py`, pixels of a player showing through
  something that hides the rest of them as a line 1-2 px wide (counted only
  where the artist drew something, not in a gap between leaves or bars).
- **shoe spots**: `tools/dev/feet_check.py`, spots where the shoes (drawn 8 %
  of a character below the feet) show over a drawing that stands below them.
  It predates the doorway rule and counts "player in front of the doorway's
  pillar base" as an error: the nyc-int, vie-int and ist-up rises are that
  rule, checked by eye.

| scene | leak px, previous | leak px, floor | shoe spots, previous | shoe spots, floor |
|---|---|---|---|---|
| nyc-ext | 54,687 | 9,490 | 63 | 23 |
| nyc-int | 10,475 | 1,323 | 42 | 196 |
| nyc-up | 5,038 | 2,046 | 4 | 32 |
| nyc-venue | 134,826 | 2,740 | 239 | 21 |
| lon-ext | 12,698 | 772 | 56 | 11 |
| lon-int | 3,869 | 14 | 41 | 11 |
| lon-venue | 135,117 | 2,927 | 64 | 22 |
| vie-ext | 40,450 | 21,578 | 191 | 123 |
| vie-int | 12,012 | 2,874 | 202 | 246 |
| vie-up | 12,404 | 1,723 | 133 | 7 |
| vie-venue | 53,979 | 53,256 | 58 | 16 |
| ist-ext | 84,265 | 2,145 | 87 | 91 |
| ist-int | 11,107 | 1,128 | 46 | 19 |
| ist-up | 5,312 | 2,113 | 48 | 200 |
| ist-venue | 52,828 | 2,049 | 73 | 51 |
| che-ext | 140,286 | 14,206 | 16 | 29 |
| che-int | 2,639 | 159 | 78 | 17 |
| che-venue | 165,507 | 4,045 | 16 | 76 |
| wen-ext | 42,780 | 9,413 | 203 | 124 |
| wen-int | 3,654 | 627 | 55 | 19 |
| wen-up | 7,332 | 2,854 | 134 | 116 |
| wen-venue | 311,222 | 30,521 | 126 | 70 |
| mad-ext | 26,284 | 8,644 | 161 | 159 |
| mad-int | 6,250 | 110 | 9 | 4 |
| **total** | **1,335,021** | **176,757** | **2,145** | **1,683** |

Leaks are 87 % fewer and fewer in every scene; shoe spots 22 % fewer.

Still open, for a person (or a floor mask) to decide:

- nyc-ext: the two open wrought-iron gates, drawn diagonally. One gate spans
  several depths, and its bars over the hedge behind it take the hedge's line:
  a player standing behind a gate shows through some bars (the worst leak in
  the game now, 66 px at 59.9 %, 74.5 %).
- vie-venue: leaks barely moved (53,979 -> 53,256): the cafe's tables, chairs
  and railings stand close together and the walk mask gives them little room.
  A hand-painted floor mask (floor under the tables white) is the fix.
- che-ext (81 px at 81.4 %, 52.5 %), vie-ext (63 px at 42.3 %, 81.1 %) and
  wen-venue (34 px at 4.6 %, 45.0 %): the worst remaining spots.
- The grey (unsure) parts of every floor mask are treated as footprint, as
  before. Painting them is the next step wherever something still looks wrong.

The previous renderer (js/data/sceneLayers.js) is still built and checked:
`L` in the game or `?depth=legacy` compares the two anywhere.
