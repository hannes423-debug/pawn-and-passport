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
background). GrabCut alone fails on small objects that fill their rect (it
returned EMPTY masks for pots, lamps and plants), so its mask is joined with a
colour cut: pixels inside the rect that differ clearly from every floor colour
sampled in a ring around it. The result is cleaned (holes filled, specks
dropped), and a mask that is still empty falls back to the whole rect.

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
    'nyc-int': {
        'floor': [
            [[9, 23], [30.5, 23], [30.5, 39], [9, 39]],
            [[29, 36], [40, 36], [40, 40.5], [29, 40.5]],
            [[5.5, 55.5], [30.5, 55.5], [30.5, 73], [5.5, 73]],
            [[29, 58], [40, 58], [40, 62], [29, 62]],
            [[45.5, 12], [54.5, 12], [54.5, 37], [62, 37], [62, 73], [59, 73], [59, 93], [41, 93], [41, 73], [38, 73], [38, 37], [45.5, 37]],
            [[59, 38], [68.5, 38], [68.5, 42.5], [59, 42.5]],
            [[67, 30.5], [93.5, 30.5], [93.5, 72.5], [67, 72.5]],
        ],
        'blocks': [],
        'props': [
            ('desk', (11.5, 19.5, 26, 29.5), 29, (12, 25, 25.5, 29)),
            ('shelf-w', (5, 16, 12.5, 30), 29.5, (5, 23, 9.5, 29.5)),
            ('armchairs', (11, 30, 25, 37), 36.5, (11.5, 32.5, 24.5, 36.5)),
            ('plants-dir-e', (27.5, 18.5, 31.5, 36), 35.5, (28, 33, 31, 35.5)),
            ('plant-dir-sw', (5, 29, 9, 38.5), 38, (5.5, 35, 9, 38)),
            ('statue', (29, 33.5, 31.5, 38.5), 38, None),
            ('prac-nw', (8.5, 56, 16, 64), 63.5, (9, 58.5, 15.5, 63.5)),
            ('prac-sw', (8.5, 64.5, 16, 72.5), 72, (9, 67, 15.5, 72)),
            ('prac-ne', (20.5, 56, 28.5, 64), 63.5, (21, 58.5, 28, 63.5)),
            ('prac-se', (20.5, 64.5, 28.5, 72.5), 72, (21, 67, 28, 72)),
            ('banner-nw', (36, 16, 41.5, 39), 38.5, None),
            ('banner-ne', (58.5, 16, 64, 39), 38.5, None),
            ('lamp-stair-w', (41.5, 25, 44.5, 32.5), 32, None),
            ('lamp-stair-e', (55.5, 25, 58.5, 32.5), 32, None),
            ('plant-hall-nw', (42, 31, 46, 38.5), 38, (42.5, 36.5, 45.5, 38.3)),
            ('plant-hall-ne', (54, 31, 58, 38.5), 38, (54.5, 36.5, 57.5, 38.3)),
            ('settee-w', (37.8, 42.5, 41.5, 52.5), 52, (38, 43.5, 41.3, 52)),
            ('settee-e', (58.3, 42.5, 62, 52.5), 52, (58.5, 43.5, 61.8, 52)),
            ('sidetable-w', (38, 52, 41, 58.5), 58, (38.2, 55.5, 40.8, 58)),
            ('sidetable-e', (59, 52, 62, 59), 58.5, (59.2, 55.5, 61.8, 58.5)),
            ('plant-hall-w', (40, 58.5, 43.5, 66), 65.5, (40.3, 62.5, 43.2, 65.5)),
            ('plant-hall-e', (56.5, 58.5, 60, 66.5), 66, (56.8, 62.5, 59.7, 66)),
            ('lamp-hall-w', (38, 68, 40.5, 73.5), 73, (38.2, 71, 40.3, 73)),
            ('lamp-hall-e', (59.3, 67.5, 61.5, 73.5), 73, (59.5, 71, 61.3, 73)),
            ('plant-entry-w', (40.5, 72.5, 44, 84), 83.5, (41, 80, 43.8, 83.5)),
            ('plant-entry-e', (55, 72.5, 59, 83), 82.5, (55.5, 79.5, 58.8, 82.5)),
            ('banner-sw', (36, 73.5, 41.5, 90), 89.5, None),
            ('banner-se', (58.5, 73.5, 64.5, 90), 89.5, None),
            ('plant-tour-nw', (66.5, 24, 70.5, 34), 33.5, (67, 31, 70.3, 33.5)),
            ('plant-tour-sw', (67.5, 63.5, 70.8, 72.5), 72, (67.8, 69.5, 70.5, 72)),
            ('table-l1', (69.3, 31, 77.5, 39.8), 39.5, (69.8, 33.5, 77.0, 39.5)),
            ('table-l2', (69.3, 41.8, 77.5, 50.8), 50.5, (69.8, 44.3, 77.0, 50.5)),
            ('table-l3', (69.3, 52.3, 77.5, 61.3), 61.0, (69.8, 54.8, 77.0, 61.0)),
            ('table-l4', (69.3, 62.8, 77.5, 71.8), 71.5, (69.8, 65.3, 77.0, 71.5)),
            ('table-r1', (84.5, 31, 91.8, 39.8), 39.5, (85.0, 33.5, 91.3, 39.5)),
            ('table-r2', (84.5, 41.8, 91.8, 50.8), 50.5, (85.0, 44.3, 91.3, 50.5)),
            ('table-r3', (84.5, 52.3, 91.8, 61.3), 61.0, (85.0, 54.8, 91.3, 61.0)),
            ('table-r4', (84.5, 62.8, 91.8, 71.8), 71.5, (85.0, 65.3, 91.3, 71.5)),
        ],
    },
    'vie-int': {
        'floor': [
            [[7.5, 23], [31, 23], [31, 38.5], [7.5, 38.5]],
            [[29, 33], [37, 33], [37, 37.5], [29, 37.5]],
            [[7.5, 55], [31.5, 55], [31.5, 73.5], [7.5, 73.5]],
            [[30, 58], [37, 58], [37, 62], [30, 62]],
            [[46, 8], [54, 8], [54, 30], [64, 30], [64, 75], [53.5, 75], [53.5, 94], [46.5, 94], [46.5, 75], [36, 75], [36, 30], [46, 30]],
            [[62, 34], [68, 34], [68, 38.5], [62, 38.5]],
            [[66.5, 31], [93, 31], [93, 74.5], [66.5, 74.5]],
        ],
        'blocks': [],
        'props': [
            ('desk', (12.5, 16.5, 24.5, 29.5), 29, (13, 25, 24, 29)),
            ('armchairs', (11, 29.5, 25.5, 37), 36.5, (11.5, 32.5, 25, 36.5)),
            ('globe', (29, 24.5, 32.5, 30.5), 30, (29.3, 27.5, 31.8, 30)),
            ('plant-dir-sw', (4, 30, 8, 38.5), 38, (4.5, 35, 7.8, 38)),
            ('prac-nw', (9.5, 54.5, 16.8, 63.3), 63, (10, 57, 16.3, 63)),
            ('prac-ne', (19, 54.5, 27, 63.3), 63, (19.5, 57, 26.5, 63)),
            ('prac-sw', (9.5, 63.5, 16.8, 72.8), 72.5, (10, 66, 16.3, 72.5)),
            ('prac-se', (19, 63.5, 27, 72.8), 72.5, (19.5, 66, 26.5, 72.5)),
            ('plant-prac-e', (29, 65, 33, 72.5), 72, (29.3, 69, 32.8, 72)),
            ('armchair-prac', (28, 45, 33, 55.5), 55, None),
            ('banner-nw', (36, 6, 41.5, 33), 32, None),
            ('banner-ne', (58.5, 6, 64, 33), 32, None),
            ('lamp-stair-w', (42, 23.5, 45, 30.5), 30, None),
            ('lamp-stair-e', (55, 23.5, 58, 30.5), 30, None),
            ('plant-hall-nw', (42, 33, 46, 39.5), 39, (42.5, 36.5, 45.7, 39)),
            ('plant-hall-ne', (53.8, 33, 57.8, 39.5), 39, (54.2, 36.5, 57.5, 39)),
            ('round-table', (46.5, 38.5, 53.5, 45.5), 45, (47, 41, 53, 45)),
            ('settee-w', (38, 44.5, 41, 52.5), 52, (38.3, 46, 40.8, 52)),
            ('settee-e', (59, 44.5, 62, 52.5), 52, (59.2, 46, 61.5, 52)),
            ('plant-hall-w', (37.8, 52.5, 42.3, 59.5), 59, (38.2, 56, 42, 59)),
            ('plant-hall-e', (57.8, 54, 61.5, 60.5), 60, (58.2, 57, 61.2, 60)),
            ('plant-hall-sw', (35.5, 62.5, 40, 71.5), 71, (36, 68, 39.7, 71)),
            ('plant-hall-se', (60.5, 62.5, 64.3, 73.5), 73, (60.8, 69, 64, 73)),
            ('lamp-hall-w', (40.5, 67.5, 43.5, 73.5), 73, (40.8, 71, 43.2, 73)),
            ('lamp-hall-e', (56.5, 67.5, 59.5, 73.5), 73, (56.8, 71, 59.2, 73)),
            ('gate-w', (42.5, 75.5, 46.5, 85), 84.5, None),
            ('gate-e', (53.8, 75.5, 57.5, 85), 84.5, None),
            ('cypress-w', (39.5, 76, 43.5, 90.5), 90, None),
            ('cypress-e', (56.5, 76, 60, 90.5), 90, None),
            ('plant-tour-w1', (67.5, 42, 70.5, 49.5), 49, (67.8, 46, 70.3, 49)),
            ('plant-tour-w2', (67.5, 53, 70.5, 59), 58.5, (67.8, 56, 70.3, 58.5)),
            ('plant-tour-w3', (67.5, 63, 70.5, 70.5), 70, (67.8, 67, 70.3, 70)),
            ('table-l1', (70.5, 33.3, 77.8, 42.5), 42.2, (71.0, 35.8, 77.3, 42.2)),
            ('table-l2', (70.5, 44.3, 77.8, 53.5), 53.2, (71.0, 46.8, 77.3, 53.2)),
            ('table-l3', (70.5, 54.8, 77.8, 64), 63.7, (71.0, 57.3, 77.3, 63.7)),
            ('table-l4', (70.5, 65.3, 77.8, 74.3), 74.0, (71.0, 67.8, 77.3, 74.0)),
            ('table-r1', (84.5, 33.3, 91.8, 42.5), 42.2, (85.0, 35.8, 91.3, 42.2)),
            ('table-r2', (84.5, 44.3, 91.8, 53.5), 53.2, (85.0, 46.8, 91.3, 53.2)),
            ('table-r3', (84.5, 54.8, 91.8, 64), 63.7, (85.0, 57.3, 91.3, 63.7)),
            ('table-r4', (84.5, 65.3, 91.8, 74.3), 74.0, (85.0, 67.8, 91.3, 74.0)),
        ],
    },
    'che-int': {
        'floor': [
            [[9, 16], [91, 16], [91, 40], [9, 40]],
            [[45.5, 39], [54.5, 39], [54.5, 59], [45.5, 59]],
            [[31, 58], [69, 58], [69, 80], [31, 80]],
            [[42, 79], [58, 79], [58, 95], [42, 95]],
            [[4, 57], [30, 57], [30, 79], [4, 79]],
            [[28, 64], [34, 64], [34, 69], [28, 69]],
            [[70, 57], [95.5, 57], [95.5, 79], [70, 79]],
            [[66, 64], [72, 64], [72, 69], [66, 69]],
        ],
        'blocks': [],
        'props': [
            ('tables-a1', (13.5, 17, 25.5, 28), 27.5, (14, 20, 25, 27.5)),
            ('tables-a2', (13.5, 28.5, 25.5, 40), 39.5, (14, 31.5, 25, 39.5)),
            ('tables-b1', (30, 17, 42, 28), 27.5, (30.5, 20, 41.5, 27.5)),
            ('tables-b2', (30, 28.5, 42, 40), 39.5, (30.5, 31.5, 41.5, 39.5)),
            ('tables-c1', (58, 17, 70, 28), 27.5, (58.5, 20, 69.5, 27.5)),
            ('tables-c2', (58, 28.5, 70, 40), 39.5, (58.5, 31.5, 69.5, 39.5)),
            ('tables-d1', (74.5, 17, 86.5, 28), 27.5, (75, 20, 86, 27.5)),
            ('tables-d2', (74.5, 28.5, 86.5, 40), 39.5, (75, 31.5, 86, 39.5)),
            ('hall-sign', (44, 30.5, 56, 38), 40.5, None),
            ('plant-tour-nw', (9, 17, 12.5, 23.5), 23, (9.2, 20, 12.3, 23)),
            ('plant-tour-ne', (87.5, 17, 91, 23.5), 23, (87.7, 20, 90.8, 23)),
            ('lamp-tour-w', (9.5, 32, 12.5, 40), 39.5, (9.8, 36.5, 12.2, 39.5)),
            ('lamp-tour-e', (87.5, 32, 90.5, 40), 39.5, (87.8, 36.5, 90.2, 39.5)),
            ('plant-stair-w', (39.5, 50, 44.5, 58.5), 58, (40, 54.5, 44, 58)),
            ('plant-stair-e', (56, 50, 61, 58.5), 58, (56.5, 54.5, 60.5, 58)),
            ('lamp-lobby-w', (41.5, 70, 44.5, 78.5), 78, (41.8, 75.5, 44.2, 78)),
            ('lamp-lobby-e', (55.5, 70, 58.5, 78.5), 78, (55.8, 75.5, 58.2, 78)),
            ('plant-lobby-w1', (26.5, 68.5, 31.5, 78.5), 78, None),
            ('plant-lobby-w2', (32.5, 68.5, 37, 78.5), 78, (33, 74.5, 36.8, 78)),
            ('plant-lobby-e1', (63, 68.5, 67.5, 78.5), 78, (63.3, 74.5, 67.2, 78)),
            ('plant-lobby-e2', (69.5, 68.5, 74, 78.5), 78, None),
            ('entry-sign', (44.5, 82, 56, 89.5), 99, None),
            ('plant-entry-w', (41.5, 83, 45, 90.5), 90, (42, 87, 44.8, 90)),
            ('plant-entry-e', (55.5, 83, 58.5, 90.5), 90, (55.7, 87, 58.3, 90)),
            ('desk', (11.5, 50.5, 24.5, 63.5), 63, (12, 59.5, 24, 63)),
            ('armchairs', (13, 63.5, 24, 70.5), 70, (13.5, 66, 23.5, 70)),
            ('plant-dir-nw', (5, 53.5, 8.5, 59.5), 59, (5.3, 57, 8.3, 59)),
            ('trophy', (5.5, 65.5, 9.5, 77.5), 77, (5.8, 74, 9.2, 77)),
            ('plant-dir-sw', (10.5, 71.5, 14, 78.5), 78, (10.8, 75.5, 13.8, 78)),
            ('study-nw', (73.5, 57.5, 82, 65.5), 65, (74, 60, 81.5, 65)),
            ('study-ne', (84, 57.5, 92.5, 65.5), 65, (84.5, 60, 92, 65)),
            ('study-sw', (73.5, 68, 82, 77), 76.5, (74, 71, 81.5, 76.5)),
            ('study-se', (84, 68, 92.5, 77), 76.5, (84.5, 71, 92, 76.5)),
            ('plant-study-1', (91.5, 55, 95, 60.5), 60, (91.8, 57.5, 94.8, 60)),
            ('board-study', (91, 63.5, 95.5, 72), 71.5, (91.3, 68, 95.2, 71.5)),
            ('plant-study-2', (91.5, 71.5, 95, 78.5), 78, (91.8, 75.5, 94.8, 78)),
        ],
    },
    'nyc-ext': {
        'floor': [
            [[45.5, 43], [54.5, 43], [54.5, 46], [80, 46], [80, 62], [62.5, 62], [62.5, 68], [58.5, 68], [58.5, 85], [97, 85], [97, 93], [3, 93], [3, 85], [41.5, 85], [41.5, 68], [37.5, 68], [37.5, 62], [20, 62], [20, 46], [45.5, 46]],
        ],
        'blocks': [(29.5, 51, 42.5, 56.8), (57.7, 51, 70.4, 56.8), (41.5, 57, 58.5, 66.5), (45.5, 66.5, 54.5, 73), (0, 85, 19, 100), (84, 89, 91.5, 95)],
        'props': [
            ('topiary-1', (29.3, 35.5, 33, 46.5), 46, None),
            ('topiary-2', (38.3, 35.5, 42.7, 46.5), 46, None),
            ('topiary-3', (57, 35.5, 61, 46.5), 46, None),
            ('topiary-4', (67.3, 35.5, 71, 46.5), 46, None),
            ('lamp-door-w', (26.5, 31, 29.5, 48), 47, (27, 45.5, 29, 47.5)),
            ('lamp-door-e', (70.5, 31, 73.5, 48), 47, (71, 45.5, 73, 47.5)),
            ('pot-door-w', (41, 42, 44, 48.5), 48, (41.6, 46.8, 43.4, 48)),
            ('pot-door-e', (56.2, 42, 59.2, 48.5), 48, (56.8, 46.8, 58.6, 48)),
            ('bed-bench-w', (29, 48.5, 43, 57.5), 57, None),
            ('bed-bench-e', (57.3, 48.5, 71, 57.5), 57, None),
            ('fountain', (40.5, 50, 59.5, 74), 66, None),
            ('lamp-path-w1', (22.5, 54, 25.5, 63.5), 63, (23.2, 60.5, 25, 62)),
            ('lamp-path-w2', (26.8, 54, 29.8, 63.5), 63, (27.5, 60.5, 29.2, 62)),
            ('lamp-path-e1', (70.3, 54, 73.3, 63.5), 63, (70.8, 60.5, 72.6, 62)),
            ('lamp-path-e2', (74.5, 54, 77.5, 63.5), 63, (75, 60.5, 76.8, 62)),
            ('gate-w', (37, 66, 42.5, 84), 83, None),
            ('gate-e', (57.5, 66, 63, 84), 83, None),
            ('pillar-w', (30.5, 56.5, 38, 88), 87.5, (31.5, 84, 37.5, 87.5)),
            ('pillar-e', (62, 56.5, 69.5, 88), 87.5, (62.5, 84, 68.5, 87.5)),
            ('pot-gate-w1', (28.8, 77, 32.5, 86.5), 86, (29.2, 84, 32, 86)),
            ('pot-gate-w2', (37.5, 77, 41.5, 86.5), 86, (38, 84, 41, 86)),
            ('pot-gate-e1', (58.3, 77, 62, 86.5), 86, (58.8, 84, 61.5, 86)),
            ('pot-gate-e2', (68.5, 77, 72, 86.5), 86, (68.8, 84, 71.5, 86)),
            ('streetlamp-w', (0.5, 52, 4.5, 96), 95, (1, 93, 4, 95)),
            ('streetlamp-e', (94, 54, 98.5, 96), 95, (94.5, 93, 98, 95)),
            ('tree', (82, 70, 95, 95), 94, None),
            ('taxi', (0, 84, 19.5, 100), 99, None),
            ('hydrant', (25, 87, 29, 94.5), 94, (25.8, 92, 28.5, 94)),
        ],
    },
    'che-ext': {
        'floor': [
            [[44, 43], [56, 43], [56, 44], [78, 44], [78, 66], [55.5, 66], [55.5, 85], [95, 85], [95, 92], [5, 92], [5, 85], [44.5, 85], [44.5, 66], [22, 66], [22, 44], [44, 44]],
        ],
        'blocks': [(19, 33, 31.5, 45.5), (68.5, 33, 81, 45.5), (29, 42, 37.5, 54), (62.5, 42, 71, 54), (23, 54.5, 31.5, 66), (31, 62, 37.5, 66.5), (68.5, 54.5, 77, 66), (62.5, 62, 69, 66.5)],
        'props': [
            ('pot-porch-w', (36.5, 35, 40.5, 41.5), 41, None),
            ('pot-porch-e', (59.5, 35, 63.5, 41.5), 41, None),
            ('elephant-w', (39, 40.5, 43.5, 49.5), 49, (39.5, 45, 43, 49)),
            ('elephant-e', (57, 40.5, 61.5, 49.5), 49, (57.5, 45, 61, 49)),
            ('bed-nw', (19, 33, 31.5, 45.5), 45, None),
            ('bed-ne', (68.5, 33, 81, 45.5), 45, None),
            ('planter-w', (29, 42, 38, 54.5), 54, None),
            ('planter-e', (62, 42, 71, 54.5), 54, None),
            ('bench-w', (32.5, 52.5, 39.5, 60), 59.5, (33, 56, 39, 59.5)),
            ('bench-e', (60.5, 52.5, 67.5, 60), 59.5, (61, 56, 67, 59.5)),
            ('lamp-w', (40.5, 50, 43.5, 59), 58.5, (41, 56.5, 43, 58.5)),
            ('lamp-e', (56.5, 50, 59.5, 59), 58.5, (57, 56.5, 59, 58.5)),
            ('bed-sw', (22.5, 54, 37.5, 67), 66.5, None),
            ('bed-se', (62.5, 54, 77.5, 67), 66.5, None),
            ('palm-w', (12, 44, 24, 66), 64, None),
            ('palm-e', (75.5, 44, 88, 66), 64, None),
            ('pillar-w', (36.5, 62.5, 42.5, 88.5), 88, None),
            ('pillar-e', (58, 62.5, 63.5, 88.5), 88, None),
            ('gate-arch', (43.5, 63.5, 56.5, 78), 99, None),
            ('gate-door-w', (40.5, 67.5, 45, 79.5), 79, None),
            ('gate-door-e', (55, 67.5, 59.5, 79.5), 79, None),
            ('pot-gate-w', (41, 79, 44.5, 86), 85.5, None),
            ('pot-gate-e', (55.5, 79, 59, 86), 85.5, None),
            ('pot-out-w', (33.5, 78, 37.5, 86), 85.5, (34, 84, 37, 85.8)),
            ('pot-out-e', (62.5, 78, 66.5, 86), 85.5, (63, 84, 66, 85.8)),
            ('streetlamp-w', (4.5, 71, 7.5, 89), 88, (5, 86, 7, 88)),
            ('streetlamp-e', (92, 71, 95, 89), 88, (92.5, 86, 94.5, 88)),
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


def colour_cut(rgb, box):
    """Pixels in box that differ from all the colours in a ring around it (Lab, k-means)."""
    x0, y0, x1, y1 = box
    H, W = rgb.shape[:2]
    ring = max(8, int(0.25 * min(x1 - x0, y1 - y0)))
    rx0, ry0, rx1, ry1 = max(0, x0 - ring), max(0, y0 - ring), min(W, x1 + ring), min(H, y1 + ring)
    lab = cv2.cvtColor(np.ascontiguousarray(rgb[ry0:ry1, rx0:rx1]), cv2.COLOR_RGB2LAB).astype(np.float32)
    inner = np.zeros(lab.shape[:2], bool)
    inner[y0 - ry0:y1 - ry0, x0 - rx0:x1 - rx0] = True
    samples = lab[~inner].reshape(-1, 3)
    if len(samples) < 20:
        return np.zeros((y1 - y0, x1 - x0), bool)
    k = min(6, len(samples))
    _, _, centres = cv2.kmeans(samples, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 2, cv2.KMEANS_PP_CENTERS)
    patch = lab[y0 - ry0:y1 - ry0, x0 - rx0:x1 - rx0]
    dist = np.min(np.linalg.norm(patch[:, :, None, :] - centres[None, None, :, :], axis=3), axis=2)
    fg = dist > 24
    fg = ndimage.binary_opening(fg, iterations=1)
    fg = ndimage.binary_closing(fg, iterations=2)
    return fg


def inpaint_cut(rgb, box):
    """Pixels that differ from the floor the surroundings predict (OpenCV inpainting)."""
    x0, y0, x1, y1 = box
    H, W = rgb.shape[:2]
    ring = max(10, int(0.3 * min(x1 - x0, y1 - y0)))
    rx0, ry0, rx1, ry1 = max(0, x0 - ring), max(0, y0 - ring), min(W, x1 + ring), min(H, y1 + ring)
    patch = np.ascontiguousarray(rgb[ry0:ry1, rx0:rx1])
    hole = np.zeros(patch.shape[:2], np.uint8)
    hole[y0 - ry0:y1 - ry0, x0 - rx0:x1 - rx0] = 255
    bgr = cv2.cvtColor(patch, cv2.COLOR_RGB2BGR)
    floor = cv2.inpaint(bgr, hole, max(3, ring // 2), cv2.INPAINT_TELEA)
    a = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    b = cv2.cvtColor(cv2.GaussianBlur(floor, (0, 0), 2), cv2.COLOR_BGR2LAB).astype(np.float32)
    diff = np.linalg.norm(cv2.GaussianBlur(a, (0, 0), 1.2) - b, axis=2)[y0 - ry0:y1 - ry0, x0 - rx0:x1 - rx0]
    fg = diff > 26
    fg = ndimage.binary_opening(fg, iterations=1)
    fg = ndimage.binary_closing(fg, iterations=3)
    return fg


def cut_mask(rgb, box):
    x0, y0, x1, y1 = box
    try:
        gc = grabcut(rgb, box)
    except cv2.error:
        gc = np.zeros((y1 - y0, x1 - x0), bool)
    cc = colour_cut(rgb, box)
    ic = inpaint_cut(rgb, box)
    mask = gc | cc | ic
    labels, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, labels, range(1, n + 1))
        keep = [i + 1 for i, sz in enumerate(sizes) if sz >= max(30, sizes.max() * 0.05)]
        mask = np.isin(labels, keep)
    mask = ndimage.binary_fill_holes(mask)
    if mask.mean() < 0.02:
        mask = np.ones_like(mask)
    return mask


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
            mask = cut_mask(rgb, box)
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
