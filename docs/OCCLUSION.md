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
| nyc-ext | 2026-09-29 (tool) | v1.1.9 |
| nyc-venue | 2026-09-29 (tool) | v1.1.9 |
| lon-ext | 2026-09-29 (tool) | v1.1.9 |
| lon-int | 2026-09-29 (tool) | v1.1.9 |
| lon-venue | 2026-09-29 (tool) | v1.1.9 |
| vie-ext | 2026-09-29 (tool) | v1.1.9 |
| vie-int | 2026-09-29 (tool) | v1.1.9 |
| vie-up | 2026-09-29 (tool) | v1.1.9 |
| vie-venue | 2026-09-29 (tool) | v1.1.9 |
| ist-up | 2026-09-29 (tool) | v1.1.9 |
| ist-venue | 2026-09-29 (tool) | v1.1.9 |
| wen-ext | 2026-09-29 (tool) | v1.1.9 |
| wen-int | 2026-09-29 (tool) | v1.1.9 |
| wen-up | 2026-09-29 (tool) | v1.1.9 |
| wen-venue | 2026-09-29 (tool) | v1.1.9 |
| mad-ext | 2026-09-29 (tool) | v1.1.9 |
| mad-int | 2026-09-29 (tool) | v1.1.9 |

## Cut-out objects

A freestanding object drawn over something further back in the same layer (a
street tree in front of the fence) takes the BACK thing's ground line, column by
column, so a character between the two is drawn over it. `OBJECTS` in
`tools/depth_hints.py` names such objects; `tools/build_occlusion.py` cuts
each from the art once into `tools/object-masks/<scene>-<id>.png` (committed;
delete one to re-cut) and gives all of it the object's ground line.

| scene | object | since |
|---|---|---|
| nyc-ext | street-tree-w (by the taxi) | v1.1.9 |
