#!/usr/bin/env python3
"""
tools/build_characters.py - slices the supplied character sheets into game sprites.

    python3 tools/build_characters.py [--debug]

Reads characters/*.png (never modified) and writes assets/characters/<id>.png:
one uniform sheet per character, 12 columns x 4 rows,

    columns  0-3 idle, 4-11 walk
    rows     down, left, right, up

with every frame the same cell size, feet on the same baseline and the body
centred, so the game can index frames arithmetically. Also writes
assets/characters/manifest.json.

The source sheets are laid out three different ways (see SHEETS). Frames are
FOUND, not hand-measured: the background is removed (flood fill from the
border on the white sheets, alpha on the transparent ones), soft drop shadows
are dropped, and every remaining blob taller than a label becomes a frame,
grouped into rows by height on the page and sorted left to right.

Every sheet also carries one large illustration of its character (top left
of the page). That figure is cut out as the character's DIALOGUE PORTRAIT:
assets/characters/portraits/<id>.png, so a conversation shows the same person
who walks around the scene.

Only the artist's sheets are used: there are no recoloured or generated
variants (the NPC roster repeats characters instead, see js/data/).
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'characters')
OUT = os.path.join(ROOT, 'assets', 'characters')
DEBUG = '--debug' in sys.argv

CELL_W, CELL_H = 72, 108
BASELINE = CELL_H - 6
BODY_H = 96            # the tallest frame of a character is scaled to this

A = ['down', 'right', 'up', 'left']      # "IDLE 1-4 | WALK 1-8", rows down/right/up/left
C = ['down', 'left', 'up', 'right']      # "IDLE | WALK 1-8", rows down/left/up/right

# id -> source, layout, idle frames, frame region, hero-figure region
# (regions are fractions of the page: x0, y0, x1, y1)
HERO = (0.0, 0.0, 0.2, 0.36)
SHEETS = {
    'boy':          ('Shakkipojan pikselitaidean spritesheet.png', A, 4, (0.27, 0.12, 1.0, 0.95), HERO),
    'girl':         ('Shakkia opiskeleva tyttö – spritesheet.png', A, 4, (0.27, 0.12, 1.0, 0.95), HERO),
    'young-blue':   ('Nuoren shakinpelaajan pikselianimaatiot.png', A, 4, (0.27, 0.12, 1.0, 0.95), HERO),
    'young-red':    ('Nuoren shakinpelaajan pikselisprite-sheet.png', A, 4, (0.27, 0.12, 1.0, 0.95), HERO),
    'old-green':    ('Vanhan shakinpelaajan pikselihahmolevy.png', A, 4, (0.27, 0.12, 1.0, 0.95), HERO),
    'old-scarf':    ('Vanhan shakinpelaajan pikselisprite-sheet.png', A, 4, (0.27, 0.12, 1.0, 0.95), HERO),
    'woman':        ('Aikuisen naisen pikselihahmojen spritesheet.png', A, 4, (0.27, 0.12, 1.0, 0.95), HERO),
}

PORTRAIT_H = 320       # the hero figure is scaled to this height


def foreground(img):
    """Boolean mask of sprite pixels, background and soft shadows removed."""
    arr = np.asarray(img.convert('RGBA')).astype(np.int16)
    rgb, alpha = arr[..., :3], arr[..., 3]
    if alpha.min() < 250:
        mask = alpha > 200
    else:
        # Near-white AND connected to the page border = background.
        light = (rgb.min(axis=2) > 232) & ((rgb.max(axis=2) - rgb.min(axis=2)) < 14)
        labels, _ = ndimage.label(light)
        border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
        background = np.isin(labels, list(border))
        mask = ~background
    # Drop shadows: grey/purple-grey, low saturation, light, and touching the background.
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    shadowish = (rgb.min(axis=2) > 150) & (sat < 40)
    grown = ndimage.binary_dilation(~mask, iterations=2)
    for _ in range(24):
        drop = shadowish & mask & grown
        if not drop.any():
            break
        mask &= ~drop
        grown = ndimage.binary_dilation(~mask, iterations=1)
    return ndimage.binary_opening(mask, iterations=1)


def find_frames(img, layout, idle_count, region):
    W, H = img.size
    x0, y0, x1, y1 = (int(region[0] * W), int(region[1] * H), int(region[2] * W), int(region[3] * H))
    crop = img.crop((x0, y0, x1, y1))
    mask = foreground(crop)
    # Bridge the one-pixel gaps an upscaled "pixel" sprite has between limbs.
    labels, n = ndimage.label(ndimage.binary_closing(mask, iterations=3), structure=np.ones((3, 3)))
    boxes = ndimage.find_objects(labels)
    blobs = []
    rows_expected = 4
    min_h = (y1 - y0) / rows_expected * 0.45
    for i, sl in enumerate(boxes):
        if sl is None:
            continue
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if h < min_h or w < 12:
            continue
        blobs.append({'y0': sl[0].start, 'y1': sl[0].stop, 'x0': sl[1].start, 'x1': sl[1].stop, 'label': i + 1})
    # On the tightly packed page, frames of neighbouring rows can touch and
    # merge into one tall blob: cut those at the emptiest scanline.
    if blobs:
        median_h = float(np.median([b['y1'] - b['y0'] for b in blobs]))
        split = []
        for b in blobs:
            h = b['y1'] - b['y0']
            k = int(round(h / median_h))
            if k < 2:
                split.append(b)
                continue
            region_mask = labels[b['y0']:b['y1'], b['x0']:b['x1']] == b['label']
            density = region_mask.sum(axis=1)
            cuts = [0]
            for j in range(1, k):
                centre = int(h * j / k)
                lo, hi = max(1, centre - int(median_h * 0.25)), min(h - 1, centre + int(median_h * 0.25))
                cuts.append(lo + int(np.argmin(density[lo:hi])))
            cuts.append(h)
            for a, c in zip(cuts, cuts[1:]):
                split.append({**b, 'y0': b['y0'] + a, 'y1': b['y0'] + c})
        blobs = split
    blobs.sort(key=lambda b: (b['y0'] + b['y1']) / 2)
    rows = []
    for blob in blobs:
        cy = (blob['y0'] + blob['y1']) / 2
        if rows and abs(cy - rows[-1]['cy']) < min_h * 0.6:
            rows[-1]['blobs'].append(blob)
            rows[-1]['cy'] = np.mean([(b['y0'] + b['y1']) / 2 for b in rows[-1]['blobs']])
        else:
            rows.append({'cy': cy, 'blobs': [blob]})
    per_row = idle_count + 8
    rows = [r for r in rows if len(r['blobs']) >= per_row - 1]
    if len(rows) != 4:
        raise RuntimeError(f'found {len(rows)} usable rows ({[len(r["blobs"]) for r in rows]})')
    crop_rgba = np.asarray(crop.convert('RGBA')).copy()
    out = {}
    for name, row in zip(layout, rows):
        row['blobs'].sort(key=lambda b: b['x0'])
        frames = []
        for b in row['blobs'][:per_row]:
            piece = crop_rgba[b['y0']:b['y1'], b['x0']:b['x1']].copy()
            m = (labels[b['y0']:b['y1'], b['x0']:b['x1']] == b['label']) & mask[b['y0']:b['y1'], b['x0']:b['x1']]
            piece[..., 3] = np.where(m, 255, 0)
            frames.append(Image.fromarray(piece.astype(np.uint8), 'RGBA'))
        if len(frames) < per_row:
            frames.append(frames[-1])
        idle = frames[:idle_count]
        while len(idle) < 4:
            idle.append(idle[len(idle) % idle_count])
        out[name] = idle + frames[idle_count:idle_count + 8]
    return out


def hero_figure(img, region):
    """The large illustration of the character: the biggest blob in its corner of the page."""
    W, H = img.size
    box = (int(region[0] * W), int(region[1] * H), int(region[2] * W), int(region[3] * H))
    crop = img.crop(box)
    mask = foreground(crop)
    labels, n = ndimage.label(ndimage.binary_closing(mask, iterations=3), structure=np.ones((3, 3)))
    if not n:
        raise RuntimeError('no hero figure found')
    sizes = ndimage.sum(np.ones_like(labels), labels, index=range(1, n + 1))
    biggest = int(np.argmax(sizes)) + 1
    sl = ndimage.find_objects(labels)[biggest - 1]
    rgba = np.asarray(crop.convert('RGBA')).copy()
    keep = (labels == biggest) & mask
    rgba[..., 3] = np.where(keep, 255, 0)
    figure = Image.fromarray(rgba[sl[0], sl[1]].astype(np.uint8), 'RGBA')
    scale = PORTRAIT_H / figure.height
    return figure.resize((max(1, round(figure.width * scale)), PORTRAIT_H), Image.LANCZOS)


def body_centre(frame):
    """x of the torso's centre: the head and shoulders, not the swinging legs."""
    a = np.asarray(frame)[..., 3] > 0
    top = a[: max(1, int(a.shape[0] * 0.45))]
    cols = np.where(top.any(axis=0))[0]
    return (cols.min() + cols.max()) / 2 if len(cols) else a.shape[1] / 2


def assemble(frames_by_dir):
    tallest = max(f.height for fs in frames_by_dir.values() for f in fs)
    scale = BODY_H / tallest
    sheet = Image.new('RGBA', (CELL_W * 12, CELL_H * 4), (0, 0, 0, 0))
    for row, name in enumerate(['down', 'left', 'right', 'up']):
        for col, frame in enumerate(frames_by_dir[name]):
            w, h = max(1, round(frame.width * scale)), max(1, round(frame.height * scale))
            small = frame.resize((w, h), Image.NEAREST if scale < 0.5 else Image.LANCZOS)
            cx = body_centre(small)
            x = round(CELL_W / 2 - cx)
            y = BASELINE - h
            cell = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
            cell.alpha_composite(small, (max(-w, min(CELL_W, x)), max(0, y)))
            sheet.alpha_composite(cell, (col * CELL_W, row * CELL_H))
    sheet = stabilise(sheet)
    # Crisp alpha: no half-transparent fringe from resampling.
    arr = np.asarray(sheet).copy()
    arr[..., 3] = np.where(arr[..., 3] > 110, 255, 0)
    return Image.fromarray(arr, 'RGBA')


def stabilise(sheet):
    """Lock every frame of a row to that row's first idle pose.

    Each frame was centred on its own bounding box, so stray pixels (a ponytail,
    a leftover shadow speck) moved the head and feet a few pixels from frame
    to frame, and a character standing still looked like it was shuffling.
    Idle frames are matched on the whole body, walk frames on the head and
    torso only (the legs are supposed to move)."""
    arr = np.asarray(sheet).copy()
    out = np.zeros_like(arr)
    for row in range(4):
        ref = arr[row * CELL_H:(row + 1) * CELL_H, 0:CELL_W, 3] > 110
        out[row * CELL_H:(row + 1) * CELL_H, 0:CELL_W] = arr[row * CELL_H:(row + 1) * CELL_H, 0:CELL_W]
        top = int(CELL_H * 0.5)
        for col in range(1, 12):
            cell = arr[row * CELL_H:(row + 1) * CELL_H, col * CELL_W:(col + 1) * CELL_W]
            mask = cell[..., 3] > 110
            limit = CELL_H if col < 4 else top
            best, best_score = (0, 0), -1
            for dy in range(-6, 7):
                for dx in range(-8, 9):
                    shifted = np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
                    score = np.logical_and(shifted[:limit], ref[:limit]).sum() - 0.5 * np.logical_xor(shifted[:limit], ref[:limit]).sum()
                    if score > best_score:
                        best, best_score = (dy, dx), score
            dy, dx = best
            moved = np.roll(np.roll(cell, dy, axis=0), dx, axis=1)
            out[row * CELL_H:(row + 1) * CELL_H, col * CELL_W:(col + 1) * CELL_W] = moved
    return Image.fromarray(out, 'RGBA')


def recolour(sheet, band, shift):
    lo, hi, min_sat = band
    arr = np.asarray(sheet.convert('RGBA')).astype(np.float32) / 255.0
    rgb = arr[..., :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    delta = mx - mn
    sat = np.where(mx > 0, delta / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.zeros_like(mx)
    d = np.maximum(delta, 1e-6)
    hue = np.where(mx == r, ((g - b) / d) % 6, hue)
    hue = np.where(mx == g, (b - r) / d + 2, hue)
    hue = np.where(mx == b, (r - g) / d + 4, hue)
    hue = (hue * 60) % 360
    inside = (hue >= lo) & (hue <= hi) if lo <= hi else (hue >= lo) | (hue <= hi)
    sel = inside & (sat >= min_sat) & (arr[..., 3] > 0) & (mx > 0.12)
    new_h = (hue + shift) % 360
    c = mx * sat
    hp = new_h / 60
    xx = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(c)
    conds = [(hp < 1), (hp < 2), (hp < 3), (hp < 4), (hp < 5), (hp <= 6)]
    choices = [(c, xx, z), (xx, c, z), (z, c, xx), (z, xx, c), (xx, z, c), (c, z, xx)]
    nr = np.select(conds, [ch[0] for ch in choices])
    ng = np.select(conds, [ch[1] for ch in choices])
    nb = np.select(conds, [ch[2] for ch in choices])
    m = mx - c
    out = arr.copy()
    out[..., 0] = np.where(sel, nr + m, r)
    out[..., 1] = np.where(sel, ng + m, g)
    out[..., 2] = np.where(sel, nb + m, b)
    return Image.fromarray((out * 255).round().astype(np.uint8), 'RGBA')


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {'cell': [CELL_W, CELL_H], 'baseline': BASELINE, 'columns': {'idle': [0, 4], 'walk': [4, 12]},
                'rows': ['down', 'left', 'right', 'up'], 'sprites': {}}
    built = {}
    # Sheets from an older build (recolours, removed source pages) must not linger.
    for stale in os.listdir(OUT):
        if stale.endswith('.png'):
            os.remove(os.path.join(OUT, stale))
    os.makedirs(os.path.join(OUT, 'portraits'), exist_ok=True)
    for stale in os.listdir(os.path.join(OUT, 'portraits')):
        os.remove(os.path.join(OUT, 'portraits', stale))
    for sid, (file, layout, idle, region, hero) in SHEETS.items():
        path = os.path.join(SRC, file)
        if not os.path.exists(path):
            print(f'  MISSING {file}', file=sys.stderr)
            continue
        page = Image.open(path)
        frames = find_frames(page, layout, idle, region)
        sheet = assemble(frames)
        built[sid] = sheet
        sheet.save(os.path.join(OUT, f'{sid}.png'), optimize=True)
        portrait = hero_figure(page, hero)
        portrait.save(os.path.join(OUT, 'portraits', f'{sid}.png'), optimize=True)
        manifest['sprites'][sid] = {'src': f'assets/characters/{sid}.png', 'portrait': f'assets/characters/portraits/{sid}.png',
                                    'portraitSize': list(portrait.size), 'from': file}
        print(f'  {sid}: {file} (portrait {portrait.size[0]}x{portrait.size[1]})')
    with open(os.path.join(OUT, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)
    if DEBUG:
        ids = list(built)
        page = Image.new('RGBA', (CELL_W * 12, CELL_H * 4 * len(ids) // 2 + CELL_H), (120, 90, 60, 255))
        for i, sid in enumerate(ids):
            half = built[sid].resize((CELL_W * 6, CELL_H * 2), Image.NEAREST)
            page.alpha_composite(half, ((i % 2) * CELL_W * 6, (i // 2) * CELL_H * 2))
        page.save(os.path.join(ROOT, 'tools', 'shots', 'characters-debug.png'))
    print(f'{len(built)} sprite sheets -> assets/characters/')


if __name__ == '__main__':
    main()
