#!/usr/bin/env python3
"""tools/dev/ceiling_view.py scene [scene ...] - what the floor build calls CEILING, over the art.

The ceiling (the cut tops of the walls: navy in Vienna, New York, Istanbul and
Madrid, dark lacquer in Wenzhou) is always drawn in front of a player. It is
found by colour (depth_hints.CEILING: Lab centres + radius per scene) and kept
only where the matching pixels form a big connected network (the walls round
the rooms), so a navy banner or a dark chair is not ceiling.
Output: tools/shots/floor/ceiling-<scene>.png (magenta = ceiling, cyan = the
same colour but dropped as too small).
"""
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import floor_depth as fd  # noqa: E402
import floor_mask as fm  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))


def main():
    for scene in sys.argv[1:]:
        art, opaque, _walk = fm.inputs(scene)              # no floor mask needed
        ceil, near = fd.ceiling_mask(scene, art, opaque, debug=True)
        o = art.astype(np.float32) * 0.45
        o[near & ~ceil] = o[near & ~ceil] * 0.3 + np.array((0, 230, 255)) * 0.7
        o[ceil] = o[ceil] * 0.3 + np.array((255, 0, 200)) * 0.7
        out = os.path.join(ROOT, 'tools', 'shots', 'floor', f'ceiling-{scene}.png')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        Image.fromarray(o.clip(0, 255).astype(np.uint8)).save(out)
        print(f'{scene:10} ceiling {ceil.mean() * 100:5.1f}% of the picture, same colour dropped {(near & ~ceil).mean() * 100:4.1f}%  -> {os.path.relpath(out, ROOT)}')


if __name__ == '__main__':
    main()
