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
their column. When a hand-cleaned layer arrives, move its row up to the table above.

| scene | pruned | shipped |
|---|---|---|
| nyc-ext | 2026-09-29 (tool) | v1.1.10 |
| nyc-venue | 2026-09-29 (tool) | v1.1.10 |
| lon-ext | 2026-09-29 (tool) | v1.1.10 |
| lon-int | 2026-09-29 (tool) | v1.1.10 |
| lon-venue | 2026-09-29 (tool) | v1.1.10 |
| vie-ext | 2026-09-29 (tool) | v1.1.10 |
| vie-int | 2026-09-29 (tool) | v1.1.10 |
| vie-up | 2026-09-29 (tool) | v1.1.10 |
| vie-venue | 2026-09-29 (tool) | v1.1.10 |
| ist-up | 2026-09-29 (tool) | v1.1.10 |
| ist-venue | 2026-09-29 (tool) | v1.1.10 |
| wen-ext | 2026-09-29 (tool) | v1.1.10 |
| wen-int | 2026-09-29 (tool) | v1.1.10 |
| wen-up | 2026-09-29 (tool) | v1.1.10 |
| wen-venue | 2026-09-29 (tool) | v1.1.10 |
| mad-ext | 2026-09-29 (tool) | v1.1.10 |
| mad-int | 2026-09-29 (tool) | v1.1.10 |

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
