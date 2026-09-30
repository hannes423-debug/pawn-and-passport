#!/usr/bin/env python3
"""
tools/build_prompts.py - cut the input-prompt sheet into one icon per button.

The artist's sheet (`ui-input-prompts.png`, transparent background) has five
rows: the two board cursors and the keyboard keys, Space and E, then one row
per gamepad family (Xbox, Nintendo, PlayStation). Icons are found as connected
shapes (a d-pad's four arrows and a cursor's glow are merged by a small
dilation), sorted into rows and then left to right, and named in that order.
Nothing is hand-measured: if the sheet changes, re-run this.

    python3 tools/build_prompts.py        -> assets/ui/prompts/<name>.png
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, "ui-input-prompts.png")
OUT = os.path.join(ROOT, "assets", "ui", "prompts")

ROWS = [
    ["cursor-blue", "cursor-gold", "key-w", "key-a", "key-s", "key-d", "key-up", "key-down", "key-left", "key-right"],
    ["key-space", "key-e"],
    ["xbox-a", "xbox-b", "xbox-x", "xbox-y", "xbox-dpad", "xbox-lb", "xbox-rb", "xbox-lt", "xbox-rt", "xbox-menu", "xbox-view"],
    ["nin-a", "nin-b", "nin-x", "nin-y", "nin-dpad", "nin-l", "nin-r", "nin-zl", "nin-zr", "nin-minus", "nin-plus"],
    ["ps-triangle", "ps-circle", "ps-cross", "ps-square", "ps-dpad", "ps-l1", "ps-r1", "ps-l2", "ps-r2", "ps-options", "ps-share"],
]
ALPHA = 24          # alpha that counts as part of an icon (the cursors' glow is soft)
MERGE = 2           # px of dilation that joins one icon's parts (icons sit only ~10 px apart)
PAD = 3             # px kept around each icon
CURSORS = ("cursor-blue", "cursor-gold")
ICON_H = 64         # px tall: prompts show at up to 32 CSS px, so this covers a 2x screen
                    # (the cursors keep their size: they cover a whole board square)
GREY = 0.4          # saturation below which a cursor pixel is the painted checkerboard, not the frame
FEATHER = 3         # px over which the frame fades in from the cut-out middle


def open_middle(icon):
    """The art paints a checkerboard INSIDE the cursor frames, opaque, as a
    stand-in for transparency. On the board that would hide the piece the
    cursor is on, so the grey middle is cut out: flood from the centre across
    unsaturated pixels (the frame is saturated blue or gold, the checks are
    beige and grey), clear it, and feather the frame's inner edge by its
    saturation so no beige halo is left."""
    a = np.asarray(icon).astype(float)
    rgb = a[..., :3]
    mx = rgb.max(axis=2)
    sat = np.where(mx > 0, (mx - rgb.min(axis=2)) / np.maximum(mx, 1), 0)
    lab, _ = ndimage.label(sat < GREY)
    h, w = sat.shape
    middle = lab == lab[h // 2, w // 2]
    if not lab[h // 2, w // 2] or middle[0].any() or middle[-1].any() or middle[:, 0].any() or middle[:, -1].any():
        sys.exit("cursor middle is not enclosed by its frame: the art changed, check GREY")
    dist = ndimage.distance_transform_edt(~middle)
    ring = (dist > 0) & (dist <= FEATHER)
    alpha = a[..., 3].copy()
    alpha[middle] = 0
    alpha[ring] *= np.clip(sat[ring] / (GREY + 0.2), 0, 1)
    a[..., 3] = alpha
    return Image.fromarray(a.round().astype(np.uint8), "RGBA")


def main():
    im = Image.open(SHEET).convert("RGBA")
    a = np.asarray(im)[..., 3]
    mask = ndimage.binary_dilation(a > ALPHA, iterations=MERGE)
    lab, n = ndimage.label(mask)
    boxes = []
    for sl in ndimage.find_objects(lab):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h < 30 or w < 30:
            continue                                     # stray specks
        boxes.append(sl)
    # rows: cluster by vertical centre
    boxes.sort(key=lambda s: (s[0].start + s[0].stop) / 2)
    rows, cur = [], []
    for sl in boxes:
        cy = (sl[0].start + sl[0].stop) / 2
        if cur and cy - (cur[-1][0].start + cur[-1][0].stop) / 2 > 60:
            rows.append(cur)
            cur = []
        cur.append(sl)
    if cur:
        rows.append(cur)
    counts = [len(r) for r in rows]
    if counts != [len(r) for r in ROWS]:
        sys.exit(f"found rows of {counts} icons, expected {[len(r) for r in ROWS]}: the sheet changed, update ROWS")
    os.makedirs(OUT, exist_ok=True)
    for names, row in zip(ROWS, rows):
        row.sort(key=lambda s: s[1].start)
        for name, sl in zip(names, row):
            y0 = max(0, sl[0].start + MERGE - PAD)
            x0 = max(0, sl[1].start + MERGE - PAD)
            y1 = min(im.height, sl[0].stop - MERGE + PAD)
            x1 = min(im.width, sl[1].stop - MERGE + PAD)
            icon = im.crop((x0, y0, x1, y1))
            if name in CURSORS:
                icon = open_middle(icon)
            elif icon.height > ICON_H:
                icon = icon.resize((round(icon.width * ICON_H / icon.height), ICON_H), Image.LANCZOS)
            icon.save(os.path.join(OUT, f"{name}.png"), optimize=True)
            print(f"{name:14s} {icon.width}x{icon.height}")
    print(f"{sum(counts)} prompts -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
