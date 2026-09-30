#!/usr/bin/env python3
# tools/floor_depth.py [scene ...] [--check] : Vienna depth from the FLOOR MASK (experiment, docs/FLOORMASK.md)
"""Depth slices for the Vienna scenes from three separate sources:

    walk mask   where feet may stand (movement only: the walk grid is copied
                from js/data/sceneLayers.js untouched, so walking is identical)
    floor mask  where the ground is (tools/floor_mask.py; the artist may paint it)
    occlusion   the artist's ORIGINAL layer, <City>/<scene>-occlusion-original.png
                (immutable: never pruned, never written)

Writes js/data/sceneLayersFloor.js (Vienna only) and assets/layers-floor/*.webp;
the legacy data (js/data/sceneLayers.js, assets/layers) is not touched, and the
game switches between the two (scene.js: L key, ?depth=legacy|floor).

THE RULE. Per pixel column, each run of the layer is walked down. A layer px
over FLOOR is the object in front of the floor it covers (a wall top over the
floor behind it, leaves, a chair back); a layer px over NOT-FLOOR is where the
object stands (its footprint); UNSURE counts as not-floor, the old assumption.
  1. A run splits into PIECES wherever a footprint gives way to floor below it:
     two objects stacked in one column, or one object that stands at two
     depths, become separate depth regions (object_depth_1, _2, ...).
  2. A piece stands where the floor resumes under its footprint (a drawing may
     overlap the floor in front by OVER character heights: a baseboard).
  3. THE FLOOR MASK'S JOB. A piece whose drawing starts over floor (a band of
     hidden floor above its footprint, at least MIN_BAND character heights)
     shows how tall it is: that band IS its height h, the floor its top hides.
     Seen from this angle an object of height h on footprint rows [t, c) draws
     its top at rows [t-h, c-h) (row r is the top over floor row r+h) and its
     front at [c-h, c) (all at c). So each px stands at min(row + h, c): a long
     table, a wall top, the chair behind a table, a doorway side are in front
     of a player at one row and behind at the next, from one drawing. With no
     band the height is unknown and the piece stands at c whole (the old rule),
     except a long narrow footprint with walkable floor beside it (a wall
     running up the picture): row + SIDE_D character heights, as before.
  4. A piece with no footprint at all (leaves over the floor, a lintel, the far
     edge of a round table top) takes the line of the grounded part of the same
     drawing it hangs from (nearest first, within INHERIT_R character heights);
     never less than the floor it covers. Where nothing holds it: flagged.
  5. The scene's manual HINTS apply to those hanging pieces, its OBJECTS to
     everything (tools/depth_hints.py), exactly as in the legacy build.
  6. A part of the layer lying wholly on floor, floor above and below it, is a
     floor thing (a rug, a plaque): dropped, never in front of anybody.
Report per scene: tools/shots/floor/<scene>-regions.{png,json}."""
import hashlib
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_occlusion as bo  # noqa: E402
import floor_mask as fm  # noqa: E402

SCENES = fm.SCENES
OVER = 0.35            # character heights: a drawing may overlap the floor in front of its footprint by this much
SIDE_LEN = 1.0         # character heights: a footprint longer than this down one column may be a strip (rule 3)
SIDE_W = 1.0           # character heights: ...if each row of it is no wider than this
SIDE_R = 0.3           # character heights: ...and floor lies this close beside it
SIDE_D = 0.2           # character heights: a strip row with no known height is in front of feet this far above it
MIN_BAND = 0.08        # character heights: a hidden-floor band thinner than this is an anti-aliased edge, not a height
STEP = 0.08            # character heights: per-row lines are kept to this precision (the shoe strip), rounded forward
INHERIT_R = 0.6        # character heights: how far a hanging piece looks for what holds it (rule 4)
DECAL_ON_FLOOR = 0.95  # rule 6
SPLIT_GAP = 0.25       # character heights: two pieces of one drawing this far apart in line count as separate depths
SPANS = 0.5            # character heights: a drawing whose lines spread over more than this spans several depths
LEGACY_JS = os.path.join(ROOT, 'js', 'data', 'sceneLayers.js')
OUT_JS = os.path.join(ROOT, 'js', 'data', 'sceneLayersFloor.js')
SHOTS = os.path.join(ROOT, 'tools', 'shots', 'floor')

K_GROUNDED, K_HINT, K_DECAL, K_OBJECT, K_INHERIT, K_HANGING, K_STRIP, K_BOX = 1, 2, 3, 5, 6, 7, 8, 9


def legacy_layers():
    t = open(LEGACY_JS, encoding='utf-8').read()
    return json.loads(t[t.index('{', t.index('SCENE_LAYERS')):t.rindex('};') + 1])


def inputs(scene):
    art, pruned, walk = bo.load(scene)
    H, W = walk.shape
    walk_open, _n = bo.plant_walk(scene, pruned, walk)       # the legacy movement, exactly
    opaque = fm.original_opaque(scene, W, H)
    for _oid, kind, shape, _line in bo.OBJECTS.get(scene, []):
        if kind == 'add':
            opaque |= bo.add_mask(art, shape)
        elif kind == 'fill':
            opaque |= bo.poly_mask(shape, W, H)
    floor = fm.load_floor(scene, W, H)
    return art, opaque, walk_open, floor


def runlen(m):
    """Length of the True run along axis 1 that each px is in."""
    out = np.zeros(m.shape, np.int32)
    for i in range(m.shape[0]):
        d = np.diff(np.concatenate(([0], m[i].astype(np.int8), [0])))
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            out[i, a:b] = b - a
    return out


def strip_rows(foot, is_floor, max_w, reach):
    """Footprint px whose horizontal run is at most max_w wide and has floor within
    `reach` px past its left or right end."""
    H, W = foot.shape
    out = np.zeros_like(foot)
    for y in range(H):
        row = foot[y]
        if not row.any():
            continue
        d = np.diff(np.concatenate(([0], row.astype(np.int8), [0])))
        fl = is_floor[y]
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            if b - a > max_w:
                continue
            if fl[max(0, a - reach):a].any() or fl[b:b + reach].any():
                out[y, a:b] = True
    return out


def floor_decals(opaque, is_floor):
    lab, n = ndimage.label(opaque, structure=np.ones((3, 3)))
    out = np.zeros_like(opaque)
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        part = lab[sl] == i
        if part.sum() < 30 or is_floor[sl][part].mean() < DECAL_ON_FLOOR:
            continue
        y0, y1 = sl[0].start, sl[0].stop
        above = is_floor[max(0, y0 - 6):y0, sl[1]]
        below = is_floor[y1:y1 + 6, sl[1]]
        if above.size and below.size and above.mean() >= 0.8 and below.mean() >= 0.8:
            out[sl] |= part
    return out


def depth(scene, opaque, walk, floor, actor_h):
    """(base percent per px, kind per px, piece id per px, fallback line of hanging px, decals)"""
    H, W = opaque.shape
    A = actor_h * H
    is_floor = floor == fm.FLOOR
    decals = floor_decals(opaque, is_floor)
    opaque = opaque & ~decals
    foot = opaque & ~is_floor                    # footprint (unsure counts as footprint)
    base = np.full((H, W), np.nan, np.float32)
    kinds = np.zeros((H, W), np.uint8)
    piece = np.full((H, W), -1, np.int32)
    contact = []                                 # contact row per piece id
    over = OVER * A
    # rule 3 inputs: per row, is this footprint's horizontal run narrow, with
    # floor within reach of either of its ends (a wall seen from above, not a
    # block of furniture)
    narrow = strip_rows(foot, walk & ~opaque, SIDE_W * A, max(1, int(SIDE_R * A)))
    side_d = SIDE_D * A
    min_band = max(2, MIN_BAND * A)
    heights = []                                 # per piece: the known height in px, -1 unknown

    def add_piece(x, y0, y1, c):
        contact.append(c)
        piece[y0:y1 + 1, x] = len(contact) - 1

    for x in range(W):
        col = opaque[:, x]
        if not col.any():
            continue
        d = np.diff(np.concatenate(([0], col.astype(np.int8), [0])))
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0] - 1):
            fp = foot[a:b + 1, x]
            # rule 1: cut after every footprint that has floor right below it
            cuts = list(np.where(fp[:-1] & ~fp[1:])[0] + a) + [b]
            start = a
            for k, e in enumerate(cuts):
                if e < start:
                    continue
                seg = fp[start - a:e - a + 1]
                if not seg.any():                                        # rule 4: hanging
                    base[start:e + 1, x] = (e + 1) / H * 100
                    kinds[start:e + 1, x] = K_HANGING
                    add_piece(x, start, e, e + 1)
                    heights.append(-1)
                    start = e + 1
                    continue
                last = start + int(np.where(seg)[0][-1])
                end = e
                if k == len(cuts) - 1 and e - last > over:                # a long drawing over the floor in front: its own piece
                    end = last
                c = last + 1                                             # rule 2
                top = start + int(np.argmax(seg))                        # first footprint row
                hp = top - start                                         # hidden floor above the footprint = the height
                ys = np.arange(start, end + 1)
                if hp >= min_band:                                       # rule 3: height known
                    base[start:end + 1, x] = np.minimum(c, ys + hp) / H * 100
                    kinds[start:end + 1, x] = K_BOX
                elif (last - top + 1) > SIDE_LEN * A and narrow[top:last + 1, x].mean() >= 0.5:
                    base[start:end + 1, x] = np.minimum(c, ys + side_d) / H * 100
                    kinds[start:end + 1, x] = K_STRIP
                else:
                    base[start:end + 1, x] = c / H * 100
                    kinds[start:end + 1, x] = K_GROUNDED
                heights.append(hp if hp >= min_band else -1)
                add_piece(x, start, end, c)
                if end < e:                                              # the long overlap: hanging piece
                    base[end + 1:e + 1, x] = (e + 1) / H * 100
                    kinds[end + 1:e + 1, x] = K_HANGING
                    add_piece(x, end + 1, e, e + 1)
                    heights.append(-1)
                start = e + 1
    # per-row lines to steps of STEP character heights, rounded DOWN the picture:
    # finer than the shoe strip buys nothing and costs a depth piece per step,
    # and rounding forward can only make a thing cover a little more, never
    # show feet over it
    rowish = (kinds == K_BOX) | (kinds == K_STRIP)
    q = max(bo.BIN, np.ceil(STEP * A / H * 100 / bo.BIN) * bo.BIN)
    base[rowish] = np.minimum(np.ceil(base[rowish] / q - 1e-6) * q, np.maximum(base[rowish], 99.0))
    # rule 4: hanging px take the line of what holds them, nearest first (the front-most on a tie)
    fallback = np.where(kinds == K_HANGING, base, np.nan)
    held = (kinds == K_GROUNDED) | (kinds == K_STRIP) | (kinds == K_BOX)
    hang = kinds == K_HANGING
    val = np.where(held, base, -1.0).astype(np.float32)
    assigned = held.copy()
    for _ in range(max(1, int(INHERIT_R * A))):
        grow = ndimage.binary_dilation(assigned, structure=np.ones((3, 3))) & hang & ~assigned
        if not grow.any():
            break
        vmax = ndimage.grey_dilation(np.where(assigned, val, -1.0), size=(3, 3))
        val[grow] = vmax[grow]
        assigned |= grow
    got = hang & assigned
    base[got] = np.maximum(val[got], fallback[got])                      # never behind the floor it covers
    kinds[got] = K_INHERIT
    # rule 5: hints for hanging pieces, objects for everything (as build_occlusion.depth)
    hints = bo.hint_map(scene, W, H)
    hh_ = ((kinds == K_INHERIT) | (kinds == K_HANGING)) & ~np.isnan(hints)
    auto = base.copy()                                                   # before any manual depth (the report)
    base[hh_] = hints[hh_]
    kinds[hh_] = K_HINT
    for _oid, m, line in bo.objects(scene, opaque):
        m = m & opaque
        if line is None:
            base[m] = np.nan
            kinds[m] = K_DECAL
        elif line in ('rows', 'bed'):
            ys, xs = np.nonzero(m)
            row = ys
            if line == 'bed':
                top = np.full((H, W), H, np.int32)
                nxt = np.full(W, H, np.int32)
                for y in range(H - 1, -1, -1):
                    nxt = np.where(walk[y], nxt, y)
                    top[y] = nxt
                row = np.maximum(ys, np.minimum(top[ys, xs], H - 1))
            base[ys, xs] = np.minimum(99.0, (row + bo.SIDE_D * actor_h * H) / H * 100)
            kinds[m] = K_OBJECT
        else:
            base[m] = line
            kinds[m] = K_OBJECT
    base[decals] = np.nan
    kinds[decals] = K_DECAL
    return base, kinds, piece, np.array(contact, np.int32), np.array(heights, np.int32), auto, decals, opaque


def sources(scene):
    folder = os.path.join(ROOT, bo.CITY_DIR[scene[:3]])
    md5 = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()[:12]
    rules = repr((OVER, SIDE_LEN, SIDE_W, SIDE_R, SIDE_D, MIN_BAND, INHERIT_R, DECAL_ON_FLOOR, 'box2', STEP,
                  fm.K, fm.L_WEIGHT, fm.T_FLOOR, fm.T_NOT, bo.GRID, bo.ALPHA, bo.BIN, bo.SPECK,
                  bo.WARP.get(scene), bo.HINTS.get(scene), bo.OBJECTS.get(scene)))
    return {'walkmask': md5(os.path.join(folder, f'{scene}-walkmask.png')),
            'floormask': md5(fm.floor_path(scene)),
            'occlusion': md5(fm.original_path(scene)),
            'art': md5(os.path.join(ROOT, 'assets', 'scenes', f'{scene}.webp')),
            'rules': hashlib.md5(rules.encode()).hexdigest()[:12]}


def build(scene, actor_h, legacy):
    art, opaque, walk, floor = inputs(scene)
    H, W = opaque.shape
    base, kinds, piece, contact, heights, auto, decals, opaque = depth(scene, opaque, walk, floor, actor_h)
    parts, _snapped = bo.slices(base, walk, actor_h)
    pos, (aw, ah) = bo.pack(parts)
    atlas = np.zeros((ah, aw, 4), np.uint8)
    props = []
    for (z, sl, m), (ax, ay) in zip(parts, pos):
        h, w = m.shape
        tile = np.zeros((h, w, 4), np.uint8)
        tile[..., :3] = art[sl]
        tile[..., 3] = np.where(m, 255, 0)
        atlas[ay:ay + h, ax:ax + w] = tile
        props.append([round(z, 2), round(sl[1].start / W * 100, 3), round(sl[0].start / H * 100, 3),
                      round(w / W * 100, 3), round(h / H * 100, 3), ax, ay, w, h])
    src = f'assets/layers-floor/{scene}.webp'
    os.makedirs(os.path.join(ROOT, 'assets', 'layers-floor'), exist_ok=True)
    Image.fromarray(atlas, 'RGBA').save(os.path.join(ROOT, src), 'WEBP', quality=92, alpha_quality=100, method=6)
    src += '?v=' + hashlib.md5(open(os.path.join(ROOT, src), 'rb').read()).hexdigest()[:10]
    data = {'source': sources(scene), 'atlas': src, 'atlasSize': [aw, ah], 'size': [W, H], 'slices': props,
            'walk': legacy[scene]['walk'], 'depth': 'floor'}
    legacy_base, _k = bo.depth(scene, *bo.load(scene)[1:], actor_h)            # what the legacy build says (for the report)
    report = regions(scene, art, opaque, walk, floor, base, kinds, piece, contact, heights, auto, decals, actor_h, legacy_base)
    return data, report


def name_for(scene, bbox_pct):
    """The existing hint/object whose rect overlaps this footprint most (its name), else ''."""
    x0, y0, x1, y1 = bbox_pct
    best, name = 0.0, ''
    rects = [(pid, r) for pid, r, _b, _f in bo.HINTS.get(scene, [])]
    for oid, kind, shape, _line in bo.OBJECTS.get(scene, []):
        if kind in ('poly', 'fill', 'add'):
            pts = [shape[:2], shape[2:]] if (len(shape) == 4 and not isinstance(shape[0], (tuple, list))) else shape
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            rects.append((oid, (min(xs), min(ys), max(xs), max(ys))))
    for pid, (a, b, c, d) in rects:
        ix = max(0.0, min(x1, c) - max(x0, a))
        iy = max(0.0, min(y1, d) - max(y0, b))
        inter = ix * iy
        if inter <= 0:
            continue
        score = inter / max(1e-6, max((x1 - x0) * (y1 - y0), (c - a) * (d - b)))     # overlap vs the LARGER box
        if score > best:
            best, name = score, pid
    if best >= 0.3:
        return name
    return 'building/walls' if (x1 - x0) * (y1 - y0) > 1500 else ''


def regions(scene, art, opaque, walk, floor, base, kinds, piece, contact, heights, auto, decals, actor_h, legacy_base):
    """What the rule did, for a person. An OBJECT is one standing footprint (a
    connected area of layer px that are not floor) with every depth piece that
    stands on it. Per object: its lines, whether it spans several depths, how
    many separate depth groups the rule gave it, and what the legacy build gave
    the same px. Plus: which manual hints the rule makes redundant, what it
    could not hold, and a picture."""
    H, W = opaque.shape
    A = actor_h * H
    pct = lambda v: round(float(v), 2)
    gap = SPLIT_GAP * A / H * 100
    foot = opaque & (floor != fm.FLOOR)
    flab, fn = ndimage.label(foot, structure=np.ones((3, 3)))
    # each piece's footprint component: the label at its contact row - 1 (its last footprint px)
    npieces = len(contact)
    owner = np.zeros(npieces, np.int32)
    ys, xs = np.nonzero(piece >= 0)
    pid = piece[ys, xs]
    # a piece's footprint px: its px that are footprint; take the most common label among them
    fl = flab[ys, xs]
    sel = fl > 0
    if sel.any():
        order = np.lexsort((fl[sel], pid[sel]))
        p_s, l_s = pid[sel][order], fl[sel][order]
        brk = np.nonzero(np.diff(p_s))[0] + 1
        for grp_p, grp_l in zip(np.split(p_s, brk), np.split(l_s, brk)):
            owner[grp_p[0]] = np.bincount(grp_l).argmax()
    objlab = np.zeros((H, W), np.int32)
    objlab[ys, xs] = owner[pid]                                  # every piece px -> its object (0: none)
    objs = []
    for i, sl in enumerate(ndimage.find_objects(objlab), start=1):
        if sl is None:
            continue
        part = objlab[sl] == i
        if part.sum() < 250:
            continue
        lines = base[sl][part]
        ok = ~np.isnan(lines)
        if not ok.any():
            continue
        lv = np.sort(lines[ok])
        groups = int((np.diff(np.unique(np.round(lv / 0.2) * 0.2)) > gap).sum() + 1)
        spread = float(lv[-int(len(lv) * 0.02) - 1] - lv[int(len(lv) * 0.02)])     # robust range (2..98%)
        k = kinds[sl][part]
        leg = legacy_base[sl][part]
        leg_ok = ~np.isnan(leg)
        leg_groups = 0
        if leg_ok.any():
            lu = np.unique(np.round(leg[leg_ok] / 0.2) * 0.2)
            leg_groups = int((np.diff(lu) > gap).sum() + 1)
        fsl = ndimage.find_objects((flab == i).astype(np.int32))
        fb = fsl[0] if fsl else sl
        bbox = [pct(fb[1].start / W * 100), pct(fb[0].start / H * 100), pct(fb[1].stop / W * 100), pct(fb[0].stop / H * 100)]
        hk = heights[np.unique(piece[sl][part & (piece[sl] >= 0)])]
        known = hk[hk > 0]
        objs.append({'object': i, 'name': name_for(scene, bbox), 'footprint_pct': bbox, 'px': int(part.sum()),
                     'line_min': pct(lv[0]), 'line_max': pct(lv[-1]), 'spread': pct(spread),
                     'spans_depths': spread > SPANS * A / H * 100, 'depth_groups': groups, 'legacy_groups': leg_groups,
                     'height_px_median': int(np.median(known)) if known.size else None,
                     'box_share': pct((k == K_BOX).mean() * 100), 'strip_share': pct((k == K_STRIP).mean() * 100),
                     'single_share': pct((k == K_GROUNDED).mean() * 100),
                     'manual_share': pct(((k == K_HINT) | (k == K_OBJECT)).mean() * 100)})
    objs.sort(key=lambda c: -c['px'])
    # manual depth: does the automatic line (before hints/objects) already say the same?
    manual = []
    for hid, (x0, y0, x1, y1), hb, _fp in bo.HINTS.get(scene, []):
        xs_ = slice(int(x0 / 100 * W), int(round(x1 / 100 * W)))
        ys_ = slice(int(y0 / 100 * H), int(round(y1 / 100 * H)))
        m = (kinds[ys_, xs_] == K_HINT)
        if not m.any():
            manual.append({'hint': hid, 'line': hb, 'used': False, 'verdict': 'not used: nothing hangs free in its rect'})
            continue
        a = auto[ys_, xs_][m]
        med = float(np.nanmedian(a))
        manual.append({'hint': hid, 'line': hb, 'used': True, 'auto_median': pct(med), 'px': int(m.sum()),
                       'verdict': 'redundant: the rule agrees' if abs(med - hb) <= gap else 'still needed'})
    for oid, m, line in bo.objects(scene, opaque):
        m = m & opaque
        if not m.any():
            continue
        a = auto[m]
        a = a[~np.isnan(a)]
        med = float(np.median(a)) if a.size else float('nan')
        if isinstance(line, (int, float)) and line < 99:
            verdict = 'redundant: the rule agrees' if a.size and abs(med - line) <= gap else 'still needed'
        else:
            verdict = f'still needed ({line!r} is not a single line)'
        manual.append({'object': oid, 'line': line, 'auto_median': pct(med) if a.size else None, 'verdict': verdict})
    hanging = kinds == K_HANGING
    lab2, _n2 = ndimage.label(hanging, structure=np.ones((3, 3)))
    unheld = []
    for i, sl in enumerate(ndimage.find_objects(lab2), start=1):
        part = lab2[sl] == i
        if part.sum() >= 150:
            bb = [pct(sl[1].start / W * 100), pct(sl[0].start / H * 100), pct(sl[1].stop / W * 100), pct(sl[0].stop / H * 100)]
            unheld.append({'bbox_pct': bb, 'px': int(part.sum()), 'name': name_for(scene, bb)})
    unheld.sort(key=lambda u: -u['px'])
    # floor mask vs walk mask: inaccessible floor areas and unsure areas, as places
    is_floor = floor == fm.FLOOR
    places = []
    for what, m, minpx in (('inaccessible floor (floor, not walkable)', is_floor & ~walk, 400),
                           ('unsure, not under the layer', (floor == fm.UNSURE) & ~opaque, 400)):
        lab3, _n3 = ndimage.label(m, structure=np.ones((3, 3)))
        for i, sl in enumerate(ndimage.find_objects(lab3), start=1):
            part = lab3[sl] == i
            if part.sum() >= minpx:
                bb = [pct(sl[1].start / W * 100), pct(sl[0].start / H * 100), pct(sl[1].stop / W * 100), pct(sl[0].stop / H * 100)]
                places.append({'what': what, 'bbox_pct': bb, 'px': int(part.sum()), 'near': name_for(scene, bb)})
    places.sort(key=lambda u: -u['px'])
    rep = {'scene': scene, 'actor_px': round(A, 1),
           'kinds_share': {name: pct((kinds[opaque] == k).mean() * 100) for name, k in
                           (('box (height from floor mask)', K_BOX), ('single line', K_GROUNDED), ('strip (no height)', K_STRIP),
                            ('held hanging', K_INHERIT), ('unheld hanging', K_HANGING), ('hint', K_HINT), ('object', K_OBJECT))},
           'decals_px': int(decals.sum()),
           'objects': objs, 'spanning': sum(o['spans_depths'] for o in objs),
           'split': sum(o['depth_groups'] >= 2 for o in objs),
           'manual': manual, 'unheld_hanging': unheld[:30], 'floor_vs_walk': places[:40]}
    # the picture: px coloured by line (blue far .. red near), white where the line jumps
    # (a split between depth regions), hatched where the height came from the floor mask,
    # magenta where nothing holds a hanging piece, yellow outline round manual depth
    o = art.astype(np.float32) * 0.35
    lines = np.nan_to_num(base, nan=-1)
    have = opaque & (lines >= 0)
    t = np.clip(lines / 100, 0, 1)
    hue = ((1 - t) * 120).astype(np.uint8)
    hsv = np.stack([hue, np.full_like(hue, 230), np.full_like(hue, 255)], -1)
    rgb = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB).astype(np.float32)
    o[have] = art[have] * 0.35 + rgb[have] * 0.65
    jump = np.zeros_like(have)
    jump[:, 1:] |= have[:, 1:] & have[:, :-1] & (np.abs(lines[:, 1:] - lines[:, :-1]) > gap)
    jump[1:, :] |= have[1:, :] & have[:-1, :] & (np.abs(lines[1:, :] - lines[:-1, :]) > gap)
    o[jump] = (255, 255, 255)
    yy, xx = np.mgrid[0:H, 0:W]
    hatch = ((kinds == K_BOX) | (kinds == K_STRIP)) & (((xx + yy) // 3) % 4 == 0)
    o[hatch] = o[hatch] * 0.45 + np.array((255, 255, 255)) * 0.55
    o[hanging] = (255, 0, 255)
    manual_px = (kinds == K_HINT) | (kinds == K_OBJECT)
    edge = manual_px & ~ndimage.binary_erosion(manual_px, iterations=1)
    o[edge] = (255, 255, 0)
    os.makedirs(SHOTS, exist_ok=True)
    Image.fromarray(o.clip(0, 255).astype(np.uint8)).save(os.path.join(SHOTS, f'{scene}-regions.png'))
    json.dump(rep, open(os.path.join(SHOTS, f'{scene}-regions.json'), 'w'), indent=1)
    return rep


def emit(all_data):
    head = ('/**\n * sceneLayersFloor.js - GENERATED by tools/floor_depth.py. Do not edit by hand.\n *\n'
            ' * THE VIENNA FLOOR-MASK EXPERIMENT (docs/FLOORMASK.md): depth slices built from\n'
            ' * the artist\'s ORIGINAL occlusion layer and the floor mask. Same format as\n'
            ' * sceneLayers.js; the walk grid is a copy of the legacy one (movement is\n'
            ' * identical). scene.js uses it for these scenes unless ?depth=legacy / L key.\n */\n')
    body = ',\n'.join(f' {json.dumps(k)}: ' + json.dumps(v, separators=(',', ':')) for k, v in all_data.items())
    return head + 'export const SCENE_LAYERS_FLOOR = {\n' + body + '\n};\n\nexport default SCENE_LAYERS_FLOOR;\n'


def read_out():
    if not os.path.exists(OUT_JS):
        return {}
    t = open(OUT_JS, encoding='utf-8').read()
    return json.loads(t[t.index('{', t.index('SCENE_LAYERS_FLOOR')):t.rindex('};') + 1])


def check():
    have, legacy, bad = read_out(), legacy_layers(), []
    for scene in SCENES:
        d = have.get(scene)
        if not d or d.get('source') != sources(scene):
            bad.append(f'{scene}: inputs changed since the last floor build')
            continue
        if d['walk'] != legacy[scene]['walk']:
            bad.append(f'{scene}: walk grid differs from the legacy one (movement must be identical)')
        path, _, ver = d['atlas'].partition('?v=')
        if not os.path.exists(os.path.join(ROOT, path)):
            bad.append(f'{scene}: {path} missing')
        elif ver != hashlib.md5(open(os.path.join(ROOT, path), 'rb').read()).hexdigest()[:10]:
            bad.append(f'{scene}: {path} does not match its ?v= hash')
    extra = sorted(set(have) - set(SCENES))
    if extra:
        bad.append(f'scenes outside the experiment in sceneLayersFloor.js: {extra}')
    for b in bad:
        print(b)
    print('sceneLayersFloor.js is ' + ('up to date' if not bad else 'STALE: run tools/floor_depth.py'))
    sys.exit(1 if bad else 0)


def main():
    if '--check' in sys.argv:
        check()
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    want = args or SCENES
    bad = [s for s in want if s not in SCENES]
    if bad:
        sys.exit(f'the floor experiment is Vienna only: {bad} not allowed')
    heights = bo.scene_actor_heights()
    legacy = legacy_layers()
    out = read_out()
    for scene in want:
        data, rep = build(scene, heights[scene], legacy)
        out[scene] = data
        ks = rep['kinds_share']
        print(f'{scene:10} slices {len(data["slices"]):5d}  ' + '  '.join(f'{k.split(" (")[0]} {v:4.1f}%' for k, v in ks.items())
              + f'  | objects spanning depths {rep["spanning"]}, split {rep["split"]}, decals {rep["decals_px"]} px', flush=True)
    out = {s: out[s] for s in SCENES if s in out}
    open(OUT_JS, 'w', encoding='utf-8').write(emit(out))
    print(f'wrote {os.path.relpath(OUT_JS, ROOT)} ({len(out)} scenes)')


if __name__ == '__main__':
    main()
