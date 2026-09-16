#!/usr/bin/env python3
"""
tools/cdp_layout.py - does every screen fit its window?

    python3 tools/serve.py 8123 &
    python3 tools/cdp_layout.py              # all viewports
    python3 tools/cdp_layout.py 390x844      # one

The rule: the game window never scrolls. For each viewport x screen it checks
  scroll     the document or the screen element can scroll (or would clip content)
  offscreen  a visible button/input lies outside the window and is not inside a
             panel that scrolls on its own (so the player could never reach it)
  board      the match board keeps the same rectangle while moves are played
Screenshots land in $PAP_SHOTS/layout/<viewport>-<screen>.png.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402

VIEWPORTS = ["390x844", "844x390", "360x640", "640x360", "768x1024", "1024x768", "1280x720", "1440x900"]

PROBE = r"""(() => {
  const vw = innerWidth, vh = innerHeight;
  const out = { vw, vh, problems: [] };
  const doc = document.scrollingElement;
  if (doc.scrollHeight > vh + 1 || doc.scrollWidth > vw + 1) out.problems.push(`page scrolls ${doc.scrollWidth}x${doc.scrollHeight}`);
  const screen = document.querySelector('#app > .pp-screen');
  if (screen && (screen.scrollHeight > screen.clientHeight + 2 || screen.scrollWidth > screen.clientWidth + 2)) {
    out.problems.push(`screen content ${screen.scrollWidth}x${screen.scrollHeight} > ${screen.clientWidth}x${screen.clientHeight}`);
  }
  const scrollsOnItsOwn = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.matches('#app > .pp-screen')) return null;
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return p;
    }
    return null;
  };
  const inView = (r) => r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1;
  const controls = [...document.querySelectorAll('button, select, input, .pp-hotspot, [role=button]')]
    .filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (inView(r)) continue;
    const scroller = scrollsOnItsOwn(el);
    if (scroller && inView(scroller.getBoundingClientRect())) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().slice(0, 30);
    out.problems.push(`offscreen "${label}" at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return JSON.stringify(out);
})()"""

NEW_CAREER = cdp.NEW_CAREER


def run_viewport(spec, failures):
    w, h = map(int, spec.split("x"))
    mobile = min(w, h) < 700
    c = cdp.Chrome(w, h)
    shots = os.path.join(cdp.SHOTS, "layout")
    os.makedirs(shots, exist_ok=True)

    def shot(name):
        data = c.send("Page.captureScreenshot", {"format": "png"})["data"]
        import base64
        with open(os.path.join(shots, f"{spec}-{name}.png"), "wb") as fh:
            fh.write(base64.b64decode(data))

    def check(name):
        c.pump(0.4)
        res = json.loads(c.eval(PROBE))
        shot(name)
        status = "ok" if not res["problems"] else "; ".join(res["problems"][:4]) + (f" (+{len(res['problems']) - 4})" if len(res["problems"]) > 4 else "")
        print(f"  {spec:>9} {name:<18} {status}")
        for p in res["problems"]:
            failures.append(f"{spec} {name}: {p}")

    def go(expr, wait="true", settle=1.0):
        c.eval(f"Promise.resolve({expr}).then(() => 1)", await_promise=True, timeout=60)
        c.wait_for(wait, timeout=20)
        c.pump(settle)

    try:
        c.send("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": mobile})
        if mobile:
            c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        c.goto()
        c.eval("localStorage.clear()")
        c.goto()
        c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=60)
        check("title")
        go("window.__pap.go('create')")
        check("create")
        c.eval(NEW_CAREER % ("girl", "nyc"), await_promise=True)
        go("window.__pap.go('map')", settle=1.5)
        check("map")
        for sid in ["nyc-ext", "nyc-int", "lon-venue"]:
            go(f"window.__pap.go('scene', {{ sceneId: '{sid}' }})", "!!document.querySelector('.pp-actor')")
            check(f"scene-{sid}")
        for tab in ["passport", "openings", "postcards", "career"]:
            go(f"window.__pap.go('journal', {{ tab: '{tab}' }})")
            check(f"journal-{tab}")
        go("window.__pap.go('settings', {})")
        check("settings")
        go("window.__pap.go('ending', { creditsOnly: true })")
        check("credits")
        go("window.__pap.go('puzzle', { missionId: 'm-lon', returnScene: 'lon-venue' })", "document.querySelectorAll('.cwt-piece').length > 0")
        check("puzzle")

        go("""window.__pap.go('match', { kind: 'friendly', colour: 'w', clubId: 'nyc', returnScene: 'nyc-int',
              opponent: { id: 'nyc-x', name: 'Grace Whitfield', elo: 650, style: 'aggressive', openingId: 'italian', look: { sprite: 'adult-brown' } } })""",
           "document.querySelector('.cwt-board')?.dataset.interactive === 'true'", settle=1.5)
        check("match")
        rect = lambda: c.eval("JSON.stringify(document.querySelector('.pp-boardframe').getBoundingClientRect())")
        before = rect()
        for uci in ["e2e4", "g1f3", "f1c4"]:
            c.wait_for("document.querySelector('.cwt-board')?.dataset.interactive === 'true'", timeout=60)
            c.eval(f"window.__pap.current.match.playMove('{uci}').then(() => 1)", await_promise=True, timeout=60)
            c.pump(1.2)
        c.wait_for("document.querySelector('.cwt-board')?.dataset.interactive === 'true'", timeout=60)
        c.eval("document.querySelector('.pp-hintbtn').click()")
        c.wait_for("!!document.querySelector('.cwt-arrow--hint')", timeout=40)
        c.pump(3)
        after = rect()
        if before != after:
            failures.append(f"{spec} match: board moved {before} -> {after}")
            print(f"  {spec:>9} board MOVED {before} -> {after}")
        else:
            print(f"  {spec:>9} board still")
        check("match-mid")
        errs = c.errors()
        for e in errs:
            failures.append(f"{spec} console: {e[:160]}")
    finally:
        c.close()


def main():
    wanted = [a for a in sys.argv[1:] if "x" in a] or VIEWPORTS
    failures = []
    for spec in wanted:
        run_viewport(spec, failures)
    print(f"\n{len(failures)} problem(s)")
    for f in failures:
        print("  FAIL", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
