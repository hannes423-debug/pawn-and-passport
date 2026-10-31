#!/usr/bin/env python3
"""tools/dev/hidden_map.py [scene ...] [--legacy] [--step=PCT] - how much of a player is hidden, everywhere.

For every standable spot of the game's own walk grid (a spot every STEP % of the
picture's height), the share of a player standing there that the depth slices
draw over, with the game's own sprite, size, foot anchor and stacking rule
(z = round(line * 10) * 2 for a slice, round(feet * 10) * 2 + 1 for a player).

Output: tools/shots/floor/hidden-<scene>.png, the scene with a dot per spot:
green = all of the player shows, yellow = some hidden, red = most hidden.
A red patch in the open (on a rug, in a doorway, on steps) is floor the layer
draws in front of the player: give it an OBJECTS entry with line None.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import build_occlusion as bo  # noqa: E402
import floor_audit as fa  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'tools', 'shots', 'floor')


def front_z(slices, W, H):
    """Per pixel, the highest z of the slices drawn there (-1 where none is)."""
    z = np.full((H, W), -1, np.int32)
    for zz, x0, y0, tile in slices:
        h, w = tile.shape[:2]
        xa, ya, xb, yb = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
        if xb <= xa or yb <= ya:
            continue
        m = tile[ya - y0:yb - y0, xa - x0:xb - x0, 3] > 127
        sub = z[ya:yb, xa:xb]
        sub[m] = np.maximum(sub[m], zz)
    return z


def hidden_spots(scene, legacy=False, step=0.8):
    data = fa.load_js(os.path.join(ROOT, 'js', 'data', 'sceneLayers.js' if legacy else 'sceneLayersFloor.js'),
                      'SCENE_LAYERS' if legacy else 'SCENE_LAYERS_FLOOR')[scene]
    actor_h = bo.scene_actor_heights()[scene]
    art, _op, walk = bo.load(scene)
    H, W = walk.shape
    stand = fa.game_standable(data, W, H, actor_h)
    spr = fa.sprite(actor_h, H)
    alpha = spr[..., 3] > 127
    sh, sw = alpha.shape
    z = front_z(fa.slice_images(data), W, H)
    d = max(2, int(step / 100 * H))
    out = []
    for fy in range(d // 2, H, d):
        for fx in range(d // 2, W, d):
            if not stand[fy, fx]:
                continue
            pz = int(round(fy / H * 1000)) * 2 + 1
            x0, y0 = int(round(fx - sw / 2)), int(round(fy - 0.92 * sh))
            xa, ya, xb, yb = max(0, x0), max(0, y0), min(W, x0 + sw), min(H, y0 + sh)
            m = alpha[ya - y0:yb - y0, xa - x0:xb - x0]
            if not m.any():
                continue
            hid = (z[ya:yb, xa:xb][m] > pz).mean()
            out.append((fx, fy, float(hid)))
    return art, out


def draw(scene, art, spots, d, tag=''):
    im = Image.fromarray((art[..., :3] * 0.55).astype(np.uint8))
    dr = ImageDraw.Draw(im)
    r = max(2, d // 3)
    for fx, fy, hid in spots:
        col = (40, 220, 60) if hid < 0.05 else (240, 220, 40) if hid < 0.5 else (255, 40, 40)
        dr.ellipse((fx - r, fy - r, fx + r, fy + r), fill=col)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'hidden-{scene}{tag}.png')
    im.save(path)
    return path


def main():
    legacy = '--legacy' in sys.argv
    step = next((float(a.split('=')[1]) for a in sys.argv if a.startswith('--step=')), 0.8)
    scenes = [a for a in sys.argv[1:] if not a.startswith('--')] or bo.SCENES
    for scene in scenes:
        art, spots = hidden_spots(scene, legacy, step)
        H = art.shape[0]
        path = draw(scene, art, spots, max(2, int(step / 100 * H)), '-legacy' if legacy else '')
        red = sum(1 for s in spots if s[2] >= 0.5)
        print(f'{scene:10} spots {len(spots):5d}  mostly hidden {red:4d}  -> {os.path.relpath(path, ROOT)}')


if __name__ == '__main__':
    main()
