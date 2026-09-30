#!/usr/bin/env python3
"""tools/dev/leak_check.py [scene ...] [--legacy] [--shots] - thin leaks through what hides a player.

"Odd thin lines that leak": a player mostly hidden by a wall or a ceiling, with
a line of it 1-2 px wide still showing through. For every spot a player can
stand (the game's own walk grid, eroded by walkerFor), the sprite is placed as
scene.js places it (translate(-50%, -92%), max(40 px, stage * actorHeight)) and
compared with the depth slices drawn over it (slice z = 2*round(10*line),
player z = 2*round(10*feet%)+1):

  leak px   a visible sprite px in a horizontal run of at most LEAK px, with
            HIDDEN sprite px right before and right after it in that row (a
            vertical line through a hidden body), or the same down a column
            (a horizontal line) - counted only where the artist's ORIGINAL
            layer covers the px (alpha >= SOLID): a gap in the drawing itself
            (between leaves, between balusters) is meant to show the player

Scores the floor-mask data (js/data/sceneLayersFloor.js) or --legacy
(js/data/sceneLayers.js). --shots: tools/shots/floor/leaks-<scene>.png, the
worst spots marked. Summary per scene: spots with any leak, total leak px.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import build_occlusion as bo  # noqa: E402
import floor_mask as fm  # noqa: E402
import floor_audit as fa  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
LEAK = 2              # px: a visible run this thin between hidden px is a leak
STEP = 3              # px between tested feet spots
BODY_ALPHA = 127      # sprite px that count as body
SOLID = 16            # original-layer alpha from which a px is drawing, not a gap


def zfront(d, W, H):
    """Highest slice z covering each scene px (-1: none)."""
    z = np.full((H, W), -1, np.int32)
    for zz, x0, y0, tile in fa.slice_images(d):
        h, w = tile.shape[:2]
        h, w = min(h, H - y0), min(w, W - x0)
        a = tile[:h, :w, 3] > 127
        sub = z[y0:y0 + h, x0:x0 + w]
        np.maximum(sub, np.where(a, zz, -1), out=sub)
    return z


def thin_runs(vis, hid):
    """Visible px in runs of <= LEAK along axis 1 with hidden px right before and after."""
    out = np.zeros_like(vis)
    for i in range(vis.shape[0]):
        row = vis[i]
        if not row.any():
            continue
        d = np.diff(np.concatenate(([0], row.astype(np.int8), [0])))
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            if b - a <= LEAK and a > 0 and b < vis.shape[1] and hid[i, a - 1] and hid[i, b]:
                out[i, a:b] = True
    return out


def check(scene, legacy=False, shots=False):
    name, js = (('SCENE_LAYERS', 'sceneLayers.js') if legacy else ('SCENE_LAYERS_FLOOR', 'sceneLayersFloor.js'))
    d = fa.load_js(os.path.join(ROOT, 'js', 'data', js), name)[scene]
    W, H = d['size']
    actor_h = bo.scene_actor_heights()[scene]
    stand = fa.game_standable(d, W, H, actor_h)
    spr = fa.sprite(actor_h, H)
    body = spr[..., 3] > BODY_ALPHA
    sh, sw = body.shape
    z = zfront(d, W, H)
    solid = fm.original_alpha(scene, W, H) >= SOLID
    spots = 0
    bad = []
    total = 0
    for fy in range(0, H, STEP):
        xs = np.nonzero(stand[fy, ::STEP])[0] * STEP
        if not xs.size:
            continue
        za = int(round(fy / H * 1000)) * 2 + 1
        y0 = int(round(fy - 0.92 * sh))
        for fx in xs:
            x0 = int(round(fx - sw / 2))
            ya, yb, xa, xb = max(0, y0), min(H, y0 + sh), max(0, x0), min(W, x0 + sw)
            if yb <= ya or xb <= xa:
                continue
            m = body[ya - y0:yb - y0, xa - x0:xb - x0]
            front = z[ya:yb, xa:xb] > za
            vis, hid = m & ~front, m & front
            spots += 1
            if not hid.any() or not vis.any():
                continue
            leak = (thin_runs(vis, hid) | thin_runs(vis.T, hid.T).T) & solid[ya:yb, xa:xb]
            n = int(leak.sum())
            if n:
                total += n
                bad.append((n, int(fx), int(fy)))
    bad.sort(reverse=True)
    if shots:
        art = np.asarray(Image.open(os.path.join(ROOT, 'assets', 'scenes', f'{scene}.webp')).convert('RGB')).astype(np.float32) * 0.5
        img = Image.fromarray(art.astype(np.uint8))
        dr = ImageDraw.Draw(img)
        for n, fx, fy in bad[:400]:
            r = 2 + min(6, n // 4)
            dr.ellipse((fx - r, fy - r, fx + r, fy + r), outline=(255, 0, 200), width=2)
        out = os.path.join(ROOT, 'tools', 'shots', 'floor', f'leaks-{scene}{"-legacy" if legacy else ""}.png')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        img.save(out)
    return {'scene': scene, 'mode': 'legacy' if legacy else 'floor', 'spots': spots,
            'leaky_spots': len(bad), 'leak_px': total, 'worst': [[round(fx / W * 100, 1), round(fy / H * 100, 1), n] for n, fx, fy in bad[:8]]}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    for s in args or bo.SCENES:
        r = check(s, legacy='--legacy' in sys.argv, shots='--shots' in sys.argv)
        print(f'{s:10} {r["mode"]:6} spots {r["spots"]:6}  leaky {r["leaky_spots"]:5} ({100 * r["leaky_spots"] / max(1, r["spots"]):4.1f}%)'
              f'  leak px {r["leak_px"]:6}  worst {r["worst"][:3]}', flush=True)


if __name__ == '__main__':
    main()
