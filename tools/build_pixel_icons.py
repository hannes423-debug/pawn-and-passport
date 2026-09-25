#!/usr/bin/env python3
"""
tools/build_pixel_icons.py - cut the UI icon sheet into individual icons.

The artist's sheet ("ui-pixel-icons.png") is one transparent PNG holding 18
icons in 3 rows of 6, drawn large. The game wants them small, square, one file
each, so nothing in the game has to know the sheet's layout - a new icon is a
new cell here and a new name in js/ui/icons.js, and nothing else moves.

    python3 tools/build_pixel_icons.py [--preview]

Each cell is found by its own alpha (the rows and columns are segmented, not
hand-measured), trimmed to the drawing, padded to a square so every icon shares
one baseline and optical size, and resampled to SIZE x SIZE. Writes
assets/ui/icons/<name>.png and deletes anything stale in that folder, so a
renamed icon cannot leave its old file behind to be referenced by accident.

--preview also writes a contact sheet at 4x nearest neighbour, which is the
only honest way to look at a 32px icon on a desktop screen.
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHEET = os.path.join(ROOT, "ui-pixel-icons.png")
# The second sheet (2026-09-24) is painted on flat BLACK, not transparency: the
# black is keyed out from the edges inward before it is cut like the first.
SHEET2 = os.path.join(ROOT, "ui-pixel-icons2.png")
OUT = os.path.join(ROOT, "assets", "ui", "icons")

SIZE = 32          # native pixels. Displayed at 16/24/32/48/64 CSS px.
ALPHA = 8          # anything under this is background, not a soft edge
PAD = 1            # native px of breathing room inside the square

# Row-major, exactly as the sheet reads. The names are the game's vocabulary:
# js/ui/icons.js may not name an icon that is not in this list.
NAMES = [
    "xp",       "trophy",  "postcard",   "settings", "map",      "journal",
    "dialogue", "play",    "practice",   "exit",     "passport", "side-white",
    "side-black", "pawn",  "coin",       "club",     "back",     "hint",
]
COLUMNS = 6
# Row-major like NAMES. None = on the sheet but not used by the game (a train
# ticket, a backpack...): not cut, so nothing can reference it by accident.
NAMES2 = [
    "medal",     None,        None,        None,      None,      None,
    "hourglass", "handshake", None,        "pin",     None,      "crown",
    "scroll",    "analysis",  None,        "coins",   None,      "lock",
]
KEY = 14           # sheet 2: max channel at or under this, touching the black, is background

def runs(counts):
    """Index ranges where `counts` is non-zero."""
    out, start = [], None
    for i, value in enumerate(counts):
        if value and start is None:
            start = i
        elif not value and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(counts) - 1))
    return out


def key_black(sheet):
    """Sheet 2: the flat black background -> transparent, with a soft edge.

    Only black CONNECTED to the sheet's border goes: the icons' own dark
    outlines and pupils are near-black too, but they are enclosed by colour."""
    import numpy as np
    from scipy import ndimage
    rgb = np.asarray(sheet.convert("RGB")).astype(int)
    peak = rgb.max(axis=2)
    dark = peak <= KEY
    lab, _ = ndimage.label(dark)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, edge[edge > 0])
    alpha = np.where(bg, np.clip((peak - 3) * 255 // max(1, KEY - 3), 0, 255), 255).astype(np.uint8)
    out = np.dstack([rgb.astype(np.uint8), alpha])
    return Image.fromarray(out, "RGBA")


def segment(sheet, names=None):
    """(x0, y0, x1, y1) per cell, found from the sheet's own alpha."""
    alpha = sheet.split()[3]
    width, height = sheet.size
    px = alpha.load()
    row_counts = [sum(1 for x in range(width) if px[x, y] > ALPHA) for y in range(height)]
    bands = [r for r in runs(row_counts) if r[1] - r[0] > SIZE]
    names = names or NAMES
    if len(bands) * COLUMNS != len(names):
        sys.exit(f"sheet has {len(bands)} rows, expected {len(names) // COLUMNS}")
    boxes = []
    for y0, y1 in bands:
        col_counts = [sum(1 for y in range(y0, y1 + 1) if px[x, y] > ALPHA) for x in range(width)]
        cols = [c for c in runs(col_counts) if c[1] - c[0] > SIZE]
        # Neighbouring icons can touch on this sheet (row 3's coin and club do):
        # split the widest run until the row has its six.
        while len(cols) > COLUMNS:
            cols.pop(min(range(len(cols)), key=lambda i: cols[i][1] - cols[i][0]))
        if len(cols) != COLUMNS:
            sys.exit(f"row {y0}-{y1} segmented into {len(cols)} icons, expected {COLUMNS}")
        boxes.extend((x0, y0, x1, y1) for x0, x1 in cols)
    return boxes


def cut(sheet, box):
    """One cell, trimmed to its drawing, squared and resampled to SIZE."""
    x0, y0, x1, y1 = box
    crop = sheet.crop((x0, y0, x1 + 1, y1 + 1))
    bounds = crop.split()[3].point(lambda v: 255 if v > ALPHA else 0).getbbox()
    crop = crop.crop(bounds)
    w, h = crop.size
    # A square canvas keeps the optical sizes comparable: the play triangle and
    # the club building end up the same height on screen, which is what makes a
    # row of them look like one set rather than eighteen drawings.
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(crop, ((side - w) // 2, (side - h) // 2))
    inner = SIZE - PAD * 2
    small = canvas.resize((inner, inner), Image.LANCZOS)
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(small, (PAD, PAD))
    return icon


def main():
    if not os.path.exists(SHEET):
        sys.exit(f"missing {SHEET}")
    sheet = Image.open(SHEET).convert("RGBA")
    boxes = segment(sheet)
    os.makedirs(OUT, exist_ok=True)
    sheet2 = key_black(Image.open(SHEET2)) if os.path.exists(SHEET2) else None
    pairs = list(zip(NAMES, boxes))
    if sheet2 is not None:
        pairs2 = [(n, b) for n, b in zip(NAMES2, segment(sheet2, NAMES2)) if n]
    else:
        print(f"  (no {os.path.basename(SHEET2)}: second set skipped)")
        pairs2 = []
    wanted = {f"{name}.png" for name, _ in pairs + pairs2}
    for stale in os.listdir(OUT):
        if stale not in wanted:
            os.remove(os.path.join(OUT, stale))
            print(f"  removed stale {stale}")
    icons = []
    for name, box, src in [(n, b, sheet) for n, b in pairs] + [(n, b, sheet2) for n, b in pairs2]:
        icon = cut(src, box)
        icon.save(os.path.join(OUT, f"{name}.png"), optimize=True)
        icons.append(icon)
        print(f"  {name:<12} from {box} -> {SIZE}x{SIZE}")
    print(f"{len(icons)} icons -> assets/ui/icons/")

    if "--preview" in sys.argv:
        scale = 4
        rows = -(-len(icons) // COLUMNS)
        sheet_out = Image.new("RGBA", (SIZE * scale * COLUMNS, SIZE * scale * rows), (26, 17, 16, 255))
        for i, icon in enumerate(icons):
            big = icon.resize((SIZE * scale, SIZE * scale), Image.NEAREST)
            sheet_out.alpha_composite(big, ((i % COLUMNS) * SIZE * scale, (i // COLUMNS) * SIZE * scale))
        path = os.path.join(ROOT, "icons-preview.png")
        sheet_out.convert("RGB").save(path)
        print(f"preview -> {path}")


if __name__ == "__main__":
    main()
