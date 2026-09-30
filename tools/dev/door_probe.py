#!/usr/bin/env python3
"""tools/dev/door_probe.py SCENE x0 y0 x1 y1 [step%] [--legacy] - players on EVERY standable
spot of a small area (a doorway, a wall end), drawn the way the game draws them.

One player per render (so none cover another), all composited as a contact sheet:
each tile is the area with one player, hidden parts outlined cyan, feet circled.
Uses the floor-mask data (js/data/sceneLayersFloor.js) or --legacy
(js/data/sceneLayers.js). Output: tools/shots/floor/door-<scene>-<x0>-<y0>[-legacy].png
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import build_occlusion as bo  # noqa: E402
import floor_audit as fa  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    scene = args[0]
    x0, y0, x1, y1 = map(float, args[1:5])
    step = float(args[5]) if len(args) > 5 else 1.0
    legacy = '--legacy' in sys.argv
    data = fa.load_js(os.path.join(ROOT, 'js', 'data', 'sceneLayers.js' if legacy else 'sceneLayersFloor.js'),
                      'SCENE_LAYERS' if legacy else 'SCENE_LAYERS_FLOOR')[scene]
    heights = bo.scene_actor_heights()
    actor_h = heights[scene]
    art, _op, walk = bo.load(scene)
    H, W = walk.shape
    stand = fa.game_standable(data, W, H, actor_h)
    spr = fa.sprite(actor_h, H)
    slices = fa.slice_images(data)
    A = actor_h * H
    feet = []
    for yp in np.arange(y0, y1 + 1e-6, step):
        for xp in np.arange(x0, x1 + 1e-6, step):
            fx, fy = int(xp / 100 * W), int(yp / 100 * H)
            if 0 <= fx < W and 0 <= fy < H and stand[fy, fx]:
                feet.append((fx, fy))
    if not feet:
        sys.exit('no standable spot in that area')
    cw, ch = int(1.6 * A), int(1.5 * A)
    zoom = max(1, int(round(220 / cw)))
    tiles = []
    for fx, fy in feet:
        rgb, owner = fa.render(art, slices, spr, [(fx, fy)])
        m, _b = fa.sprite_mask(spr, fx, fy, H, W)
        edge = m & ~ndimage.binary_erosion(m, iterations=1)
        px = rgb.clip(0, 255).astype(np.uint8)
        px[edge & (owner != 0)] = (0, 255, 255)
        xa, ya = max(0, min(W - cw, fx - cw // 2)), max(0, min(H - ch, int(fy - 1.2 * A)))
        crop = Image.fromarray(px[ya:ya + ch, xa:xa + cw]).resize((cw * zoom, ch * zoom), Image.NEAREST)
        d = ImageDraw.Draw(crop)
        cx, cy = (fx - xa) * zoom, (fy - ya) * zoom
        d.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), outline=(255, 255, 0), width=2)
        d.rectangle((0, 0, cw * zoom, 12), fill=(0, 0, 0))
        d.text((2, 0), f'{fx / W * 100:.1f},{fy / H * 100:.1f}', fill=(255, 255, 255))
        tiles.append(crop)
    cols = min(8, len(tiles))
    rows = (len(tiles) + cols - 1) // cols
    tw, th = tiles[0].size
    sheet = Image.new('RGB', (cols * (tw + 4), rows * (th + 4)), (20, 20, 20))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * (tw + 4), (i // cols) * (th + 4)))
    out = os.path.join(ROOT, 'tools', 'shots', 'floor', f'door-{scene}-{x0:g}-{y0:g}{"-legacy" if legacy else ""}.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)
    print(f'{len(feet)} spots -> {os.path.relpath(out, ROOT)}')


if __name__ == '__main__':
    main()
