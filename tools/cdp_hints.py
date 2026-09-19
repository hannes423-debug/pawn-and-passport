#!/usr/bin/env python3
"""
tools/cdp_hints.py - the Focus hint rolls in a real match, with Stockfish.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_hints.py [390x844]

  1. a level-15 hint with rolls forced to gold / purple / green draws three
     arrows and squares in those colours, and the hint card lists the rolls
  2. playing the gold plan's move grades FOCUS (no Focus back), and after the
     opponent's reply the plan's second move appears by itself, numbered 2
  3. a hint whose rolls all fail shows nothing and gives Focus back
  4. the opening guide is drawn blue
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402

spec = next((a for a in sys.argv[1:] if "x" in a), "1280x800")
W, H = map(int, spec.split("x"))
mobile = min(W, H) < 700
fails = []


def check(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        fails.append(label)


c = cdp.Chrome(W, H)
try:
    c.send("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": mobile})
    c.goto(); c.eval("localStorage.clear()"); c.goto()
    c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=60)
    c.eval(cdp.NEW_CAREER % ("boy", "nyc"), await_promise=True)
    c.eval("window.__pap.career.level = 15; window.__pap.career.openings.italian = 100")
    c.eval("window.__pap.go('match', { kind: 'friendly', colour: 'w', clubId: 'nyc', returnScene: 'nyc-int', opponent: { id: 'nyc-tony', name: 'Tony Delgado', elo: 900, style: 'balanced', openingId: 'italian', look: { sprite: 'young-blue' } } }).then(() => 1)", await_promise=True)
    c.wait_for("!!window.__pap.current?.match && window.__pap.current.match.status === 'active'", timeout=60)
    c.pump(1.5)
    guide = c.eval("document.querySelectorAll('.cwt-arrow--book').length")
    colour = c.eval("getComputedStyle(document.querySelector('.cwt-arrow--book')).color")
    check(guide >= 1 and colour == "rgb(19, 207, 252)", f"the opening guide is blue ({guide} arrows, {colour})")

    # 1. forced rolls: gold, purple, green
    c.eval("""(() => { const seq = [0.99, 0.6, 0.2]; let i = 0; window.__rolls = () => seq[i++ % 3]; })()""")
    r = c.eval("window.__pap.current.match.requestHint(window.__rolls).then(r => ({ ok: r.ok, q: r.hint.plans.map(p => p.quality), cost: r.hint.quote.cost }))", await_promise=True, timeout=90)
    c.pump(0.6)
    print("  hint:", r)
    counts = c.eval("['green','purple','gold'].map(q => document.querySelectorAll('.cwt-arrow--hint-' + q).length)")
    squares = c.eval("['green','purple','gold'].map(q => document.querySelectorAll('.cwt-sq.is-hint-' + q).length)")
    check(r["ok"] and counts == [1, 1, 1], f"one arrow per colour: green/purple/gold = {counts}")
    check(squares == [1, 1, 1], f"and a coloured square each = {squares}")
    card = c.eval("document.querySelector('.pp-hint-card').textContent")
    check("Gold" in card and "Purple" in card and "Green" in card, f"the hint card lists the rolls ({card[:90]!r})")
    c.shot(f"h1-rolls-{spec}")

    # 2. follow the gold plan
    gold = c.eval("window.__pap.current.match.hint.plans.find(p => p.quality === 'gold').uci")
    focus_before = c.eval("window.__pap.current.match.focus")
    c.eval(f"window.__pap.current.match.playMove('{gold}')")
    ok = c.wait_for("document.querySelectorAll('.cwt-arrow--hint-gold').length === 1 && window.__pap.current.match.isPlayersTurn", timeout=60)
    badge = c.eval("document.querySelector('.cwt-arrow--hint-gold .cwt-arrow__badge text')?.textContent")
    check(ok and badge == "2", f"after the reply the gold plan's move 2 appears by itself (badge {badge})")
    c.wait_for("/Focus/.test(document.querySelector('.pp-match__moves .pp-small')?.textContent || '')", timeout=40)
    last = c.eval("document.querySelector('.pp-match__moves .pp-small').textContent")
    check("Focus" in last and "no Focus back" in last, f"the hinted move is graded FOCUS ({last!r})")
    focus_after = c.eval("window.__pap.current.match.focus")
    check(focus_after == focus_before, f"following the best idea gave no Focus back ({focus_before} -> {focus_after})")
    c.shot(f"h2-continuation-{spec}")

    # 3. all rolls fail
    c.eval("window.__pap.current.match.hint = null")
    before = c.eval("window.__pap.current.match.focus")
    r = c.eval("window.__pap.current.match.requestHint(() => 0.01).then(r => ({ n: r.hint.plans.length, cost: r.hint.quote.cost, refund: r.hint.refund }))", await_promise=True, timeout=90)
    c.pump(0.5)
    after = c.eval("window.__pap.current.match.focus")
    check(r["n"] == 0 and after == before - r["cost"] + r["refund"] and r["refund"] > 0,
          f"a blank hint shows nothing and refunds {r['refund']} of {r['cost']} ({before} -> {after})")
    check(c.eval("document.querySelectorAll('[class*=cwt-arrow--hint-]').length") == 0, "no plan arrows after a blank hint")

    errs = [e for e in c.errors() if "favicon" not in e]
    check(not errs, f"no console errors ({errs[:3]})")
finally:
    c.close()

print(f"{len(fails)} failed" if fails else "all passed")
sys.exit(1 if fails else 0)
