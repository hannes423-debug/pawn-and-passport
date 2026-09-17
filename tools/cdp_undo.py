#!/usr/bin/env python3
"""
tools/cdp_undo.py - the Undo Focus ability.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_undo.py

  - level 1: Undo costs the whole 30-point Focus pool, 1 per game
  - an undo takes back the player's move and the reply (history -2), board follows
  - cooldown: Undo is locked for UNDO.cooldownMoves of the player's moves
  - level 15: capped at 3 per game even with Focus to spare
  - at 8 viewports the Hint and Undo buttons are both fully on screen, side by side, not covered
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


GO = """window.__pap.go('match', { kind: 'friendly', colour: 'w', clubId: 'nyc', returnScene: 'nyc-int',
  opponent: { id: 'nyc-x', name: 'Grace', elo: 650, style: 'balanced', openingId: 'italian', look: { sprite: 'woman' } } }).then(() => 1)"""
READY = "document.querySelector('.cwt-board')?.dataset.interactive === 'true' && !window.__pap.current.match.thinking"
MOVES = ["e2e4", "g1f3", "f1c4", "d2d3", "e1g1", "c2c3", "h2h3", "a2a3", "b2b4", "a3a4"]


def play(c, n, start=0):
    for uci in MOVES[start:start + n]:
        c.wait_for(READY, timeout=60)
        legal = c.eval(f"window.__pap.current.match.game.legalMoves().some(m => m.from + m.to === '{uci}')")
        if not legal:
            uci = c.eval("(() => { const m = window.__pap.current.match.game.legalMoves().find(m => !m.captured); return m.from + m.to; })()")
        c.eval(f"window.__pap.current.match.playMove('{uci}').then(() => 1)", await_promise=True, timeout=60)
    c.wait_for(READY, timeout=60)
    c.pump(0.5)


def state(c):
    return json.loads(c.eval("JSON.stringify({ ...window.__pap.current.match.undoState(), focus: window.__pap.current.match.focus, focusMax: window.__pap.current.match.focusMax, ply: window.__pap.current.match.game.ply, used: window.__pap.current.match.undosUsed, label: document.querySelector('.pp-undobtn').textContent, disabled: document.querySelector('.pp-undobtn').disabled })"))


c = cdp.Chrome(1280, 800)
try:
    c.goto(settle=3); c.eval("localStorage.clear()"); c.goto(settle=3)
    assert c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=90)
    c.eval(cdp.NEW_CAREER % ("girl", "nyc"), await_promise=True)
    c.eval(GO, await_promise=True)
    c.wait_for(READY, timeout=60)
    s0 = state(c)
    check(s0['reason'] == 'nothing' and s0['disabled'], f"level 1: no undo before the first move ({s0['label']})")
    play(c, 2)
    s1 = state(c)
    check(s1['ok'] and s1['cost'] == s1['focusMax'] == 30, f"level 1: Undo costs the whole pool ({s1['cost']} of {s1['focusMax']})")
    fen_before = c.eval("window.__pap.current.match.game.fenAtPly(window.__pap.current.match.game.ply - 2)")
    c.eval("document.querySelector('.pp-undobtn').click()")
    c.pump(1.0)
    s2 = state(c)
    check(s2['ply'] == s1['ply'] - 2, f"undo takes back the move and the reply (ply {s1['ply']} -> {s2['ply']})")
    check(c.eval("window.__pap.current.match.game.fen") == fen_before, "the position is the one before the player's move")
    check(s2['focus'] <= s1['focus'] - 30, f"Focus spent ({s1['focus']} -> {s2['focus']})")
    check(s2['reason'] == 'used' and s2['disabled'], f"level 1: one undo per game ({s2['label']})")
    moves_list = c.eval("document.querySelectorAll('.pp-moves > span:not(.num)').length")
    check(moves_list == s2['ply'], f"the move list follows ({moves_list} entries)")
    c.shot("undo-after")

    # level 15: cap 3 and cooldown
    c.eval("""(async () => { const C = await import('./js/core/career.js'); const car = window.__pap.career; car.level = 15; car.xp = 6000; window.__pap.save(); return 1; })()""", await_promise=True)
    c.eval(GO, await_promise=True)
    c.wait_for(READY, timeout=60)
    play(c, 1)
    t0 = state(c)
    check(t0['max'] == 3 and t0['ok'], f"level 15: 3 undos per game ({t0['label']})")
    c.eval("window.__pap.current.match.undo()"); c.pump(0.8)
    t1 = state(c)
    check(t1['reason'] == 'cooldown' and t1['cooldown'] > 0, f"cooldown after an undo ({t1['label']})")
    play(c, t1['cooldown'], start=0)
    t2 = state(c)
    check(t2['ok'], f"usable again after the cooldown ({t2['label']})")
    for _ in range(2):
        c.eval("window.__pap.current.match.focus = window.__pap.current.match.focusMax; window.__pap.current.match.playerMovesSinceUndo = 99; 1")
        c.eval("window.__pap.current.match.undo()"); c.pump(0.8)
        c.wait_for(READY, timeout=60)
        play(c, 1, start=5)
    c.eval("window.__pap.current.match.focus = window.__pap.current.match.focusMax; window.__pap.current.match.playerMovesSinceUndo = 99; 1")
    t3 = state(c)
    check(t3['used'] == 3 and t3['reason'] == 'used', f"level 15: a fourth undo is refused even with full Focus ({t3['label']})")
    for e in c.errors():
        fails.append(f"console: {e[:160]}")
        print("  CONSOLE", e[:200])
finally:
    c.close()

for spec in ["390x844", "360x640", "844x390", "640x360", "768x1024", "1024x768", "1280x720", "1440x900"]:
    w, h = map(int, spec.split("x"))
    c = cdp.Chrome(w, h)
    try:
        c.send("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": min(w, h) < 700})
        c.goto(settle=3)
        assert c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=90)
        c.eval(cdp.NEW_CAREER % ("boy", "nyc"), await_promise=True)
        c.eval(GO, await_promise=True)
        c.wait_for(READY, timeout=60)
        c.pump(0.8)
        r = json.loads(c.eval("""(() => {
          const out = {};
          for (const [k, sel] of [['hint', '.pp-hintbtn'], ['undo', '.pp-undobtn']]) {
            const b = document.querySelector(sel); const r = b.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            out[k] = { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, onTop: !!(top && top.closest(sel)), text: b.textContent };
          }
          out.vw = innerWidth; out.vh = innerHeight; return JSON.stringify(out); })()"""))
        hint, undo = r['hint'], r['undo']
        inside = all(b['l'] >= 0 and b['t'] >= 0 and b['r'] <= r['vw'] + 0.5 and b['b'] <= r['vh'] + 0.5 for b in (hint, undo))
        beside = abs(hint['t'] - undo['t']) < 2 and undo['l'] >= hint['r'] - 1
        big = undo['h'] >= 36 and undo['w'] >= 70
        ok = inside and beside and big and hint['onTop'] and undo['onTop']
        check(ok, f"{spec}: Hint and Undo side by side on screen (undo {undo['w']:.0f}x{undo['h']:.0f}, '{undo['text']}')")
        c.shot(f"undo-{spec}")
    finally:
        c.close()

print(f"\n{len(fails)} failure(s)")
for f in fails:
    print("  FAIL", f)
sys.exit(1 if fails else 0)
