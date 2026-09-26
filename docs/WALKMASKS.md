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

| scene | edited | shipped |
|---|---|---|
| nyc-ext | 2026-09-26 | v1.1.2 |
| nyc-int | 2026-09-26 | v1.1.2 |
| nyc-venue | 2026-09-26 | v1.1.2 |
| che-ext | 2026-09-26 | v1.1.4 |
| che-venue | 2026-09-26 (delivered flattened over the art; mask recovered by comparing against the art) | v1.1.4 |

## Generated, approved as a first pass (not hand-edited yet)

`tools/propose_walkmasks.py` output, approved 2026-09-26 ("a big improvement, not
perfect but good for now"), shipped in v1.1.3. Light grey in these files is what the
generator added; white is the original. Still for the artist to clean by hand:

| scene | state | shipped |
|---|---|---|
| nyc-up | generated, approved | v1.1.3 |
| lon-ext | generated, approved | v1.1.3 |
| lon-int | generated, approved | v1.1.3 |
| lon-venue | generated, approved | v1.1.3 |
| vie-ext | generated, approved | v1.1.3 |
| vie-int | generated, approved | v1.1.3 |
| vie-up | generated, approved | v1.1.3 |
| vie-venue | generated, approved | v1.1.3 |
| ist-ext | generated, approved | v1.1.3 |
| ist-int | generated, approved | v1.1.3 |
| ist-up | generated, approved | v1.1.3 |
| ist-venue | generated, approved | v1.1.3 |
| che-int | generated, approved | v1.1.3 |
| wen-ext | generated, approved | v1.1.3 |
| wen-int | generated, approved | v1.1.3 |
| wen-up | generated, approved | v1.1.3 |
| wen-venue | generated, approved | v1.1.3 |
| mad-ext | generated, approved | v1.1.3 |
| mad-int | generated, approved | v1.1.3 |

When a hand-cleaned mask arrives, move its row to the hand-edited table.

## Generating proposals

    python3 tools/propose_walkmasks.py walkmask-proposals <scene> ...

Rules measured from the NYC hand edits (2026-09-26): furniture with floor on both
sides keeps its front 55% blocked (chamfered octagon), the rest walkable; potted
plants keep the pot; lamps/posts/trees/statues keep the base; floor carries on
0.38 character heights behind a front wall, balustrade or rail. Walls, shelves,
banners, gates, hedges, beds and fountains are untouched. Scored against the hand
edits: 75% (nyc-int) and 82% (nyc-venue) of what it opens matches.
