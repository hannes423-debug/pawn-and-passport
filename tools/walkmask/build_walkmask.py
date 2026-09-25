#!/usr/bin/env python3
"""Walk masks for Pawn & Passport scenes: white = a character's feet may stand here.

    python3 build_walkmask.py [scene ...]      (default: every scene below)

Needs the repo checkout next to this file (REPO) for build_layers.LAYERS, and
for each scene the scene art plus the artist's cut-out layer (floor removed).

How a mask is made:
  1. FLOOR   = transparent pixels of the cut-out layer, minus CUTS (back walls
               and anything else the artist left transparent that is not floor),
               minus regions touching the image border (the void outside).
  2. BEHIND  = floor hidden behind a LAYERS prop. In a rectangular ROOM, all of a
               prop above its footprint (widened by up to PAD px where chairs
               poke out past it). Elsewhere, a prop pixel counts only if floor continues above
               AND below it in the same column, so things against walls stay solid.
               Repo 'blocks' never become walk-behind, and by default they block.
               blocks='ground' (lon-ext): a block is a bed's ground outline, so
               the bed art above it is walk-behind. blocks='nobehind' (che-ext):
               the blocks are coarse, so they only stop walk-behind and the
               layer decides what is floor.
  3. minus FOOTPRINTS (LAYERS rects; a None footprint is read off the art: the
     bottom FOOT_BAND of the prop's own pixels, as build_layers.py does)
  4. + WALK rects (doorway thresholds, exits), - BLOCK rects, then tidy and keep
     only what connects to SEED.
"""
import os, sys, importlib.util, numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get('PAP_REPO', os.path.join(HERE, 'pawn-and-passport'))
UP = os.environ.get('PAP_ART', '/mnt/user-data/uploads')
OUT = os.environ.get('PAP_OUT', '/mnt/user-data/outputs')

spec = importlib.util.spec_from_file_location('bl', os.path.join(REPO, 'tools', 'build_layers.py'))
bl = importlib.util.module_from_spec(spec); spec.loader.exec_module(bl)

# rects are PIXELS (x0, y0, x1, y1) of the scene art
SCENES = {
    'ist-int': dict(
        art='C58057AB-D5D3-433D-B6F7-BD078A98FDA7.png', layer='5C1C19A5-9BE8-46D9-89A8-B17B58303403.png',
        seed=(723, 560),
        cuts=[(0, 0, 1447, 90), (0, 0, 60, 1087), (1400, 0, 1447, 1087),          # outside the building
              (0, 880, 620, 1087), (826, 880, 1447, 1087), (620, 1066, 826, 1087),  # keep only the entry steps
              (60, 0, 470, 262), (60, 470, 470, 604), (980, 0, 1400, 306)],         # back walls
        rooms=[(60, 262, 460, 460), (60, 604, 458, 800), (990, 306, 1400, 800)],
        walk=[(630, 780, 812, 912),      # under the ISTANBUL CHESS CLUB sign
              (410, 626, 528, 664)],     # practice doorway, behind the plant and left column
        block=[(458, 664, 489, 674), (428, 662, 463, 692)]),
    'lon-ext': dict(
        art='lon-ext-manor-courtyard.png', layer='Codex-kuva_24_9_2026_klo_18_43_57-3.png',
        seed=(723, 700),
        cuts=[(0, 975, 510, 1086), (938, 975, 1448, 1086), (510, 1026, 938, 1086),  # past the gate: only the threshold slab
              (470, 0, 980, 402)],                                                    # the manor itself (door sill ~y405)
        rooms=[], blocks='ground'),     # its blocks are the flower beds' ground outlines
    'lon-int': dict(
        art='lon-int-club-interior.png', layer='Codex-kuva_24_9_2026_klo_18_43_56-2.png',
        seed=(723, 720),
        cuts=[(100, 430, 480, 562),      # director back wall
              (960, 430, 1345, 552),     # study back wall
              (515, 400, 658, 578), (785, 400, 948, 578)],   # lobby walls with the banners
        rooms=[(182, 152, 1265, 410), (110, 562, 481, 863), (966, 552, 1336, 863)],
        walk=[(470, 648, 525, 700),      # director doorway threshold
              (925, 648, 985, 700),      # study doorway threshold
              (642, 925, 806, 1030)]),   # CHESS CLUB mat and the landing: the exit
    'lon-venue': dict(
        art='lon-venue-covent-garden.png', layer='Codex-kuva_24_9_2026_klo_18_43_55-1.png',
        seed=(723, 800), drop_border=False,
        cuts=[(0, 0, 1448, 348),          # the arch passage beyond the steps
              (0, 962, 655, 1086), (795, 962, 1448, 1086), (655, 1012, 795, 1086)],  # street: only the curb gap
        rooms=[]),
    'che-ext': dict(
        art='che-ext-temple-garden.png', layer='Codex-kuva_24_9_2026_klo_20_12_40-7.png',
        seed=(724, 640),
        cuts=[(0, 1000, 1448, 1086),                              # the road
              (0, 0, 190, 930), (1258, 0, 1448, 930),              # outside the garden walls
              (0, 930, 72, 1000), (1376, 930, 1448, 1000)],        # pavement: only the streetlamp stretch
        rooms=[], blocks='nobehind',     # repo blocks also cover the side gardens' paving
        solid=['pillar-w', 'pillar-e'],  # gate pillars sit on the fence line: no passing behind them
        walk=[(640, 488, 812, 545),      # the porch steps (the layer keeps them solid)
              (636, 725, 812, 840)]),    # under the CHESS CLUB gate arch
    'che-int': dict(
        art='che-int-club-hall.png', layer='Codex-kuva_24_9_2026_klo_20_12_39-6.png',
        seed=(724, 720),
        cuts=[(100, 0, 440, 165), (930, 0, 1350, 165), (440, 0, 930, 140),   # tournament hall back wall
              (60, 440, 450, 600), (990, 440, 1390, 604),                    # director / study back walls
              (470, 440, 640, 628), (808, 440, 980, 628)],                   # lobby walls with the banners
        rooms=[(140, 140, 1310, 450), (76, 600, 448, 863), (999, 604, 1371, 863)],
        walk=[(637, 330, 811, 422),      # TOURNAMENT HALL sign hangs over the stair head (its edge runs past the rect)
              (438, 668, 482, 730),      # director door
              (966, 668, 1010, 730),     # study door
              (644, 885, 805, 985)]),    # under the entrance sign, out to the mat
    'che-venue': dict(
        art='che-venue-marina-promenade.png', layer='Codex-kuva_24_9_2026_klo_20_12_35-5.png',
        seed=(724, 950), drop_border=False, blocks='nobehind',   # blocks overlap open paving by the statue and stall
        cuts=[(0, 0, 1448, 236),         # sea wall and beach
              (0, 1006, 1448, 1086),     # kerb and road
              (0, 0, 29, 1086), (1419, 0, 1448, 1086)],
        rooms=[],
        # the layer has no bollards: block their bases by hand
        block=[(cx - 16, 985, cx + 16, 1006) for cx in (157, 339, 516, 923, 1092, 1271, 1440)]),
    'ist-up': dict(
        art='ist-up-upstairs-lobby.png', layer='Codex-kuva_24_9_2026_klo_18_43_59-5.png',
        seed=(726, 560),
        rooms=[(64, 321, 450, 682), (1007, 391, 1396, 682)],
        walk=[(440, 404, 512, 432),      # lounge doorway: the threshold strip under the column
              (940, 412, 1040, 452),     # trophy hall doorway (its floor starts lower, under the corner plant)
              (560, 452, 600, 469),      # squeeze between the west stair newel and the plant pot
              (852, 452, 892, 469)],     # ...and its mirror on the east side
        block=[(168, 585, 352, 666)]),   # the layer lost the lounge's game table: its footprint + both chairs
    'ist-venue': dict(
        art='ist-venue-tea-terrace.png', layer='Codex-kuva_24_9_2026_klo_18_43_58-4.png',
        seed=(724, 480), blocks='nobehind',   # the cafe block also covers paving by the counter
        cuts=[(0, 800, 1448, 1086)],     # the sign stands on the stair head: steps and lower walk are off-limits
        rooms=[]),
    'ist-ext': dict(
        art='ist-ext-club-garden.png', layer='Codex-kuva_24_9_2026_klo_18_44_01-7.png',
        seed=(724, 640),
        cuts=[(0, 977, 1448, 1086), (0, 840, 608, 977), (840, 840, 1448, 977)],   # outside: only the gate passage
        rooms=[], solid=['pillar-w', 'pillar-e'],
        walk=[(636, 700, 812, 845)]),    # under the ISTANBUL CHESS CLUB gate arch
    'vie-int': dict(
        art='vie-int-club-interior.png', layer='Codex-kuva_24_9_2026_klo_20_12_43-10.png',
        seed=(723, 560),
        cuts=[(0, 1030, 1447, 1087), (0, 960, 628, 1030), (817, 960, 1447, 1030)],   # outside: only the entrance steps
        rooms=[(70, 250, 460, 400), (62, 583, 475, 808), (950, 340, 1387, 808)],
        solid=['banner-nw', 'banner-ne'],   # they hang on the stair walls: no way through behind them
        walk=[(455, 376, 530, 402),      # director doorway: the strip under the column
              (910, 376, 985, 402),      # tournament hall doorway, same on the east side
              (440, 632, 535, 676)]),    # practice room: no gap drawn, the repo's connector
    'vie-up': dict(
        art='vie-up-upstairs-lounge.png', layer='Codex-kuva_24_9_2026_klo_20_12_42-9.png',
        seed=(723, 380),
        cuts=[(500, 0, 945, 326)],       # the stairs going further up: not used
        rooms=[(62, 280, 470, 709), (970, 380, 1390, 709)],
        # a stone ledge closes the aisles off from the lower landing; without this the
        # column test tunnels through it behind the plants
        solid=['plant-lower-w', 'plant-lower-e', 'lamp-bottom-w', 'lamp-bottom-e']),
    'vie-ext': dict(
        art='vie-ext-club-garden.png', layer='Codex-kuva_24_9_2026_klo_18_45_14-1.png',
        seed=(723, 700),
        cuts=[(0, 1035, 1447, 1087), (0, 990, 490, 1035), (960, 990, 1447, 1035)],   # outside: only the threshold slab
        rooms=[], solid=['pillar-w', 'pillar-e']),
    'vie-venue': dict(
        art='vie-venue-coffeehouse.png', layer='Codex-kuva_24_9_2026_klo_20_12_41-8.png',
        seed=(723, 700), drop_border=False,
        cuts=[(0, 0, 1448, 440),         # back wall: wainscot base ~y442
              (0, 1000, 435, 1086), (1010, 1000, 1448, 1086), (0, 1056, 1448, 1086)],   # past the partitions: only the doormat way out
        rooms=[]),
    'wen-ext': dict(
        art='wen-ext-temple-courtyard.png', layer='Codex-kuva_24_9_2026_klo_20_12_30-4.png',
        seed=(724, 700),
        cuts=[(0, 1012, 1448, 1086), (0, 975, 550, 1012), (900, 975, 1448, 1012)],   # outside: only the gate threshold
        rooms=[], solid=['pillar-w', 'pillar-e']),
    'wen-int': dict(
        art='wen-int-club-interior.png', layer='Codex-kuva_24_9_2026_klo_20_12_28-3.png',
        seed=(724, 560),
        cuts=[(60, 0, 440, 222), (60, 440, 440, 690),          # director / practice back walls
              (470, 0, 660, 282), (790, 0, 980, 282)],         # the scroll walls beside the stairs
        rooms=[(60, 222, 440, 420), (60, 690, 440, 880), (1000, 300, 1390, 900)],
        walk=[(665, 100, 785, 335),      # the grand staircase (the layer keeps its steps solid)
              (640, 330, 805, 408),      # under the CHESS CLUB sign that hangs across the stair foot
              (655, 915, 800, 1025)]),   # the entrance steps, likewise
    'wen-up': dict(
        art='wen-up-upstairs-loft.png', layer='Codex-kuva_24_9_2026_klo_20_12_24-2.png',
        layer_xform=(1.0241, 0.8, 1.0224, 2.3),   # this layer came out ~2.3% smaller than the art
        seed=(724, 560),
        cuts=[(90, 0, 470, 296), (960, 0, 1345, 185),          # lounge / trophy hall back walls
              (540, 0, 630, 330), (805, 0, 895, 330)],         # scroll walls beside the stairs down
        rooms=[(60, 296, 460, 640), (990, 340, 1360, 640)],
        walk=[(460, 552, 548, 580),      # lounge <-> hall: the gap between the lantern post and the low lantern
              (899, 552, 987, 580)]),    # ...and the trophy-hall side
    'wen-venue': dict(
        art='wen-venue-riverside-pavilion.png', layer='Codex-kuva_24_9_2026_klo_20_12_23-1.png',
        seed=(724, 760),
        cuts=[(0, 0, 1448, 262), (0, 262, 300, 300), (0, 300, 120, 345)],   # the canal behind the railing, the old town above the stairs
        rooms=[]),                        # repo blocks keep the pavilion itself solid
    'mad-ext': dict(
        art='mad-ext-championship-courtyard.png', layer='Codex-kuva_24_9_2026_klo_18_45_20-3.png',
        seed=(627, 850),
        cuts=[(0, 1216, 1254, 1254), (0, 1100, 440, 1216), (815, 1100, 1254, 1216)],   # outside: only the slab past the gate
        rooms=[],
        walk=[(530, 960, 725, 1180)]),   # through the gate (LAYERS draws it OVER the player)
    'mad-int': dict(
        art='mad-int-championship-hall.png', layer='Codex-kuva_24_9_2026_klo_18_45_17-2.png',
        seed=(722, 640),                 # repo blocks: the stage and both grand staircases stay solid
        rooms=[(98, 190, 420, 420), (1030, 190, 1348, 420)],
        walk=[(655, 262, 795, 368),      # the steps up to the stage platform (drawn solid in the layer)
              (660, 900, 790, 1035),     # the entrance steps, likewise
              (405, 222, 470, 246),      # upper west hall -> platform, over the head of the west staircase
              (975, 222, 1040, 246)]),   # ...and the east one
    'nyc-ext': dict(
        art='nyc-ext-club-facade.png', layer='Codex-kuva_24_9_2026_klo_18_45_25-7.png',
        seed=(724, 520),
        cuts=[(0, 1012, 1447, 1087), (0, 0, 43, 1087), (1403, 0, 1447, 1087)],   # the pavement, not the street
        rooms=[], solid=['pillar-w', 'pillar-e'],
        walk=[(545, 700, 640, 900), (808, 700, 905, 900),     # the lanes behind the open gate leaves (LAYERS draws them over the player)
              (590, 548, 648, 640), (799, 548, 857, 640)]),   # porch <-> gate: the squeeze between each bench bed and the fountain
    'nyc-int': dict(
        art='nyc-int-club-interior.png', layer='Codex-kuva_24_9_2026_klo_18_45_23-6.png',
        seed=(724, 600),
        rooms=[(100, 256, 440, 438), (80, 617, 460, 801), (979, 320, 1367, 801)],
        solid=['banner-nw', 'banner-ne'],
        walk=[(415, 404, 500, 436),      # director doorway: under the column, past the statue's base
              (430, 652, 545, 700),      # practice room: no gap drawn; under the armchair corner to its floor
              (920, 404, 1010, 452),     # tournament hall doorway (its floor starts below the first table)
              (625, 660, 820, 775),      # CHESS CLUB NEW YORK is a floor inlay, not a block
              (625, 930, 820, 1030)]),   # entrance steps (drawn solid in the layer)
    'nyc-up': dict(
        art='nyc-up-upstairs-lounge.png', layer='Codex-kuva_24_9_2026_klo_18_45_22-5.png',
        seed=(723, 360),
        cuts=[(500, 0, 945, 292), (100, 0, 470, 347), (975, 0, 1345, 384)],   # back walls
        rooms=[(80, 347, 490, 700), (935, 384, 1360, 700)],
        walk=[(650, 405, 795, 645),      # the stairs down to the landing (drawn solid in the layer)
              (645, 368, 800, 412),      # under the STAIRS DOWN sign at the stair head
              (455, 424, 540, 454),      # lounge doorway under the column
              (900, 424, 985, 454),      # trophy hall doorway
              (512, 380, 585, 430), (861, 380, 934, 430),   # ...on past the potted plant beside each doorway
              (560, 362, 660, 392), (786, 362, 886, 392)]), # aisles <-> stair head, between the back plants and the newels
    'nyc-venue': dict(
        art='nyc-venue-bethesda-terrace.png', layer='Codex-kuva_24_9_2026_klo_18_45_21-4.png',
        seed=(300, 850), blocks='nobehind',   # the repo's pool block is a rectangle: its corners sealed the way out
        cuts=[(330, 480, 1110, 645),     # inside the arcade
              (0, 1000, 1448, 1086)],    # the balustrade and beyond
        rooms=[],
        # the layer lost the fountain's pool: block it by its own outline (LAYERS' clip ellipse) + the statue
        block_ellipses=[(724, 823, 278, 112)],
        block=[(644, 603, 804, 728)],
        walk=[(105, 480, 225, 760), (1235, 480, 1345, 760),     # both terrace staircases (drawn solid)
              (442, 905, 530, 955), (918, 905, 1006, 955)]),  # behind the front planters' foliage: the only way to the arrival strip
}
PAD = 14                      # px: at most this much art (side chairs) past a LAYERS rect, rooms only
FOOT_BAND = bl.FOOT_BAND_PCT / 100
COL_UP, COL_DOWN = 40, 24     # column test looks this far past the prop rect


def build(scene, cfg):
    art = Image.open(os.path.join(UP, cfg['art'])).convert('RGB'); W, H = art.size
    layer = Image.open(os.path.join(UP, cfg['layer'])).convert('RGBA')
    if 'layer_xform' in cfg:            # the layer was drawn at a slightly different scale: art = s*layer + d
        sx, dx, sy, dy = cfg['layer_xform']
        layer = layer.transform((W, H), Image.AFFINE, (1 / sx, 0, -dx / sx, 0, 1 / sy, -dy / sy), resample=Image.BICUBIC)
    else:
        layer = layer.resize((W, H), Image.LANCZOS)
    alpha = np.asarray(layer)[..., 3]
    opaque = alpha >= 128
    L = bl.LAYERS[scene]
    R = lambda r: (slice(max(0, int(r[1])), int(r[3])), slice(max(0, int(r[0])), int(r[2])))
    P = lambda r: R(bl.px_rect(r, W, H))

    floor = ~opaque
    for c in cfg.get('cuts', []): floor[R(c)] = False
    lab, n = ndimage.label(floor)
    if cfg.get('drop_border', True):
        edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        floor &= ~np.isin(lab, edge[edge > 0])

    blocks = np.zeros_like(floor)
    for b in L.get('blocks', []): blocks[P(b)] = True
    hulls = []
    for (x0, y0, x1, y1) in cfg.get('rooms', []):
        ys, xs = np.where(floor[y0:y1, x0:x1])
        h = np.zeros_like(floor); h[y0 + ys.min():y0 + ys.max() + 1, x0 + xs.min():x0 + xs.max() + 1] = True
        hulls.append(h)

    behind = np.zeros_like(floor); foot = np.zeros_like(floor)
    for prop in L['props']:
        pid, rect, base, fp = prop[:4]           # a 5th item (clip shapes) is build_layers' business
        if pid in cfg.get('solid', ()):
            continue                            # stands IN a wall line: never walk-behind
        ys, xs = P(rect)
        cy, cx = (ys.start + ys.stop) // 2, (xs.start + xs.stop) // 2
        room = next((h for h in hulls if h[cy, cx]), None)
        padl = padr = 0
        if room is not None and fp and fp != bl.OVER:
            # widen only where the art really runs on past the rect (side chairs)
            fy, fx = P(fp)
            while padl < PAD and fx.start - padl - 1 >= 0 and opaque[fy, fx.start - padl - 1].mean() > 0.3: padl += 1
            while padr < PAD and fx.stop + padr < W and opaque[fy, fx.stop + padr].mean() > 0.3: padr += 1
        got = np.zeros_like(floor)
        r = np.zeros_like(floor); r[ys, xs] = True
        if cfg.get('blocks') == 'ground' and (r & blocks).sum() > 0.3 * r.sum():
            # a bed, pool or hedge the repo already gave a GROUND block: the art
            # above that block is its top face, drawn over floor -> walk behind it
            behind |= r & ~blocks
            continue
        if room is not None:
            got[ys, max(0, xs.start - padl):xs.stop + padr] = True
            got &= room
        else:
            yy = slice(max(0, ys.start - COL_UP), ys.stop + COL_DOWN)
            f = floor[yy, xs]
            above = np.maximum.accumulate(f, axis=0); below = np.maximum.accumulate(f[::-1], axis=0)[::-1]
            got[yy, xs] = opaque[yy, xs] & above & below
        got &= ~blocks
        behind |= got
        if fp == bl.OVER:
            continue
        if fp:
            fy, fx = P(fp)
            foot[fy, max(0, fx.start - padl):fx.stop + padr] = True
        if room is None and got.any():
            # the art's own ankle band also blocks: LAYERS rects are hand-placed
            # and a few sit above the drawn base (lon-ext's lamps by ~1%)
            gl, gn = ndimage.label(got)
            for i in range(1, gn + 1):
                blob = gl == i
                low = np.where(blob.any(axis=1))[0].max()
                band = np.zeros_like(blob); band[max(0, low - int(round(FOOT_BAND * H))):low + 1] = True
                foot |= blob & band

    if cfg.get('blocks', 'solid') != 'nobehind':
        foot |= blocks & (floor | behind | opaque)
    walk = (floor | behind) & ~foot
    for r in cfg.get('walk', []): walk[R(r)] = True
    for r in cfg.get('block', []): walk[R(r)] = False
    yy, xx = np.mgrid[0:H, 0:W]
    for (cx, cy, rx, ry) in cfg.get('block_ellipses', []):
        walk[((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1] = False
    walk = ndimage.binary_opening(walk, iterations=1)
    holes = ~walk & ~foot
    hl, hn = ndimage.label(holes)
    hs = ndimage.sum(holes, hl, range(1, hn + 1))
    walk |= np.isin(hl, np.where(hs < 120)[0] + 1)
    wl, _ = ndimage.label(walk)
    sx, sy = cfg['seed']
    assert wl[sy, sx] > 0, f'{scene}: seed {cfg["seed"]} is not on walkable floor'
    walk = wl == wl[sy, sx]

    Image.fromarray(np.where(walk, 255, 0).astype(np.uint8), 'L').save(os.path.join(OUT, f'{scene}-walkmask.png'))
    a = np.asarray(art).astype(float); ov = a * 0.45
    fl = walk & ~opaque; hid = walk & opaque; ft = foot & (floor | behind)
    ov[fl] = a[fl] * 0.55 + np.array([40, 220, 90]) * 0.45
    ov[hid] = a[hid] * 0.45 + np.array([40, 200, 255]) * 0.55
    ov[ft] = a[ft] * 0.4 + np.array([255, 50, 50]) * 0.6
    Image.fromarray(ov.astype(np.uint8)).save(os.path.join(OUT, f'{scene}-walkmask-preview.png'))
    return walk


if __name__ == '__main__':
    for s in (sys.argv[1:] or SCENES):
        m = build(s, SCENES[s]); print(f'{s}: walkable {m.mean():.1%}')
