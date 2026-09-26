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

## Still to do (original masks, or my proposals awaiting approval)

nyc-up,
lon-ext, lon-int, lon-venue,
vie-ext, vie-int, vie-up, vie-venue,
ist-ext, ist-int, ist-up, ist-venue,
che-ext, che-int, che-venue,
wen-ext, wen-int, wen-up, wen-venue,
mad-ext, mad-int

Proposals (not in the game) go to `walkmask-proposals/<City>/`, untracked. A
proposal the artist approves moves into the city folder and into the table above
as "proposal approved".
