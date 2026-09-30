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
from depth_hints import HINTS, OBJECTS  # noqa: E402

def _hand_cleaned():
    """Scenes whose occlusion layer the artist cleaned by hand (docs/OCCLUSION.md, first table)."""
    try:
        doc = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'OCCLUSION.md')).read()
    except OSError:
        return frozenset()
    top = doc.split('## Pruned by the tool')[0]
    return frozenset(re.findall(r'^\| ([a-z]{3}-[a-z]+) \|', top, re.M))


HAND_CLEANED = _hand_cleaned()

CITY_DIR = {'nyc': 'NYC', 'lon': 'London', 'vie': 'Vienna', 'ist': 'Istanbul', 'che': 'Chennai', 'wen': 'Wenzhou', 'mad': 'Spain Madrid'}
SCENES = ['nyc-ext', 'nyc-int', 'nyc-up', 'nyc-venue', 'lon-ext', 'lon-int', 'lon-venue',
          'vie-ext', 'vie-int', 'vie-up', 'vie-venue', 'ist-ext', 'ist-int', 'ist-up', 'ist-venue',
          'che-ext', 'che-int', 'che-venue', 'wen-ext', 'wen-int', 'wen-up', 'wen-venue', 'mad-ext', 'mad-int']

GRID = (300, 225)          # js/core/freeWalk.js GRID
ALPHA = 128                # layer alpha that counts as opaque
BIN = 0.2                  # ground lines are floored to this many percent: one slice per band
SPECK = 12                 # opaque specks smaller than this (px) are dropped
FOOT = 12                  # px: a run is walked under when most of its lowest FOOT px are walkable
LINTEL = 0.9               # a hanging run with no hint: its line is this many character heights below it
UNIFY_R = 0.5              # character heights: how far along an object its front line carries (unify)
UNIFY_HOLD = 0.5           # character heights: a hinted canopy/sign trusts a holder this close to its hint (unify)
UNIFY_FAR = 1.5            # ...or this far, when no foot can stand between the two lines (unify)
OVER = 0.35                # character heights: a drawing may overlap the floor in front of its walk-mask edge by this much
SIDE_LEN = 1.0             # character heights: a blocked strip taller than this with floor beside it is a side wall
SIDE_D = 0.2               # character heights: a side wall's row is in front of feet this far above it
SIDE_R = 0.3               # character heights: how far beside a side-wall row the floor is looked for
DOOR_W = 1.0               # character heights: a walkable passage no wider than this through a wall is a doorway (interiors)
SIDE_W = 0.6               # character heights: a side wall is no wider than this
ADD_DIFF = 90              # colour distance (sum over RGB) from the floor that counts as part of an added object
DOOR_SIDE = 1.6            # character heights: each half of a wall beside a doorway is at least this long (a table is shorter)
WALLTOP_GAP = 4             # px: rows right below a walkable run that must be blocked for it to be a wall top
WALLTOP_PART = 0.9         # a drawn part with less than this share on walkable floor is a structure, not a rug
STACK_GAP = 0.08           # character heights: floor this deep between two footprints in one column splits it (stacked things)
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
    # Walkable is "light", but a mask saved flat on black (vie-ext, 2026-09-29)
    # paints its floor dark grey (~90) with nothing over 127: then split at half
    # its brightest level. Every other mask keeps the 127 cut.
    thr = 127 if walk.max() > 127 else int(walk.max()) // 2
    if scene not in MASK_IN_ART_FRAME:
        walk = warp(walk, scene, (W, H), cv2.INTER_NEAREST)
    opaque = alpha >= ALPHA
    art = np.asarray(art)
    for oid, kind, shape, _line in OBJECTS.get(scene, []):
        if kind == 'add':
            opaque = opaque | add_mask(art, shape)
        elif kind == 'fill':
            opaque = opaque | poly_mask(shape, W, H)
    return art, opaque, walk > thr


def add_mask(art, rect):
    """An object the artist's layer leaves out (a lamp on open floor): the
    pixels inside rect (percent) that differ from the floor round it (the
    median colour of a ring just outside the rect) by more than ADD_DIFF."""
    H, W = art.shape[:2]
    x0, y0, x1, y1 = (int(rect[0] / 100 * W), int(rect[1] / 100 * H), int(round(rect[2] / 100 * W)), int(round(rect[3] / 100 * H)))
    ring = np.zeros((H, W), bool)
    ring[max(0, y0 - 4):y1 + 4, max(0, x0 - 4):x1 + 4] = True
    ring[y0:y1, x0:x1] = False
    floor = np.median(art[ring].reshape(-1, 3).astype(np.float32), axis=0)
    diff = np.abs(art[y0:y1, x0:x1].astype(np.float32) - floor).sum(axis=2)
    cut = ndimage.binary_opening(diff > ADD_DIFF, iterations=1)
    lab, n = ndimage.label(cut)
    if n:
        sz = np.bincount(lab.ravel()); sz[0] = 0
        cut = lab == int(np.argmax(sz))          # the object, not specks of the floor pattern
        cut = ndimage.binary_fill_holes(cut)
    out = np.zeros((H, W), bool)
    out[y0:y1, x0:x1] = cut
    return out


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
    over = OVER * actor_h * H
    gap = max(3, int(STACK_GAP * actor_h * H))
    kinds = np.zeros((H, W), np.uint8)       # 1 grounded, 2 hint, 3 decal, 4 lintel, 5 cut-out object (for the preview)
    hung = []
    # each drawn part's share on walkable floor: a rug or plaque is ~all of it
    lab, n = ndimage.label(opaque, structure=np.ones((3, 3)))
    part_walk = np.ones(n + 1)
    if n:
        part_walk[1:] = ndimage.mean(walk, lab, np.arange(1, n + 1))
    walltop = np.zeros((H, W), bool)
    perrow = np.zeros((H, W), bool)
    for x in range(W):
        col = opaque[:, x]
        if not col.any():
            continue
        d = np.diff(np.concatenate(([0], col.astype(np.int8), [0])))
        starts = np.where(d == 1)[0]
        ends = np.where(d == -1)[0] - 1
        for a, b in zip(starts, ends):
            band = walk[max(a, b - FOOT + 1):b + 1, x]
            # where the walk mask says this thing meets the floor: the last
            # blocked row of the run, when the drawing only overlaps the floor
            # in front of it by a little (a wall's baseboard, a pot's shadow)
            blocked = np.where(~walk[a:b + 1, x])[0]
            meet = a + int(blocked[-1]) + 1 if blocked.size and b - (a + blocked[-1]) <= over else None
            if band.mean() < 0.5 or (meet is not None and np.isnan(hints[b, x]) and blocked.size >= 0.5 * (meet - a)):
                base[a:b + 1, x] = min(b, meet if meet is not None else b) / H * 100   # stands on the floor here
                kinds[a:b + 1, x] = 1
                # Two things stacked in one column of the drawing (a plant in
                # front of another plant, a chair before a sideboard): the walk
                # mask has two footprints in the run with floor between them.
                # Each part meets the floor at the end of ITS footprint (the
                # first one at or below it), not at the run's lowest pixel.
                wb = ~walk[a:b + 1, x]
                dd = np.diff(np.concatenate(([0], wb.astype(np.int8), [0])))
                s0, s1 = np.where(dd == 1)[0], np.where(dd == -1)[0]
                if len(s0) >= 2 and np.max(s0[1:] - s1[:-1]) >= gap:
                    keep = np.concatenate(([True], (s0[1:] - s1[:-1]) >= gap))
                    ends = []                  # merge sections split by a gap too small to stand in
                    for k in range(len(s0)):
                        if keep[k] or not ends:
                            ends.append(s1[k])
                        else:
                            ends[-1] = s1[k]
                    ends = np.array(ends)
                    ys = np.arange(b - a + 1)
                    j = np.searchsorted(ends, ys, side='left')
                    j = np.minimum(j, len(ends) - 1)
                    seg = a + ends[j]
                    cur = base[a:b + 1, x]
                    base[a:b + 1, x] = np.minimum(cur, seg / H * 100)
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
            below = walk[b + 1:b + 1 + WALLTOP_GAP, x]
            if below.size and below.mean() < 0.5 and part_walk[lab[b, x]] < WALLTOP_PART:
                # The top of a wall the walk mask runs behind on purpose (from
                # this angle a wall hides the floor behind it): the run is all
                # walkable, but the ground right below it is blocked and it is
                # part of a drawn structure, not a rug. It stands at its own
                # bottom edge: feet on it are behind it and it covers them.
                base[a:b + 1, x][rest] = b / H * 100
                kinds[a:b + 1, x][rest] = 1
                walltop[a:b + 1, x][rest] = True
            elif part_walk[lab[b, x]] < WALLTOP_PART:
                # walkable all the way but part of a drawn structure: a wall
                # running up the picture, a stair rail, a door post the mask
                # overlaps on purpose. Each row is where it is (as side_walls)
                ys = np.nonzero(rest)[0] + a
                base[ys, x] = np.minimum(99.0, (ys + SIDE_D * actor_h * H) / H * 100)
                kinds[ys, x] = 1
                perrow[ys, x] = True
            elif a >= 4 and above.mean() >= 0.5:
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
    side_walls(opaque, walk, base, kinds, actor_h)
    if scene.endswith(('-int', '-up')) and scene not in HAND_CLEANED:
        doorways(opaque, walk, base, kinds, actor_h)     # a hand-cleaned layer has no floor left in it
    unify(opaque, base, kinds, actor_h, standable(scene, opaque, walk, actor_h))
    rests_on(opaque, walk, base, kinds)
    # a wall top keeps its own edge: joined to the structure below it, it took
    # a line from far down and hid anyone in the room in front of the wall
    for x in np.nonzero(walltop.any(axis=0))[0]:
        col = walltop[:, x]
        d = np.diff(np.concatenate(([0], col.astype(np.int8), [0])))
        for a0, b0 in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            base[a0:b0, x] = (b0 - 1) / H * 100
            kinds[a0:b0, x] = 1
    ys, xs = np.nonzero(perrow)
    base[ys, xs] = np.minimum(99.0, (ys + SIDE_D * actor_h * H) / H * 100)
    kinds[ys, xs] = 1
    for _oid, m, line in objects(scene, opaque):       # after unify: nothing may pull an object's line
        m = m & opaque
        if line is None:                                 # floor: never in front of anybody
            base[m] = np.nan
            kinds[m] = 3
        elif line in ('rows', 'bed'):
            # seen from above: each row of it is where it is ('rows': a side
            # wall or hedge, a handrail down a staircase). 'bed': a flower bed,
            # whose rows are those of its blocked footprint; what rises above the
            # footprint (a bush over the floor behind the bed) stands at the
            # footprint's back edge, in front of anyone behind it
            ys, xs = np.nonzero(m)
            row = ys
            if line == 'bed':
                top = np.full((H, W), H, np.int32)      # first blocked row at or below each px
                nxt = np.full(W, H, np.int32)
                for y in range(H - 1, -1, -1):
                    nxt = np.where(walk[y], nxt, y)
                    top[y] = nxt
                row = np.maximum(ys, np.minimum(top[ys, xs], H - 1))
            base[ys, xs] = np.minimum(99.0, (row + SIDE_D * actor_h * H) / H * 100)
            kinds[m] = 5
        else:
            base[m] = line
            kinds[m] = 5
    return base, kinds


def object_mask(scene, oid, ell, seed, opaque):
    """The cut of one OBJECTS entry (bool, art size): tools/object-masks/<scene>-<oid>.png,
    made on first use. Foliage: the sunlit leaves in the ellipse (yellow-green,
    bright), closed into one crown, holes filled, plus the shaded green leaves
    within a few px of it, the part joined to the seed rect (the trunk), and
    the seed itself. GrabCut was tried and took the hedge behind the fence too."""
    path = os.path.join(HERE, 'object-masks', f'{scene}-{oid}.png')
    if os.path.exists(path):
        return np.asarray(Image.open(path).convert('L')) > 127
    art = np.asarray(Image.open(os.path.join(ROOT, 'assets', 'scenes', f'{scene}.webp')).convert('RGB'))
    H, W = art.shape[:2]
    cx, cy, rx, ry = ell[0] / 100 * W, ell[1] / 100 * H, ell[2] / 100 * W, ell[3] / 100 * H
    sx0, sy0, sx1, sy1 = (int(seed[0] / 100 * W), int(seed[1] / 100 * H), int(seed[2] / 100 * W), int(seed[3] / 100 * H))
    x0, x1 = max(0, min(int(cx - rx), sx0) - 2), min(W, max(int(cx + rx), sx1) + 3)
    y0, y1 = max(0, min(int(cy - ry), sy0) - 2), min(H, max(int(cy + ry), sy1) + 3)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    inside = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 < 1
    trunk = (xx >= sx0) & (xx <= sx1) & (yy >= sy0) & (yy <= sy1)
    hsv = cv2.cvtColor(np.ascontiguousarray(art[y0:y1, x0:x1]), cv2.COLOR_RGB2HSV).astype(int)
    hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    lit = (hue >= 25) & (hue <= 45) & (sat >= 80) & (val >= 90) & inside
    crown = cv2.morphologyEx(lit.astype(np.uint8), cv2.MORPH_CLOSE,
                             cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
    crown = ndimage.binary_fill_holes(crown)
    shade = (hue >= 25) & (hue <= 60) & (sat >= 60) & inside
    crown |= shade & ndimage.binary_dilation(crown, iterations=6)
    lab, _ = ndimage.label(crown | trunk)
    cut = np.isin(lab, np.unique(lab[trunk])) & opaque[y0:y1, x0:x1]
    out = np.zeros((H, W), bool)
    out[y0:y1, x0:x1] = cut
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(out.astype(np.uint8) * 255).save(path)
    return out


def poly_mask(pts, W, H):
    img = Image.new('L', (W, H), 0)
    ImageDraw.Draw(img).polygon([(x / 100 * W, y / 100 * H) for x, y in pts], fill=255)
    return np.asarray(img) > 127


def objects(scene, opaque):
    """[(id, mask, ground line percent | None)] for the scene's OBJECTS (depth_hints.py)."""
    H, W = opaque.shape
    out = []
    for oid, kind, shape, line in OBJECTS.get(scene, []):
        if kind == 'foliage':
            m = object_mask(scene, oid, shape[0], shape[1], opaque)
        elif kind == 'add':      # the cut from the art, and whatever of the layer is in the rect
            m = add_mask(np.asarray(Image.open(os.path.join(ROOT, 'assets', 'scenes', f'{scene}.webp')).convert('RGB')), shape)
            x0, y0, x1, y1 = shape
            m |= poly_mask([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], W, H)
        elif kind == 'fill':     # a shape the layer leaves out, drawn whole
            m = poly_mask(shape, W, H)
        elif kind == 'poly':
            if len(shape) == 4 and not isinstance(shape[0], (tuple, list)):     # a rect (x0, y0, x1, y1)
                x0, y0, x1, y1 = shape
                shape = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            m = poly_mask(shape, W, H)
        else:
            raise ValueError(f'{scene} {oid}: unknown object kind {kind}')
        out.append((oid, m, line))
    return out


def rests_on(opaque, walk, base, kinds):
    """Layer px on WALKABLE floor (a wall edge, a table back the feet may overlap)
    belong to the blocked thing drawn right below them in their run, or to
    something behind it; never to something further forward. Joining can give
    them a line from far down the picture (ist-int: a wall edge took the entry
    pillar's 83.5 over a table at 67.7), which cut a player standing there into
    stripes. Cap each at the line of the first blocked px below it in its run."""
    H, W = opaque.shape
    for x in range(W):
        col = opaque[:, x]
        if not col.any():
            continue
        d = np.diff(np.concatenate(([0], col.astype(np.int8), [0])))
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            wk = walk[a:b, x]
            if not wk.any() or wk.all():
                continue
            cap = np.nan
            for y in range(b - 1, a - 1, -1):
                if not wk[y - a]:
                    if kinds[y, x] == 1 and not np.isnan(base[y, x]):
                        cap = base[y, x]
                elif not np.isnan(cap) and kinds[y, x] == 1 and base[y, x] > cap:
                    base[y, x] = cap


def doorways(opaque, walk, base, kinds, actor_h):
    """Interiors are cutaway plans with the floor in the layer too. In a doorway
    the floor strip's column runs on into the wall in front of it and took that
    wall's ground line, so a player in the doorway was hidden by the FLOOR (or,
    where only some rows were caught, cut into stripes).

    A doorway is a passage through a WALL: floor narrower than DOOR_W character
    heights ACROSS, whose two sides are walls (blocked runs, along the passage
    edge, longer than DOOR_SIDE character heights: the two halves of the wall),
    with open floor (walkable, not layer) on both sides of it ALONG the passage.
    Layer px in it are floor. Not doors: the gap between two tables (their
    footprints are short), the strip where feet overlap the top of a wall (not
    narrow), the pocket behind a chair (no open floor beyond it)."""
    H, W = opaque.shape
    A = actor_h * H
    lim = DOOR_W * A
    need = DOOR_SIDE * A
    free = walk & ~opaque
    blocked = ~walk

    def runlen(m):
        """Length of the True run (along axis 1) each px is in."""
        out = np.zeros(m.shape, np.int32)
        for i in range(m.shape[0]):
            d = np.diff(np.concatenate(([0], m[i].astype(np.int8), [0])))
            for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
                out[i, a:b] = b - a
        return out

    def passages(wk, bl_along, fr):
        """Axis 1 of wk runs ACROSS the passage; bl_along: length of the blocked run
        each px is in, measured along the passage edge (axis 0 of wk). Returns
        px of narrow walkable runs walled on both sides."""
        out = np.zeros(wk.shape, bool)
        n = wk.shape[1]
        for i in range(wk.shape[0]):
            d = np.diff(np.concatenate(([0], wk[i].astype(np.int8), [0])))
            for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
                if b - a <= lim and a > 0 and b < n and bl_along[i, a - 1] >= need and bl_along[i, b] >= need:
                    out[i, a:b] = True
        return out

    def through(wk, fr):
        """Walkable px (runs along axis 1) with open floor both before and after in their run."""
        out = np.zeros(wk.shape, bool)
        for i in range(wk.shape[0]):
            d = np.diff(np.concatenate(([0], wk[i].astype(np.int8), [0])))
            for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
                f = np.concatenate(([0], np.cumsum(fr[i, a:b])))
                out[i, a:b] = (f[:-1] > 0) & ((f[-1] - f[1:]) > 0)
        return out

    vlen = runlen(blocked.T).T        # blocked run length up/down the picture
    hlen = runlen(blocked)            # blocked run length across the picture
    # passage going UP/DOWN through a wall running ACROSS: narrow in rows, its
    # sides are that wall's two halves (long across), open floor above and below
    updown = passages(walk, hlen, free) & through(walk.T, free.T).T
    # passage going ACROSS through a wall running UP/DOWN
    across = passages(walk.T, vlen.T, free.T).T & through(walk, free)
    cond = opaque & (updown | across) & (kinds == 1)
    base[cond] = np.nan
    kinds[cond] = 3


def side_walls(opaque, walk, base, kinds, actor_h):
    """A wall that runs UP the picture (between two rooms, a pillar at a room's
    corner) is drawn as a tall blocked strip with floor beside it. Its column
    reaches down to its far end, so the whole strip took the ground line of its
    bottom end and cut through anyone standing beside it. Each row of it is
    where it is: line = the row + SIDE_D character heights, where the strip is
    taller than SIDE_LEN and walkable floor lies within SIDE_R in that row."""
    H, W = opaque.shape
    A = actor_h * H
    blocked = ~walk
    seg = np.zeros((H, W), np.int32)                 # length of the blocked vertical run each px is in
    for x in range(W):
        col = blocked[:, x]
        d = np.diff(np.concatenate(([0], col.astype(np.int8), [0])))
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            seg[a:b, x] = b - a
    r = max(1, int(SIDE_R * A))
    beside = ndimage.maximum_filter1d(walk.astype(np.uint8), 2 * r + 1, axis=1) > 0
    # only a NARROW strip is a wall seen edge-on (a wall between rooms, a
    # pillar); a wide blocked block (a garden, a bed) is a thing seen from
    # above, and each of its rows being "where it is" would let a player stand
    # in front of its back row: the cypress at the top of a garden
    wid = np.zeros((H, W), np.int32)                 # width of the blocked horizontal run each px is in
    for y in range(H):
        row = blocked[y]
        d = np.diff(np.concatenate(([0], row.astype(np.int8), [0])))
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            wid[y, a:b] = b - a
    cond = opaque & (kinds == 1) & blocked & (seg > SIDE_LEN * A) & beside & (wid <= SIDE_W * A)
    ys, xs = np.nonzero(cond)
    line = np.minimum(base[ys, xs], (ys + SIDE_D * A) / H * 100)
    base[ys, xs] = line
    # A wall stands on ITS OWN blocked section. Where the walk mask runs a
    # passage through a drawn wall (into a hall, under an arch), the column of
    # the drawing carries on through the passage into the wall in front, and
    # the wall BEHIND the passage took the front wall's ground line: a player
    # walking through was hidden by the wall further back. A pixel on a
    # blocked section taller than a character meets the floor where that
    # section ends; only what is drawn over the passage hangs in front.
    bot = np.zeros((H, W), np.int32)                 # last row of the blocked vertical run each px is in
    for x in range(W):
        col = blocked[:, x]
        d = np.diff(np.concatenate(([0], col.astype(np.int8), [0])))
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            bot[a:b, x] = b - 1
    wall = opaque & (kinds == 1) & blocked & (seg > SIDE_LEN * A)
    ys, xs = np.nonzero(wall)
    base[ys, xs] = np.minimum(base[ys, xs], (bot[ys, xs] + 1) / H * 100)


def standable(scene, opaque, walk, actor_h):
    """Where a character's FEET can be: the walk mask as the game uses it (the
    floor behind potted plants opened, then eroded by the walker's feet like
    freeWalk.js), plus every spot an NPC is placed (they may stand off it)."""
    H, W = walk.shape
    wo, _ = plant_walk(scene, opaque, walk)
    h = actor_h * 100
    hw = max(1, int(max(1.0, h * 0.11) / 100 * H))       # walkerFor: percent of the scene HEIGHT
    hd = max(1, int(max(0.6, h * 0.04) / 100 * H))
    feet = ndimage.binary_erosion(wo, structure=np.ones((2 * hd + 1, 2 * hw + 1)))
    for x, y in npc_feet().get(scene, []):
        fx, fy = int(x / 100 * W), int(y / 100 * H)
        feet[max(0, fy - 4):fy + 5, max(0, fx - 6):fx + 7] = True
    return feet


_NPC = None


def npc_feet():
    """scene -> [(x, y) percent]: hotspot NPCs, a scene's crowd, club members."""
    global _NPC
    if _NPC is None:
        import subprocess
        js = ("Promise.all([import('./js/data/scenes.js'), import('./js/data/memberSpots.js')]).then(([S, M]) => {"
              " const out = {};"
              " for (const s of Object.values(S.SCENES)) {"
              "  const f = out[s.id] = [];"
              "  for (const h of s.hotspots) if (h.npc?.at) f.push(h.npc.at);"
              "  if (s.crowd) f.push(...s.crowd.left, ...s.crowd.right);"
              "  for (const m of Object.values(M.MEMBER_SPOTS[s.id] || {})) f.push(m.at);"
              " }"
              " console.log(JSON.stringify(out)); })")
        _NPC = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', js], cwd=ROOT, text=True))
    return _NPC


def unify(opaque, base, kinds, actor_h, feet):
    """One ground line across an object, where nobody can tell the difference.

    Each column's line is where THAT column's pixels end, so an object with a
    ragged bottom (legs, a canopy wider than its table) came out as stripes of
    different depth, and a character near it was hidden by some columns and
    drawn over by others.

    A pixel may take the lower line of a pixel of the same connected part
    beside it (same row, up to UNIFY_R character heights) or below it (same
    column) ONLY when no character can stand between the two lines anywhere
    its sprite would cover the pixel: no standable feet (`feet`) in the rows
    between, a sprite's width either side. Then the change is invisible to
    anyone who can be there, and the stripes go. Measured from the pixel's
    ORIGINAL line every time, so lines never creep forward in chains: an
    object never claims floor a character can stand on in front of it (a tree
    stays walk-around, both ways).

    A pixel hung over walkable floor (a tree canopy, a sign, kinds 2 and 4)
    takes the line of the NEAREST standing pixel of its part in its row, the
    thing holding it up: a street tree's canopy used an old hand-set hint a
    little in front of its trunk, so a player in front of the trunk was covered
    by the canopy; umbrella poles on the LINTEL fallback sat 15% low. With no
    standing pixel within UNIFY_R it keeps its own line."""
    H, W = opaque.shape
    live = opaque & ~np.isnan(base) & (base < 99) & ((kinds == 1) | (kinds == 2) | (kinds == 4))
    lab, n = ndimage.label(live, structure=np.ones((3, 3)))
    if not n:
        return
    r = max(2, int(UNIFY_R * actor_h * H))
    far = UNIFY_FAR * actor_h * 100
    ys, xs = np.nonzero(live)
    lb = lab[ys, xs]
    hanging = (kinds[ys, xs] == 4) | (kinds[ys, xs] == 2)
    standing = kinds[ys, xs] == 1
    C = np.zeros((H + 1, W + 1), np.int32)             # standable feet above-left of each point
    C[1:, 1:] = np.cumsum(np.cumsum(feet, axis=0), axis=1)
    ah = max(actor_h, 40 / 340)                         # scene.js: max(40 px, stage * actorHeight), smallest stage
    A = int(ah * H) + 2
    half = int(ah * H * 72 / 108 / 2) + 2               # a sprite's half width (CELL 72x108)
    L0 = base[ys, xs].astype(np.float32)
    idx = np.full((H, W), -1, np.int64)
    idx[ys, xs] = np.arange(ys.size)

    def beside(dx, dy=0):
        """per live pixel: index of the live pixel (dx, dy) away in the same part, else -1"""
        xq, yq = xs + dx, ys + dy
        inb = (xq >= 0) & (xq < W) & (yq >= 0) & (yq < H)
        j = np.full(ys.size, -1, np.int64)
        j[inb] = idx[yq[inb], xq[inb]]
        has = j >= 0
        has[has] = lab[yq[has], xq[has]] == lb[has]
        return np.where(has, j, -1)

    # hanging parts: of the standing pixels of the part within UNIFY_R in the
    # row, the one whose line agrees best with the hanging pixel's own (the
    # trunk under a canopy, not a hedge the canopy overlaps), within
    # UNIFY_HOLD character heights (UNIFY_FAR for a guessed lintel)
    if hanging.any():
        best = np.full(ys.size, np.inf, np.float32)
        pick = L0.copy()
        bound = np.where(kinds[ys, xs] == 4, UNIFY_FAR, UNIFY_HOLD) * actor_h * 100
        for dx in range(-r, r + 1):
            if dx == 0:
                continue
            j = beside(dx)
            g = (j >= 0) & hanging
            g[g] = standing[j[g]]
            k = np.where(g)[0]
            dev = np.abs(L0[j[k]] - L0[k])
            better = (dev < best[k]) & (dev <= bound[k])
            kk = k[better]
            best[kk] = dev[better]
            pick[kk] = L0[j[kk]]
        L0 = pick
    y_of = lambda v: np.clip((v / 100 * H).astype(np.int64), 0, H)
    L = L0.copy()
    offsets = [(d, 0) for d in range(-r, r + 1) if d] + [(0, d) for d in range(1, r + 1)]
    for _ in range(6):
        M = L.copy()
        for dx, dy in offsets:
            j = beside(dx, dy)
            has = j >= 0
            q = np.where(has, L[np.maximum(j, 0)], -1.0)
            k = np.where(has & (q > M) & (q - L0 <= far))[0]
            if not k.size:
                continue
            # feet rows between the two lines whose sprite (92% above the feet, 8%
            # below) could reach this pixel at all
            y0 = np.maximum(y_of(L0[k]) + 1, ys[k] - int(0.08 * A))
            y1 = np.minimum(y_of(q[k]) + 1, ys[k] + A + 1)
            y0 = np.clip(y0, 0, H)
            y1 = np.clip(np.maximum(y1, y0), 0, H)
            xa = np.clip(xs[k] - half, 0, W); xb = np.clip(xs[k] + half + 1, 0, W)
            free = C[y1, xb] - C[y0, xb] - C[y1, xa] + C[y0, xa]
            ok = k[free == 0]
            M[ok] = q[ok]
        if np.array_equal(M, L):
            break
        L = M
    base[ys, xs] = L


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
    # stray dots of the drawing go; a depth piece of a real object never does
    # (dropping small PIECES left holes in chair and table edges: feet showed)
    lab, n = ndimage.label(valid, structure=np.ones((3, 3)))
    if n:
        sizes = ndimage.sum(valid, lab, np.arange(1, n + 1))
        valid &= ~np.isin(lab, np.nonzero(sizes < SPECK)[0] + 1)
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
    tun = repr((GRID, ALPHA, BIN, SPECK, FOOT, LINTEL, UNIFY_R, UNIFY_HOLD, UNIFY_FAR, 'unify6', OVER, SIDE_LEN, SIDE_D, SIDE_R, SIDE_W, 'rows2', STACK_GAP, DOOR_W, 'door4', DOOR_SIDE, 'rests1', 'walltop2', 'speck2', sorted(HAND_CLEANED), WALLTOP_GAP, WALLTOP_PART, PLANT.pattern, PLANT_REACH, WARP.get(scene), HINTS.get(scene)))
    cuts = [md5(os.path.join(HERE, 'object-masks', f'{scene}-{o[0]}.png')) for o in OBJECTS.get(scene, [])
            if o[1] == 'foliage' and os.path.exists(os.path.join(HERE, 'object-masks', f'{scene}-{o[0]}.png'))]
    tun += repr((OBJECTS.get(scene), cuts))
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
    # The URL carries the atlas's own hash: every build repacks it, and a cached
    # atlas read against new slice data draws furniture and walls in pieces.
    if os.path.exists(os.path.join(ROOT, src)):
        src += '?v=' + hashlib.md5(open(os.path.join(ROOT, src), 'rb').read()).hexdigest()[:10]
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
    # feet only where the GAME lets a player stand (freeWalk.js walkerFor), or
    # the preview shows bodies in places nobody can reach
    h = actor_h * 100
    hw = max(1, int(max(1.0, h * 0.11) / 100 * H))
    hd = max(1, int(max(0.6, h * 0.04) / 100 * H))
    er = ndimage.binary_erosion(walk, structure=np.ones((2 * hd + 1, 2 * hw + 1)))
    canvas = Image.fromarray(art).convert('RGBA')
    # tint by kind: hint = blue, lintel = orange, decal = green
    tint = np.zeros((H, W, 4), np.uint8)
    tint[kinds == 2] = (60, 120, 255, 70)
    tint[kinds == 4] = (255, 150, 0, 90)
    tint[kinds == 3] = (0, 255, 90, 70)
    tint[kinds == 5] = (170, 60, 255, 70)      # cut-out object
    canvas.alpha_composite(Image.fromarray(tint, 'RGBA'))
    sy, sx = max(24, int(ah * 0.8)), max(30, aw * 3)
    # PREVIEW_SHIFT="fx,fy": move the whole grid by that share of a cell (fresh spots each review)
    fx, fy = (float(v) for v in os.environ.get('PREVIEW_SHIFT', '0,0').split(','))
    ox, oy = int(fx * sx), int(fy * sy)
    feet = [(x + ox + (sx // 2 if (y // sy) % 2 else 0), y + oy) for y in range(sy // 2, H - oy, sy)
            for x in range(sx // 2, W - sx // 2 - ox, sx)]
    feet = [(x, y) for x, y in feet if x < W and y < H]
    if os.environ.get('PREVIEW_FEET'):      # "x,y;x,y" percent: bodies exactly there (probing one spot)
        feet = [(int(float(a) / 100 * W), int(float(b) / 100 * H))
                for a, b in (q.split(',') for q in os.environ['PREVIEW_FEET'].split(';'))]
    feet = [(x, y) for x, y in feet if er[y, x]] if not os.environ.get('PREVIEW_FEET') else feet
    layers = [(p[0], 'slice', p) for p in data['slices']] + [(y / H * 100, 'actor', (x, y)) for x, y in feet]
    layers.sort(key=lambda t: (round(t[0] * 10), 0 if t[1] == 'slice' else 1))
    for _z, kind, item in layers:
        if kind == 'slice':
            x0 = round(item[1] / 100 * W); y0 = round(item[2] / 100 * H)
            w, h = item[7:9]
            # slices() caps a line at 99.0 (990) but keeps the snapped 991-999
            # in `base`: compare capped, or every front-most slice is never drawn
            m = np.minimum(base[y0:y0 + h, x0:x0 + w], 990) == round(item[0] * 10)
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
        path, _, ver = d['atlas'].partition('?v=')
        if not os.path.exists(os.path.join(ROOT, path)):
            bad.append(f'{scene}: {path} missing')
        elif ver != hashlib.md5(open(os.path.join(ROOT, path), 'rb').read()).hexdigest()[:10]:
            bad.append(f'{scene}: {path} does not match its ?v= hash')
    for b in bad:
        print(b)
    print('sceneLayers.js is ' + ('up to date' if not bad else 'STALE: run tools/build_occlusion.py'))
    sys.exit(1 if bad else 0)


def build_one(job):
    scene, actor_h, want_preview = job
    data, debug = build(scene, actor_h)
    kinds = debug[4]
    tot = max(1, (kinds > 0).sum())
    line = (f'{scene:10s} slices {len(data["slices"]):4d}  walkable {debug[2].mean():5.1%}  '
            f'grounded {(kinds == 1).sum() / tot:5.1%} hint {(kinds == 2).sum() / tot:5.1%} '
            f'floor {(kinds == 3).sum() / tot:5.1%} lintel {(kinds == 4).sum() / tot:5.1%}')
    if want_preview:
        line += '\n    ' + os.path.relpath(preview(scene, data, debug, actor_h), ROOT)
    return scene, data, line


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
    # one process per scene: unify() makes a scene take a minute or more
    from multiprocessing import Pool
    jobs = [(scene, heights.get(scene, 0.1), '--preview' in sys.argv) for scene in want]
    with Pool(min(len(jobs), os.cpu_count() or 1)) as pool:
        for scene, data, line in pool.imap(build_one, jobs):
            all_data[scene] = data
            print(line, flush=True)
    ordered = {s: all_data[s] for s in SCENES if s in all_data}
    open(out_js, 'w', encoding='utf-8').write(emit(ordered))
    print(f'wrote js/data/sceneLayers.js ({len(ordered)} scenes)')


if __name__ == '__main__':
    main()
