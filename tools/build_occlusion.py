#!/usr/bin/env python3
"""
tools/build_occlusion.py - collision and depth for every walkable scene.

    python3 tools/build_occlusion.py              # all 24 scenes
    python3 tools/build_occlusion.py nyc-int ...  # some
    python3 tools/build_occlusion.py --preview    # also tools/shots/occlusion-<scene>.png
    python3 tools/build_occlusion.py --check      # fast: inputs unchanged, walk grid not hand-edited?

Replaces tools/build_layers.py (GrabCut cut-outs + hand-drawn floor polygons).
Two artist guides per scene, both in the city folder:

    <scene>-walkmask.png    white = a character's FEET may stand here. It
                            becomes the collision grid, as is: freeWalk.js
                            erodes it by the walker's body the way it always has.
    <scene>-occlusion.png   the scene with the floor removed: everything that
                            can stand in front of a character.

DEPTH. Every opaque pixel of the occlusion layer gets a ground line, the y
where that part of the scene meets the floor. A character whose feet are
higher up the picture than that line is behind the pixel; lower down, in front.
Per column, the layer is split into vertical runs of opaque pixels:

    a run whose lowest FOOT px are mostly NOT walkable stands on the floor:
        its ground line is that lowest pixel. (A wall, a table with its chairs,
        a lamp post, a planter.)
    a run whose lowest FOOT px are walkable does not touch the floor: the player
        walks under it or behind it. Then
          - inside a depth hint (tools/depth_hints.py: the old hand-set ground
            lines of signs, arches, banners, trees) -> that hint's line.
            A hint of 99 hangs in a gateway and is always in front.
          - with walkable floor above it too -> it is drawn ON the floor (an
            inlay, a rug, steps): it never hides anybody.
          - otherwise (a lintel, a sign over porch steps) -> the ground line of
            what holds it up: the nearest standing column either side at the
            same height (pillars, the wall round a doorway), the lower of the
            two. With nothing in reach, its lowest pixel plus most of a
            character's height.

The pixels drawn are the SCENE's own (assets/scenes/<scene>.webp), cut by the
layer's alpha: the layer is a redraw, 35-80 levels off the art, and pasting it
would show a seam round every object. Layers that were drawn at a slightly
different size are fitted to the art first (WARP, measured with OpenCV ECC).

Output:
    assets/layers/<scene>.webp   one atlas of depth slices per scene
    js/data/sceneLayers.js       GENERATED: per scene, the walk grid (run-length
                                 rows) and the slices (box, ground line, atlas rect)
"""
import hashlib
import json
import os
import re
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from depth_hints import HINTS  # noqa: E402

CITY_DIR = {'nyc': 'NYC', 'lon': 'London', 'vie': 'Vienna', 'ist': 'Istanbul', 'che': 'Chennai', 'wen': 'Wenzhou', 'mad': 'Spain Madrid'}
SCENES = ['nyc-ext', 'nyc-int', 'nyc-up', 'nyc-venue', 'lon-ext', 'lon-int', 'lon-venue',
          'vie-ext', 'vie-int', 'vie-up', 'vie-venue', 'ist-ext', 'ist-int', 'ist-up', 'ist-venue',
          'che-ext', 'che-int', 'che-venue', 'wen-ext', 'wen-int', 'wen-up', 'wen-venue', 'mad-ext', 'mad-int']

GRID = (300, 225)          # js/core/freeWalk.js GRID
ALPHA = 128                # layer alpha that counts as opaque
BIN = 0.5                  # ground lines are floored to this many percent: one slice per band
SPECK = 12                 # opaque specks smaller than this (px) are dropped
FOOT = 12                  # px: a run is walked under when most of its lowest FOOT px are walkable
LINTEL = 0.9               # a hanging run with no hint: its line is this many character heights below it
PAD = 4                    # atlas padding (px): a scaled slice must not sample its neighbour
ATLAS_W = 2048

# Layer -> art, as the inverse-map affine cv2.warpAffine takes (WARP_INVERSE_MAP).
# Fitted with cv2.findTransformECC(art, layer, MOTION_AFFINE) on 2026-09-25; all the
# others fit within half a pixel of identity and are used as they are. wen-up's
# walk mask was already built in the art's frame, so only its layer is warped.
WARP = {
    'wen-up': [[0.9774, 0.0004, -1.4733], [0.0, 0.9777, -1.5560]],
    'vie-ext': [[1.0001, 0.0020, -2.4241], [0.0007, 0.9939, 5.6731]],
    'ist-up': [[1.0050, -0.0001, 0.1748], [0.0, 1.0012, -0.8664]],
    'ist-ext': [[1.0025, -0.0004, -1.5578], [0.0, 1.0020, -0.4647]],
}
MASK_IN_ART_FRAME = {'wen-up'}

# WALK BEHIND PLANTS (user, 2026-09-25): the masks make every potted plant
# solid, but a player should be able to step behind most of them and be
# hidden. Inside a potted plant's hint rect, floor the plant hides becomes walkable where the floor
# visibly carries on either side of it (left and right in that row, or above
# and below in that column), so a plant against a wall stays against the wall.
# Only the pot's own base (its lowest FOOT px per column) keeps blocking. A
# plant whose opening would JOIN two separate floor areas is left solid: some
# of them close an aisle on purpose (vie-up's lower plants).
PLANT = re.compile(r'(^|-)(plants?|pots?|bonsai|bamboo|topiary|cypress|palm|trees?|olive|pine|willow|planters?|urn|vase)(-|$)')
POTTED = re.compile(r'(^|-)(plants?|pots?|topiary|urn|vase|bonsai|bamboo)(-|$)')   # stand on the pot's base only
PLANT_REACH = 14           # px past the rect where the floor on either side is looked for


def scene_actor_heights():
    """actorHeight per scene, from js/data/scenes.js itself (default 0.1)."""
    import subprocess
    js = ("import('./js/data/scenes.js').then(m => console.log(JSON.stringify("
          "Object.fromEntries(Object.values(m.SCENES).map(s => [s.id, s.actorHeight ?? 0.1])))))")
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', js], cwd=ROOT, text=True))


def warp(img, scene, size, interp):
    W, H = size
    m = WARP.get(scene)
    if m is None:
        return img
    return cv2.warpAffine(img, np.array(m, np.float32), (W, H), flags=interp + cv2.WARP_INVERSE_MAP)


def load(scene):
    folder = os.path.join(ROOT, CITY_DIR[scene[:3]])
    art = Image.open(os.path.join(ROOT, 'assets', 'scenes', f'{scene}.webp')).convert('RGB')
    W, H = art.size
    layer = Image.open(os.path.join(folder, f'{scene}-occlusion.png')).convert('RGBA').resize((W, H), Image.LANCZOS)
    alpha = warp(np.asarray(layer)[..., 3].copy(), scene, (W, H), cv2.INTER_LINEAR)
    walk = Image.open(os.path.join(folder, f'{scene}-walkmask.png')).convert('L').resize((W, H), Image.NEAREST)
    walk = np.asarray(walk).copy()
    if scene not in MASK_IN_ART_FRAME:
        walk = warp(walk, scene, (W, H), cv2.INTER_NEAREST)
    return np.asarray(art), alpha >= ALPHA, walk > 127


def plant_walk(scene, opaque, walk):
    """The walk mask with the floor behind the scene's plants opened up. Returns (mask, plants opened)."""
    H, W = walk.shape
    lab, _ = ndimage.label(walk, structure=np.ones((3, 3)))
    sizes = np.bincount(lab.ravel())
    out = walk.copy()
    opened = 0
    for pid, (x0, y0, x1, y1), _base, fp in HINTS.get(scene, []):
        if not PLANT.search(pid):
            continue
        xa, xb = max(0, int(x0 / 100 * W)), min(W, int(round(x1 / 100 * W)))
        ya, yb = max(0, int(y0 / 100 * H)), min(H, int(round(y1 / 100 * H)))
        if xb - xa < 3 or yb - ya < 3:
            continue
        # A planter or a tree in a bed stands on its whole box: the floor
        # behind it is already open in the masks (canopies are walk-behind),
        # and opening more would put the player IN the flowers. So only potted
        # things open, standing on their lowest FOOT px.
        if not POTTED.search(pid):
            continue
        foot = np.zeros((yb - ya, xb - xa), bool)
        op = opaque[ya:yb, xa:xb]
        for i in range(xb - xa):
            ys = np.where(op[:, i])[0]
            if ys.size:
                foot[max(0, ys.max() - FOOT + 1):, i] = True
        L = max(0, xa - PLANT_REACH); R = min(W, xb + PLANT_REACH)
        T = max(0, ya - PLANT_REACH); B = min(H, yb + PLANT_REACH)
        w = walk[T:B, L:R]
        ox, oy = xa - L, ya - T
        left = np.maximum.accumulate(w, axis=1)[oy:oy + yb - ya, ox:ox + xb - xa]
        right = np.maximum.accumulate(w[:, ::-1], axis=1)[:, ::-1][oy:oy + yb - ya, ox:ox + xb - xa]
        up = np.maximum.accumulate(w, axis=0)[oy:oy + yb - ya, ox:ox + xb - xa]
        down = np.maximum.accumulate(w[::-1], axis=0)[::-1][oy:oy + yb - ya, ox:ox + xb - xa]
        fill = ((left & right) | (up & down)) & ~foot & ~walk[ya:yb, xa:xb]
        if not fill.any():
            continue
        # would it join two floors that were apart?
        big = np.zeros((H, W), bool)
        big[ya:yb, xa:xb] = fill
        touch = lab[ndimage.binary_dilation(big, iterations=2) & walk]
        touch = {int(t) for t in np.unique(touch) if t and sizes[t] >= 200}
        if len(touch) > 1:
            print(f'    {scene}: {pid} would join two floors, left solid')
            continue
        out[ya:yb, xa:xb] |= fill
        opened += 1
    out = ndimage.binary_opening(out, iterations=1) | walk     # no one-pixel slivers
    return out, opened


def hint_map(scene, W, H):
    """Per pixel: the ground line (percent) of the SMALLEST hint rect over it, else NaN."""
    out = np.full((H, W), np.nan, np.float32)
    area = np.full((H, W), np.inf, np.float32)
    for _pid, (x0, y0, x1, y1), base, _foot in HINTS.get(scene, []):
        xs = slice(max(0, int(x0 / 100 * W)), min(W, int(round(x1 / 100 * W))))
        ys = slice(max(0, int(y0 / 100 * H)), min(H, int(round(y1 / 100 * H))))
        a = (x1 - x0) * (y1 - y0)
        sel = area[ys, xs] > a
        out[ys, xs][sel] = base
        area[ys, xs][sel] = a
    return out


def depth(scene, opaque, walk, actor_h):
    """Ground line in percent for every opaque pixel (NaN = never in front of anybody)."""
    H, W = opaque.shape
    hints = hint_map(scene, W, H)
    base = np.full((H, W), np.nan, np.float32)
    lintel = LINTEL * actor_h * H
    kinds = np.zeros((H, W), np.uint8)       # 1 grounded, 2 hint, 3 decal, 4 lintel (for the preview)
    hung = []
    for x in range(W):
        col = opaque[:, x]
        if not col.any():
            continue
        d = np.diff(np.concatenate(([0], col.astype(np.int8), [0])))
        starts = np.where(d == 1)[0]
        ends = np.where(d == -1)[0] - 1
        for a, b in zip(starts, ends):
            band = walk[max(a, b - FOOT + 1):b + 1, x]
            if band.mean() < 0.5:
                base[a:b + 1, x] = b / H * 100             # stands on the floor here
                kinds[a:b + 1, x] = 1
                continue
            h = hints[a:b + 1, x]
            has = ~np.isnan(h)
            base[a:b + 1, x][has] = h[has]                  # walked under/behind: its hint
            kinds[a:b + 1, x][has] = 2
            if has.all():
                continue
            if has[-1]:
                # The bottom is a hinted object (chairs against a wall, a sign
                # under a lintel): whatever is above it in this run meets the
                # floor where that object starts.
                s0 = b - int(np.argmin(has[::-1]))  + 1      # top of the hinted bottom segment
                top = ~has & (np.arange(a, b + 1) < s0)
                base[a:b + 1, x][top] = s0 / H * 100
                kinds[a:b + 1, x][top] = 1
                rest = ~has & ~top
            else:
                rest = ~has
            if not rest.any():
                continue
            above = walk[max(0, a - 4):a, x]
            if a >= 4 and above.mean() >= 0.5:
                kinds[a:b + 1, x][rest] = 3                 # on the floor: drawn with the background
            else:
                base[a:b + 1, x][rest] = min(99.0, (b + lintel) / H * 100)   # refined below
                kinds[a:b + 1, x][rest] = 4
                hung.append((x, a, b))
    # Something hanging with no hint (a sign over porch steps, a lintel) is held
    # up by what stands beside it at the same height - the porch pillars, the
    # wall either side of a doorway - so it takes THEIR ground line: the
    # nearest grounded column on each side, the lower of the two. Only with
    # nothing within reach does the rough "a character height below" stand.
    reach = max(8, int(2.5 * actor_h * H))
    for x, a, b in hung:
        lines = []
        for step in (-1, 1):
            for k in range(1, reach):
                xx = x + step * k
                if xx < 0 or xx >= W:
                    break
                g = kinds[a:b + 1, xx] == 1
                if g.any():
                    lines.append(float(np.nanmax(base[a:b + 1, xx][g])))
                    break
        if lines:
            rows = kinds[a:b + 1, x] == 4
            base[a:b + 1, x][rows] = max(max(lines), b / H * 100)
    return base, kinds


def slices(base, walk, actor_h):
    """[(z, bbox, mask)]: the opaque pixels grouped into as few depth slices as
    keeps every possible character drawn exactly as the per-pixel lines say.

    A slice only has to be right against the feet that can stand where a
    character's sprite would overlap it. Its line is snapped DOWN the picture to
    the next such feet row (a character above that row is behind it either
    way), so neighbouring bands with no floor between them collapse into one
    slice. Lines are in tenths of a percent, the game's z-index unit."""
    H, W = base.shape
    valid = ~np.isnan(base)
    z = np.where(valid, np.floor(np.nan_to_num(base) * 10 / (BIN * 10)) * BIN * 10, -1).astype(np.int32)
    z[valid & (base >= 99)] = 990
    feet_u = np.round(np.arange(H) / H * 1000).astype(np.int32)     # feet row -> z units, as scene.js rounds
    A = int(actor_h * H)
    half = max(3, int(A * 0.21))
    colsum = np.cumsum(np.concatenate([np.zeros((H, 1), np.int32), walk.astype(np.int32)], axis=1), axis=1)

    def snap(zu, sl):
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = max(0, sl[1].start - half), min(W, sl[1].stop + half)
        rows = np.arange(y0, min(H, y1 + A))
        live = rows[(colsum[rows, x1] - colsum[rows, x0]) > 0]      # feet rows with floor in the window
        u = feet_u[live]
        u = u[u >= zu]
        return int(u.min()) if u.size else 999

    snapped = np.full((H, W), -1, np.int32)
    for zu in np.unique(z[valid]):
        m = z == zu
        lab, n = ndimage.label(m, structure=np.ones((3, 3)))
        for i, sl in enumerate(ndimage.find_objects(lab), start=1):
            part = lab[sl] == i
            snapped[sl][part] = 990 if zu >= 990 else snap(int(zu), sl)
    out = []
    for zu in np.unique(snapped[snapped >= 0]):
        m = snapped == zu
        lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=4))
        for i, sl in enumerate(ndimage.find_objects(lab), start=1):
            # even origin and size: the atlas is lossy WebP (4:2:0), so a slice
            # whose 2x2 colour blocks line up with the background's re-encodes
            # to the same colours instead of a faint fringe
            y0, x0 = sl[0].start - sl[0].start % 2, sl[1].start - sl[1].start % 2
            y1, x1 = sl[0].stop + (sl[0].stop - y0) % 2, sl[1].stop + (sl[1].stop - x0) % 2
            sl = (slice(y0, min(H, y1)), slice(x0, min(W, x1)))
            part = m[sl] & (lab[sl] == i)
            if part.sum() < SPECK:
                continue
            out.append((min(99.0, zu / 10), sl, part))
    return out, snapped


def pack(parts):
    """Shelf-pack the slice rects into one atlas. Returns positions and the atlas size."""
    order = sorted(range(len(parts)), key=lambda i: -(parts[i][1][0].stop - parts[i][1][0].start))
    pos = [None] * len(parts)
    x = y = shelf = 0
    width = 0
    for i in order:
        sl = parts[i][1]
        w = sl[1].stop - sl[1].start
        h = sl[0].stop - sl[0].start
        if x + w + PAD > ATLAS_W:
            x, y, shelf = 0, y + shelf + PAD, 0
        pos[i] = (x, y)
        x += w + PAD
        shelf = max(shelf, h)
        width = max(width, x)
    return pos, (width, y + shelf)


def walk_rows(walk):
    """The walk mask on the game's grid, as run lengths per row (first run = blocked)."""
    H, W = walk.shape
    cols, rows = GRID
    rle = []
    for j in range(rows):
        y0, y1 = int(j * H / rows), max(int(j * H / rows) + 1, int((j + 1) * H / rows))
        runs = []
        cur = 0
        n = 0
        for i in range(cols):
            x0, x1 = int(i * W / cols), max(int(i * W / cols) + 1, int((i + 1) * W / cols))
            v = 1 if walk[y0:y1, x0:x1].mean() >= 0.5 else 0
            if v != cur:
                runs.append(n)
                cur, n = v, 0
            n += 1
        runs.append(n)
        rle.append(','.join(map(str, runs)))
    return rle


def sources(scene):
    """What a scene's data is made from: both guides, its hints and this file's tunables."""
    folder = os.path.join(ROOT, CITY_DIR[scene[:3]])
    md5 = lambda path: hashlib.md5(open(path, 'rb').read()).hexdigest()[:12]
    tun = repr((GRID, ALPHA, BIN, SPECK, FOOT, LINTEL, PLANT.pattern, PLANT_REACH, WARP.get(scene), HINTS.get(scene)))
    return {'walkmask': md5(os.path.join(folder, f'{scene}-walkmask.png')),
            'occlusion': md5(os.path.join(folder, f'{scene}-occlusion.png')),
            'art': md5(os.path.join(ROOT, 'assets', 'scenes', f'{scene}.webp')),
            'rules': hashlib.md5(tun.encode()).hexdigest()[:12]}


def build(scene, actor_h, write=True):
    art, opaque, walk = load(scene)
    H, W = opaque.shape
    base, kinds = depth(scene, opaque, walk, actor_h)
    parts, snapped = slices(base, walk, actor_h)
    pos, (aw, ah) = pack(parts)
    props = []
    atlas = np.zeros((ah, aw, 4), np.uint8)
    for k, ((z, sl, m), (ax, ay)) in enumerate(zip(parts, pos)):
        h, w = m.shape
        tile = np.zeros((h, w, 4), np.uint8)
        tile[..., :3] = art[sl]
        tile[..., 3] = np.where(m, 255, 0)
        atlas[ay:ay + h, ax:ax + w] = tile
        props.append([round(z, 2), round(sl[1].start / W * 100, 3), round(sl[0].start / H * 100, 3),
                      round(w / W * 100, 3), round(h / H * 100, 3), ax, ay, w, h])
    src = f'assets/layers/{scene}.webp'
    if write:
        os.makedirs(os.path.join(ROOT, 'assets', 'layers'), exist_ok=True)
        Image.fromarray(atlas, 'RGBA').save(os.path.join(ROOT, src), 'WEBP', quality=92, alpha_quality=100, method=6)
    walk_open, opened = plant_walk(scene, opaque, walk)
    data = {'source': sources(scene), 'atlas': src, 'atlasSize': [aw, ah], 'size': [W, H], 'slices': props, 'walk': {'cols': GRID[0], 'rows': GRID[1], 'rle': walk_rows(walk_open)}}
    print(f'    {scene}: floor behind {opened} plants opened (+{(walk_open & ~walk).sum()} px)')
    return data, (art, opaque, walk_open, snapped, kinds)


def preview(scene, data, debug, actor_h):
    """The scene with a character silhouette stood on a grid of walkable spots,
    each drawn in its true depth order - the honest test of the ground lines."""
    art, opaque, walk, base, kinds = debug
    H, W = opaque.shape
    ah = int(actor_h * H)
    aw = max(6, int(ah * 0.42))
    er = ndimage.binary_erosion(walk, structure=np.ones((max(1, ah // 12), max(1, aw // 2))))
    canvas = Image.fromarray(art).convert('RGBA')
    # tint by kind: hint = blue, lintel = orange, decal = green
    tint = np.zeros((H, W, 4), np.uint8)
    tint[kinds == 2] = (60, 120, 255, 70)
    tint[kinds == 4] = (255, 150, 0, 90)
    tint[kinds == 3] = (0, 255, 90, 70)
    canvas.alpha_composite(Image.fromarray(tint, 'RGBA'))
    sy, sx = max(24, int(ah * 0.8)), max(30, aw * 3)
    feet = [(x + (sx // 2 if (y // sy) % 2 else 0), y) for y in range(sy // 2, H, sy) for x in range(sx // 2, W - sx // 2, sx)]
    feet = [(x, y) for x, y in feet if er[y, x]]
    layers = [(p[0], 'slice', p) for p in data['slices']] + [(y / H * 100, 'actor', (x, y)) for x, y in feet]
    layers.sort(key=lambda t: (round(t[0] * 10), 0 if t[1] == 'slice' else 1))
    for _z, kind, item in layers:
        if kind == 'slice':
            x0 = round(item[1] / 100 * W); y0 = round(item[2] / 100 * H)
            w, h = item[7:9]
            m = base[y0:y0 + h, x0:x0 + w] == round(item[0] * 10)
            rgba = np.zeros((h, w, 4), np.uint8)
            rgba[..., :3] = art[y0:y0 + h, x0:x0 + w]
            rgba[..., 3] = np.where(m, 255, 0)
            canvas.alpha_composite(Image.fromarray(rgba, 'RGBA'), (x0, y0))
        else:
            x, y = item
            d = ImageDraw.Draw(canvas)
            d.rectangle([x - aw // 2, y - ah, x + aw // 2, y], fill=(230, 30, 200, 255), outline=(20, 0, 20, 255))
            d.ellipse([x - aw // 2, y - 3, x + aw // 2, y + 3], fill=(255, 255, 0, 255))
    path = os.path.join(ROOT, 'tools', 'shots', f'occlusion-{scene}.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.convert('RGB').save(path)
    return path


def emit(all_data):
    head = ('/**\n * sceneLayers.js - GENERATED by tools/build_occlusion.py. Do not edit by hand.\n *\n'
            ' * Per scene: the walk grid (the artist\'s walk mask, run lengths per row,\n'
            ' * blocked first) and the depth slices of the artist\'s occlusion layer, each\n'
            ' * as [ground line, x, y, w, h] in percent of the scene + [x, y, w, h] in\n'
            ' * the atlas image.\n */\n')
    body = ',\n'.join(f' {json.dumps(k)}: ' + json.dumps(v, separators=(',', ':')) for k, v in all_data.items())
    return head + 'export const SCENE_LAYERS = {\n' + body + '\n};\n\nexport default SCENE_LAYERS;\n'


def check():
    """Fast: is the committed data still what the guides make? (inputs + walk grid)"""
    txt = open(os.path.join(ROOT, 'js', 'data', 'sceneLayers.js'), encoding='utf-8').read()
    have = json.loads(txt[txt.index('{', txt.index('SCENE_LAYERS')):txt.rindex('};') + 1])
    bad = []
    for scene in SCENES:
        d = have.get(scene)
        if not d or d.get('source') != sources(scene):
            bad.append(f'{scene}: inputs changed since the last build')
            continue
        _art, op, walk = load(scene)
        if d['walk']['rle'] != walk_rows(plant_walk(scene, op, walk)[0]):
            bad.append(f'{scene}: walk grid edited by hand')
        if not os.path.exists(os.path.join(ROOT, d['atlas'])):
            bad.append(f'{scene}: {d["atlas"]} missing')
    for b in bad:
        print(b)
    print('sceneLayers.js is ' + ('up to date' if not bad else 'STALE: run tools/build_occlusion.py'))
    sys.exit(1 if bad else 0)


def main():
    if '--check' in sys.argv:
        check()
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    want = args or SCENES
    heights = scene_actor_heights()
    out_js = os.path.join(ROOT, 'js', 'data', 'sceneLayers.js')
    all_data = {}
    if args and os.path.exists(out_js):
        txt = open(out_js, encoding='utf-8').read()
        all_data = json.loads(txt[txt.index('{', txt.index('SCENE_LAYERS')):txt.rindex('};') + 1])
    for scene in want:
        actor_h = heights.get(scene, 0.1)
        data, debug = build(scene, actor_h)
        all_data[scene] = data
        kinds = debug[4]
        tot = max(1, (kinds > 0).sum())
        print(f'{scene:10s} slices {len(data["slices"]):4d}  walkable {debug[2].mean():5.1%}  '
              f'grounded {(kinds == 1).sum() / tot:5.1%} hint {(kinds == 2).sum() / tot:5.1%} '
              f'floor {(kinds == 3).sum() / tot:5.1%} lintel {(kinds == 4).sum() / tot:5.1%}')
        if '--preview' in sys.argv:
            print('   ', os.path.relpath(preview(scene, data, debug, actor_h), ROOT))
    ordered = {s: all_data[s] for s in SCENES if s in all_data}
    open(out_js, 'w', encoding='utf-8').write(emit(ordered))
    print(f'wrote js/data/sceneLayers.js ({len(ordered)} scenes)')


if __name__ == '__main__':
    main()
