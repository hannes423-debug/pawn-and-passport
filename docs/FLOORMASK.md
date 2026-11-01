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
    python3 tools/dev/hidden_map.py [scene]      # every standable spot coloured by how much of a player is hidden

After painting a floor mask or delivering a new layer: add the scene to the
table below (masks), then run floor_depth.py and leak_check.py.

## Hand-edited floor masks

| scene | edited | note |
|---|---|---|

## Accuracy: the layer is not cut from this art (v1.2.9, 2026-11-01)

From the user's Vienna screenshots: paving drawn over characters round lamp
posts and trees, and gates drawn solid. The artist's layer was cut from a
slightly different render of each scene: after the per-scene affine WARP its
objects are still 1-5 px off the art, a different way for each object.

- `fm.aligned_layer()`: the layer is moved onto the art by a dense optical flow
  (OpenCV DIS, art vs the layer laid over the art, capped at FLOW_MAX = 6 px);
  its alpha is resampled NEAREST at every step, or a gate's 2-3 px gaps blur
  shut. Every tool reading `original_alpha` (the build, leak_check) gets it.
- The pruned layer is still loaded unaligned for the legacy movement; its use
  in rule 4 ("erased by pruning = floor") gets PRUNED_SLACK = 2 px. Without it
  every bar and post lost its right column and was drawn shifted left.
- `paving()` in floor_depth.py, px that are never drawn (depth itself is still
  worked out from the layer as drawn):
  - the RING never takes the visible floor's colour (PAVE_*), nor a gap 2+ px
    wide with drawing on both sides (GAP_ALPHA);
  - inside the layer, only where the layer's own px disagrees with the art and
    the object lies on both sides (gaps), never along one edge: a wooden chair
    rail on parquet reads as floor and must stay;
  - iron (DARK_GAP under the floor's lightness) comes from the ART: gaps between
    bars and halos beside posts are dropped, iron the layer missed is drawn;
  - cast shadows painted into the layer (the floor's hue, SHADOW_*).
- vie-ext `table-ne-back` follows the umbrella canopy: the box took the hedge.

leak_check counts every gap these open as a leak (it scores against the
layer's alpha), so it rose in every scene by design. Judge changes with
door_probe renders of the old build (a git worktree of HEAD) beside the new.

## Upright things cut along their outline (v1.2.11, 2026-11-01)

From the user's nyc-ext and vie-ext phone screenshots: potted cones, bushes,
lamps and street trees cut into columns at different depths (a cone in front
of a player at one column and behind them at the next; a pot drawn over a
player's legs while its cone stayed behind them), two club members drawn
behind the open gates.

- New OBJECTS kind `'cut'` (both builds): `(rect, [seed rects], [bg rects])`.
  A watershed on the art from the seeds (inside the thing) against the rect's
  surround (CUT_RING px) and the bg rects (what stands behind it), grown
  CUT_GROW px so a post keeps its dark rim. The art alone decides, so both
  builds get one cut; kept in `tools/object-masks/<scene>-<id>.png`, hashed
  into both builds' source stamps (delete one to re-cut, then rebuild).
  Each cut stands at its pot's (or post's) foot; a lamp comes after the bush
  it stands in front of, and the leaves round its top go to the bush.
- nyc-ext: 16 cuts (terrace cones and bush, lamps, the west bench cone and
  bush, both potted bushes, both street lamps and street trees); the sidewalk
  fence stands at its foot (85.2), not at the east tree's line. The gate hints
  stopped at the gates' free-end posts: wider, they gave the hedge beside each
  post the gate's line, drawn over Hector's and Dev's heads. Both members also
  stand in the passage between the gates now (place-members.mjs PINS: a full
  re-run of that tool moves most members, since memberSpots.js predates the
  current walk masks, so only these two were changed).
- vie-ext: 15 cuts (every potted cone and urn in the courtyard and on the
  terrace, the pots at the gazebo, the bushes beside the west bench).
- Measured against v1.2.10: mostly hidden spots nyc-ext 529 -> 446, vie-ext
  382 -> 397 (players right behind the terrace urn are now behind its cone too);
  leak px nyc-ext 57,569 -> 57,728, vie-ext 90,856 -> 91,091.

Note for readers of a line map: a slice whose line no standable feet row can
tell apart from 99 (nobody can stand in front of it within reach) is SNAPPED
to 99 (`bo.slices`); 99 in a slice dump is not always "hangs in front".

## Chennai, and the player never vanishes (v1.2.12, 2026-11-01)

From the user's che-ext and che-int phone screenshots: a player behind an open
gate leaf with only the head showing, a player gone behind a palm, a player in
a study doorway hidden by the wall south of it.

- che-ext: the open gate leaves were drawn solid in their lower half (the floor
  between the bars too). New OBJECTS line `'gaps'` (floor_depth.py only): inside
  the shape, px no darker than GAPS_DARK under the visible floor round it and
  within GAPS_HUE of its hue are never drawn, and the soft-edge ring may not
  close them again. The two lower palms are `'cut'` objects at the trunk's foot
  (65.6): each trunk was always in front (a stripe down a player on the path in
  front of it) and the crown over the stone pillar took the pillar's line (86).
- che-int: the cap of the low wall south of each study doorway, and the lintel
  strip joining it to the wall north of it, stand at 66.6, the doorway's first
  row: a player in the doorway is in front of its jambs (the user's rule).
- X-ray (js/ui/screens/scene.js, `XRAY`): a player behind the palm crown or the
  gate is behind it, rightly, and was lost there. Wherever a depth slice is drawn
  in front of the player, that part of them is drawn again over it at 45 %
  opacity (`.pp-xray`, z 2100, from the atlas and the slices on the stage, the
  same stacking rule). Nothing changes where the player is in the open. The
  canvas is not a `.pp-actor`: the test drivers take the last one as the player.
- Measured against v1.2.11: mostly hidden spots che-ext 1223 -> 1216, che-int
  124 -> 102; leak px che-ext 168,152 -> 169,604 (the gaps opened count as leaks),
  che-int 7,826 -> 6,840. The che-ext red patches left are a player rightly
  behind the gate arch sign, the porch sign and the palm crowns: the x-ray shows
  them there.

## Nothing hides a player standing in front of it (v1.2.13, 2026-11-01)

From the user's che-ext screenshot: the x-ray (v1.2.12) showing on a player
standing on the paving in front of a flower bed. The x-ray was right: the bed
was drawn over them. Two rounding steps put every object's line too far down
the picture, so it covered the floor right in front of it:

- The box rule rounds each row's line DOWN the picture to steps of STEP
  character heights (0.8 % in che-ext). Its front face stands at the contact
  row c (`min(row + h, c)`), but the step carried it past c: a bed meeting the
  floor at 46.04 stood at 46.4, over a player at 46.2. The step is capped at c,
  rounded up to the bin.
- The last round-up to the bin used a tolerance of 1e-6 bins, under float32's
  error: 46.4 is held as 46.4000015 and went to 46.6, a whole bin (2 px) down
  the picture. ROUND_EPS = 1e-3 bins.

Every scene was rebuilt. Measured on every standable spot every 2 px, a
player mostly hidden by something whose line is within the shoe strip below
their feet (the drawn shoes reach past its front edge: they look in front):
3,297 -> 2,295 spots in all, che-ext 284 -> 2, nyc-ext 568 -> 301, ist-ext
226 -> 125. What is left is mostly right: a player behind a potted cone or on
a low wall's top, behind its face.

The HUD level badge (dark "15" on gold) had taken the floating HUD's 2 px dark
outline and become a black blob: `text-shadow: none` on `.pp-hud__badge`.

## The study doorways, and names that cover nobody (v1.2.14, 2026-11-01)

From the user's che-int screenshot: the player standing ON the low wall south
of the east study doorway, and Hiro's name drawn over Rahul's body.

- The walk mask lets feet across the cap of the low wall at each study
  doorway (the opening itself, between the cap and the wall end north of it,
  is narrower than a character). v1.2.11 had the cap in front (the player
  vanished behind it), v1.2.12 behind (the player stood on top of it). It is
  the top of a wall running up the picture, so it is `'rows'` now: feet on the
  cap are behind its rows below them, and the body shows above it (the x-ray
  shows the legs). In the opening the player is drawn whole, as before.
- A member's name used to appear a row above their speech bubble, a body and a
  half above their feet: in a crowded lobby that is the body of whoever stands
  behind. The name takes the bubble's place now (the bubble steps aside), then
  `placeName()` (scene.js) tries the bubble's place, above it, under the
  member's feet and beside the head, and takes the first that covers no other
  character (else the one covering least).

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

2026-10-31 (user: "the rug hides the player, and the floor at the doorways",
London club): `hidden_map.py` over every scene found floor drawn into the
layer in five scenes, now OBJECTS entries with line None: the lon-int entrance
mat, its two side doorways and the staircase's wooden sides; the vie-int
Tournament Hall dais steps; the mad-int stage steps; the nyc-venue terrace
stairs. The lon-venue arch's inner pillars were 99 (always in front) and hid a
player standing in front of their bases: now at their foot (33.2). Mostly
hidden spots: lon-int 311 -> 44 (the rest behind potted plants), mad-int
84 -> 56, vie-int 144 -> 126, nyc-venue 854 -> 807, lon-venue 1438 -> 1377.
The other red patches the map shows are a player rightly behind something
(signs, gates, trees, walls).

The previous renderer (js/data/sceneLayers.js) is still built and checked:
`L` in the game or `?depth=legacy` compares the two anywhere.
