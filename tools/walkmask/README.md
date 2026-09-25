# Walk masks: how they were made

`build_walkmask.py` and `check_walkmask.py` came with the walk masks
(2026-09-24, in the city folders' zip files). They are kept for the record:
they ran against the artist's upload folders (`/mnt/user-data/...`) and the
retired `tools/build_layers.py`, so they do not run from here.

The masks they produced live in the city folders as `<scene>-walkmask.png`,
next to `<scene>-occlusion.png`. `tools/build_occlusion.py` turns both into
the game's data. `check_walkmask.py` erodes at the pixel, which is the body
size `js/core/freeWalk.js` matches by rounding to the nearest grid cell.
