#!/usr/bin/env python3
# tools/floor_mask.py [scene ...] [--force] : first-version FLOOR MASKS (Vienna experiment, docs/FLOORMASK.md)
"""A floor mask says where the GROUND is, which the walk mask cannot:

    walk mask   where a character's FEET may stand (collision, paths)
    floor mask  where there is ground at that depth: every walkable px, and
                ground the feet cannot reach (a strip behind a railing, the
                floor visible under a table, the ground round a trunk)
    occlusion   what may be drawn in front of a character (the artist's layer)

Written to <City>/<scene>-floormask.png in the WALK MASK's frame and size, so
it can be painted on the same canvas as the walk mask:

    white (255)  floor, visible or hidden behind a drawing
    black (0)    not floor: a wall, a planter, a trunk, the void, the sky
    grey (128)   UNCERTAIN: nobody knows yet (and fully transparent = grey)

What this first version knows, and where it came from:
  - walkable = floor. Where the walk mask runs under a drawing (a wall top, a
    chair back, leaves: the user's rule, 2026-09-30) the floor is there,
    hidden behind the drawing.
  - ground the artist's ORIGINAL layer leaves transparent (it is "the scene
    with the floor removed") that is not walkable: floor when its colour is
    close to the scene's walkable floor AND it joins the walkable floor within
    REACH px (colour alone cannot tell a warm-lit wall from shadowed floor);
    black when its colour is far from every floor colour (the void round an
    interior, the sky, a wall the layer leaves out); grey in between.
  - under the layer where the feet cannot go: GREY. It is either the object's
    own footprint or floor hidden under it, and nothing in the data says
    which. tools/floor_depth.py treats grey as not-floor (the old assumption),
    so painting white or black there is what the artist's knowledge adds.

Never touches a mask listed as hand-edited in docs/FLOORMASK.md (--force to
override). Review image: tools/shots/floor/<scene>-floormask.png."""
import json
import os
import re
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_occlusion as bo  # noqa: E402

SCENES = list(bo.SCENES)                                     # every scene since 2026-09-30 (Vienna first)
FLOOR, NOT_FLOOR, UNSURE = 255, 0, 128
K = 12                    # floor colour clusters
L_WEIGHT = 0.35           # lightness matters less than hue: a shadow under a table is still floor
T_FLOOR = 11.0            # Lab distance to the nearest floor colour: floor-like
T_NOT = 24.0              # ...beyond this: clearly not floor
SEED_REACH = 2            # px: transparent px this close to walkable floor start the growth
CORE = 8                  # px: floor colours are learnt this far inside the walkable floor
REACH = 24                # px: visible floor is claimed at most this far from walkable floor


def floor_path(scene):
    return os.path.join(ROOT, bo.CITY_DIR[scene[:3]], f'{scene}-floormask.png')


def original_path(scene):
    """The artist's occlusion layer as they drew it. A layer the artist cleaned by
    hand (docs/OCCLUSION.md, first table) IS their source; for a tool-pruned one
    the original is kept beside it as <scene>-occlusion-original.png (from 90f2128)."""
    folder = os.path.join(ROOT, bo.CITY_DIR[scene[:3]])
    if scene in bo.HAND_CLEANED:
        return os.path.join(folder, f'{scene}-occlusion.png')
    path = os.path.join(folder, f'{scene}-occlusion-original.png')
    if not os.path.exists(path):
        raise FileNotFoundError(f'{scene}: {os.path.relpath(path, ROOT)} missing (git show 90f2128:<the pruned file>)')
    return path


def hand_edited():
    """Floor masks the artist has edited (docs/FLOORMASK.md, table 'Hand-edited'): never regenerated."""
    try:
        doc = open(os.path.join(ROOT, 'docs', 'FLOORMASK.md')).read()
    except OSError:
        return set()
    part = doc.split('## Hand-edited floor masks')[-1] if '## Hand-edited floor masks' in doc else ''
    part = part.split('\n## ')[0]
    return set(re.findall(r'^\| ([a-z]{3}-[a-z]+) \|', part, re.M))


def original_alpha(scene, W, H):
    """The artist's ORIGINAL occlusion layer's alpha (0-255, soft edges kept), in the art frame."""
    lay = Image.open(original_path(scene)).convert('RGBA').resize((W, H), Image.LANCZOS)
    return bo.warp(np.asarray(lay)[..., 3].copy(), scene, (W, H), cv2.INTER_LINEAR)


def original_opaque(scene, W, H):
    """The artist's ORIGINAL occlusion layer (immutable source), in the art frame."""
    return original_alpha(scene, W, H) >= bo.ALPHA


def inputs(scene):
    """Art, original layer (+ the objects the layer leaves out), walkable floor - all in the art frame."""
    art, pruned, walk = bo.load(scene)
    H, W = walk.shape
    walk_open, _n = bo.plant_walk(scene, pruned, walk)          # the legacy movement, exactly
    opaque = original_opaque(scene, W, H)
    for _oid, kind, shape, _line in bo.OBJECTS.get(scene, []):
        if kind == 'add':
            opaque |= bo.add_mask(art, shape)
        elif kind == 'fill':
            opaque |= bo.poly_mask(shape, W, H)
    return art, opaque, walk_open


def colour_model(lab, samples):
    """Cluster centres of the walkable floor's colours (Lab, lightness weighted down)."""
    pts = lab[samples].reshape(-1, 3).astype(np.float32)
    if len(pts) > 40000:
        pts = pts[np.random.RandomState(0).choice(len(pts), 40000, replace=False)]
    pts[:, 0] *= L_WEIGHT
    k = min(K, max(1, len(pts) // 50))
    _c, _l, centres = cv2.kmeans(pts, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5), 2, cv2.KMEANS_PP_CENTERS)
    return centres


def colour_distance(lab, centres):
    px = lab.reshape(-1, 3).astype(np.float32)
    px[:, 0] *= L_WEIGHT
    best = np.full(len(px), np.inf, np.float32)
    for c in centres:
        best = np.minimum(best, np.sqrt(((px - c) ** 2).sum(1)))
    return best.reshape(lab.shape[:2])


def generate(scene):
    """(mask in the art frame, dict of provenance masks for review and the report)"""
    art, opaque, walk = inputs(scene)
    H, W = walk.shape
    lab = cv2.cvtColor(art, cv2.COLOR_RGB2LAB)
    visible_floor = walk & ~opaque
    # floor colours from well inside the walkable floor: the walk mask overlaps
    # walls and furniture on purpose, and their edge px are not floor colours
    core = ndimage.binary_erosion(visible_floor, iterations=CORE)
    dist = colour_distance(lab, colour_model(lab, core if core.sum() > 2000 else visible_floor))
    clear = ~opaque & ~walk                                     # transparent in the layer, not walkable
    floorlike = clear & (dist < T_FLOOR)
    seed = floorlike & ndimage.binary_dilation(walk, iterations=SEED_REACH)
    # only NEAR the walkable floor: colour alone cannot tell a warm-lit wall from
    # shadowed floor (vie-venue: both ~10 from the floor colours), so farther
    # floor-coloured px stay unsure instead of being claimed
    grown = ndimage.binary_dilation(seed, structure=np.ones((3, 3)), iterations=REACH, mask=floorlike)
    notfloor = clear & (dist >= T_NOT)
    # the scene's surround (the void round an interior, the sky and the town
    # behind a garden): transparent, reaching the picture's edge without ever
    # joining the walkable floor (the town's paving colours match the garden's)
    rest = clear & ~grown
    lab_, n = ndimage.label(rest, structure=np.ones((3, 3)))
    if n:
        edge = np.zeros_like(rest)
        edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
        touch = np.unique(lab_[edge & rest])
        notfloor |= np.isin(lab_, touch[touch > 0])
    out = np.full((H, W), UNSURE, np.uint8)
    out[walk] = FLOOR
    out[grown] = FLOOR
    out[notfloor & ~grown] = NOT_FLOOR
    # a speck of "not floor" or "unsure" wholly inside grown floor is floor texture
    for val in (NOT_FLOOR, UNSURE):
        m = (out == val) & clear
        lab_, n = ndimage.label(m)
        if n:
            sizes = ndimage.sum(m, lab_, np.arange(1, n + 1))
            for i in np.nonzero(sizes < 40)[0] + 1:
                part = lab_ == i
                edge = ndimage.binary_dilation(part, iterations=1) & ~part
                if (out[edge] == FLOOR).mean() > 0.95:
                    out[part] = FLOOR
    prov = {'walkable': walk, 'hidden_floor': walk & opaque, 'inaccessible_floor': grown,
            'not_floor': out == NOT_FLOOR, 'unsure_under_layer': (out == UNSURE) & opaque,
            'unsure_visible': (out == UNSURE) & ~opaque, 'opaque': opaque}
    return art, out, prov


def to_mask_frame(m_art, scene):
    """Art frame -> the walk mask's own frame and size (inverse of bo.load's resize + warp)."""
    H, W = m_art.shape
    if scene in bo.WARP and scene not in bo.MASK_IN_ART_FRAME:
        m_art = cv2.warpAffine(m_art, np.array(bo.WARP[scene], np.float32), (W, H),
                               flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=UNSURE)
    size = Image.open(os.path.join(ROOT, bo.CITY_DIR[scene[:3]], f'{scene}-walkmask.png')).size
    return np.asarray(Image.fromarray(m_art).resize(size, Image.NEAREST))


def load_floor(scene, W, H):
    """A floor mask in the art frame: 255 floor, 0 not floor, 128 unsure (transparent px = unsure)."""
    im = Image.open(floor_path(scene))
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGBA', im.size, (128, 128, 128, 255))
        im = Image.alpha_composite(bg, im)
    g = np.asarray(im.convert('L').resize((W, H), Image.NEAREST)).copy()
    if scene in bo.WARP and scene not in bo.MASK_IN_ART_FRAME:
        g = cv2.warpAffine(g, np.array(bo.WARP[scene], np.float32), (W, H),
                           flags=cv2.INTER_NEAREST + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=UNSURE)
    out = np.full((H, W), UNSURE, np.uint8)
    out[g > 170] = FLOOR
    out[g < 85] = NOT_FLOOR
    return out


def review(scene, art, out, prov):
    """Art with the floor mask over it: green walkable, cyan hidden floor, blue floor the feet
    cannot reach, dark not floor, orange uncertain."""
    o = art.astype(np.float32) * 0.55
    paint = [(prov['not_floor'], (10, 10, 20), 0.55),
             (prov['unsure_under_layer'], (255, 150, 0), 0.35),
             (prov['unsure_visible'], (255, 60, 0), 0.6),
             (prov['walkable'] & ~prov['opaque'], (0, 210, 60), 0.35),
             (prov['hidden_floor'], (0, 220, 255), 0.55),
             (prov['inaccessible_floor'], (40, 90, 255), 0.7)]
    for m, c, a in paint:
        o[m] = o[m] * (1 - a) + np.array(c, np.float32) * a
    path = os.path.join(ROOT, 'tools', 'shots', 'floor', f'{scene}-floormask.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(o.clip(0, 255).astype(np.uint8)).save(path)
    return path


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    want = args or SCENES
    bad = [s for s in want if s not in SCENES]
    if bad:
        sys.exit(f'unknown scenes: {bad}')
    locked = hand_edited()
    stats = {}
    for scene in want:
        if scene in locked and '--force' not in sys.argv:
            print(f'{scene:10} hand-edited floor mask: left as it is (docs/FLOORMASK.md)')
            continue
        art, out, prov = generate(scene)
        Image.fromarray(to_mask_frame(out, scene), 'L').save(floor_path(scene))
        shot = review(scene, art, out, prov)
        stats[scene] = {k: round(float(v.mean()) * 100, 2) for k, v in prov.items() if k != 'opaque'}
        print(f'{scene:10} floor {(out == FLOOR).mean():5.1%}  not {(out == NOT_FLOOR).mean():5.1%}  unsure {(out == UNSURE).mean():5.1%}'
              f'  | inaccessible floor {prov["inaccessible_floor"].mean():5.1%}  hidden floor {prov["hidden_floor"].mean():5.1%}'
              f'  -> {os.path.relpath(floor_path(scene), ROOT)}, {os.path.relpath(shot, ROOT)}')
    if stats:
        path = os.path.join(ROOT, 'tools', 'shots', 'floor', 'floormask-stats.json')
        old = json.load(open(path)) if os.path.exists(path) else {}
        old.update(stats)
        json.dump(old, open(path, 'w'), indent=1)


if __name__ == '__main__':
    main()
