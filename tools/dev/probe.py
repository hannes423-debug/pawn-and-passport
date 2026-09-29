#!/usr/bin/env python3
"""probe.py SCENE x0 y0 x1 y1 fx,fy [fx,fy ...] [name=...]   (percent)
Draws the scene the way scene.js does from the BUILT data (js/data/sceneLayers.js
+ assets/layers/<scene>.webp): art, then actors and depth slices by z
(slice 2*round(10*line), actor 2*round(10*feetY)+1). Bodies at the given feet.
Crop saved as diag/probe-<name>.png, with a 1% grid."""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
PAWNS = os.path.expanduser('~/Työpöytä/Pawns')
L = os.path.join(PAWNS, 'tools', 'shots')
os.chdir(PAWNS)
sys.path.insert(0, 'tools')
import build_occlusion as bo
scene = sys.argv[1]
x0, y0, x1, y1 = map(float, sys.argv[2:6])
name = scene
feet = []
for a in sys.argv[6:]:
    if a.startswith('name='):
        name = a[5:]
    else:
        feet.append(tuple(map(float, a.split(','))))
txt = open(os.environ.get('LAYERS_JS', 'js/data/sceneLayers.js')).read()
d = json.loads(txt[txt.index('{', txt.index('SCENE_LAYERS')):txt.rindex('};') + 1])[scene]
art = Image.open(f'assets/scenes/{scene}.webp').convert('RGBA')
W, H = art.size
atlas = Image.open(d['atlas']).convert('RGBA')
ah = bo.scene_actor_heights()[scene]
A = int(max(40 / 340, ah) * H)          # the smallest stage, where the 40 px floor makes bodies biggest
aw = int(A * 0.42)
items = [(2 * round(10 * s[0]), 0, s) for s in d['slices']] + [(2 * round(10 * fy) + 1, 1, (fx, fy)) for fx, fy in feet]
items.sort(key=lambda t: t[0])
c = art.copy()
dr = ImageDraw.Draw(c)
for _z, kind, it in items:
    if kind == 0:
        z, x, y, w, h, ax, ay, pw, ph = it
        tile = atlas.crop((ax, ay, ax + pw, ay + ph))
        c.alpha_composite(tile, (round(x / 100 * W), round(y / 100 * H)))
    else:
        fx, fy = it
        X, Y = fx / 100 * W, fy / 100 * H
        dr.rectangle([X - aw / 2, Y - A * 0.92, X + aw / 2, Y + A * 0.08], fill=(230, 30, 200, 255), outline=(20, 0, 20, 255))
        dr.ellipse([X - aw / 2, Y - 3, X + aw / 2, Y + 3], fill=(255, 255, 0, 255))
X0, Y0, X1, Y1 = int(x0 / 100 * W), int(y0 / 100 * H), int(x1 / 100 * W), int(y1 / 100 * H)
S = max(1, min(5, 900 // max(1, X1 - X0)))
out = c.crop((X0, Y0, X1, Y1)).resize(((X1 - X0) * S, (Y1 - Y0) * S), Image.NEAREST).convert('RGB')
g = ImageDraw.Draw(out)
for p in np.arange(np.ceil(x0), x1, 1.0):
    X = (p / 100 * W - X0) * S
    if p % 5 == 0:
        g.line([(X, 0), (X, out.height)], fill=(0, 255, 255), width=1); g.text((X + 2, 2), f'{p:g}', fill=(0, 255, 255))
for p in np.arange(np.ceil(y0), y1, 1.0):
    Y = (p / 100 * H - Y0) * S
    if p % 5 == 0:
        g.line([(0, Y), (out.width, Y)], fill=(0, 255, 255), width=1); g.text((2, Y + 2), f'{p:g}', fill=(0, 255, 255))
out.save(os.path.join(L, 'diag-' + f'probe-{name}.png'))
print('probe', name, 'scale', S, 'body px', A)
