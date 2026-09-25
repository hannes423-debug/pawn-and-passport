#!/usr/bin/env python3
"""
tools/build_city_popup.py - the world map's city preview card.

The artist's frame ("City preview popup.png", 1122x1402) is drawn with grey
placeholder content: a sketch of a city in the picture window, a pawn in the
info panel, text bars and dots. The game fills those slots itself, so this
tool knocks the placeholders out and keeps the frame:

    picture window   made TRANSPARENT: the city card is drawn behind the frame,
                     so the gold corner pieces stay on top of it
    pawn + plinth,   painted over with the panel's own parchment (the Star
    text bars, dots  Player's portrait goes between the laurels, which stay)
    tile icons       painted over: the game puts its own icons in the tiles and
                     lights the ones the player has earned

    python3 tools/build_city_popup.py [--preview]

Writes assets/ui/city-popup.png. The SLOTS below are what css/pap.css
positions the game's content in (as percentages of this image), so a slot
moved here must be moved there too; the script prints them in that form.
"""
import os
import sys
from collections import deque

import numpy as np
from scipy import ndimage
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'City preview popup.png')
OUT = os.path.join(ROOT, 'assets', 'ui', 'city-popup.png')

# x0, y0, x1, y1 in source pixels, measured on a 50 px grid over the art.
SLOTS = {
    'title':   (250, 212, 878, 322),
    'picture': (200, 385, 912, 752),
    'tile1':   (148, 798, 318, 928),
    'tile2':   (366, 798, 536, 928),
    'tile3':   (586, 798, 756, 928),
    'tile4':   (806, 798, 976, 928),
    'portrait': (200, 972, 312, 1128),
    'info':    (404, 968, 968, 1126),
    'fly':     (138, 1170, 542, 1308),
    'close':   (582, 1170, 988, 1308),
}
DARK = 70          # luminance of the frame's outline: a knock-out never crosses it


def lum(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def flood(mask_ok, seed):
    """Pixels reachable from seed through mask_ok (4-connected)."""
    h, w = mask_ok.shape
    out = np.zeros_like(mask_ok)
    q = deque([seed])
    out[seed[1], seed[0]] = True
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and mask_ok[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                q.append((nx, ny))
    return out


def main():
    img = np.asarray(Image.open(SRC).convert('RGBA')).copy()
    rgb = img[..., :3].astype(float)
    L = lum(rgb)
    H, W = L.shape

    def box(name, inset=0):
        x0, y0, x1, y1 = SLOTS[name]
        m = np.zeros((H, W), bool)
        m[y0 + inset:y1 - inset, x0 + inset:x1 - inset] = True
        return m

    # 1. The picture window: everything light inside the dark frame line.
    x0, y0, x1, y1 = SLOTS['picture']
    window = flood(box('picture') & (L > DARK), ((x0 + x1) // 2, (y0 + y1) // 2))
    img[window, 3] = 0

    # 2. Text bars and dots, and the tile icons: repaint anything that is not
    #    parchment with the parchment around it (the median of the slot's rim).
    def repaint(name, inset):
        m = box(name, inset)
        x0, y0, x1, y1 = SLOTS[name]
        rim = np.zeros_like(m)
        rim[y0 + inset:y0 + inset + 4, x0 + inset:x1 - inset] = True
        paper = np.median(rgb[rim], axis=0)
        off = np.abs(rgb - paper).sum(-1) > 24
        # the art is soft-edged: grow the marks so no faint outline is left
        off = ndimage.binary_dilation(off, iterations=3)
        img[m & off, :3] = paper.astype(np.uint8)
        img[m & off, 3] = 255
        return paper

    repaint('info', 0)
    repaint('portrait', 0)          # the pawn on its plinth: the Star Player's portrait goes there
    for t in ('tile1', 'tile2', 'tile3', 'tile4'):
        repaint(t, 16)

    Image.fromarray(img).save(OUT, optimize=True)
    print(f'wrote {os.path.relpath(OUT, ROOT)}  {W}x{H}')
    for name, (x0, y0, x1, y1) in SLOTS.items():
        print(f'  {name:9s} left {x0 / W * 100:.2f}%  top {y0 / H * 100:.2f}%  width {(x1 - x0) / W * 100:.2f}%  height {(y1 - y0) / H * 100:.2f}%')
    if '--preview' in sys.argv:
        bg = Image.new('RGBA', (W, H), (255, 0, 255, 255))
        bg.alpha_composite(Image.open(OUT))
        path = os.path.join(ROOT, 'tools', 'shots', 'city-popup-preview.png')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bg.resize((W // 2, H // 2), Image.NEAREST).save(path)
        print(f'preview {os.path.relpath(path, ROOT)}')


if __name__ == '__main__':
    main()
