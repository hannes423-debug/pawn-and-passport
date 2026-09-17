#!/usr/bin/env python3
"""
tools/build_layers.py - depth layers for walkable scenes.

    python3 tools/build_layers.py            # all scenes in LAYERS
    python3 tools/build_layers.py lon-venue  # one
    python3 tools/build_layers.py --preview  # also tools/shots/layers-<scene>.png

A scene is the flat art in assets/scenes/<scene>.webp. Every object a character
can walk BEHIND (a lamp, a tree, a table, a sign) is cut out of that same art
into its own transparent PNG, placed exactly where it sits in the picture, with:

    base   the y (percent of the scene) where the object meets the ground.
           The game draws the cut-out above any character whose feet are
           higher up the picture (behind it) and below any character whose
           feet are lower (in front of it).
    foot   the part of the floor the object stands on (percent rect): the
           player cannot walk there.

The background needs no editing: the object is already painted in it, and the
cut-out copy on top only matters when a character is behind it.

Cutting: the prop's rect seeds OpenCV GrabCut (everything outside the rect is
background), then the mask is cleaned (holes filled, specks dropped).

ARTIST LAYERS WIN. If the artist supplies a transparent, scene-sized
foreground for a scene, it is used instead of GrabCut:
    <city folder>/layers/<scene>.png    e.g. London/layers/lon-venue.png
Each prop then takes that file's pixels inside its rect.

Output:
    assets/layers/<scene>/<prop>.png
    js/data/sceneLayers.js   (GENERATED: props with boxes, base, foot + the walkable floor)
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'layers')
PREVIEW = '--preview' in sys.argv

CITY_DIR = {'nyc': 'NYC', 'lon': 'London', 'vie': 'Vienna', 'ist': 'Istanbul', 'che': 'Chennai', 'wen': 'Wenzhou', 'mad': 'Spain Madrid'}

# scene -> floor polygons (percent points; the walkable area before props are
# carved out), extra blocks (percent rects that are not props: water, walls,
# hedges), and props: (id, rect x0 y0 x1 y1, base y, foot rect or None).
LAYERS = {
    'lon-venue': {
        'floor': [[[3, 37], [97, 37], [97, 88], [56, 88], [56, 93], [44, 93], [44, 88], [3, 88]]],
        'blocks': [(0, 34, 13, 58), (92, 34, 100, 56)],
        'props': [
            ('tree-w', (0, 26, 15, 61), 58, None),
            ('bench-nw', (18, 24, 36, 41), 39, (19, 35, 35, 40)),
            ('bench-ne', (64, 24, 82, 41), 39, (65, 35, 81, 40)),
            ('table-nw', (25.5, 39, 39.5, 52), 51, (27, 46, 38.5, 51.5)),
            ('table-ne', (60.5, 39, 74.5, 52), 51, (61.5, 46, 73.5, 51.5)),
            ('fountain', (41.5, 43, 58.5, 66.5), 66, (40, 52, 60, 67)),
            ('lamp-w', (12, 36, 22, 71), 69, (15, 66, 19, 70)),
            ('lamp-e', (78, 36, 89, 72), 70, (81, 66.5, 85, 71)),
            ('cart', (87, 40, 100, 67), 66, (88, 58, 100, 66)),
            ('table-sw', (25, 59, 39.5, 73), 72, (26, 66, 38.5, 72.5)),
            ('table-se', (60.5, 59, 75, 73), 72, (61.5, 66, 74, 72.5)),
            ('booth', (3.5, 53, 14, 83), 81, (4, 76, 13.5, 82)),
            ('planter-w', (12, 64, 22, 81), 80, (13, 74, 21, 81)),
            ('planter-e', (78, 64, 88, 81), 80, (79, 74, 87, 81)),
            ('aframe', (84.5, 65, 96.5, 83), 81, (86, 77, 95.5, 82)),
            ('bench-sw', (24.5, 76, 39.5, 88), 86, (25, 82, 38.5, 87)),
            ('bench-se', (60.5, 76, 75.5, 88), 86, (61, 82, 75, 87)),
            ('pot-sw', (37.5, 74, 45.5, 89), 87, (38, 82, 45, 88)),
            ('pot-se', (54.5, 74, 62.5, 89), 87, (55, 82, 62, 88)),
        ],
    },
    'vie-venue': {
        'floor': [[[20, 40], [74, 40], [74, 54], [97, 54], [97, 71], [82, 71], [82, 73], [70, 73], [69, 97], [31, 97], [30, 73], [13, 73], [13, 66], [3, 66], [3, 56], [20, 56]]],
        'blocks': [(12, 72, 30, 84), (70, 72, 84, 84)],
        'props': [
            ('plant-nw', (16, 22, 26, 43), 41, (18, 37, 24, 41)),
            ('plant-mid', (37, 22, 45, 42), 40, (38, 37, 44, 40.5)),
            ('coatstand', (59, 19, 67, 42), 41, (61, 38, 65, 41.5)),
            ('newsrack', (66, 24, 74, 44), 42, (67, 39, 73, 43)),
            ('piano', (0, 26, 20.5, 56), 54, (0, 40, 20, 55)),
            ('table-mid', (35, 37, 61, 56), 54, (37, 45, 59, 55)),
            ('table-w', (10, 52, 37, 72), 70, (12, 62, 35, 71)),
            ('table-e', (60, 54, 89, 72), 70, (62, 63, 87, 71)),
            ('stanchion-w', (27.5, 73, 33.5, 93), 91, (28.5, 86, 32.5, 92)),
            ('stanchion-e', (66.5, 73, 72.5, 93), 91, (67.5, 86, 71.5, 92)),
            ('plant-sw', (18, 71, 31, 94), 92, (20, 85, 29, 93)),
            ('plant-se', (69, 71, 82, 94), 92, (71, 85, 80, 93)),
        ],
    },
    'ist-venue': {
        'floor': [[[8, 33], [92, 33], [92, 50], [97, 50], [97, 62], [67, 62], [67, 63.5], [33, 63.5], [33, 62], [3, 62], [3, 48], [8, 48]]],
        'blocks': [(0, 27, 23.5, 40)],
        'props': [
            ('lamp-n', (33, 3, 40, 38), 36, (34.5, 33, 37.5, 37)),
            ('planter-n1', (36, 28, 44, 40), 38, (37, 34, 43, 39)),
            ('bench-n', (44, 29, 57, 39), 37, (45, 33, 56, 38)),
            ('planter-n2', (59.5, 28, 67.5, 40), 38, (60.5, 34, 66.5, 39)),
            ('bench-ne', (68.5, 30, 81.5, 41), 39, (69.5, 35, 80.5, 40)),
            ('cypress-e', (83, 17, 93, 47), 45, (84, 40, 92, 46)),
            ('lamp-e', (88, 7, 98, 52), 50, (90, 46, 96, 51)),
            ('chalkboard', (3, 34, 12, 51), 49, (4, 45, 11, 50)),
            ('table-nw', (25, 41, 39.5, 53), 51, (26, 46, 39, 52)),
            ('table-ne', (60, 41, 75, 53), 51, (61, 46, 74, 52)),
            ('table-mid', (42.5, 50, 57.5, 62), 60, (44, 55, 56, 61)),
            ('table-w', (5, 50, 19, 62), 61, (6, 56, 18, 61.5)),
            ('table-e', (81, 50, 95, 62), 61, (82, 56, 94, 61.5)),
            ('lamp-sw', (27, 57, 31.5, 78), 76, None),
            ('lamp-se', (68.5, 57, 73, 78), 76, None),
        ],
    },
    'che-venue': {
        'floor': [[[2, 24], [98, 24], [98, 88], [2, 88]]],
        'blocks': [(0, 24, 21.5, 56), (74, 24, 100, 52), (92, 42, 100, 58), (0, 73, 5, 88), (95, 73, 100, 88)],
        'props': [
            ('lamp-nw', (22.5, 3, 28, 28), 26, (24, 23.5, 26.5, 26.5)),
            ('planter-nw1', (22, 22, 29.5, 30.5), 29, (22.5, 25, 29, 29.5)),
            ('bench-nw', (29.5, 19, 42.5, 30), 28, (30.5, 24, 41.5, 29)),
            ('planter-nw2', (42.5, 22, 50, 30.5), 29, (43, 25, 49.5, 29.5)),
            ('bench-ne', (60.5, 19, 73.5, 30), 28, (61.5, 24, 72.5, 29)),
            ('lamp-ne', (80.5, 2, 85.5, 28), 26, None),
            ('table-n', (29.5, 29.5, 44.5, 43), 41, (31, 35, 43, 42)),
            ('table-e', (55.5, 36.5, 70, 50.5), 49, (57, 43, 69, 50)),
            ('stool', (78.5, 45, 84.5, 54.5), 53, (79.5, 50, 83.5, 53.5)),
            ('table-mid', (36.5, 47.5, 52, 61.5), 60, (38, 54, 51, 61)),
            ('lamp-sw', (26.5, 56, 31.5, 81), 79, (27.5, 75, 30.5, 80)),
            ('lamp-se', (65.5, 56, 70.5, 81), 79, (66.5, 75, 69.5, 80)),
            ('sign', (31.5, 63, 64.5, 81), 78, (33, 70, 63, 79)),
            ('palm-sw', (3, 50, 21, 87), 85, (5, 74, 17, 86)),
            ('palm-se', (76, 51, 96, 87), 85, (82, 74, 95, 86)),
            ('planter-sw', (25.5, 73.5, 42.5, 87), 86, (26.5, 79, 41.5, 86)),
            ('planter-se', (56.5, 73.5, 72.5, 87), 86, (57.5, 79, 71.5, 86)),
        ],
    },
    'wen-venue': {
        'floor': [[[12, 34], [40, 34], [40, 57], [78, 57], [78, 40], [80, 28], [90, 26], [93, 40], [93, 70], [12, 70]]],
        'blocks': [(0, 55, 22, 72), (0, 34, 12, 56), (39, 26, 79, 56.5)],
        'props': [
            ('willow', (0, 28, 22, 72), 66, None),
            ('lamp-banners', (12.5, 8, 27.5, 42), 40, (17, 37, 21, 41)),
            ('bench-nw', (24, 31, 36.5, 43.5), 42, (25, 37, 36, 43)),
            ('planter-nw', (33.5, 29, 40.5, 41), 40, (34, 35, 40, 40.5)),
            ('planters-stairs', (84, 29, 94, 48), 46, (85, 40, 93, 47)),
            ('bench-e', (90, 42, 100, 53), 51, (91, 46, 100, 52)),
            ('pavilion', (39, 0, 80, 57), 55, None),
            ('table-w', (22.5, 43.5, 37.5, 57), 56, (24, 50, 36, 56)),
            ('planter-pav-w', (40, 46, 51, 58.5), 57.5, (41, 52, 50, 58)),
            ('planter-pav-e', (66, 45, 76, 57.5), 57, (67, 51, 75, 57)),
            ('table-e', (73, 53.5, 88.5, 67.5), 66, (74, 59, 87.5, 66.5)),
            ('chalkboard', (90, 54, 100, 70.5), 69, (91, 64, 99, 70)),
            ('table-mid', (32, 57.5, 47.5, 72.5), 71, (33.5, 64, 46.5, 71.5)),
        ],
    },
    'nyc-venue': {
        'floor': [
            [[5, 24], [95, 24], [95, 40], [84, 40], [84, 38], [16, 38], [16, 40], [5, 40]],
            [[5, 39], [16, 39], [18, 67], [19, 73], [12, 73], [6, 67]],
            [[84, 39], [95, 39], [94, 67], [88, 73], [81, 73], [82, 67]],
            [[18, 62], [82, 62], [88, 72], [88, 88], [62, 88], [62, 92], [38, 92], [38, 88], [12, 88], [12, 72]],
        ],
        'blocks': [(31, 66, 69, 86)],
        'props': [
            ('lamp-nw', (1.5, 11, 4.5, 41), 39, None),
            ('lamp-ne', (95, 11, 98.5, 41), 39, None),
            ('bench-n', (28, 20, 34.5, 27.5), 26, (28.5, 23.5, 34, 26.5)),
            ('bench-ne', (66.5, 20, 73.5, 27.5), 26, (67, 23.5, 73, 26.5)),
            ('table-w1', (6.5, 26.5, 14.5, 36.5), 35, (7.5, 31, 13.5, 35.5)),
            ('table-w2', (19.5, 26.5, 28, 36.5), 35, (20.5, 31, 27.5, 35.5)),
            ('table-e1', (72, 26.5, 80.5, 36.5), 35, (72.5, 31, 79.5, 35.5)),
            ('table-e2', (85, 26.5, 93.5, 36.5), 35, (85.5, 31, 92.5, 35.5)),
            ('planter-rail-w', (19.5, 33, 26.5, 44.5), 43, None),
            ('planter-rail-mw', (32, 31, 38.5, 44.5), 43, None),
            ('planter-rail-me', (61.5, 31, 68, 44.5), 43, None),
            ('planter-rail-e', (73.5, 33, 80.5, 44.5), 43, None),
            ('pillar-sw', (14, 55, 20, 70.5), 70, None),
            ('pillar-se', (80, 55, 86, 70.5), 70, None),
            ('lamp-sw', (20.5, 51, 24.5, 68.5), 67, (21, 64, 24, 68)),
            ('lamp-se', (76, 51, 80, 68.5), 67, (76.5, 64, 79.5, 68)),
            ('fountain', (30.5, 55, 69.5, 87), 80, None),
            ('lamp-front-w', (22.5, 77, 26.5, 89.5), 88, (23, 85, 26, 89)),
            ('lamp-front-e', (74.5, 77, 78.5, 89.5), 88, (75, 85, 78, 89)),
            ('planter-front-w', (30.5, 83, 36.5, 93.5), 92, (31, 88, 36, 92.5)),
            ('planter-front-e', (63.5, 83, 69.5, 93.5), 92, (64, 88, 69, 92.5)),
        ],
    },
    'mad-ext': {
        'floor': [[[40, 36], [60, 36], [60, 39], [65, 39], [65, 62], [69, 76], [60, 77], [60, 97], [40, 97], [40, 77], [31, 76], [35, 62], [35, 39], [40, 39]]],
        'blocks': [],
        'props': [
            ('pots-steps-w', (37.5, 31, 44.5, 39.5), 38, None),
            ('pots-steps-e', (55.5, 31, 62.5, 39.5), 38, None),
            ('lamp-nw', (35.5, 38, 38.5, 48), 47, (36, 45, 38, 47.5)),
            ('lamp-ne', (61.5, 38, 64.5, 48), 47, (62, 45, 64, 47.5)),
            ('fountain', (40.5, 44, 59.5, 62), 60, (42, 50, 58, 60.5)),
            ('lamp-sw', (35.5, 56, 38.5, 67), 66, (36, 63, 38, 66.5)),
            ('lamp-se', (61.5, 56, 64.5, 67), 66, (62, 63, 64, 66.5)),
            ('pot-w1', (40, 62, 45, 68.5), 67, (40.5, 64, 44.5, 67.5)),
            ('pot-e1', (55, 62, 60, 68.5), 67, (55.5, 64, 59.5, 67.5)),
            ('pillar-w', (31.5, 59, 38.5, 74.5), 73, (32, 69, 38, 73.5)),
            ('pillar-e', (61.5, 59, 68.5, 74.5), 73, (62, 69, 68, 73.5)),
            ('pot-w2', (40, 69, 45, 75.5), 74, (40.5, 71, 44.5, 74.5)),
            ('pot-e2', (55, 69, 60, 75.5), 74, (55.5, 71, 59.5, 74.5)),
            ('gate', (41, 77, 59, 94), 93, None),
            ('gatepost-w', (34, 76, 41, 95.5), 94, (35, 90, 40, 94.5)),
            ('gatepost-e', (59, 76, 66, 95.5), 94, (60, 90, 65, 94.5)),
        ],
    },
}


def load_scene(scene):
    path = os.path.join(ROOT, 'assets', 'scenes', f'{scene}.webp')
    return Image.open(path).convert('RGB')


def artist_layer(scene, size):
    folder = CITY_DIR.get(scene[:3])
    if not folder:
        return None
    path = os.path.join(ROOT, folder, 'layers', f'{scene}.png')
    if not os.path.exists(path):
        return None
    img = Image.open(path).convert('RGBA')
    if img.size != size:
        img = img.resize(size, Image.LANCZOS)
    print(f'  {scene}: using artist layer {os.path.relpath(path, ROOT)}')
    return np.asarray(img)


def px_rect(rect, w, h):
    x0, y0, x1, y1 = rect
    return (max(0, int(x0 / 100 * w)), max(0, int(y0 / 100 * h)), min(w, int(round(x1 / 100 * w))), min(h, int(round(y1 / 100 * h))))


def grabcut(rgb, box):
    """Foreground mask of the object inside box (x0, y0, x1, y1 in px)."""
    x0, y0, x1, y1 = box
    pad = 12
    H, W = rgb.shape[:2]
    cx0, cy0, cx1, cy1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
    crop = cv2.cvtColor(rgb[cy0:cy1, cx0:cx1], cv2.COLOR_RGB2BGR)
    mask = np.zeros(crop.shape[:2], np.uint8)
    rect = (x0 - cx0, y0 - cy0, x1 - x0, y1 - y0)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(crop, mask, rect, bgd, fgd, 6, cv2.GC_INIT_WITH_RECT)
    fg = (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)
    fg = ndimage.binary_opening(fg, iterations=1)
    labels, n = ndimage.label(fg)
    if n:
        sizes = ndimage.sum(fg, labels, range(1, n + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s >= max(40, sizes.max() * 0.04)]
        fg = np.isin(labels, keep)
    fg = ndimage.binary_fill_holes(fg)
    fg = ndimage.binary_closing(fg, iterations=2)
    return fg[y0 - cy0:y1 - cy0, x0 - cx0:x1 - cx0]


def build(scene, spec):
    img = load_scene(scene)
    W, H = img.size
    rgb = np.asarray(img)
    artist = artist_layer(scene, (W, H))
    out_dir = os.path.join(OUT, scene)
    os.makedirs(out_dir, exist_ok=True)
    for stale in os.listdir(out_dir):
        os.remove(os.path.join(out_dir, stale))
    props = []
    preview = img.convert('RGBA').copy() if PREVIEW else None
    tint = Image.new('RGBA', (W, H), (0, 0, 0, 0)) if PREVIEW else None
    for pid, rect, base, foot in spec['props']:
        box = px_rect(rect, W, H)
        x0, y0, x1, y1 = box
        if artist is not None:
            piece = artist[y0:y1, x0:x1].copy()
        else:
            mask = grabcut(rgb, box)
            piece = np.dstack([rgb[y0:y1, x0:x1], np.where(mask, 255, 0).astype(np.uint8)])
        Image.fromarray(piece.astype(np.uint8), 'RGBA').save(os.path.join(out_dir, f'{pid}.png'), optimize=True)
        props.append({'id': pid, 'src': f'assets/layers/{scene}/{pid}.png',
                      'x': round(x0 / W * 100, 3), 'y': round(y0 / H * 100, 3),
                      'w': round((x1 - x0) / W * 100, 3), 'h': round((y1 - y0) / H * 100, 3),
                      'base': base, 'foot': list(foot) if foot else None})
        if PREVIEW:
            cut = Image.fromarray(piece.astype(np.uint8), 'RGBA')
            alpha = np.asarray(cut)[..., 3]
            overlay = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
            overlay[alpha > 0] = (255, 40, 200, 90)
            tint.alpha_composite(Image.fromarray(overlay, 'RGBA'), (x0, y0))
    if PREVIEW:
        preview.alpha_composite(tint)
        d = ImageDraw.Draw(preview)
        P = lambda x, y: (x / 100 * W, y / 100 * H)
        for poly in spec['floor']:
            d.line([P(*p) for p in poly + [poly[0]]], fill=(0, 255, 0, 255), width=3)
        for b in spec.get('blocks', []):
            d.rectangle([P(b[0], b[1]), P(b[2], b[3])], outline=(0, 120, 255, 255), width=3)
        for p in props:
            d.line([P(p['x'], p['base']), P(p['x'] + p['w'], p['base'])], fill=(255, 0, 0, 255), width=2)
            if p['foot']:
                f = p['foot']
                d.rectangle([P(f[0], f[1]), P(f[2], f[3])], outline=(255, 220, 0, 255), width=2)
            d.text(P(p['x'], p['y']), p['id'], fill=(255, 255, 255, 255))
        os.makedirs(os.path.join(ROOT, 'tools', 'shots'), exist_ok=True)
        preview.convert('RGB').save(os.path.join(ROOT, 'tools', 'shots', f'layers-{scene}.png'))
    print(f'  {scene}: {len(props)} props')
    return {'props': props, 'floor': spec['floor'], 'blocks': [list(b) for b in spec.get('blocks', [])]}


def main():
    wanted = [a for a in sys.argv[1:] if not a.startswith('--')] or list(LAYERS)
    data = {}
    js_path = os.path.join(ROOT, 'js', 'data', 'sceneLayers.js')
    # Keep scenes that are not being rebuilt this run.
    if os.path.exists(js_path):
        text = open(js_path, encoding='utf8').read()
        start = text.find('export const SCENE_LAYERS = ')
        if start >= 0:
            body = text[start + len('export const SCENE_LAYERS = '):text.rfind(';\nexport default')]
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                data = {}
    for scene in wanted:
        data[scene] = build(scene, LAYERS[scene])
    data = {k: data[k] for k in LAYERS if k in data}
    with open(js_path, 'w', encoding='utf8') as fh:
        fh.write('/**\n * sceneLayers.js - GENERATED by tools/build_layers.py. Do not edit by hand.\n *\n'
                 ' * Per scene: props (cut-out objects with box, base line and footprint, in\n'
                 ' * percent of the scene), the walkable floor polygons and extra blocks.\n */\n')
        fh.write('export const SCENE_LAYERS = ' + json.dumps(data, indent=1) + ';\nexport default SCENE_LAYERS;\n')
    print(f'{len(wanted)} scene(s) -> assets/layers/, js/data/sceneLayers.js')


if __name__ == '__main__':
    main()
