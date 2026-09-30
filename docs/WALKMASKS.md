# Walk masks: who drew what

`<City>/<scene>-walkmask.png` is the collision guide (light = feet may stand here;
black, and anything erased to transparent, is blocked). `tools/build_occlusion.py`
turns it into the game's walk grid. The masks as first delivered (v1.1.1) are kept
in `walkmasks-original/<City>/` for comparison.

Rule the hand edits follow (see the NYC ones): floor behind a LONE tree, lamp, post
or plant is walkable and the prop hides the player; its base stays solid. Rows of
trees, hedges, beds, walls and furniture stay blocked. Furniture blocks only its
real footprint (the table and chairs, not the rectangle round them).

## Hand-edited by the artist (source of truth, never regenerate)

These masks are the law: ship them exactly as delivered (a flattened export is
the one exception: the mask is recovered from it, nothing else changes). Nothing
else ever edits them.

| scene | edited | shipped |
|---|---|---|
| nyc-ext | 2026-09-26, updated 2026-09-29 (twice: behind the west bench hedge, hydrant, fountain edge) | v1.1.2, v1.1.11, v1.1.12 |
| nyc-int | 2026-09-26 | v1.1.2 |
| nyc-venue | 2026-09-26 | v1.1.2 |
| che-ext | 2026-09-26 | v1.1.4 |
| che-venue | 2026-09-26 (delivered flattened over the art; mask recovered by comparing against the art) | v1.1.4 |
| che-int | 2026-09-27 | v1.1.5 |
| lon-ext | 2026-09-27 | v1.1.5 |
| lon-venue | 2026-09-27 | v1.1.5 |
| nyc-up | 2026-09-27 (one fix with the artist's OK: a 4 px blocked line at x 912-916, y 454-482 px pinched the trophy-hall doorway to 15 px; opened, 133 px) | v1.1.6 |
| vie-ext | 2026-09-28, updated 2026-09-29 (saved flat on black: floor is dark grey ~90, read at half the brightest level) | v1.1.6, v1.1.11 |
| vie-int | 2026-09-28 | v1.1.6 |
| vie-up | 2026-09-28 | v1.1.6 |
| vie-venue | 2026-09-28 | v1.1.6 |
| ist-ext | 2026-09-28 | v1.1.7 |
| ist-int | 2026-09-28 | v1.1.7 |
| ist-up | 2026-09-28 | v1.1.7 |
| ist-venue | 2026-09-28 | v1.1.7 |
| lon-int | 2026-09-28 | v1.1.7 |
| wen-ext | 2026-09-28 | v1.1.7 |
| wen-up | 2026-09-28, updated 2026-09-30 | v1.1.7, v1.1.14 |
| wen-venue | 2026-09-28 | v1.1.7 |
| wen-int | 2026-09-28 (delivered flattened over the art; mask read from the overlay, the flattened file kept beside it) | v1.1.7 |
| mad-ext | 2026-09-29 (walking ends at the gate: the Leave spot moved up to it, y 84%) | v1.1.8 |
| mad-int | 2026-09-29 (only the aisle to the stage; scenes.js `crowd` puts the other finalists across both side openings) | v1.1.8 |

## Generated masks

None: every scene's mask is hand-edited since v1.1.8. The generator that made the
first-pass proposals (tools/propose_walkmasks.py) was removed on 2026-09-30; it is
in git history (last at 2e52007) if a new scene ever needs a first pass.
