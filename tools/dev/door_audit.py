#!/usr/bin/env python3
"""tools/dev/door_audit.py [scene ...] - every doorway, walked through, in both renderers.

A doorway is found on the game's own walk grid: walkable floor too narrow for a
disc of DOOR_W character heights, joining two open areas (rooms). Through each
one, test players stand on N spots along the passage (from one room, through
the opening, into the other) and at its two edges. Each spot is drawn by the
CURRENT renderer (js/data/sceneLayers.js) and by the FLOOR renderer
(js/data/sceneLayersFloor.js), one player per render, side by side.

Output: tools/shots/floor/doors-<scene>.png, one row per doorway: for each
spot a pair of tiles (current | floor), hidden parts of the player outlined in
cyan, the feet circled. Doorways are numbered and listed with their position.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import build_occlusion as bo  # noqa: E402
import floor_audit as fa  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
DOOR_W = 1.0          # character heights: narrower than this is a passage
SPOTS = 5             # spots along a passage (plus two at its edges)


def doorways(stand, A):
    """[(passage mask bbox, spots [(x, y)])] on the standable mask."""
    d = max(3, int(DOOR_W * A) | 1)
    disc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d))
    wide = cv2.morphologyEx(stand.astype(np.uint8), cv2.MORPH_OPEN, disc).astype(bool)
    narrow = stand & ~wide
    rooms, _ = ndimage.label(wide)
    parts, n = ndimage.label(narrow, structure=np.ones((3, 3)))
    out = []
    for i, sl in enumerate(ndimage.find_objects(parts), start=1):
        if sl is None:
            continue
        pad = (slice(max(0, sl[0].start - 3), sl[0].stop + 3), slice(max(0, sl[1].start - 3), sl[1].stop + 3))
        part = parts[pad] == i
        if part.sum() < 0.05 * A * A:
            continue
        touch = np.unique(rooms[pad][ndimage.binary_dilation(part, iterations=3) & (rooms[pad] > 0)])
        if len(touch) < 2:
            continue
        ys, xs = np.nonzero(part)
        ys, xs = ys + pad[0].start, xs + pad[1].start
        # the passage runs along its longer extent
        horizontal = (xs.max() - xs.min()) >= (ys.max() - ys.min())
        key = xs if horizontal else ys
        lo, hi = key.min() - int(0.4 * A), key.max() + int(0.4 * A)
        spots = []
        for t in np.linspace(lo, hi, SPOTS):
            # the middle of the walkable band across the passage at this point
            if horizontal:
                x = int(t)
                col = np.nonzero(stand[max(0, ys.min() - int(A)):ys.max() + int(A), x])[0] if 0 <= x < stand.shape[1] else []
                if len(col):
                    band = col + max(0, ys.min() - int(A))
                    mid = band[np.argmin(np.abs(band - int(np.median(ys))))]
                    spots.append((x, int(mid)))
            else:
                y = int(t)
                row = np.nonzero(stand[y, max(0, xs.min() - int(A)):xs.max() + int(A)])[0] if 0 <= y < stand.shape[0] else []
                if len(row):
                    band = row + max(0, xs.min() - int(A))
                    mid = band[np.argmin(np.abs(band - int(np.median(xs))))]
                    spots.append((int(mid), y))
        # the two edges of the opening, at its middle
        cx, cy = int(np.median(xs)), int(np.median(ys))
        if horizontal:
            col = np.nonzero(stand[:, cx])[0]
            near = col[np.abs(col - cy) < A]
            if near.size:
                spots += [(cx, int(near.min())), (cx, int(near.max()))]
        else:
            row = np.nonzero(stand[cy])[0]
            near = row[np.abs(row - cx) < A]
            if near.size:
                spots += [(int(near.min()), cy), (int(near.max()), cy)]
        spots = [(x, y) for x, y in spots if stand[y, x]]
        if spots:
            out.append(((xs.min(), ys.min(), xs.max(), ys.max()), spots))
    return out


def tile(art, slices, spr, fx, fy, A, W, H, label):
    rgb, owner = fa.render(art, slices, spr, [(fx, fy)])
    m, _b = fa.sprite_mask(spr, fx, fy, H, W)
    edge = m & ~ndimage.binary_erosion(m, iterations=1)
    px = rgb.clip(0, 255).astype(np.uint8)
    px[edge & (owner != 0)] = (0, 255, 255)
    cw, ch = int(1.5 * A), int(1.45 * A)
    xa, ya = max(0, min(W - cw, fx - cw // 2)), max(0, min(H - ch, int(fy - 1.15 * A)))
    zoom = max(1, int(round(150 / cw)))
    im = Image.fromarray(px[ya:ya + ch, xa:xa + cw]).resize((cw * zoom, ch * zoom), Image.NEAREST)
    d = ImageDraw.Draw(im)
    cx, cy = (fx - xa) * zoom, (fy - ya) * zoom
    d.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), outline=(255, 255, 0), width=2)
    d.rectangle((0, 0, cw * zoom, 11), fill=(0, 0, 0))
    d.text((2, 0), label, fill=(255, 255, 255))
    return im


def audit(scene):
    legacy = fa.load_js(os.path.join(ROOT, 'js', 'data', 'sceneLayers.js'), 'SCENE_LAYERS')[scene]
    floor = fa.load_js(os.path.join(ROOT, 'js', 'data', 'sceneLayersFloor.js'), 'SCENE_LAYERS_FLOOR')[scene]
    actor_h = bo.scene_actor_heights()[scene]
    art, _op, _walk = bo.load(scene)
    H, W = art.shape[:2]
    A = actor_h * H
    stand = fa.game_standable(legacy, W, H, actor_h)
    spr = fa.sprite(actor_h, H)
    doors = doorways(stand, A)
    if not doors:
        print(f'{scene:10} no doorways found')
        return
    sl_l, sl_f = fa.slice_images(legacy), fa.slice_images(floor)
    rows = []
    for k, (box, spots) in enumerate(doors):
        pairs = []
        for fx, fy in spots:
            lab = f'#{k} {fx / W * 100:.1f},{fy / H * 100:.1f}'
            a = tile(art, sl_l, spr, fx, fy, A, W, H, lab + ' CUR')
            b = tile(art, sl_f, spr, fx, fy, A, W, H, lab + ' FLOOR')
            pairs.append((a, b))
        rows.append(pairs)
        print(f'{scene:10} doorway #{k}: x {box[0] / W * 100:.1f}-{box[2] / W * 100:.1f}  y {box[1] / H * 100:.1f}-{box[3] / H * 100:.1f}  ({len(spots)} spots)')
    tw, th = rows[0][0][0].size
    cols = max(len(r) for r in rows)
    sheet = Image.new('RGB', (cols * (2 * tw + 10), len(rows) * (th + 6)), (15, 15, 15))
    for i, pairs in enumerate(rows):
        for j, (a, b) in enumerate(pairs):
            x = j * (2 * tw + 10)
            sheet.paste(a, (x, i * (th + 6)))
            sheet.paste(b, (x + tw + 1, i * (th + 6)))
    out = os.path.join(ROOT, 'tools', 'shots', 'floor', f'doors-{scene}.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)
    print(f'{scene:10} -> {os.path.relpath(out, ROOT)}')


if __name__ == '__main__':
    for s in [a for a in sys.argv[1:] if not a.startswith('--')] or [x for x in bo.SCENES if x.endswith(('-int', '-up'))]:
        audit(s)
