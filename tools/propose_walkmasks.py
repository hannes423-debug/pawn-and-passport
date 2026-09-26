#!/usr/bin/env python3
# tools/propose_walkmasks.py OUT_DIR scene... : proposals from walkmasks-original/ into OUT_DIR/<City>/ (see docs/WALKMASKS.md)
"""Walk-mask proposals learned from the artist's NYC edits (2026-09-26).
A prop standing on the floor keeps only its FOOTPRINT blocked; the rest of its
silhouette becomes walkable where there is floor behind it (so the prop hides
the player). Nothing opens against a wall. Walls, pillars, shelves, banners,
gates, hedges and garden beds are never touched."""
import sys, os, re
ROOT = os.path.expanduser('~/Työpöytä/Pawns')
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import numpy as np
from PIL import Image
from scipy import ndimage
from depth_hints import HINTS
from build_occlusion import CITY_DIR, SCENES, scene_actor_heights

FURN = re.compile(r'(^|-)(tables?|desks?|bench(es)?|chairs?|settees?|sofas?|armchairs?|couch|sidetable|stools?|piano|counter|cart|ottoman|lectern|podium|easel|globe|tea|board|chess|prac|study)(-|$|\d)')
POTTED = re.compile(r'(^|-)(plants?|pots?|urns?|vase|topiary|bonsai|bamboo|fern|ficus)(-|$|\d)')
POST = re.compile(r'(^|-)(lamps?|streetlamps?|lanterns?|posts?|lamppost|pole|bollards?|statue|bust|hydrant|trees?|cypress|pine|olive|palm|willow)(-|$|\d)')
FOUNT = re.compile(r'fountain')
heights = scene_actor_heights()

def kind(pid):
    if re.search(r'(^|-)(bed|beds|hedge|planter|wall|rail|fence|gate|pillar|shelf|banner|sign)(-|$|\d)', pid): return None
    if FOUNT.search(pid): return None
    if FURN.search(pid): return 'furniture'
    if POTTED.search(pid): return 'potted'
    if POST.search(pid): return 'post'
    return None

def footprint(sil, k, ah):
    """Blocked part of a silhouette (bool array in the rect)."""
    ys, xs = np.nonzero(sil)
    top, bot = ys.min(), ys.max()
    h = bot - top + 1
    fp = np.zeros_like(sil)
    if k in ('furniture', 'fountain'):
        depth = int(round((0.55 if k == 'furniture' else 0.6) * h))
        y0 = bot - depth + 1
        x0, x1 = xs.min(), xs.max()
        w = x1 - x0 + 1
        ch = max(1, int(0.45 * depth))              # chamfer the top corners (octagon)
        for y in range(y0, bot + 1):
            cut = int(round(0.25 * w * max(0, ch - (y - y0)) / ch))
            fp[y, x0 + cut:x1 - cut + 1] = True
        return fp
    if k == 'potted':
        depth = max(int(0.3 * h), int(0.15 * ah))
    else:                                           # post, lamp, tree, statue: the base only
        depth = max(8, int(0.12 * ah))
    low = {}
    for y, x in zip(ys, xs):
        low[x] = max(low.get(x, -1), y)
    cols = np.array(sorted(x for x, y in low.items() if y >= bot - max(6, int(0.07 * ah))))
    runs = np.split(cols, np.nonzero(np.diff(cols) > 2)[0] + 1)
    mid = (xs.min() + xs.max()) / 2
    run = min(runs, key=lambda r: abs((r[0] + r[-1]) / 2 - mid))
    maxw = int(0.37 * ah) if k == 'post' else int(0.6 * ah)
    c = (run[0] + run[-1]) // 2
    lo, hi = max(run[0], c - maxw // 2), min(run[-1], c + maxw // 2)
    if k == 'potted':                               # the pot is as wide as the silhouette's lower part
        lo, hi = xs[ys >= bot - depth].min(), xs[ys >= bot - depth].max()
    for x in range(lo, hi + 1):
        fp[max(0, low.get(x, bot) - depth + 1):low.get(x, bot) + 1, x] = True
    return fp & sil

def propose(scene, src_dir, out_dir):
    city = CITY_DIR[scene[:3]]
    walk = np.asarray(Image.open(os.path.join(src_dir, city, f'{scene}-walkmask.png')).convert('L')) > 127
    H, W = walk.shape
    ah = heights.get(scene, 0.1) * H
    occ = Image.open(os.path.join(ROOT, city, f'{scene}-occlusion.png')).convert('RGBA').resize((W, H), Image.LANCZOS)
    opaque = np.asarray(occ)[..., 3] >= 128
    out = walk.copy()
    reach = max(4, int(0.25 * ah))
    log = []
    blocks = []
    props = np.zeros_like(walk)
    for pid, (x0, y0, x1, y1), _b, _f in HINTS.get(scene, []):
        if kind(pid):
            props[max(0, int(y0 / 100 * H)):int(y1 / 100 * H), max(0, int(x0 / 100 * W)):int(x1 / 100 * W)] = True
    for pid, (x0, y0, x1, y1), _base, _fp in HINTS.get(scene, []):
        k = kind(pid)
        if not k:
            continue
        xa, xb = max(0, int(x0 / 100 * W)), min(W, int(round(x1 / 100 * W)))
        ya, yb = max(0, int(y0 / 100 * H)), min(H, int(round(y1 / 100 * H)))
        sil = opaque[ya:yb, xa:xb] & (~walk[ya:yb, xa:xb] if k != 'furniture' else True)
        if sil.sum() < 30:
            continue
        lab, n = ndimage.label(sil, structure=np.ones((3, 3)))
        sil = lab == (np.argmax(np.bincount(lab.ravel())[1:]) + 1)   # the prop's own blob
        fp = footprint(sil, k, ah)
        ys, xs = np.nonzero(sil)
        top = ys.min()
        if k == 'furniture':
            mid = ya + (ys.min() + ys.max()) // 2
            L = walk[mid, max(0, xa + xs.min() - reach):xa + xs.min()].any()
            Rr = walk[mid, xa + xs.max() + 1:xa + xs.max() + 1 + reach].any()
            if not (L and Rr):
                log.append(f'{pid}: against a wall, kept')
                continue
            force = np.zeros_like(walk); force[ya:yb, xa:xb] = fp
            blocks.append(force)
        # the blocked area the prop sits in (silhouette + floor gaps between its parts), above the footprint
        blocked = ~walk[ya:yb, xa:xb]
        fp_top = np.nonzero(fp.any(1))[0].min() if fp.any() else ys.max()
        cand = np.zeros_like(sil)
        opened_cols = 0
        for i in range(xs.min(), xs.max() + 1):
            col = sil[:, i]
            if not col.any():
                continue
            ctop = np.nonzero(col)[0].min()
            gx = xa + i
            above = walk[max(0, ya + ctop - reach):ya + ctop, gx]
            fl = walk[ya + ctop:ya + fp_top, max(0, gx - reach):gx].any(1) & walk[ya + ctop:ya + fp_top, gx + 1:gx + 1 + reach].any(1) if k != 'furniture' else None
            if above.any():                        # floor behind it: the whole column above the footprint
                cand[ctop:, i] = True
                opened_cols += 1
            elif fl is not None and fl.any():       # lone prop with floor either side
                rows = np.nonzero(fl)[0] + ctop
                cand[rows, i] = True
                opened_cols += 1
        add = cand & blocked & ~fp
        add[ys.max() + 1:, :] = False
        if k == 'furniture':
            # floor gaps between the chairs above the footprint count too, but nothing below the prop
            pass
        big = np.zeros_like(walk); big[ya:yb, xa:xb] = add
        out |= big
        if add.any():
            log.append(f'{pid} ({k}) +{int(add.sum())}')
    # WALK BEHIND THE FRONT WALL: where the floor's lower edge meets the occlusion layer
    # (a front wall, a balustrade, a rail), the floor carries on DEPTH down behind it, the
    # wall hiding the feet. Only where the occluder is deep enough that the extension stays
    # inside it, and not under a prop (those have their own footprint rule).
    depth = int(round(0.38 * ah)); margin = int(round(0.25 * ah))
    ext = np.zeros_like(walk)
    edge = walk[:-1] & ~walk[1:]
    ys, xs = np.nonzero(edge)
    for y, x in zip(ys, xs):
        if props[y + 1, x]:
            continue
        seg = opaque[y + 1:y + 1 + depth + margin, x]
        if seg.size == depth + margin and seg.all() and not walk[y + 1:y + 1 + depth + margin, x].any():
            ext[y + 1:y + 1 + depth, x] = True
    # tidy: drop slivers narrower than a body
    ext = ndimage.binary_opening(ext, structure=np.ones((1, max(3, int(0.3 * ah)))))
    out |= ext
    log.append(f'front walls +{int(ext.sum())}')
    for b in blocks:
        out &= ~b
    # opened ground must join the floor it was opened from
    olab, _ = ndimage.label(out, structure=np.ones((3, 3)))
    good = np.unique(olab[walk])
    out &= walk | np.isin(olab, good[good > 0])
    os.makedirs(os.path.join(out_dir, city), exist_ok=True)
    # light = original walkable, grey = added (the artist's own convention)
    rgb = np.zeros((H, W, 3), np.uint8); rgb[walk & out] = 255; rgb[out & ~walk] = (215, 204, 200)
    Image.fromarray(rgb).save(os.path.join(out_dir, city, f'{scene}-walkmask.png'))
    art = Image.open(os.path.join(ROOT, 'assets', 'scenes', f'{scene}.webp')).convert('RGB').resize((W, H))
    a = np.asarray(art).astype(float) * 0.45
    for m, c, kk in [(walk, (255, 255, 255), .5), (out & ~walk, (0, 255, 0), .65)]:
        a[m] = a[m] * (1 - kk) + np.array(c) * kk
    os.makedirs(os.path.join(out_dir, 'previews'), exist_ok=True)
    Image.fromarray(a.astype(np.uint8)).save(os.path.join(out_dir, 'previews', f'{scene}.png'))
    print(f'{scene:10s} +{int((out & ~walk).sum()):6d} px   ' + '; '.join(log))
    return out

if __name__ == '__main__':
    out_dir = sys.argv[1]
    for s in sys.argv[2:]:
        propose(s, os.path.join(ROOT, 'walkmasks-original'), out_dir)
