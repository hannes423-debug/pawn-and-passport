#!/usr/bin/env python3
"""tools/dev/audit_depth.py [scene ...] - bodies where depth goes wrong, in the REAL render.

    python3 tools/serve.py 8123 &
    python3 tools/dev/audit_depth.py                 # all 24 scenes
    python3 tools/dev/audit_depth.py lon-int vie-int

Depth errors show up where a player stands BETWEEN objects: right behind one
thing and right in front of another, or on floor that is walked round an
object from both sides. This picks such foot spots from the walk mask (the
game's own walk grid: js/data/sceneLayers.js, so only spots a player can
reach), stands a magenta body on each in the real game (atlas + CSS, z =
2*round(10*feet)+1 like scene.js actors) and saves the whole scene to
tools/shots/audit/<scene>.png, each body numbered, for a person to read:
a body BEHIND something must be cut by it, a body IN FRONT must be whole.
"""
import base64
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import cdp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'tools', 'shots', 'audit')


def layers():
    t = open(os.path.join(ROOT, 'js', 'data', 'sceneLayers.js')).read()
    return json.loads(t[t.index('{', t.index('SCENE_LAYERS')):t.rindex('};') + 1])


def walk_grid(d):
    """The game's walk grid (freeWalk.solidFromWalk): per row a comma list of
    run lengths, blocked first, then floor, alternating. True = floor."""
    cols, rows = d['walk']['cols'], d['walk']['rows']
    g = np.zeros((rows, cols), bool)
    for r, line in enumerate(d['walk']['rle']):
        x = 0
        for k, n in enumerate(int(v) for v in line.split(',')):
            if k % 2 == 1:
                g[r, x:x + n] = True
            x += n
    return g


def spots(d, actor_h, cap=36):
    """Feet (percent) between objects: blocked within an actor height above AND
    below, or right behind something (blocked just below)."""
    g = walk_grid(d)
    R, C = g.shape
    ah = max(2, int(actor_h * R))
    hw = max(1, int(0.011 * C))
    # where a body fits: eroded like the game's walker (feet only)
    from scipy import ndimage
    fit = ndimage.binary_erosion(g, structure=np.ones((3, 2 * hw + 1)))
    blocked = ~g
    up = np.zeros_like(g)
    down = np.zeros_like(g)
    near = np.zeros_like(g)
    for k in range(1, ah + 1):
        up[k:] |= blocked[:-k]
        down[:-k] |= blocked[k:]
    for k in range(1, max(2, ah // 4) + 1):
        near[:-k] |= blocked[k:]
    score = fit & ((up & down) * 2 + near)
    ys, xs = np.nonzero(score)
    order = np.argsort(-score[ys, xs] + np.random.RandomState(0).rand(len(ys)) * 0.5)
    picked = []
    minx, miny = 0.045 * C, 0.6 * ah
    for i in order:
        y, x = ys[i], xs[i]
        if all(abs(x - px) > minx or abs(y - py) > miny for px, py in picked):
            picked.append((x, y))
            if len(picked) >= cap:
                break
    return [((x + 0.5) / C * 100, (y + 0.9) / R * 100) for x, y in picked]


def run(scenes):
    os.makedirs(OUT, exist_ok=True)
    all_layers = layers()
    global HEIGHTS
    import build_occlusion as bo
    HEIGHTS = bo.scene_actor_heights()
    c = cdp.Chrome(1600, 1250)
    try:
        c.send("Emulation.setDeviceMetricsOverride", {"width": 1600, "height": 1250, "deviceScaleFactor": 1, "mobile": False})
        c.goto(); c.eval("localStorage.clear()"); c.goto()
        c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=90)
        c.eval(cdp.NEW_CAREER % ("girl", "nyc"), await_promise=True)
        for sid in scenes:
            c.eval(f"Promise.resolve(window.__pap.go('scene', {{ sceneId: '{sid}' }})).then(() => 1)", await_promise=True, timeout=60)
            c.wait_for(f"!!document.querySelector('.pp-actor') && !!document.querySelector('.pp-scene__bg[src*=\"{sid}\"]')", timeout=30)
            c.pump(2.5)
            c.eval("document.querySelectorAll('.pp-overlay, .pp-dialogue, .pp-scene__labels, .pp-scene__dock, .pp-actor').forEach(e => e.remove())")
            c.eval("(() => { const s = document.querySelector('.pp-scene__viewport'); s.style.left = '0px'; s.style.right = '0px'; s.style.top = '0px'; s.style.bottom = '0px'; window.dispatchEvent(new Event('resize')); })()")
            c.pump(1.0)
            actor_h = HEIGHTS[sid]
            feet = spots(all_layers[sid], actor_h)
            H = max(40 / 1250, actor_h)
            for i, (fx, fy) in enumerate(feet):
                c.eval(f"""(() => {{ const d = document.createElement('div');
                  Object.assign(d.style, {{ position: 'absolute', left: '{fx - H * 22 * 0.75}%', top: '{fy - H * 92}%',
                    width: '{H * 44 * 0.75}%', height: '{H * 92}%', background: '#f0f', outline: '1px solid #000',
                    zIndex: String(2 * Math.round(10 * {fy}) + 1) }});
                  document.querySelector('.pp-scene__actors').append(d); }})()""")
            c.pump(0.8)
            r = json.loads(c.eval("JSON.stringify((() => { const r = document.querySelector('.pp-scene__stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height] })())"))
            png = Image.open(io.BytesIO(base64.b64decode(c.send("Page.captureScreenshot", {"format": "png"})["data"]))).convert('RGB')
            L, T, Wd, Ht = r
            crop = png.crop((int(max(0, L)), int(max(0, T)), int(L + Wd), int(T + Ht)))
            dr = ImageDraw.Draw(crop)
            for i, (fx, fy) in enumerate(feet):
                x, y = fx / 100 * crop.width, fy / 100 * crop.height
                dr.ellipse((x - 2, y - 2, x + 2, y + 2), fill='yellow')
                dr.text((x + 4, y - 10), str(i), fill='yellow')
            crop.save(os.path.join(OUT, f'{sid}.png'))
            with open(os.path.join(OUT, f'{sid}.json'), 'w') as fh:
                json.dump([[round(a, 2), round(b, 2)] for a, b in feet], fh)
            print(f'{sid:10} {len(feet):3} bodies -> tools/shots/audit/{sid}.png', flush=True)
    finally:
        c.close()


if __name__ == '__main__':
    names = sys.argv[1:]
    if not names:
        sys.path.insert(0, os.path.dirname(HERE))
        import build_occlusion as bo
        names = bo.SCENES
    run(names)
