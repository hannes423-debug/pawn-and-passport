#!/usr/bin/env python3
"""
tools/cdp_practice.py - the practice room, opening study, drills and engine fallback.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_practice.py [390x844]

  1. practice room menu opens from the club's practice hotspot
  2. tutorial for an UNKNOWN opening: stepping line 0 to its end unlocks it (MASTERY.tutorialGrant)
  3. journal study at 40%: later moves stay locked
  4. a drill set answered correctly passes and teaches (+drillGain)
  5. puzzle practice holds the club's own set (not the venue puzzles)
  6. ?engine=asm boots the compatibility build and it analyses
"""
import json
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
    if mobile:
        c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    c.goto(); c.eval("localStorage.clear()"); c.goto()
    c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=60)
    c.eval(cdp.NEW_CAREER % ("girl", "nyc"), await_promise=True)

    # 1. practice room in London (London System unknown: 0%)
    c.eval("window.__pap.go('scene', { sceneId: 'lon-int' }).then(() => 1)", await_promise=True)
    c.wait_for("!!document.querySelector('.pp-actor')", timeout=15)
    c.pump(1)
    c.eval("[...document.querySelectorAll('.pp-hotspot')].find(b => /Practice|Study/.test(b.getAttribute('aria-label'))).click()")
    ok = c.wait_for("document.querySelectorAll('.pp-practice__option').length === 4", timeout=20)
    check(ok, "practice room shows 4 options")
    c.pump(0.5); c.shot(f"p1-practice-{spec}")

    # 2. tutorial
    c.eval("[...document.querySelectorAll('.pp-practice__option')].find(b => b.textContent.includes('Tutorial')).click()")
    check(c.wait_for("!!document.querySelector('.pp-study .pp-boardframe')", timeout=10), "tutorial study opens with a board")
    c.pump(0.8)
    length = c.eval("import('./js/data/openings.js').then(m => m.openingById('london').lines[0].length)", await_promise=True)
    for i in range(length):
        c.eval("document.querySelector('.pp-study__nav [aria-label=Forward]').click()")
        c.pump(0.05)
        if i == 5:
            c.pump(0.5); c.shot(f"p2-tutorial-{spec}")
    c.pump(0.5)
    note = c.eval("document.querySelector('.pp-study__note').textContent")
    check("End of the line" in note, f"tutorial reaches the end of line 0 ({note[-40:]!r})")
    check(c.eval("document.querySelectorAll('.pp-study__locked').length") == 0, "tutorial shows every move")
    c.eval("[...document.querySelectorAll('.pp-study button')].find(b => b.textContent.trim() === 'Done').click()")
    c.pump(1)
    london = c.eval("window.__pap.career.openings.london")
    check(london == 25, f"tutorial unlocks London at 25% (got {london})")

    # 3. journal review at 40% (Italian)
    c.eval("window.__pap.go('journal', { tab: 'openings' }).then(() => 1)", await_promise=True)
    c.pump(1.2)
    c.eval("[...document.querySelectorAll('button')].filter(b => b.textContent.includes('Study'))[0].click()")
    check(c.wait_for("!!document.querySelector('.pp-study .pp-boardframe')", timeout=10), "journal Study opens the review")
    c.pump(0.8)
    locked = c.eval("document.querySelectorAll('.pp-study__locked').length")
    title = c.eval("document.querySelector('.pp-study h2').textContent")
    check(locked > 0, f"review of {title} at 40% hides deeper moves ({locked} locked)")
    c.eval("document.querySelector('.pp-study__nav [aria-label=End]').click()"); c.pump(0.6)
    check("as far as you know" in c.eval("document.querySelector('.pp-study__note').textContent"), "review stops at the known depth and says so")
    check("games between 2200+" in c.eval("document.querySelector('.pp-study__popularity').textContent") or "Rare" in c.eval("document.querySelector('.pp-study__popularity').textContent"), "review shows research game counts")
    c.shot(f"p3-review-{spec}")
    c.eval("[...document.querySelectorAll('.pp-study button')].find(b => b.textContent.trim() === 'Close').click()")
    c.pump(0.5)

    # 4. drills for the Italian, answered with the book
    c.eval("window.__pap.go('drill', { openingId: 'italian', clubId: 'nyc', returnScene: 'nyc-int' }).then(() => 1)", await_promise=True)
    c.wait_for("!!window.__pap.current.drill && document.querySelectorAll('.cwt-piece').length > 0", timeout=15)
    c.pump(1)
    c.shot(f"p4-drill-{spec}")
    before = c.eval("window.__pap.career.openings.italian")
    n = c.eval("window.__pap.current.drill.set.length")
    for i in range(n):
        c.wait_for(f"window.__pap.current.drill.index === {i}", timeout=10)
        c.eval("""(() => { const d = window.__pap.current.drill; const a = d.set[d.index].answers[0].uci;
                  return d.attempt({ from: a.slice(0,2), to: a.slice(2,4), promotion: a.slice(4) || undefined }).then(() => 1); })()""", await_promise=True)
        c.pump(0.9)
        if i < n - 1:
            c.eval("[...document.querySelectorAll('.pp-match__focus button')].find(b => /Next|Finish/.test(b.textContent)).click()")
        else:
            c.eval("[...document.querySelectorAll('.pp-match__focus button')].find(b => /Finish/.test(b.textContent)).click()")
        c.pump(0.3)
    check(c.wait_for("!!document.querySelector('.pp-overlay h2') && document.querySelector('.pp-overlay h2').textContent.includes('passed')", timeout=10), f"a perfect drill set passes ({n} positions)")
    after = c.eval("window.__pap.career.openings.italian")
    check(after == before + 3, f"passing teaches +3% ({before} -> {after})")
    c.shot(f"p5-drill-done-{spec}")
    c.eval("[...document.querySelectorAll('.pp-overlay button')].find(b => b.textContent.includes('Leave')).click()")
    c.pump(1)

    # 5. puzzle practice
    c.eval("window.__pap.go('puzzle', { practice: true, clubId: 'nyc', returnScene: 'nyc-int' }).then(() => 1)", await_promise=True)
    c.pump(1)
    dots = c.eval("document.querySelectorAll('.pp-dot').length")
    total = c.eval("import('./js/data/clubPuzzles.js').then(m => m.puzzlesForClub('nyc').length)", await_promise=True)
    check(dots == total and total >= 4, f"puzzle practice holds the club's own {total} puzzles ({dots} dots)")
    shown = c.eval("[...document.querySelectorAll('.pp-dot')].map(d => d.title).join('|')")
    club_titles = c.eval("import('./js/data/clubPuzzles.js').then(m => m.puzzlesForClub('nyc').map(p => p.title).join('|'))", await_promise=True)
    check(sorted(shown.split('|')) == sorted(club_titles.split('|')), "the dots are the club's puzzles")
    board_fen = c.eval("import('./js/data/clubPuzzles.js').then(m => m.puzzlesForClub('nyc').map(p => p.fen.split(' ')[0]))", await_promise=True)
    venue_fens = c.eval("import('./js/data/puzzles.js').then(m => m.PUZZLES.map(p => p.fen.split(' ')[0]))", await_promise=True)
    check(not set(board_fen) & set(venue_fens), "no club puzzle position is a venue puzzle position")
    c.shot(f"p6-puzzles-{spec}")

    for e in c.errors():
        fails.append(f"console: {e[:160]}")
        print("  CONSOLE", e[:200])
finally:
    c.close()

# 6. engine fallback, in a fresh browser
c = cdp.Chrome(1024, 700)
try:
    c.goto("?engine=asm", settle=2)
    c.wait_for("!!window.__pap", timeout=60)
    probe = """import('./js/chess/engine/engineService.js').then(async m => { const s = m.engineService; await s.ready();
      const r = await s.analyze('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', { depth: 8, movetime: 800, multiPv: 2, useCache: false });
      return JSON.stringify({ status: s.status, text: s.statusText, build: s.build && s.build.id, lines: r.lines.length, best: r.bestMoveSan }); })"""
    res = json.loads(c.eval(probe, await_promise=True, timeout=200))
    check(res["build"] == "asm" and res["lines"] >= 1, f"ASM.js fallback engine analyses: {res}")
finally:
    c.close()

print(f"\n{len(fails)} failure(s)")
for f in fails:
    print("  FAIL", f)
sys.exit(1 if fails else 0)
