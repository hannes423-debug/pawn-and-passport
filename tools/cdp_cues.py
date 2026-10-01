#!/usr/bin/env python3
"""
tools/cdp_cues.py - hotspots show only as much as the player's distance earns.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_cues.py [390x844]

  1. out of reach (scene.js CUE_RADIUS) a hotspot is not drawn at all
  2. within reach it shows its icon but no words
  3. the words appear only on the spot the A button would use now
  4. an exit at the bottom of the art hangs UNDER the feet at the doorway
     (or sits on the bottom edge when the stage is short), not above the head in the middle of the garden (ist-venue: on the steps,
     which the walk mask does not reach)
  5. on a touch screen no visible marker sits under the joystick or A button
  6. out of reach of everything, A heads for the career's next goal
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402

spec = next((a for a in sys.argv[1:] if "x" in a), "390x844")
W, H = map(int, spec.split("x"))
mobile = min(W, H) < 700
fails = []


def check(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        fails.append(label)


STATE = """(() => {
  const stage = document.querySelector('.pp-scene__stage').getBoundingClientRect();
  const out = {};
  for (const b of document.querySelectorAll('.pp-hotspot')) {
    const r = b.getBoundingClientRect();
    const text = b.querySelector('.pp-hotspot__text, .pp-hotspot__name');
    out[b.getAttribute('aria-label')] = {
      shown: getComputedStyle(b).visibility !== 'hidden' && getComputedStyle(b).opacity !== '0',
      words: !!text && getComputedStyle(text).display !== 'none' && getComputedStyle(text).visibility !== 'hidden',
      near: b.classList.contains('is-near'),
      top: (r.top - stage.top) / stage.height * 100, bottom: (r.bottom - stage.top) / stage.height * 100,
      rect: [r.left, r.top, r.right, r.bottom]
    };
  }
  return out;
})()"""

UNDER_CONTROLS = """(() => {
  const pads = [...document.querySelectorAll('.pp-pad__stick, .pp-pad__action')]
    .map((c) => c.getBoundingClientRect()).filter((c) => c.width);
  return [...document.querySelectorAll('.pp-hotspot')].filter((b) => getComputedStyle(b).visibility !== 'hidden')
    .filter((b) => { const r = b.querySelector('.pp-hotspot__label, .pp-hotspot__bubble').getBoundingClientRect();
      return pads.some((c) => r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top); })
    .map((b) => b.getAttribute('aria-label'));
})()"""


def enter(c, sid):
    c.eval(f"window.__pap.go('scene', {{ sceneId: '{sid}' }}).then(() => 1)", await_promise=True)
    c.wait_for("!!document.querySelector('.pp-actor')", timeout=15)
    c.pump(1.2)


def place(c, x, y):
    c.eval(f"window.__pap.current.debugPlace({x}, {y})")
    c.pump(0.5)
    return c.eval(STATE)


c = cdp.Chrome(W, H)
try:
    c.send("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": mobile})
    if mobile:
        c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    c.goto(); c.eval("localStorage.clear()"); c.goto()
    c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=60)
    c.eval(cdp.NEW_CAREER % ("boy", "nyc"), await_promise=True)
    c.eval("document.head.insertAdjacentHTML('beforeend', '<style>.pp-coach{display:none!important}</style>')")

    # New York garden, standing at the gate.
    enter(c, "nyc-ext")
    s = place(c, 50, 89)
    door, gate = s["Enter: Enter the club"], s["Travel: Leave"]
    check(not door["shown"], "1. at the gate the far club door is not drawn")
    check(gate["shown"] and gate["near"] and gate["words"], "3. the gate A would use shows its words")
    check(gate["top"] >= 89 or gate["bottom"] >= 98,
          f"4. the gate marker hangs under the feet, or sits on the bottom edge ({gate['top']:.1f}-{gate['bottom']:.1f}%)")
    members = [k for k in s if k.startswith("Talk:")]
    check(all(not s[k]["words"] for k in members), "3. no member name while A would use the gate")
    c.shot(f"cues-gate-{spec}")

    # Halfway up the path: the door is in reach, so its icon shows - without words.
    s = place(c, 50, 62)
    door = s["Enter: Enter the club"]
    check(door["shown"] and not door["words"], "2. halfway up the path the door shows its icon, no words")
    near = [k for k, v in s.items() if v["words"]]
    check(len(near) <= 1, f"3. at most one hotspot shows words ({near})")
    label = c.eval("document.querySelector('.pp-keyprompt__label')?.textContent || document.querySelector('.pp-pad__label, .pp-pad__action')?.textContent || ''")
    check("Enter the club" in label, f"6. A heads for the next goal, not a nearby member ({label!r})")
    c.shot(f"cues-path-{spec}")

    # Floor plan: from the entrance the tournament hall is out of reach.
    enter(c, "nyc-int")
    s = place(c, 50, 91)
    check(not s["Play: Tournament hall"]["shown"], "1. from the entrance the tournament hall is not drawn")
    garden = s["Exit: Garden"]
    check(garden["shown"] and (garden["top"] >= 88 or garden["bottom"] >= 98),
          f"4. the Garden exit is on the front steps ({garden['top']:.1f}-{garden['bottom']:.1f}%)")
    if mobile:
        under = c.eval(UNDER_CONTROLS)
        check(not under, f"5. nothing under the joystick or A ({under})")

    # Istanbul tea terrace: the exit marker is on the steps, below the sign.
    enter(c, "ist-venue")
    s = place(c, 50, 63)
    ex = s["Travel: Down the steps"]
    check(ex["shown"] and ex["top"] >= 75, f"4. Istanbul's exit is drawn on the steps (top {ex['top']:.1f}% >= 75%)")
    if mobile:
        under = c.eval(UNDER_CONTROLS)
        check(not under, f"5. nothing under the joystick or A ({under})")
    c.shot(f"cues-istanbul-{spec}")

    for sid, x, y in (("vie-venue", 50, 95), ("che-venue", 60, 93), ("nyc-venue", 50, 96)):
        enter(c, sid)
        s = place(c, x, y)
        ex = next(v for k, v in s.items() if k.startswith("Travel:"))
        check(ex["shown"] and ex["bottom"] <= 100.5 and (ex["top"] >= y - 6 or ex["bottom"] >= 98),
              f"4. {sid}: the exit stays at the bottom edge ({ex['top']:.1f}-{ex['bottom']:.1f}%)")
        if mobile:
            under = c.eval(UNDER_CONTROLS)
            check(not under, f"5. {sid}: nothing under the joystick or A ({under})")

    errs = c.errors()
    check(not errs, f"no console errors ({errs[:3]})")
finally:
    c.close()

print(f"\n{'FAIL' if fails else 'OK'}: {len(fails)} failed")
sys.exit(1 if fails else 0)
