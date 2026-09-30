#!/usr/bin/env python3
"""tools/dev/feet_check.py [scene ...] [--shots] - feet drawn over what stands in front of them.

A character is drawn from 92% of its height above the feet to 8% BELOW them
(css .pp-actor translate(-50%, -92%)): the shoes hang below the feet point.
Anything that stands in the rows under the feet (a south wall the walk mask
lets you walk behind, a pillar, a table front) is in front of the character
and must cover the shoes. This renders the scene's BUILT depth like scene.js
(slice z = 2*round(10*line), actor z = 2*round(10*feet)+1) and, for every
standable foot spot of the game's walk grid, counts shoe-strip px over the
artist's layer (the ORIGINAL layer: before any pruning) that nothing covers.

    python3 tools/dev/feet_check.py                  # all scenes, summary
    python3 tools/dev/feet_check.py vie-int --shots  # + tools/shots/feet/<scene>.png

Floor things in the layer (rugs, plaques, stair treads: NaN in the build's
own depth() run on the original layer) are not counted: shoes may cover a rug.
"""
import io
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import build_occlusion as bo  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
PRUNED_FROM = '90f2128'          # the artist's originals of the tool-pruned layers (docs/OCCLUSION.md)
SHOE_W = 0.20                    # half-width of the shoes, in character heights (canvas is 0.667 wide)
SHOE_H = 0.08                    # the canvas below the feet point


def built(scene, floor=False):
    """The previous renderer's data, or with floor=True the floor-mask data."""
    path, name = (('sceneLayersFloor.js', 'SCENE_LAYERS_FLOOR') if floor else ('sceneLayers.js', 'SCENE_LAYERS'))
    t = open(os.path.join(ROOT, 'js', 'data', path)).read()
    return json.loads(t[t.index('{', t.index(name)):t.rindex('};') + 1])[scene]


def over_z(d, W, H):
    """Highest slice z drawn at each scene px (-1 = none)."""
    atlas = np.asarray(Image.open(os.path.join(ROOT, d['atlas'].split('?')[0])).convert('RGBA'))[..., 3]
    z = np.full((H, W), -1, np.int32)
    for base, x, y, pw, ph, ax, ay, w, h in d['slices']:
        sz = int(round(base * 10)) * 2
        x0, y0 = int(round(x / 100 * W)), int(round(y / 100 * H))
        a = atlas[ay:ay + h, ax:ax + w] > 127
        hh, ww = min(h, H - y0), min(w, W - x0)
        sub = z[y0:y0 + hh, x0:x0 + ww]
        np.maximum(sub, np.where(a[:hh, :ww], sz, -1), out=sub)
    return z


def original_layer(scene, W, H):
    p = f'{bo.CITY_DIR[scene[:3]]}/{scene}-occlusion.png'
    listed = subprocess.run(['git', 'show', f'{PRUNED_FROM}:{p}'], cwd=ROOT, capture_output=True)
    hand = open(os.path.join(ROOT, 'docs', 'OCCLUSION.md')).read().split('## Pruned by the tool')[0]
    data = open(os.path.join(ROOT, p), 'rb').read() if (f'| {scene} |' in hand or listed.returncode) else listed.stdout
    lay = Image.open(io.BytesIO(data)).convert('RGBA').resize((W, H), Image.LANCZOS)
    alpha = bo.warp(np.asarray(lay)[..., 3].copy(), scene, (W, H), 1)
    return alpha >= bo.ALPHA


def check(scene, shots=False, floor=False):
    d = built(scene, floor)
    W, H = d['size']
    _art, _op, walk = bo.load(scene)
    walk_open, _ = bo.plant_walk(scene, _op, walk)
    A = bo.scene_actor_heights()[scene] * H
    layer = original_layer(scene, W, H)
    # what stands, by the build's own rules run on the ORIGINAL layer: floor
    # things (rugs, plaques, stair treads) come out as NaN and are not counted
    base, _k = bo.depth(scene, layer, walk, A / H)
    stand = layer & ~np.isnan(base)
    z = over_z(d, W, H)
    # the game's standable feet: the walk grid eroded by the walker (feet only)
    hw = max(1, int(max(0.010, 0.11 * A / H) * H))
    hd = max(1, int(max(0.006, 0.04 * A / H) * H))
    fit = ndimage.binary_erosion(walk_open, structure=np.ones((2 * hd + 1, 2 * hw + 1)))
    sw, sh = max(2, int(SHOE_W * A)), max(2, int(SHOE_H * A))
    # a foot spot every few px
    step = max(2, int(A * 0.06))
    bad = []
    for fy in range(0, H - 1, step):
        row = fit[fy]
        if not row.any():
            continue
        za = int(round(fy / H * 1000)) * 2 + 1
        y0, y1 = fy + 1, min(H, fy + 1 + sh)
        for fx in np.nonzero(row)[0][::step]:
            x0, x1 = max(0, fx - sw), min(W, fx + sw + 1)
            shown = stand[y0:y1, x0:x1] & (z[y0:y1, x0:x1] < za)
            n = int(shown.sum())
            if n >= 6:
                bad.append((n, fx, fy))
    bad.sort(reverse=True)
    total = int(fit[::step, ::step].sum())
    print(f'{scene:10} {"floor " if floor else "legacy"} spots {total:6}  feet over a front object at {len(bad):5} ({100 * len(bad) / max(1, total):4.1f}%)', flush=True)
    if shots and bad:
        art = Image.open(os.path.join(ROOT, 'assets', 'scenes', f'{scene}.webp')).convert('RGB')
        o = np.asarray(art).astype(float) * 0.55
        m = np.zeros((H, W), bool)
        for n, fx, fy in bad:
            m[fy + 1:min(H, fy + 1 + sh), max(0, fx - sw):fx + sw + 1] |= True
        o[m] = o[m] * 0.3 + np.array([255, 0, 200]) * 0.7
        im = Image.fromarray(o.astype('uint8'))
        os.makedirs(os.path.join(ROOT, 'tools', 'shots', 'feet'), exist_ok=True)
        im.save(os.path.join(ROOT, 'tools', 'shots', 'feet', f'{scene}.png'))
    return bad


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    for s in args or bo.SCENES:
        check(s, shots='--shots' in sys.argv, floor='--floor' in sys.argv)
