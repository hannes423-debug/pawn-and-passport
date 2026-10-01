#!/usr/bin/env python3
"""
tools/cdp_promote.py - promotion by TAP-TAP on a touch phone (real CDP touches).

    python3 tools/serve.py 8123 &
    python3 tools/cdp_promote.py

The pick opens on the board's pointerup, and the tap's own click then lands on
the new overlay; it used to dismiss it (move lost) or choose for the player.
Checks: the pick stays up after tap e7, tap e8; tapping Knight plays e8=N.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp
W, H = 390, 844
FEN = "k7/4P3/8/8/8/8/8/K7 w - - 0 1"
c = cdp.Chrome(W, H)
fails = []
def tap(x, y):
    c.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 1}]})
    c.pump(0.05)
    c.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    c.pump(0.4)
def centre(sel):
    r = json.loads(c.eval(f"JSON.stringify(document.querySelector({json.dumps(sel)}).getBoundingClientRect())"))
    return r['x'] + r['width'] / 2, r['y'] + r['height'] / 2
try:
    c.send("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 2, "mobile": True})
    c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    c.goto(); c.eval("localStorage.clear()"); c.goto()
    c.wait_for("!!window.__pap")
    c.eval(cdp.NEW_CAREER % ("boy", "ist"), await_promise=True)
    c.eval("""window.__pap.go('match', { kind: 'friendly', colour: 'w', clubId: 'ist', returnScene: 'ist-int',
             opponent: { id: 'ist-deniz', name: 'Deniz Arslan', elo: 650, style: 'aggressive', openingId: 'sicilian',
                         look: { sprite: 'young-red' } } }).then(() => 1)""", await_promise=True)
    c.wait_for("document.querySelectorAll('.cwt-piece').length === 32", timeout=20)
    c.wait_for("!!(document.querySelector('.pp-hintbtn') && !Array.from(document.querySelectorAll('.pp-thinking')).some(e => e.style.visibility === 'visible'))", timeout=40)
    c.eval(f"""(async () => {{
      const {{ createRules }} = await import('./js/chess/core/rules.js');
      const cur = window.__pap.current;
      cur.match.game.rules = createRules({json.dumps(FEN)});
      cur.board.renderer.render({json.dumps(FEN)});
      return 1; }})()""", await_promise=True)
    c.pump(0.5)
    tap(*centre('.cwt-board [data-square="e7"]'))
    tap(*centre('.cwt-board [data-square="e8"]'))
    c.pump(0.5)
    up = c.eval("!!document.querySelector('.pp-overlay .pp-modal')")
    print("pick open after tap-tap:", up, c.shot("promote-pick"))
    if not up: fails.append("promotion pick did not stay open after tap-tap")
    else:
        tap(*centre('.pp-overlay .pp-modal .pp-btn:nth-child(4)'))  # Knight
        c.pump(1)
        fen = c.eval("window.__pap.current.match.game.fen")
        print("fen after Knight:", fen)
        if not fen.startswith("k3N3/"): fails.append(f"Knight tap did not play e8=N: {fen}")
    for e in c.errors(): print("CONSOLE", e); fails.append(e)
finally:
    c.close()
print("FAIL" if fails else "PASS", fails)
sys.exit(1 if fails else 0)
