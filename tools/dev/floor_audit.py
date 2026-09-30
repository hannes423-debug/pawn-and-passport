#!/usr/bin/env python3
"""tools/dev/floor_audit.py [scene ...] - the Vienna floor-mask experiment, audited.

For each Vienna scene, into tools/shots/floor/:
  <scene>-1-masks.png    the scene; walk mask (green), the floor mask's floor the
                         feet cannot reach (blue), unsure (orange hatch), not
                         floor (dark); the artist's original layer outlined
  <scene>-regions.png    the floor build's depth regions (tools/floor_depth.py)
  <scene>-3-legacy.png   test players drawn by the CURRENT renderer's data
  <scene>-4-floor.png    the same players drawn by the floor-mask data
  <scene>-5-diff.png     the spots where the two differ most: legacy | floor
  <scene>-audit.json     per spot: category, visible body px in each, and the
                         shoe check (a standing thing below the feet must be
                         in front of them: shoes shown over it = an error)

The players are the game's own sprite (assets/characters/girl.png, idle,
facing down) at the game's size (max(40 px, stage * actorHeight)) and foot
anchor (css translate(-50%, -92%)), z-sorted exactly as scene.js does: depth
slices at z = 2*round(10*line), players at 2*round(10*feet%)+1. Hidden parts
of a player are outlined in cyan, so you can see what is covered.

Spots are picked on the game's own walk grid (freeWalk.js createWalkGrid,
eroded by walkerFor), in categories: in front of / behind / beside an
object, between two objects, in a passage or doorway, by furniture, walls and
plants. Every spot is a place a player can really stand.
"""
import base64  # noqa: F401  (kept for parity with the other dev tools)
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import build_occlusion as bo  # noqa: E402
import floor_mask as fm  # noqa: E402
import floor_depth as fd  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'tools', 'shots', 'floor')
CELL_W, CELL_H = 72, 108
FURN = re.compile(r'(^|-)(tables?|desks?|bench(es)?|chairs?|armchairs?|settees?|sofas?|piano|counter|cart|stools?|globe|board|lectern|podium|easel|cabinet|shelf|shelves|sidetable|round|prac|study|coffee|gazebo|statue|stand)(-|$|\d)')
PLANT = bo.PLANT
CATS = [('front', (255, 90, 90)), ('behind', (90, 160, 255)), ('beside', (255, 220, 60)), ('between', (180, 90, 255)),
        ('passage', (255, 140, 0)), ('furniture', (0, 220, 200)), ('wall', (220, 220, 220)), ('plant', (80, 230, 80))]
PER_CAT = 14


def load_js(path, name):
    t = open(path, encoding='utf-8').read()
    return json.loads(t[t.index('{', t.index(name)):t.rindex('};') + 1])


def game_standable(d, W, H, actor_h):
    """The game's standable cells (createWalkGrid), upsampled to the art: bool (H, W)."""
    cols, rows = d['walk']['cols'], d['walk']['rows']
    free = np.zeros((rows, cols), bool)
    for r, line in enumerate(d['walk']['rle']):
        x = 0
        for k, n in enumerate(int(v) for v in line.split(',')):
            if k % 2 == 1:
                free[r, x:x + n] = True
            x += n
    h = actor_h * 100
    hw, hd = max(1.0, h * 0.11), max(0.6, h * 0.04)
    aspect = W / H
    rx = max(1, round((hw / aspect) / (100 / cols)))
    ry = max(1, round(hd / (100 / rows)))
    er = ndimage.binary_erosion(free, structure=np.ones((2 * ry + 1, 2 * rx + 1)), border_value=0)
    yi = np.minimum(rows - 1, (np.arange(H) + 0.5) * rows // H).astype(int)
    xi = np.minimum(cols - 1, (np.arange(W) + 0.5) * cols // W).astype(int)
    return er[yi][:, xi]


def sprite(actor_h, H):
    sheet = Image.open(os.path.join(ROOT, 'assets', 'characters', 'girl.png')).convert('RGBA')
    cell = sheet.crop((0, 0, CELL_W, CELL_H))
    h = max(40, round(H * actor_h))
    w = round(h * CELL_W / CELL_H)
    im = cell.resize((w, h), Image.LANCZOS if h < CELL_H else Image.NEAREST)
    return np.asarray(im).astype(np.float32)


def slice_images(d):
    atlas = np.asarray(Image.open(os.path.join(ROOT, d['atlas'].split('?')[0])).convert('RGBA'))
    W, H = d['size']
    out = []
    for base, x, y, pw, ph, ax, ay, w, h in d['slices']:
        x0, y0 = int(round(x / 100 * W)), int(round(y / 100 * H))
        out.append((int(round(base * 10)) * 2, x0, y0, atlas[ay:ay + h, ax:ax + w]))
    return out


def render(art, slices, spr, feet):
    """The scene as scene.js stacks it. Returns (rgb float, owner int32: -1 background,
    -2 a depth slice, k = player k)."""
    H, W = art.shape[:2]
    canvas = art.astype(np.float32).copy()
    owner = np.full((H, W), -1, np.int32)
    sh, sw = spr.shape[:2]
    items = [(z, 0, i) for i, (z, *_r) in enumerate(slices)]
    for k, (fx, fy) in enumerate(feet):
        z = int(round(fy / H * 1000)) * 2 + 1
        items.append((z, 1, k))
    items.sort()
    for _z, kind, i in items:
        if kind == 0:
            _zz, x0, y0, tile = slices[i]
            h, w = tile.shape[:2]
            h, w = min(h, H - y0), min(w, W - x0)
            a = tile[:h, :w, 3] > 127
            region = canvas[y0:y0 + h, x0:x0 + w]
            region[a] = tile[:h, :w, :3][a]
            owner[y0:y0 + h, x0:x0 + w][a] = -2
        else:
            fx, fy = feet[i]
            x0 = int(round(fx - sw / 2))
            y0 = int(round(fy - 0.92 * sh))
            xa, ya = max(0, x0), max(0, y0)
            xb, yb = min(W, x0 + sw), min(H, y0 + sh)
            if xb <= xa or yb <= ya:
                continue
            s = spr[ya - y0:yb - y0, xa - x0:xb - x0]
            al = s[..., 3:4] / 255.0
            canvas[ya:yb, xa:xb] = canvas[ya:yb, xa:xb] * (1 - al) + s[..., :3] * al
            owner[ya:yb, xa:xb][s[..., 3] > 127] = i
    return canvas, owner


def sprite_mask(spr, fx, fy, H, W):
    sh, sw = spr.shape[:2]
    m = np.zeros((H, W), bool)
    x0, y0 = int(round(fx - sw / 2)), int(round(fy - 0.92 * sh))
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(W, x0 + sw), min(H, y0 + sh)
    if xb > xa and yb > ya:
        m[ya:yb, xa:xb] = spr[ya - y0:yb - y0, xa - x0:xb - x0, 3] > 127
    return m, (x0, y0, sw, sh)


def pick_spots(stand, foot, names_map, strip_or_box, A, W, H):
    """{category: [(x, y)]} on the standable mask."""
    a = int(A)
    near = max(2, int(0.3 * a))
    side = max(2, int(0.45 * a))
    btw = max(3, int(0.7 * a))
    up = np.zeros_like(foot)
    down = np.zeros_like(foot)
    for k in range(1, near + 1):
        up[k:] |= foot[:-k]
        down[:-k] |= foot[k:]
    up_far = np.zeros_like(foot)
    down_far = np.zeros_like(foot)
    for k in range(1, btw + 1):
        up_far[k:] |= foot[:-k]
        down_far[:-k] |= foot[k:]
    left = np.zeros_like(foot)
    right = np.zeros_like(foot)
    for k in range(1, side + 1):
        left[:, k:] |= foot[:, :-k]
        right[:, :-k] |= foot[:, k:]
    around = ndimage.binary_dilation(foot, structure=np.ones((3, 3)), iterations=max(2, int(0.35 * a)))
    cats = {
        'front': stand & up & ~down,
        'behind': stand & down & ~up,
        'beside': stand & (left | right) & ~up & ~down,
        'between': stand & ((up_far & down_far) | (left & right)),
        'passage': stand & left & right,
        'furniture': stand & around & names_map['furniture'],
        'wall': stand & around & names_map['wall'],
        'plant': stand & around & names_map['plant'],
    }
    rng = np.random.RandomState(7)
    taken = []
    out = {}
    for cat, _c in CATS:
        ys, xs = np.nonzero(cats[cat])
        order = rng.permutation(len(ys))
        got = []
        for i in order:
            x, y = int(xs[i]), int(ys[i])
            if all(abs(x - px) > 0.55 * a or abs(y - py) > 0.45 * a for px, py in taken):
                got.append((x, y))
                taken.append((x, y))
                if len(got) >= PER_CAT:
                    break
        out[cat] = got
    return out


def names_maps(scene, W, H, A):
    """Areas near named furniture, plants (hint rects), and wall footprints."""
    furn = np.zeros((H, W), bool)
    plant = np.zeros((H, W), bool)
    for pid, (x0, y0, x1, y1), _b, _f in bo.HINTS.get(scene, []):
        sl = (slice(max(0, int(y0 / 100 * H)), min(H, int(y1 / 100 * H))), slice(max(0, int(x0 / 100 * W)), min(W, int(x1 / 100 * W))))
        if PLANT.search(pid):
            plant[sl] = True
        elif FURN.search(pid):
            furn[sl] = True
    grow = max(2, int(0.35 * A))
    return {'furniture': ndimage.binary_dilation(furn, iterations=grow),
            'plant': ndimage.binary_dilation(plant, iterations=grow)}


def audit(scene, legacy_all, floor_all, heights):
    actor_h = heights[scene]
    art, opaque, walk, floor = fd.inputs(scene)
    H, W = walk.shape
    A = actor_h * H
    leg, flo = legacy_all[scene], floor_all[scene]
    stand = game_standable(leg, W, H, actor_h)
    is_floor = floor == fm.FLOOR
    decals = fd.floor_decals(opaque, is_floor)
    standing = opaque & ~decals                 # what must be in front when it is below the feet
    foot = opaque & ~is_floor
    nm = names_maps(scene, W, H, A)
    lab, n = ndimage.label(foot, structure=np.ones((3, 3)))
    sizes = ndimage.sum(foot, lab, np.arange(1, n + 1)) if n else np.array([])
    wall = np.isin(lab, np.nonzero(sizes > 0.02 * H * W)[0] + 1)
    nm['wall'] = ndimage.binary_dilation(wall, iterations=max(2, int(0.35 * A)))
    spots = pick_spots(stand, foot, nm, None, A, W, H)
    feet, cat_of = [], []
    for cat, _c in CATS:
        for x, y in spots[cat]:
            feet.append((x, y))
            cat_of.append(cat)
    spr = sprite(actor_h, H)
    results = {}
    renders = {}
    for name, d in (('legacy', leg), ('floor', flo)):
        rgb, owner = render(art, slice_images(d), spr, feet)
        renders[name] = (rgb, owner)
    rows = []
    shoe_h = max(2, int(0.08 * spr.shape[0]))
    for k, (fx, fy) in enumerate(feet):
        m, (x0, y0, sw, sh) = sprite_mask(spr, fx, fy, H, W)
        rec = {'spot': k, 'category': cat_of[k], 'feet_pct': [round(fx / W * 100, 2), round(fy / H * 100, 2)], 'body_px': int(m.sum())}
        # shoe check: sprite px BELOW the feet row over a standing layer px, shown = error
        shoes = m.copy()
        shoes[:fy + 1] = False
        shoes[fy + 1 + shoe_h:] = False
        shoes &= standing
        for name in ('legacy', 'floor'):
            owner = renders[name][1]
            vis = (owner == k) & m
            rec[f'{name}_visible'] = int(vis.sum())
            rec[f'{name}_shoe_errors'] = int((shoes & (owner == k)).sum())
        rec['diff_px'] = int(((renders['legacy'][1] == k) ^ (renders['floor'][1] == k)).sum())
        rows.append(rec)
    # images
    os.makedirs(OUT, exist_ok=True)
    masks_img(scene, art, walk, floor, opaque)
    colours = dict(CATS)
    for name in ('legacy', 'floor'):
        rgb, owner = renders[name]
        img = Image.fromarray(rgb.clip(0, 255).astype(np.uint8))
        px = np.asarray(img).copy()
        for k, (fx, fy) in enumerate(feet):
            m, _box = sprite_mask(spr, fx, fy, H, W)
            edge = m & ~ndimage.binary_erosion(m, iterations=1)
            hidden_edge = edge & (owner != k)
            px[hidden_edge] = (0, 255, 255)
        img = Image.fromarray(px)
        dr = ImageDraw.Draw(img)
        for k, (fx, fy) in enumerate(feet):
            c = colours[cat_of[k]]
            dr.ellipse((fx - 3, fy - 3, fx + 3, fy + 3), fill=c, outline=(0, 0, 0))
            dr.text((fx + 5, fy - 4), str(k), fill=c)
        dr.rectangle((0, 0, 330, 18 + 14 * len(CATS)), fill=(0, 0, 0))
        dr.text((6, 3), f'{scene}: {"CURRENT renderer" if name == "legacy" else "FLOOR-MASK renderer"}', fill=(255, 255, 255))
        for i, (cat, c) in enumerate(CATS):
            dr.text((6, 18 + 14 * i), f'o {cat}', fill=c)
        img.save(os.path.join(OUT, f'{scene}-{"3-legacy" if name == "legacy" else "4-floor"}.png'))
    diff_img(scene, renders, feet, cat_of, rows, spr, A, W, H, walk, floor)
    tot = {n: sum(r[f'{n}_shoe_errors'] for r in rows) for n in ('legacy', 'floor')}
    bad = {n: sum(1 for r in rows if r[f'{n}_shoe_errors'] >= 6) for n in ('legacy', 'floor')}
    summary = {'scene': scene, 'spots': len(rows), 'per_category': {c: len(spots[c]) for c, _ in CATS},
               'spots_with_shoe_errors': bad, 'shoe_error_px': tot,
               'spots_differing': sum(1 for r in rows if r['diff_px'] > 0.03 * r['body_px'])}
    json.dump({'summary': summary, 'spots': rows}, open(os.path.join(OUT, f'{scene}-audit.json'), 'w'), indent=1)
    return summary


def masks_img(scene, art, walk, floor, opaque):
    o = art.astype(np.float32) * 0.5
    H, W = walk.shape
    yy, xx = np.mgrid[0:H, 0:W]
    notf = floor == fm.NOT_FLOOR
    uns = floor == fm.UNSURE
    inacc = (floor == fm.FLOOR) & ~walk
    o[notf] = o[notf] * 0.4
    hatch = uns & (((xx + yy) // 4) % 3 == 0)
    o[hatch] = o[hatch] * 0.4 + np.array((255, 150, 0)) * 0.6
    o[walk] = o[walk] * 0.55 + np.array((0, 220, 70)) * 0.45
    o[inacc] = o[inacc] * 0.3 + np.array((40, 110, 255)) * 0.7
    edge = opaque & ~ndimage.binary_erosion(opaque, iterations=1)
    o[edge] = (255, 255, 255)
    img = Image.fromarray(o.clip(0, 255).astype(np.uint8))
    dr = ImageDraw.Draw(img)
    dr.rectangle((0, 0, 420, 74), fill=(0, 0, 0))
    dr.text((6, 3), f'{scene}: walk mask vs floor mask', fill=(255, 255, 255))
    dr.text((6, 18), 'green  walkable (walk mask)', fill=(0, 220, 70))
    dr.text((6, 31), 'blue   floor the feet cannot reach (floor mask only)', fill=(80, 140, 255))
    dr.text((6, 44), 'orange hatch  unsure (grey in the mask: paint it)', fill=(255, 150, 0))
    dr.text((6, 57), 'dark   not floor; white line = artist layer outline', fill=(200, 200, 200))
    img.save(os.path.join(OUT, f'{scene}-1-masks.png'))


def diff_img(scene, renders, feet, cat_of, rows, spr, A, W, H, walk, floor, top=12):
    order = sorted(range(len(rows)), key=lambda k: -rows[k]['diff_px'])
    order = [k for k in order if rows[k]['diff_px'] > 0.03 * rows[k]['body_px']][:top]
    if not order:
        Image.new('RGB', (420, 40), (0, 0, 0)).save(os.path.join(OUT, f'{scene}-5-diff.png'))
        return
    zoom = 2 if A < 150 else 1
    cw, ch = int(2.2 * A), int(1.7 * A)
    tiles = []
    for k in order:
        fx, fy = feet[k]
        x0, y0 = max(0, min(W - cw, fx - cw // 2)), max(0, min(H - ch, int(fy - 1.25 * A)))
        pair = []
        for name in ('legacy', 'floor'):
            rgb, owner = renders[name]
            crop = rgb[y0:y0 + ch, x0:x0 + cw].clip(0, 255).astype(np.uint8).copy()
            m, _b = sprite_mask(spr, fx, fy, H, W)
            edge = (m & ~ndimage.binary_erosion(m, iterations=1))[y0:y0 + ch, x0:x0 + cw]
            hid = edge & (owner[y0:y0 + ch, x0:x0 + cw] != k)
            crop[hid] = (0, 255, 255)
            # where feet may stand (green edge) and where the floor mask says floor ends (blue edge)
            wk = walk[y0:y0 + ch, x0:x0 + cw]
            crop[wk & ~ndimage.binary_erosion(wk, iterations=1)] = (0, 230, 60)
            fl = (floor == fm.FLOOR)[y0:y0 + ch, x0:x0 + cw]
            fe = fl & ~ndimage.binary_erosion(fl, iterations=1) & ~wk
            crop[fe] = (60, 120, 255)
            im = Image.fromarray(crop).resize((cw * zoom, ch * zoom), Image.NEAREST)
            d = ImageDraw.Draw(im)
            px_, py_ = (fx - x0) * zoom, (fy - y0) * zoom
            d.ellipse((px_ - 4, py_ - 4, px_ + 4, py_ + 4), outline=(255, 255, 0), width=2)
            r = rows[k]
            d.rectangle((0, 0, cw * zoom, 15), fill=(0, 0, 0))
            d.text((4, 2), f'#{k} {cat_of[k]} {"CURRENT" if name == "legacy" else "FLOOR"} shoe err {r[name + "_shoe_errors"]}', fill=(255, 255, 255))
            pair.append(im)
        tiles.append(pair)
    tw, th = tiles[0][0].size
    sheet = Image.new('RGB', (tw * 2 + 12, (th + 8) * len(tiles)), (20, 20, 20))
    for i, (a, b) in enumerate(tiles):
        sheet.paste(a, (0, i * (th + 8)))
        sheet.paste(b, (tw + 12, i * (th + 8)))
    sheet.save(os.path.join(OUT, f'{scene}-5-diff.png'))


def main():
    names = [a for a in sys.argv[1:] if not a.startswith('--')] or fd.SCENES
    legacy_all = load_js(os.path.join(ROOT, 'js', 'data', 'sceneLayers.js'), 'SCENE_LAYERS')
    floor_all = load_js(os.path.join(ROOT, 'js', 'data', 'sceneLayersFloor.js'), 'SCENE_LAYERS_FLOOR')
    heights = bo.scene_actor_heights()
    out = []
    for s in names:
        sm = audit(s, legacy_all, floor_all, heights)
        out.append(sm)
        print(f'{s:10} spots {sm["spots"]:3}  shoe errors: current {sm["spots_with_shoe_errors"]["legacy"]:3} spots ({sm["shoe_error_px"]["legacy"]:5} px)'
              f'  floor {sm["spots_with_shoe_errors"]["floor"]:3} spots ({sm["shoe_error_px"]["floor"]:5} px)  | spots that look different {sm["spots_differing"]}', flush=True)
    json.dump(out, open(os.path.join(OUT, 'audit-summary.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
