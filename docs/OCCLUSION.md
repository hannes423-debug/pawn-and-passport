# Occlusion layers: who cleaned what

`<City>/<scene>-occlusion.png` is the depth guide: the scene with the floor
removed, everything that can stand in front of a character
(`tools/build_occlusion.py` explains how it becomes depth slices).

The artist cleans a layer by erasing everything that can never hide a
character: things on the floor (rugs, runners, floor plaques, steps), the far
back wall and everything on it, the buildings behind a garden, a front ledge
below the last row feet can reach. `tools/prune_occlusion.py` does the same by
test (see its header) for the layers not cleaned yet:

    python3 tools/prune_occlusion.py occlusion-proposals <scene> ...

## Cleaned by the artist (source of truth, never pruned)

| scene | cleaned | shipped |
|---|---|---|
| nyc-int | 2026-09-28 | v1.1.8 |
| nyc-up | 2026-09-28 | v1.1.8 |
| che-ext | 2026-09-28 | v1.1.8 |
| che-int | 2026-09-28 | v1.1.8 |
| che-venue | 2026-09-28 | v1.1.8 |
| ist-ext | 2026-09-28 | v1.1.8 |
| ist-int | 2026-09-28 | v1.1.8 |

## Pruned by the tool (the artist may clean these by hand later)

Shipped in v1.1.8 without review (artist: "fix and push, I wont have time to
review"); re-pruned from the artist's originals for v1.1.9 (reviewed in a
before/after preview) with the sliver rule: a column erased on its own left thin
strips of canopy standing between erased neighbours, drawn over characters as
stripes. `slivers()` + `trim_slivers()` in the tool take them off the top of
their column. Re-pruned again from the originals for v1.1.11 (doorway floor,
the new `fill` objects and the Club Principles sign change what can stand in
front). When a hand-cleaned layer arrives, move its row up to the table above.

| scene | pruned | shipped |
|---|---|---|
| nyc-ext | 2026-09-29 (tool) | v1.1.11 |
| nyc-venue | 2026-09-29 (tool) | v1.1.11 |
| lon-ext | 2026-09-29 (tool) | v1.1.11 |
| lon-int | 2026-09-29 (tool) | v1.1.11 |
| lon-venue | 2026-09-29 (tool) | v1.1.11 |
| vie-ext | 2026-09-29 (tool) | v1.1.11 |
| vie-int | 2026-09-29 (tool) | v1.1.11 |
| vie-up | 2026-09-29 (tool) | v1.1.11 |
| vie-venue | 2026-09-29 (tool) | v1.1.11 |
| ist-up | 2026-09-29 (tool) | v1.1.11 |
| ist-venue | 2026-09-29 (tool) | v1.1.11 |
| wen-ext | 2026-09-29 (tool) | v1.1.11 |
| wen-int | 2026-09-29 (tool) | v1.1.11 |
| wen-up | 2026-09-29 (tool) | v1.1.11 |
| wen-venue | 2026-09-29 (tool) | v1.1.11 |
| mad-ext | 2026-09-29 (tool) | v1.1.11 |
| mad-int | 2026-09-29 (tool) | v1.1.11 |

## Objects: depth set by hand (`OBJECTS` in tools/depth_hints.py)

The layer is one flat alpha and depth is read per pixel column, so wherever
two things overlap on screen (a street tree over a fence, a plant behind a
plant, a sign over a doorway) one column takes ONE ground line; and flat
things (short grass, floor logos, stairs) read as standing ones. An OBJECTS
entry sets a region's depth: a ground line, `None` (floor, never in front),
99 (always in front), `'rows'` (a side wall or handrail: each row where it
is) or `'bed'` (a flower bed seen from above). Kinds: `poly` (polygon or
rect), `foliage` (cut from the art by leaf colour, mask kept in
`tools/object-masks/`), `add` (an object the layer leaves out, cut from the
art by its difference from the floor round it).

Artist reports 2026-09-29 (v1.1.10) became entries in: nyc-ext, lon-ext,
lon-venue, vie-ext, vie-int, ist-ext, ist-int, ist-up, che-ext, wen-ext,
wen-int, wen-up, mad-ext, mad-int. Also general rules in build_occlusion.py:
a wall stands on its OWN blocked section (a passage through a wall no longer
gives the wall behind the front wall's line), a narrow side wall or pillar is
at the depth of each of its rows, and two footprints in one column split it.

v1.1.14 (2026-09-30): "feet shown on top of walls, tables, chairs". A
character is drawn 8% of its height BELOW its feet (css translate(-50%,-92%)),
and the shoes showed over whatever stands just in front. Three causes:
(1) a run the walk mask makes walkable all the way (the mask overlaps walls on
purpose: from this angle a wall hides the floor behind it) was taken for a
rug. A drawn part not ~all on walkable floor (WALLTOP_PART) is a structure:
blocked ground below = a wall top at its own bottom edge, else each row where
it is. Pinned after unify. The doorway-to-floor rule is off for hand-cleaned
layers (they have no floor left). (2) slices() floored ground lines to 0.5%,
about the shoe strip: now BIN 0.2. (3) slices() dropped depth pieces under
SPECK px, holes in chair and table edges: specks are filtered on the drawing
before slicing now. Measure: `tools/dev/feet_check.py [--shots]`.

v1.1.13 (2026-09-30): "player drawn over tables/stairs, walls glitch" in
lon-int, vie-int, ist-int. Three causes. (1) The v1.1.11 doorway rule floored
ANY narrow walkable run, including where feet overlap a wall top or a table
back; those px stopped hiding anybody and the prune then erased them (holes
along the lon-int dividing wall). A doorway is now a passage walled on both
sides (DOOR_SIDE) with open floor along it. (2) `rests_on()`: a layer px on
walkable floor can't stand further forward than the blocked thing right below
it in its run (ist-int wall edge had taken the entry pillar's line: stripes).
(3) The atlas URL never changed, so a browser holding the previous build's
atlas for 10 min drew every slice from the wrong place; the URL now carries
`?v=<hash>` and scene.js checks the atlas size against the data. Audit sheet
per scene: `tools/dev/audit_depth.py` (bodies between objects, real render).
vie-ext: the two umbrella tables are separate objects (back 44.3, front 47.6).

v1.1.11 (2026-09-29): interior doorways (a passage <= 1 actor height wide) are
floor; new kind `fill` (a polygon the layer lacks, drawn whole) for the nyc-ext
terrace umbrella tables; che-venue statue and che-ext palms given lines; nyc-ext
Club Principles sign is a signpost (line at its posts' foot, 57), not floor:
the strip between it and the bench + knight statue behind is walkable.
