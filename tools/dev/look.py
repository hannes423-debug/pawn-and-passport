#!/usr/bin/env python3
"""look.py SCENE x0 y0 x1 y1 [out]   (percent of the scene)
Side by side: art with a 1% grid (labels every 5%) and the occlusion layer's
opaque px tinted (red = in layer), and the current preview crop. -> diag/look-<scene>-<x0>-<y0>.png"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw
PAWNS = os.path.expanduser('~/Työpöytä/Pawns')
sys.path.insert(0, os.path.join(PAWNS, 'tools'))
os.chdir(PAWNS)
import build_occlusion as bo
L = os.path.join(PAWNS, 'tools', 'shots')
scene = sys.argv[1]
x0, y0, x1, y1 = map(float, sys.argv[2:6])
art, opaque, walk = bo.load(scene)
H, W = opaque.shape
X0, Y0, X1, Y1 = int(x0 / 100 * W), int(y0 / 100 * H), int(x1 / 100 * W), int(y1 / 100 * H)
S = max(1, min(6, 900 // max(1, X1 - X0)))
a = art[Y0:Y1, X0:X1].astype(float)
t = a.copy()
o = opaque[Y0:Y1, X0:X1]
w = walk[Y0:Y1, X0:X1]
t[o] = t[o] * 0.55 + np.array([255, 40, 40]) * 0.45
t[~o & ~w] *= 0.45
imgs = []
for arr in (a, t):
    im = Image.fromarray(arr.astype(np.uint8)).resize(((X1 - X0) * S, (Y1 - Y0) * S), Image.NEAREST)
    d = ImageDraw.Draw(im)
    for p in np.arange(np.ceil(x0), x1, 1.0):
        X = (p / 100 * W - X0) * S
        d.line([(X, 0), (X, im.height)], fill=(0, 255, 255) if p % 5 == 0 else (0, 120, 140), width=1)
        if p % 5 == 0:
            d.text((X + 2, 2), f'{p:g}', fill=(0, 255, 255))
    for p in np.arange(np.ceil(y0), y1, 1.0):
        Y = (p / 100 * H - Y0) * S
        d.line([(0, Y), (im.width, Y)], fill=(0, 255, 255) if p % 5 == 0 else (0, 120, 140), width=1)
        if p % 5 == 0:
            d.text((2, Y + 2), f'{p:g}', fill=(0, 255, 255))
    imgs.append(im)
pv = os.path.join(PAWNS, 'tools', 'shots', f'occlusion-{scene}.png')
if os.path.exists(pv):
    imgs.append(Image.open(pv).convert('RGB').crop((X0, Y0, X1, Y1)).resize(((X1 - X0) * S, (Y1 - Y0) * S), Image.NEAREST))
out = Image.new('RGB', (sum(i.width for i in imgs) + 8 * (len(imgs) - 1), imgs[0].height), (255, 0, 255))
x = 0
for i in imgs:
    out.paste(i, (x, 0)); x += i.width + 8
name = sys.argv[6] if len(sys.argv) > 6 and not sys.argv[6].startswith('poly=') else f'look-{scene}-{x0:g}-{y0:g}'
for arg in sys.argv[6:]:
    if arg.startswith('poly='):      # poly=x,y;x,y;...  drawn on every panel
        pts = [tuple(map(float, q.split(','))) for q in arg[5:].split(';')]
        xy = [((px / 100 * W - X0) * S, (py / 100 * H - Y0) * S) for px, py in pts]
        dd = ImageDraw.Draw(out)
        off = 0
        for i in imgs:
            dd.line([(x + off, y) for x, y in xy + xy[:1]], fill=(255, 255, 0), width=2)
            off += i.width + 8
out.save(os.path.join(L, 'diag-' + name + '.png'))
print(name, 'scale', S)
