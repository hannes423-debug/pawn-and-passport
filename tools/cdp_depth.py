#!/usr/bin/env python3
"""
tools/cdp_depth.py - layered scenes in the browser: cut-outs, free walking, depth order.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_depth.py [scene ...]

For every scene in js/data/sceneLayers.js:
  - every cut-out is on the stage, stacked at its ground line
  - holding each arrow key moves the player and never ends inside a footprint
  - the player's stacking follows its feet (behind a prop above its base, in front below it)
  - walking to each hotspot triggers it (dialogue, menu or a new scene)
Screenshots: $PAP_SHOTS/depth-<scene>.png
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402

fails = []


def check(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        fails.append(label)


PLAYER = "[...document.querySelectorAll('.pp-actor')].pop()"
c = cdp.Chrome(1280, 960)
try:
    c.goto(settle=3); c.eval("localStorage.clear()"); c.goto(settle=3)
    assert c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=90), "boot"
    scenes = c.eval("import('./js/data/sceneLayers.js').then(m => JSON.stringify(Object.keys(m.SCENE_LAYERS)))", await_promise=True)
    wanted = [a for a in sys.argv[1:]] or json.loads(scenes)
    for sid in wanted:
        club = 'nyc' if sid.startswith('mad') else sid[:3]
        c.eval(cdp.NEW_CAREER % ("girl", club), await_promise=True)
        c.eval(f"window.__pap.go('scene', {{ sceneId: '{sid}' }}).then(() => 1)", await_promise=True)
        c.wait_for("document.querySelectorAll('.pp-prop').length > 0 && document.querySelectorAll('.pp-actor').length > 0", timeout=20)
        c.pump(1)
        print(sid)
        expected = c.eval(f"import('./js/data/sceneLayers.js').then(m => m.SCENE_LAYERS['{sid}'].props.length)", await_promise=True)
        check(c.eval("document.querySelectorAll('.pp-prop').length") == expected, f"{sid}: all {expected} cut-outs on the stage")
        grid_js = f"""Promise.all([import('./js/core/freeWalk.js'), import('./js/data/sceneLayers.js'), import('./js/data/scenes.js')]).then(([F, L, S]) => {{
            const img = document.querySelector('.pp-scene__bg');
            const walker = F.walkerFor(S.sceneById('{sid}').actorHeight ?? 0.1);
            window.__grid = F.createWalkGrid(L.SCENE_LAYERS['{sid}'], {{ aspect: img.naturalWidth / img.naturalHeight, walker }}); return 1; }})"""
        c.eval(grid_js, await_promise=True)
        pos = lambda: json.loads(c.eval(f"JSON.stringify([parseFloat({PLAYER}.style.left), parseFloat({PLAYER}.style.top), +{PLAYER}.style.zIndex])"))
        start = pos()
        moved_any = False
        for key in ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]:
            before = pos()
            c.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": key, "code": key})
            c.pump(0.7)
            c.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": key})
            c.pump(0.25)
            after = pos()
            moved_any = moved_any or abs(after[0] - before[0]) + abs(after[1] - before[1]) > 0.5
            check(c.eval(f"window.__grid.free({after[0]}, {after[1]})"), f"{sid}: {key} ends on walkable floor ({after[0]:.1f}, {after[1]:.1f})")
            check(after[2] == round(after[1] * 10), f"{sid}: player stacked by its feet")
        check(moved_any, f"{sid}: the arrow keys move the player (from {start[0]:.1f}, {start[1]:.1f})")
        c.shot(f"depth-{sid}")
        spots = json.loads(c.eval(f"import('./js/data/scenes.js').then(m => JSON.stringify(m.sceneById('{sid}').hotspots.map(h => h.verb + ': ' + h.label)))", await_promise=True))
        for label in spots:
            c.eval(f"window.__pap.go('scene', {{ sceneId: '{sid}' }}).then(() => 1)", await_promise=True)
            c.wait_for("document.querySelectorAll('.pp-actor').length > 0", timeout=20)
            c.pump(0.6)
            c.eval(f"[...document.querySelectorAll('.pp-hotspot')].find(b => b.getAttribute('aria-label') === {json.dumps(label)}).click()")
            ok = c.wait_for(f"!!document.querySelector('.pp-dialogue, .pp-overlay') || window.__pap.currentName !== 'scene' || !document.querySelector('.pp-scene__bg[src*=\"{sid}\"]')", timeout=25)
            check(ok, f"{sid}: walking to \"{label}\" triggers it")
            c.eval("document.querySelectorAll('.pp-overlay, .pp-dialogue').forEach(e => e.remove())")
    for e in c.errors():
        fails.append(f"console: {e[:160]}")
        print("  CONSOLE", e[:200])
finally:
    c.close()
print(f"\n{len(fails)} failure(s)")
for f in fails:
    print("  FAIL", f)
sys.exit(1 if fails else 0)
