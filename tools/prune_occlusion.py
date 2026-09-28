#!/usr/bin/env python3
# tools/prune_occlusion.py OUT_DIR [scene...] : pruned occlusion layers into OUT_DIR/<City>/ (see docs/OCCLUSION.md)
"""Occlusion-layer pruning, copied from the artist's own edits (2026-09-28).

The artist cleaned seven layers by erasing everything that can never stand in
front of a character: floor things (rugs, runners, floor plaques, entrance
steps), the far back wall with everything on it, the buildings behind a
garden, the front ledge below the last row a foot can reach. Erasing it
changes nothing a player sees and leaves nothing for a wrong ground line
to draw over a character.

Here that is a test, per opaque pixel of the layer, with the ground lines
tools/build_occlusion.py gives it and the walk mask:

    kept if some walkable foot spot puts a character's sprite over the
    pixel while the feet stand more than TOL character heights above the
    pixel's ground line (behind it, so it is drawn over them).

The sprite is scene.js's canvas: CELL 72x108 at max(40 px, stage * actorHeight),
drawn from 92% above the feet to 8% below, taken at the smallest stage (MIN_STAGE
px tall) where the 40 px floor makes characters biggest. TOL lets go of objects
the feet can only tuck a sliver behind (lamps and shelves against the back wall,
the artist's "furthermost walls back"). Also erased: a component that lies
entirely on walkable floor with floor above and below it (a rug, a plaque),
whatever depth hint covers it.

Scored against the artist's seven edits: 62-98% of what they erased, and far
more they left (it is invisible in play). Never touches a hand-cleaned layer."""
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

TOL = float(os.environ.get("PRUNE_TOL", 0.15))          # character heights: feet no further behind a line than this count as in front
MIN_STAGE = 340     # px: the smallest stage height the game lays out (landscape phone)
DECAL_BAND = 6      # px above and below a floor decal that must be walkable too


def hand_cleaned():
    """Scenes whose layer the artist cleaned (docs/OCCLUSION.md): the law, never pruned."""
    doc = open(os.path.join(ROOT, 'docs', 'OCCLUSION.md'), encoding='utf-8').read()
    doc = doc.split('## Cleaned by the artist', 1)[-1].split('\n## ', 1)[0]    # that table only
    return {s for s in bo.SCENES if f'| {s} |' in doc}


def npc_feet():
    """scene -> [(x, y) percent] where a non-player character stands: hotspot
    NPCs, a scene's crowd, club members. They may stand off the walk mask (the
    finale crowd does), and the layer must hide them right too."""
    import json
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
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', js], cwd=ROOT, text=True))


NPC_FEET = None


def load(scene):
    global NPC_FEET
    art, opaque, walk = bo.load(scene)
    if NPC_FEET is None:
        NPC_FEET = npc_feet()
    H, W = walk.shape
    feet = walk.copy()
    for x, y in NPC_FEET.get(scene, []):          # a small pad: rivals spread a little round their spot
        fx, fy = int(x / 100 * W), int(y / 100 * H)
        feet[max(0, fy - 4):fy + 5, max(0, fx - 6):fx + 7] = True
    return art, opaque, walk, feet


def never_in_front(scene, opaque, walk, actor_h, tol=TOL, feet=None):
    H, W = opaque.shape
    base, _kinds = bo.depth(scene, opaque, walk, actor_h)
    walk_open, _ = bo.plant_walk(scene, opaque, walk)
    if feet is not None:
        walk_open = walk_open | feet
    ah = max(actor_h, 40 / MIN_STAGE)
    A = int(ah * H) + 2
    half = int(ah * H * 72 / 108 / 2) + 2
    T = int(tol * ah * H)
    S = np.zeros((H + 1, W + 1), np.int64)
    S[1:, 1:] = np.cumsum(np.cumsum(walk_open.astype(np.int64), 0), 1)
    ys, xs = np.nonzero(opaque)
    b = base[ys, xs]
    line = np.where(np.isnan(b), -1, np.ceil(b / 100 * H) - T).astype(np.int64)
    line = np.where(b >= 99, H, line)                       # hung in a gateway: always in front
    y0 = np.maximum(ys - int(0.08 * A), 0)                  # feet rows whose sprite covers the pixel...
    y1 = np.minimum(np.minimum(ys + A, line), H)            # ...and stand behind its line
    x0 = np.clip(xs - half, 0, W)
    x1 = np.clip(xs + half + 1, 0, W)
    cnt = np.where(y1 > y0, S[y1, x1] - S[y0, x1] - S[y1, x0] + S[y0, x0], 0)
    out = np.zeros((H, W), bool)
    out[ys[cnt == 0], xs[cnt == 0]] = True
    return out


def floor_decals(opaque, walk):
    lab, _ = ndimage.label(opaque, structure=np.ones((3, 3)))
    out = np.zeros_like(opaque)
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        part = lab[sl] == i
        if part.sum() < 30 or walk[sl][part].mean() < 0.95:
            continue
        y0, y1 = sl[0].start, sl[0].stop
        above = walk[max(0, y0 - DECAL_BAND):y0, sl[1]]
        below = walk[y1:y1 + DECAL_BAND, sl[1]]
        if above.size and below.size and above.mean() >= 0.8 and below.mean() >= 0.8:
            out[sl] |= part
    return out


def whole_runs(opaque, walk, erase):
    """What of `erase` can go without moving a kept pixel's ground line.
    build_occlusion reads a column's run of opaque pixels from its BOTTOM (its
    lowest pixel is the ground line; its lowest FOOT px decide whether it is
    walked under) and, for a hanging run, from its TOP. So a run goes whole, or
    a standing run loses its top down to its highest kept pixel: the back wall
    above a side wall, the building behind the hedge."""
    out = np.zeros_like(erase)
    H, W = opaque.shape
    for x in range(W):
        col = opaque[:, x]
        if not col.any():
            continue
        d = np.diff(np.concatenate(([0], col.astype(np.int8), [0])))
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            e = erase[a:b, x]
            if e.all():
                out[a:b, x] = True
            elif e[0] and walk[max(a, b - bo.FOOT):b, x].mean() < 0.5:
                out[a:a + int(np.argmin(e)), x] = True
    return out


def prune(scene, actor_h):
    """(pruned RGBA layer at its own size, erase mask at art size, share of the layer erased)"""
    _art, opaque, walk, feet = load(scene)
    H, W = opaque.shape
    erase = whole_runs(opaque, walk, never_in_front(scene, opaque, walk, actor_h, feet=feet)) | floor_decals(opaque, feet)
    src = os.path.join(ROOT, bo.CITY_DIR[scene[:3]], f'{scene}-occlusion.png')
    layer = np.asarray(Image.open(src).convert('RGBA')).copy()
    lh, lw = layer.shape[:2]
    # take the faint edge pixels (alpha < ALPHA) round an erased object with it
    erase_px = erase | (ndimage.binary_dilation(erase, iterations=3) & ~opaque)
    m = erase_px.astype(np.uint8) * 255
    same = scene not in bo.WARP and (lw, lh) == (W, H)
    if scene in bo.WARP:            # art frame -> the layer's own frame (WARP is the inverse map)
        m = cv2.warpAffine(m, np.array(bo.WARP[scene], np.float32), (W, H), flags=cv2.INTER_NEAREST)
    m = cv2.resize(m, (lw, lh), interpolation=cv2.INTER_NEAREST) > 0
    if not same:    # an edge pixel of a kept object must survive the resampling
        m = ndimage.binary_erosion(m, structure=np.ones((3, 3)), border_value=1)
    layer[m, 3] = 0
    return layer, erase, erase.sum() / max(1, opaque.sum())


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out_dir = sys.argv[1]
    want = sys.argv[2:] or bo.SCENES
    heights = bo.scene_actor_heights()
    hand = hand_cleaned()
    for scene in want:
        if scene in hand:
            print(f'{scene:10s} cleaned by the artist: skipped (docs/OCCLUSION.md)')
            continue
        layer, _erase, share = prune(scene, heights.get(scene, 0.1))
        dst = os.path.join(out_dir, bo.CITY_DIR[scene[:3]], f'{scene}-occlusion.png')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        Image.fromarray(layer, 'RGBA').save(dst)
        print(f'{scene:10s} erased {share:4.0%} of the layer -> {os.path.relpath(dst, ROOT)}')


if __name__ == '__main__':
    main()
