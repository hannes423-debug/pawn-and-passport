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
  overlap    two separate UI boxes (panels, HUD, pad, map card) cover each other
  inset      something interactive sits under the iPhone status bar / home bar
             (the @ios viewports emulate those safe-area insets)
Screenshots land in $PAP_SHOTS/layout/<viewport>-<screen>.png.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402

VIEWPORTS = ["390x844@ios", "844x390@ios", "360x640", "640x360", "768x1024", "1024x768", "1280x720", "1440x900"]
INSETS = {"390x844": {"top": 47, "bottom": 34, "left": 0, "right": 0}, "844x390": {"top": 0, "bottom": 21, "left": 47, "right": 47}}

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
  // Separate UI boxes must not cover each other (a modal overlay is exempt: covering is its job).
  const boxes = [...document.querySelectorAll('.pp-hud, .pp-panel, .pp-pad__stick, .pp-pad__action, .pp-map__card, .pp-map__legend, .pp-scene__dock, .pp-title__item, .pp-title__logo')]
    .filter((el) => el.offsetParent !== null && !el.closest('.pp-overlay, .pp-dialogue') && getComputedStyle(el).visibility !== 'hidden')
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
    const a = boxes[i], b = boxes[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const hgt = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 4 && hgt > 4 && w * hgt > 120) {
      const name = (el) => (el.className || el.tagName).toString().split(' ').filter((c) => c.startsWith('pp-')).slice(0, 2).join('.');
      out.problems.push(`overlap ${name(a)} x ${name(b)} (${Math.round(w)}x${Math.round(hgt)})`);
    }
  }
  // World labels must not hide under the HUD or the touch controls.
  const blockers = [...document.querySelectorAll('.pp-hud, .pp-pad__stick, .pp-pad__action')]
    .filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden').map((el) => [el.className.split(' ')[0], el.getBoundingClientRect()]);
  for (const label of document.querySelectorAll('.pp-hotspot__label')) {
    const r = label.getBoundingClientRect();
    if (!r.width || r.right < 0 || r.left > vw) continue;          // off camera: walked into view later
    for (const [name, b] of blockers) {
      const w = Math.min(r.right, b.right) - Math.max(r.left, b.left);
      const hh = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      if (w > 6 && hh > 6) out.problems.push(`label "${label.textContent.trim().slice(0, 24)}" under ${name}`);
    }
  }
  const inset = (side) => { const d = document.createElement('div'); d.style.cssText = `position:fixed;padding-top:env(safe-area-inset-${side})`; document.body.append(d); const v = parseFloat(getComputedStyle(d).paddingTop) || 0; d.remove(); return v; };
  const safe = { top: inset('top'), bottom: inset('bottom'), left: inset('left'), right: inset('right') };
  const inView = (r) => r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1;
  const controls = [...document.querySelectorAll('button, select, input, .pp-hotspot, [role=button]')]
    .filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (inView(r)) {
      const scroller = scrollsOnItsOwn(el);
      const under = r.top < safe.top - 1 || r.bottom > vh - safe.bottom + 1 || r.left < safe.left - 1 || r.right > vw - safe.right + 1;
      if (under && !scroller) {
        const label = (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().slice(0, 30);
        out.problems.push(`inset "${label}" under the status/home bar`);
      }
      continue;
    }
    const scroller = scrollsOnItsOwn(el) || el.closest('.pp-map__area.is-pannable, .pp-scene__viewport.is-camera');
    if (scroller && inView(scroller.getBoundingClientRect())) continue;  // reached by scrolling, panning or walking
    const label = (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().slice(0, 30);
    out.problems.push(`offscreen "${label}" at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return JSON.stringify(out);
})()"""

NEW_CAREER = cdp.NEW_CAREER


def run_viewport(spec, failures):
    size, _, profile = spec.partition("@")
    w, h = map(int, size.split("x"))
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
        if profile == "ios":
            c.send("Emulation.setSafeAreaInsetsOverride", {"insets": INSETS[size]})
        if mobile:
            c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        c.goto()
        c.eval("localStorage.clear()")
        c.goto()
        c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=60)
        check("title")
        # The creator is two pages and BOTH have to fit: the city list living
        # on page 2 is the only reason it fits at all, so checking page 1
        # alone would pass the screen that used to be broken.
        go("window.__pap.go('create')")
        check("create")
        go("[...document.querySelectorAll('.pp-create__go .pp-btn')].find(b => b.offsetParent && /Next/.test(b.textContent)).click()",
           "!document.querySelector('.pp-create__cities').hidden")
        check("create-city")
        c.eval(NEW_CAREER % ("girl", "nyc"), await_promise=True)
        go("window.__pap.go('map')", settle=1.5)
        check("map")
        for sid in ["nyc-ext", "nyc-int", "lon-venue", "che-venue", "vie-venue", "mad-int"]:
            go(f"window.__pap.go('scene', {{ sceneId: '{sid}' }})", "!!document.querySelector('.pp-actor')")
            check(f"scene-{sid}")
        for tab in ["passport", "openings", "postcards", "career"]:
            go(f"window.__pap.go('journal', {{ tab: '{tab}' }})")
            check(f"journal-{tab}")
        go("window.__pap.go('settings', {})")
        check("settings")
        go("window.__pap.go('ending', { creditsOnly: true })")
        check("credits")
        go("window.__pap.go('drill', { openingId: 'italian', clubId: 'nyc', returnScene: 'nyc-int' })", "document.querySelectorAll('.cwt-piece').length > 0")
        check("drill")
        # The real ending, on a finished campaign (a copy: the career is restored after).
        c.eval("""(() => { window.__saved = JSON.stringify(window.__pap.career); const c = window.__pap.career;
          c.completed = true; c.finale.won = true; c.finale.unlocked = true;
          for (const id of ['nyc','lon','vie','ist','che','wen']) c.trophies[id] = { wonAt: 1, starElo: 900, tier: 0 }; })()""")
        go("window.__pap.go('ending', {})")
        check("ending")
        c.eval("window.__pap.career = JSON.parse(window.__saved)")
        go("window.__pap.go('puzzle', { missionId: 'm-lon', returnScene: 'lon-venue' })", "document.querySelectorAll('.cwt-piece').length > 0")
        check("puzzle")

        go("window.__pap.go('practice', { clubId: 'nyc', returnScene: 'nyc-int' })", "!!document.querySelector('.pp-tree__lesson')")
        check("practice-tree")
        for step in ["read", "watch", "solve"]:
            go(f"window.__pap.go('lesson', {{ lessonId: 'fork', clubId: 'nyc', returnScene: 'nyc-int', step: '{step}' }})",
               "document.querySelectorAll('.cwt-piece').length > 0")
            check(f"lesson-{step}")

        go("""window.__pap.go('match', { kind: 'friendly', colour: 'w', clubId: 'nyc', returnScene: 'nyc-int',
              opponent: { id: 'nyc-x', name: 'Grace Whitfield', elo: 650, style: 'aggressive', openingId: 'italian', look: { sprite: 'young-red' } } })""",
           "document.querySelector('.cwt-board')?.dataset.interactive === 'true'", settle=1.5)
        check("match")
        # A tip that names a host must END UP in that host. The match asks
        # for its tip while the screen is still being built, so the host is
        # not in the document yet; the fallback used to keep the `--inline`
        # class while appending to <body>, which is position:static - the
        # tip lost its fixed placement and the safe-area offsets with it,
        # and landed in the top-left corner under the notch.
        coach = json.loads(c.eval("(() => { const el = document.querySelector('.pp-coach');\n          if (!el) return JSON.stringify({ none: true });\n          return JSON.stringify({ none: false, inline: el.classList.contains('pp-coach--inline'),\n            inPanel: !!el.closest('.pp-match__right'), fixed: getComputedStyle(el).position === 'fixed' }); })()"))
        if coach["none"]:
            failures.append(f"{spec} match: no coach tip to check")
        elif coach["inline"] != coach["inPanel"]:
            failures.append(f"{spec} match: coach inline={coach['inline']} but inside the panel={coach['inPanel']}")
        elif not coach["inline"] and not coach["fixed"]:
            failures.append(f"{spec} match: a hostless coach must be position:fixed")
        else:
            print(f"  {spec:>9} {'coach-placement':<18} ok")
        rect = lambda: c.eval("JSON.stringify(document.querySelector('.pp-boardframe').getBoundingClientRect())")
        before = rect()
        for uci in ["e2e4", "g1f3", "f1c4"]:
            c.wait_for("document.querySelector('.cwt-board')?.dataset.interactive === 'true'", timeout=60)
            c.eval(f"window.__pap.current.match.playMove('{uci}').then(() => 1)", await_promise=True, timeout=60)
            c.pump(1.2)
        c.wait_for("document.querySelector('.cwt-board')?.dataset.interactive === 'true'", timeout=60)
        c.eval("document.querySelector('.pp-hintbtn').click()")
        c.wait_for("!!document.querySelector('[class*=cwt-arrow--hint-]') || !!document.querySelector('.pp-hint-card:not([hidden])')", timeout=40)
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
