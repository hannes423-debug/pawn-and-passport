#!/usr/bin/env python3
"""
tools/cdp_resilience.py - the game survives what breaks around it.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_resilience.py

  1. scene art that cannot load: the scene still appears within seconds with a
     readable placeholder, the dock still works, Retry brings the art back
  2. storage the browser refuses: one warning strip, the game keeps going
  3. the engine dies mid-match: the opponent still moves, the player is never
     stuck, and the finished game still pays out once and returns to the club
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402

fails = []


def check(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        fails.append(label)


def boot(c, storage_ok=True):
    c.goto(); c.eval("localStorage.clear()")
    if not storage_ok:
        c.send("Page.addScriptToEvaluateOnNewDocument", {"source": "Storage.prototype.setItem = function () { const e = new Error('blocked'); e.name = 'SecurityError'; throw e; };"})
    c.goto()
    c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=60)
    c.eval(cdp.NEW_CAREER % ("girl", "vie"), await_promise=True)


# 1 + 3 in one browser
c = cdp.Chrome(1280, 800)
try:
    boot(c)
    c.send("Network.enable")
    c.send("Network.setBlockedURLs", {"urls": ["*scenes/vie-venue.webp*"]})
    t0 = time.time()
    c.eval("window.__pap.go('scene', { sceneId: 'vie-venue' }).then(() => 1)", await_promise=True, timeout=30)
    took = time.time() - t0
    shown = c.wait_for("!!document.querySelector('.pp-scene__missing')", timeout=8)
    check(shown and took < 6, f"the scene appears without its art, with a placeholder ({took:.1f}s)")
    check(c.eval("document.querySelectorAll('.pp-scene__dock button').length") >= 2, "the dock still offers the actions")
    c.shot("r1-missing-art")
    c.send("Network.setBlockedURLs", {"urls": []})
    c.eval("document.querySelector('.pp-scene__missing button').click()")
    check(c.wait_for("!document.querySelector('.pp-scene__missing') && document.querySelector('.pp-scene__bg').naturalWidth > 0", timeout=15), "Retry brings the art back")

    # 3. engine dies mid-match
    c.eval("window.__pap.go('match', { kind: 'tournament', colour: 'w', clubId: 'vie', returnScene: 'vie-int', opponent: { id: 'vie-felix', name: 'Felix Brandt', elo: 700, style: 'balanced', openingId: 'vienna', look: { sprite: 'young-blue' } } }).then(() => 1)", await_promise=True)
    c.eval("window.__pap.career.tournaments = {}; import('./js/core/career.js').then(C => C.enterTournament(window.__pap.career, 'vie'))", await_promise=True)
    c.wait_for("window.__pap.current?.match?.status === 'active'", timeout=60)
    c.pump(1)
    c.eval("window.__pap.current.match.playMove('e2e4')")
    c.wait_for("window.__pap.current.match.game.ply >= 2 && window.__pap.current.match.isPlayersTurn", timeout=60)
    # Kill it: every search now rejects.
    c.eval("""(async () => { const { engineService } = await import('./js/chess/engine/engineService.js');
      engineService.analyze = async () => { throw new Error('worker died'); };
      engineService.review = async () => { throw new Error('worker died'); };
      window.__fallbacks = 0; window.__toasts = [];
      window.__pap.current.match.on((e) => { if (e.type === 'bot-fallback') window.__fallbacks += 1; });
      new MutationObserver(() => document.querySelectorAll('.pp-toast').forEach((t) => window.__toasts.push(t.textContent)))
        .observe(document.body, { childList: true, subtree: true }); })()""", await_promise=True)
    moved = True
    for k in range(4):
        uci = c.eval("import('./js/chess/core/rules.js').then(r => { const m = r.legalMoves(window.__pap.current.match.fen)[0]; return m.from + m.to + (m.promotion || ''); })", await_promise=True)
        c.eval(f"window.__pap.current.match.playMove('{uci}')")
        ok = c.wait_for("(window.__pap.current.match.isPlayersTurn && !window.__pap.current.match.thinking) || window.__pap.current.match.game.status !== 'active'", timeout=90)
        moved = moved and ok
    check(moved, "with the engine dead the opponent keeps answering (fallback moves)")
    fallbacks = c.eval("window.__fallbacks")
    told = c.eval("window.__toasts.some((t) => t.includes('engine trouble'))")
    check(fallbacks > 0 and told, f"fallback moves were played ({fallbacks}) and the player was told ({told})")
    elo_before = c.eval("window.__pap.career.elo")
    c.eval("window.__pap.current.match.game.resign('b')")
    ok = c.wait_for("!!document.querySelector('.pp-result__letter')", timeout=40)
    check(ok, "the game still ends with a result card")
    for _ in range(4):
        c.eval("[...document.querySelectorAll('.pp-overlay button')].find(b => /Continue|passport/.test(b.textContent))?.click()")
        c.pump(0.8)
    check(c.wait_for("!!document.querySelector('.pp-scene')", timeout=20), "and returns to the club")
    elo_after = c.eval("window.__pap.career.elo")
    check(elo_after > elo_before, f"the win was paid once ({elo_before} -> {elo_after})")
    errs = [e for e in c.errors() if "favicon" not in e and "worker died" not in e and "ERR_BLOCKED" not in e and "net::" not in e]
    check(not errs, f"no unexpected console errors ({errs[:3]})")
finally:
    c.close()

# 2. storage refused
c = cdp.Chrome(1280, 800)
try:
    boot(c, storage_ok=False)
    c.eval("window.__pap.go('scene', { sceneId: 'vie-ext' }).then(() => 1)", await_promise=True)
    c.pump(1)
    n = c.eval("document.querySelectorAll('.pp-savewarn').length")
    check(n == 1, f"one 'not saving' warning ({n})")
    for _ in range(3):
        c.eval("window.__pap.save()")
    check(c.eval("document.querySelectorAll('.pp-savewarn').length") == 1, "saving again does not stack warnings")
    check(c.eval("!!document.querySelector('.pp-scene__dock button')"), "the game stays playable")
    c.shot("r2-not-saving")
finally:
    c.close()

print(f"{len(fails)} failed" if fails else "all passed")
sys.exit(1 if fails else 0)
