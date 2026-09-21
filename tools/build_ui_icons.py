#!/usr/bin/env python3
"""
tools/build_ui_icons.py - cut the board markers out of the supplied UI pack.

The artist's sheet ("ui-icon-pack.png") carries
a row of small marker icons: a reticle, crossed swords, a shield, a sparkle and
an alert. The board uses them to say what an arrow MEANS on the square it points
at - the target of a suggestion, a piece under threat, the expected defence, a
move you have prepared.

The sheet paints them over a smooth coloured backdrop with a glow. This tool
flood-fills the backdrop away from the crop's edges (it is smooth, so a
tolerance walk is enough) and keeps the icon with its dark outline. The glow is
NOT kept: css/board.css draws it with a drop-shadow, so one icon can glow in
whatever colour the board needs.

    python3 tools/build_ui_icons.py [--preview]

Writes assets/ui/<name>.png and prints what it found. Like the character
slicer, the sheet itself is never edited, and stale outputs are removed.
"""
import os
import sys
from collections import deque

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHEET = os.path.join(ROOT, "ui-icon-pack.png")
OUT = os.path.join(ROOT, "assets", "ui")

# The marker row, and roughly where each icon sits in it. Boxes are generous:
# the exact bounds are measured below, not trusted from here.
ROW = (540, 660)
ICONS = [
    # name, x0, x1, fill tolerance. The reticle sits on a GREEN backdrop and is
    # itself green, so the walk has to be strict or it eats the corner brackets
    # (at 30 they vanish; at 12 all four survive with no halo speckle).
    ("reticle", 1025, 1150, 12),   # the target of a suggestion
    ("swords", 1158, 1262, 30),    # a piece under threat
    ("shield", 1268, 1362, 30),    # the expected reply / a defended square
    ("sparkle", 1366, 1458, 30),   # a move from your own prepared opening
    ("alert", 1462, 1536, 30),     # something that needs looking at
]
FEATHER = 1          # px of soft edge left around the icon


def key_out(crop, tolerance):
    """Transparent background by flood fill from the edges."""
    px = crop.load()
    w, h = crop.size
    seen = [[False] * h for _ in range(w)]
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            queue.append((x, y, px[x, y][:3]))
    for y in range(h):
        for x in (0, w - 1):
            queue.append((x, y, px[x, y][:3]))
    while queue:
        x, y, ref = queue.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[x][y]:
            continue
        r, g, b = px[x, y][:3]
        if max(abs(r - ref[0]), abs(g - ref[1]), abs(b - ref[2])) > tolerance:
            continue
        seen[x][y] = True
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            queue.append((x + dx, y + dy, (r, g, b)))
    for x in range(w):
        for y in range(h):
            if seen[x][y]:
                px[x, y] = (0, 0, 0, 0)
    return crop


def trim(img):
    box = img.getbbox()
    if not box:
        return img
    x0, y0, x1, y1 = box
    x0 = max(0, x0 - FEATHER); y0 = max(0, y0 - FEATHER)
    x1 = min(img.width, x1 + FEATHER); y1 = min(img.height, y1 + FEATHER)
    return img.crop((x0, y0, x1, y1))


def main():
    if not os.path.exists(SHEET):
        sys.exit(f"the UI pack is not here: {SHEET}")
    sheet = Image.open(SHEET).convert("RGBA")
    os.makedirs(OUT, exist_ok=True)
    keep = set()
    for name, x0, x1, tolerance in ICONS:
        crop = sheet.crop((x0, ROW[0], x1, ROW[1])).copy()
        icon = trim(key_out(crop, tolerance))
        # Square it off so every marker scales the same way on a square.
        side = max(icon.size)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(icon, ((side - icon.width) // 2, (side - icon.height) // 2))
        path = os.path.join(OUT, f"{name}.png")
        canvas.save(path)
        keep.add(f"{name}.png")
        opaque = sum(1 for p in canvas.convert("RGBA").tobytes()[3::4] if p > 20)
        print(f"  {name:8s} {canvas.width}x{canvas.height}  {opaque} solid px  -> assets/ui/{name}.png")
        if "--preview" in sys.argv:
            preview = Image.new("RGBA", canvas.size, (24, 16, 10, 255))
            preview.alpha_composite(canvas)
            preview.resize((side * 3, side * 3), Image.NEAREST).save(os.path.join(HERE, "shots", f"ui-icon-{name}.png"))
    for stale in os.listdir(OUT):
        if stale.endswith(".png") and stale not in keep:
            os.remove(os.path.join(OUT, stale))
            print(f"  removed stale {stale}")


if __name__ == "__main__":
    main()
