#!/usr/bin/env python3
"""
tools/cdp_dock.py - the scene's actions panel never covers the map, and hides.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_dock.py              # all viewports
    python3 tools/cdp_dock.py 390x844      # one

Per viewport x scene:
  cover    the OPEN panel overlaps the visible stage (stage rect clipped to the
           viewport) - on a phone this hid the Tournament / Upstairs labels
  top      the stage's top edge is cut off (not in camera mode's sideways pan)
  hide     the Hide button / H key does not collapse the panel, or the stage
           does not grow back to use the freed room
  keep     the hidden state is not remembered on the next scene
Screenshots: $PAP_SHOTS/dock/<viewport>-<scene>-<open|hidden>.png
"""

import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402
from cdp_layout import INSETS, NEW_CAREER  # noqa: E402

VIEWPORTS = ["390x844@ios", "844x390@ios", "360x640", "640x360", "768x1024", "1024x768", "1280x720", "1440x900"]
SCENES = ["nyc-ext", "nyc-int", "vie-venue", "mad-int"]

PROBE = r"""(() => {
  const dock = document.querySelector('.pp-scene__dock');
  const stage = document.querySelector('.pp-scene__stage').getBoundingClientRect();
  const vp = document.querySelector('.pp-scene__viewport').getBoundingClientRect();
  const panel = dock.querySelector('.pp-panel');
  const vis = { l: Math.max(stage.left, vp.left), t: Math.max(stage.top, vp.top), r: Math.min(stage.right, vp.right), b: Math.min(stage.bottom, vp.bottom) };
  const p = panel.offsetParent ? panel.getBoundingClientRect() : null;
  const cover = p ? Math.max(0, Math.min(p.right, vis.r) - Math.max(p.left, vis.l)) * Math.max(0, Math.min(p.bottom, vis.b) - Math.max(p.top, vis.t)) : 0;
  return JSON.stringify({ open: !!p, collapsed: dock.classList.contains('is-collapsed'), cover: Math.round(cover),
    coverPct: Math.round(1000 * cover / Math.max(1, (vis.r - vis.l) * (vis.b - vis.t))) / 10,
    stageTop: Math.round(stage.top), vpTop: Math.round(vp.top), stageH: Math.round(stage.height), vpH: Math.round(vp.height),
    camera: document.querySelector('.pp-scene__viewport').classList.contains('is-camera') });
})()"""


def run_viewport(spec, failures):
    size, _, profile = spec.partition("@")
    w, h = map(int, size.split("x"))
    mobile = min(w, h) < 700
    c = cdp.Chrome(w, h)
    shots = os.path.join(cdp.SHOTS, "dock")
    os.makedirs(shots, exist_ok=True)

    def shot(name):
        with open(os.path.join(shots, f"{spec}-{name}.png"), "wb") as fh:
            fh.write(base64.b64decode(c.send("Page.captureScreenshot", {"format": "png"})["data"]))

    def probe():
        c.pump(0.4)
        return json.loads(c.eval(PROBE))

    def fail(what):
        print(f"  {spec:>11} FAIL {what}")
        failures.append(f"{spec} {what}")

    try:
        c.send("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": mobile})
        if profile == "ios":
            c.send("Emulation.setSafeAreaInsetsOverride", {"insets": INSETS[size]})
        if mobile:
            c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        c.goto()
        c.eval("localStorage.clear()")
        c.goto()
        c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=60)
        c.eval(NEW_CAREER % ("girl", "nyc"), await_promise=True)
        for i, sid in enumerate(SCENES):
            c.eval(f"Promise.resolve(window.__pap.go('scene', {{ sceneId: '{sid}' }})).then(() => 1)", await_promise=True, timeout=60)
            c.wait_for("!!document.querySelector('.pp-actor')", timeout=20)
            c.pump(1.0)
            if i == 0:
                a = probe()
                shot(f"{sid}-open")
                if not a["open"]:
                    fail(f"{sid}: panel not open by default")
                if a["cover"] > 0:
                    fail(f"{sid}: open panel covers {a['coverPct']}% of the visible stage ({a['cover']} px)")
                if a["stageTop"] < a["vpTop"] - 1:
                    fail(f"{sid}: stage top cut off ({a['stageTop']} < {a['vpTop']})")
                c.eval("document.querySelector('.pp-scene__toggle').click()")
                b = probe()
                shot(f"{sid}-hidden")
                if b["open"] or not b["collapsed"]:
                    fail(f"{sid}: Hide button did not collapse the panel")
                if b["stageH"] < a["stageH"]:
                    fail(f"{sid}: stage shrank after hiding ({a['stageH']} -> {b['stageH']})")
                c.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }))")
                if not probe()["open"]:
                    fail(f"{sid}: H did not reopen the panel")
                c.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }))")
                print(f"  {spec:>11} {sid:<10} open cover {a['coverPct']}%  stageH {a['stageH']} -> hidden {b['stageH']}"
                      f"{'  camera' if a['camera'] else ''}")
            elif i == 1:
                r = probe()
                if r["open"]:
                    fail(f"{sid}: hidden state not kept across scenes")
                c.eval("document.querySelector('.pp-scene__toggle').click()")
            else:
                r = probe()
                shot(f"{sid}-open")
                if r["cover"] > 0:
                    fail(f"{sid}: open panel covers {r['coverPct']}% of the visible stage")
                if r["stageTop"] < r["vpTop"] - 1:
                    fail(f"{sid}: stage top cut off")
                print(f"  {spec:>11} {sid:<10} open cover {r['coverPct']}%  stageH {r['stageH']}{'  camera' if r['camera'] else ''}")
    finally:
        c.close()


def main():
    specs = sys.argv[1:] or VIEWPORTS
    failures = []
    for spec in specs:
        run_viewport(spec if "@" in spec or spec not in ("390x844", "844x390") else spec + "@ios", failures)
    print(f"\n{len(failures)} failure(s)")
    for f in failures:
        print("  " + f)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
