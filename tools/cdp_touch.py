#!/usr/bin/env python3
"""
tools/cdp_touch.py - the touch controls, driven with real CDP touch events.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_touch.py

Landscape phone (844x390, touch emulation): the joystick walks the nyc-int
waypoint graph (up to the stairs, a short push down stops ON mid, right to the
hall), A uses the hotspot underfoot (the tournament desk opens). Then portrait
(390x844): a tap on a guide-arrow square shows the opening card.
Press timing through CDP is loose (a "short" press lasted 1.4 s once), so
releases wait on the player's POSITION, never on a sleep.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp
W,H = 844, 390
c = cdp.Chrome(W, H)
fails = []
def touch(kind, x=None, y=None):
    pts = [] if x is None else [{"x": x, "y": y, "id": 1}]
    c.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})
def player():
    return c.eval("(() => { const a=[...document.querySelectorAll('.pp-actor')].pop(); return [parseFloat(a.style.left), parseFloat(a.style.top)]; })()")
try:
    c.send("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": True})
    c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    c.goto(); c.eval("localStorage.clear()"); c.goto()
    c.wait_for("!!document.querySelector('.pp-title__item')")
    c.eval(cdp.NEW_CAREER % ("girl", "nyc"), await_promise=True)
    c.eval("window.__pap.go('scene', { sceneId: 'nyc-int' }).then(() => 1)", await_promise=True)
    c.wait_for("!!document.querySelector('.pp-actor')", timeout=10); c.pump(1)
    print("data-touch", c.eval("document.documentElement.dataset.touch"), "pad visible", c.eval("getComputedStyle(document.querySelector('.pp-pad')).display"))
    # the player sprite is created last
    r = c.eval("JSON.stringify(document.querySelector('.pp-pad__base').getBoundingClientRect())")
    r = json.loads(r); cx, cy = r['x']+r['width']/2, r['y']+r['height']/2
    p0 = player(); print("start", p0, "A:", c.eval("document.querySelector('.pp-pad__label').textContent"))
    touch("touchStart", cx, cy); c.pump(0.1)
    for i in range(1, 6): touch("touchMove", cx, cy - i*10); c.pump(0.03)
    c.pump(2.5)
    p1 = player(); print("after stick up", p1, "active", c.eval("document.querySelector('.pp-pad__stick').classList.contains('is-active')"))
    c.shot("t1-stick-held")
    touch("touchEnd"); c.pump(0.8)
    p2 = player(); print("released", p2, "A:", c.eval("document.querySelector('.pp-pad__label').textContent"), "ready", c.eval("document.querySelector('.pp-pad__action').classList.contains('is-ready')"))
    if not p1[1] < p0[1] - 5: fails.append("stick up did not walk up")
    # tap down briefly: the link in progress finishes, so the player stops ON the mid node
    touch("touchStart", cx, cy); touch("touchMove", cx, cy + 50)
    c.wait_for("parseFloat([...document.querySelectorAll('.pp-actor')].pop().style.top) > 20", timeout=10, step=0.02)
    touch("touchEnd"); c.pump(2.0)
    pm = player(); print("after short down", pm, "A:", c.eval("document.querySelector('.pp-pad__label').textContent"))
    if not pm[1] > p2[1] + 5: fails.append("short down did not move")
    # hold right: mid -> hallDoor -> hall
    touch("touchStart", cx, cy)
    for i in range(1, 6): touch("touchMove", cx + i*10, cy); c.pump(0.03)
    c.pump(3.0); touch("touchEnd"); c.pump(1.0)
    p3 = player(); lab = c.eval("document.querySelector('.pp-pad__label').textContent")
    print("after stick right", p3, "A:", lab, "ready", c.eval("document.querySelector('.pp-pad__action').classList.contains('is-ready')"))
    if not p3[0] > pm[0] + 5: fails.append("stick right did not walk right")
    if lab != "Play": fails.append(f"expected A=Play at the hall, got {lab}")
    a = json.loads(c.eval("JSON.stringify(document.querySelector('.pp-pad__action b').getBoundingClientRect())"))
    touch("touchStart", a['x']+a['width']/2, a['y']+a['height']/2); c.pump(0.05); touch("touchEnd")
    ok = c.wait_for("!!document.querySelector('.pp-overlay, .pp-dialogue')", timeout=15)
    print("A opened", ok, c.eval("(document.querySelector('.pp-overlay h2, .pp-dialogue__name')||{}).textContent"))
    c.pump(1); c.shot("t2-after-A")
    if not ok: fails.append("A did not open anything")
    for e in c.errors(): print("CONSOLE", e); fails.append(e)
finally:
    c.close()

W, H = 390, 844
c = cdp.Chrome(W, H)
try:
    c.send("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 2, "mobile": True})
    c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    c.goto(); c.eval("localStorage.clear()"); c.goto()
    c.wait_for("!!document.querySelector('.pp-title__item')")
    c.eval(cdp.NEW_CAREER % ("girl", "nyc"), await_promise=True)
    c.eval("""window.__pap.go('match', { kind: 'friendly', colour: 'w', clubId: 'nyc', returnScene: 'nyc-int',
      opponent: { id: 'x', name: 'Bot', elo: 800, style: 'balanced', openingId: 'italian' } }).then(() => 1)""", await_promise=True)
    c.pump(4)
    r = json.loads(c.eval("JSON.stringify(document.querySelector('.cwt-board').getBoundingClientRect())"))
    sq = r['width']/8; x = r['x'] + 4.5*sq; y = r['y'] + 6.5*sq   # e2
    for t in ("touchStart", "touchEnd"):
        c.send("Input.dispatchTouchEvent", {"type": t, "touchPoints": [{"x": x, "y": y, "id": 1}] if t == "touchStart" else []}); c.pump(0.1)
    c.pump(0.5)
    visible = c.eval("!document.querySelector('.pp-tip').hidden")
    if not visible: fails.append("tap on a guide square showed no opening card")
    print("tip visible", c.eval("!document.querySelector('.pp-tip').hidden"), c.eval("document.querySelector('.pp-tip').textContent.slice(0,80)"))
    print("kind first", c.eval("[...document.querySelectorAll('.pp-match__kind,.pp-match__opp,.pp-match__board')].map(e=>Math.round(e.getBoundingClientRect().top)).join(',')"))
    c.shot("t3-tip-portrait")
    c.eval("window.__pap.go('puzzle', { missionId: 'm-lon', returnScene: 'lon-venue' }).then(() => 1)", await_promise=True); c.pump(2)
    c.shot("t4-puzzle-portrait")
    for e in c.errors(): print("CONSOLE", e); fails.append(e)
finally:
    c.close()

print(f"\n{len(fails)} failure(s)")
for f in fails:
    print("  FAIL", f)
sys.exit(1 if fails else 0)
