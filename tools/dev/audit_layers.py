#!/usr/bin/env python3
"""
tools/dev/audit_layers.py - draw what the player can actually walk on.

    node tools/dev/dump_walkmask.mjs /tmp/mask       # the game's own grid
    python3 tools/dev/audit_layers.py /tmp/mask      # -> tools/shots/collision/

Over the scene art:
    green    walkable (the eroded grid js/core/freeWalk.js builds)
    red      floor polygon outline (the SOURCE shape, before erosion)
    blue     explicit blocks
    yellow   prop footprints
    dots     spawns (white) and hotspot nodes (magenta)

Green that runs under a wall means the floor polygon is wrong; a hotspot dot
with no green near it means the player cannot get there.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from build_layers import LAYERS  # noqa: E402

# The footprints the game actually uses, read out of the generated data: a rect
# in LAYERS is only a minimum, and most props derive theirs from their own art.
def _generated_feet():
    src = open(os.path.join(ROOT, 'js', 'data', 'sceneLayers.js'), encoding='utf-8').read()
    body = src[src.index('{'):src.rindex('}') + 1]
    data = json.loads(body)
    return {scene: {p['id']: p['foot'] for p in v.get('props', [])} for scene, v in data.items()}


GENERATED = _generated_feet()

MASK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/mask'
OUT = os.path.join(ROOT, 'tools', 'shots', 'collision')
SCALE = 0.62          # the audit does not need full resolution


def read_pgm(path):
    with open(path, 'rb') as fh:
        assert fh.readline().strip() == b'P5'
        w, h = map(int, fh.readline().split())
        fh.readline()
        return np.frombuffer(fh.read(w * h), np.uint8).reshape(h, w)


def main():
    meta = json.load(open(os.path.join(MASK, 'meta.json'), encoding='utf8'))
    os.makedirs(OUT, exist_ok=True)
    for scene, info in sorted(meta.items()):
        art = Image.open(os.path.join(ROOT, 'assets', 'scenes', f'{scene}.webp')).convert('RGBA')
        W, H = int(art.width * SCALE), int(art.height * SCALE)
        art = art.resize((W, H), Image.LANCZOS)
        cells = read_pgm(os.path.join(MASK, f'{scene}.pgm'))
        walk = Image.fromarray(cells).resize((W, H), Image.NEAREST)
        tint = np.zeros((H, W, 4), np.uint8)
        tint[np.asarray(walk) > 0] = (40, 255, 90, 92)
        art.alpha_composite(Image.fromarray(tint, 'RGBA'))

        d = ImageDraw.Draw(art)
        P = lambda x, y: (x / 100 * W, y / 100 * H)
        spec = LAYERS[scene]
        for poly in spec['floor']:
            d.line([P(*p) for p in poly + [poly[0]]], fill=(255, 40, 40, 255), width=2)
        for b in spec.get('blocks', []):
            d.rectangle([P(b[0], b[1]), P(b[2], b[3])], outline=(60, 140, 255, 255), width=2)
        for entry in spec['props']:
            # The generated footprint, not the table's: a declared rect is only
            # a minimum now, and most props derive theirs from their own art
            # (tools/build_layers.py). OVER means there is deliberately none.
            foot = GENERATED.get(scene, {}).get(entry[0])
            if foot:
                d.rectangle([P(foot[0], foot[1]), P(foot[2], foot[3])], outline=(255, 220, 0, 255), width=1)
        for name, (x, y) in info['nodes'].items():
            cx, cy = P(x, y)
            spawn = name.startswith('spawn')
            colour = (255, 255, 255, 255) if spawn else (255, 0, 220, 255)
            d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=colour, outline=(0, 0, 0, 255))
            d.text((cx + 7, cy - 6), name.split(':', 1)[1], fill=colour)
        art.convert('RGB').save(os.path.join(OUT, f'{scene}.png'), quality=88)
        print(f'  {scene}: {(cells > 0).mean() * 100:5.1f}% walkable')
    print(f'{len(meta)} scene(s) -> {OUT}')


if __name__ == '__main__':
    main()
