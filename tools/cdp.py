#!/usr/bin/env python3
"""
tools/cdp.py - headless Chrome driver for Pawn & Passport.

    python3 tools/serve.py 8123 &
    python3 tools/cdp.py smoke          # every screen + scene, screenshots, console errors
    python3 tools/cdp.py match          # plays a real game against the bot through the UI
    python3 tools/cdp.py puzzle         # solves a mission through the board input
    python3 tools/cdp.py shot <path>    # one screenshot of ?<query>

Screenshots land in $PAP_SHOTS (default: tools/shots/). Adapted from Chess:
World Tour's tools/cdp.py: --remote-allow-origins=* is required, the debug
port is per-process, and the Chrome profile lives under ~/.cache (a full
/tmp breaks every headless run) and is deleted on close.
"""

import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

import websocket  # websocket-client

CHROME = shutil.which("google-chrome") or "/usr/bin/google-chrome"
PORT = 9300 + (os.getpid() % 400)
BASE = os.environ.get("PAP_BASE", "http://localhost:8123")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get("PAP_SHOTS", os.path.join(ROOT, "tools", "shots"))


class Chrome:
    def __init__(self, width=1440, height=900):
        self.profile = os.path.expanduser(f"~/.cache/pap-cdp-{os.getpid()}")
        self.proc = subprocess.Popen(
            [CHROME, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={self.profile}",
             "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage",
             "--remote-allow-origins=*", "--autoplay-policy=no-user-gesture-required",
             f"--window-size={width},{height}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.msg_id = 0
        self.events = []
        self._connect()
        self.send("Runtime.enable")
        self.send("Log.enable")
        self.send("Page.enable")
        self.send("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})

    def _connect(self, tries=80):
        last = None
        for _ in range(tries):
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=2))
                pages = [t for t in targets if t["type"] == "page"]
                if not pages:
                    raise RuntimeError("no page yet")
                self.ws = websocket.create_connection(pages[0]["webSocketDebuggerUrl"], timeout=120, max_size=None)
                return
            except Exception as error:  # noqa: BLE001
                last = error
                time.sleep(0.25)
        raise RuntimeError(f"could not attach to Chrome: {last!r}")

    def send(self, method, params=None, timeout=120):
        self.msg_id += 1
        mid = self.msg_id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            self.events.append(msg)
        raise TimeoutError(method)

    def pump(self, seconds):
        end = time.time() + seconds
        self.ws.settimeout(0.2)
        while time.time() < end:
            try:
                self.events.append(json.loads(self.ws.recv()))
            except Exception:  # noqa: BLE001
                pass
        self.ws.settimeout(120)

    def eval(self, expression, await_promise=False, timeout=120):
        result = self.send("Runtime.evaluate", {"expression": expression, "returnByValue": True,
                                                "awaitPromise": await_promise, "userGesture": True}, timeout=timeout)
        if result.get("exceptionDetails"):
            d = result["exceptionDetails"]
            raise RuntimeError("JS error: " + ((d.get("exception") or {}).get("description") or d.get("text")))
        return result["result"].get("value")

    def goto(self, query="", settle=2.0):
        self.send("Page.navigate", {"url": f"{BASE}/index.html{query}"})
        time.sleep(settle)
        self.pump(0.3)

    def wait_for(self, expression, timeout=30.0, step=0.25):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.eval(expression):
                return True
            self.pump(step)
        return False

    def shot(self, name):
        os.makedirs(SHOTS, exist_ok=True)
        # Let background images and fonts decode.
        self.eval("Promise.all([...document.images].map(i => i.decode ? i.decode().catch(()=>{}) : 0)).then(() => document.fonts.ready).then(() => 1)", await_promise=True)
        self.pump(0.3)
        data = self.send("Page.captureScreenshot", {"format": "png"})["data"]
        path = os.path.join(SHOTS, f"{name}.png")
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(data))
        return path

    def errors(self):
        out = []
        for e in self.events:
            if e.get("method") == "Runtime.exceptionThrown":
                d = e["params"]["exceptionDetails"]
                out.append(((d.get("exception") or {}).get("description") or d.get("text") or "").split("\n")[0])
            if e.get("method") == "Log.entryAdded" and e["params"]["entry"]["level"] == "error":
                out.append(e["params"]["entry"]["text"])
            if e.get("method") == "Runtime.consoleAPICalled" and e["params"]["type"] == "error":
                out.append(" ".join(str(a.get("value", a.get("description", ""))) for a in e["params"]["args"])[:300])
        return out

    def close(self):
        try:
            self.ws.close()
        finally:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except Exception:  # noqa: BLE001
                self.proc.kill()
            shutil.rmtree(self.profile, ignore_errors=True)


NEW_CAREER = """(async () => {
  const C = await import('./js/core/career.js');
  const c = C.newCareer({ name: 'Tester', avatar: '%s', startClubId: '%s' });
  window.__pap.setCareer(c);
  return true;
})()"""


def smoke():
    c = Chrome()
    failures = []
    try:
        c.goto()
        c.eval("localStorage.clear()")
        c.goto()
        c.wait_for("!!document.querySelector('.pp-title__item')")
        print("title", c.shot("01-title"))
        c.eval("window.__pap.go('create')")
        c.pump(1)
        print("create", c.shot("02-create"))
        c.eval(NEW_CAREER % ("girl", "nyc"), await_promise=True)
        c.eval("window.__pap.go('map')")
        c.pump(1.5)
        print("map", c.shot("03-map"))
        scenes = c.eval("import('./js/data/scenes.js').then(m => Object.keys(m.SCENES))", await_promise=True)
        for sid in scenes:
            c.eval(f"window.__pap.go('scene', {{ sceneId: '{sid}' }})", await_promise=True)
            ok = c.wait_for("!!(document.querySelector('.pp-actor') && document.querySelector('.pp-hotspot'))", timeout=10)
            c.pump(0.6)
            print("scene", sid, "ok" if ok else "NO ACTORS", c.shot(f"10-scene-{sid}"))
            if not ok:
                failures.append(f"scene {sid} did not render actors")
        for tab in ["passport", "openings", "postcards", "career"]:
            c.eval(f"window.__pap.go('journal', {{ tab: '{tab}' }})", await_promise=True)
            c.pump(0.8)
            print("journal", tab, c.shot(f"20-journal-{tab}"))
        c.eval("window.__pap.go('settings', {})", await_promise=True)
        c.pump(0.6)
        print("settings", c.shot("30-settings"))
        c.eval("window.__pap.go('ending', { creditsOnly: true })", await_promise=True)
        c.pump(0.6)
        print("credits", c.shot("31-credits"))
        errs = c.errors()
        for e in errs:
            print("  CONSOLE:", e)
        failures += [f"console: {e}" for e in errs]
    finally:
        c.close()
    print(f"\n{len(failures)} failure(s)")
    for f in failures:
        print("  FAIL", f)
    return 1 if failures else 0


def match():
    """Start a friendly and play the engine's own move for the human, a few times."""
    c = Chrome()
    failures = []
    try:
        c.goto()
        c.eval("localStorage.clear()")
        c.goto()
        c.wait_for("!!window.__pap")
        c.eval(NEW_CAREER % ("boy", "ist"), await_promise=True)
        c.eval("""window.__pap.go('match', { kind: 'friendly', colour: 'w', clubId: 'ist', returnScene: 'ist-int',
                 opponent: { id: 'ist-deniz', name: 'Deniz Arslan', elo: 650, style: 'aggressive', openingId: 'sicilian',
                             look: { sprite: 'young-red' } } }).then(() => 1)""", await_promise=True)
        c.wait_for("document.querySelectorAll('.cwt-piece').length === 32", timeout=20)
        c.pump(1)
        print("start", c.shot("40-match-start"))
        # Opening guide arrows need 40% in an opening; Istanbul = Sicilian (Black), so as White: none expected.
        moves = ["e2e4", "g1f3", "d2d4", "f3d4", "b1c3"]
        for i, uci in enumerate(moves):
            if not c.wait_for("!!(window.__pap.current && document.querySelector('.pp-hintbtn') && !Array.from(document.querySelectorAll('.pp-thinking')).some(e => e.style.visibility === 'visible'))", timeout=40):
                failures.append("bot never finished thinking")
                break
            legal = c.eval(f"""(async () => {{
              const board = document.querySelector('.cwt-board');
              const sq = (s) => board.querySelector('[data-square="' + s + '"]');
              const fire = (el, type) => {{ const r = el.getBoundingClientRect();
                el.dispatchEvent(new PointerEvent(type, {{ bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, pointerId: 1, isPrimary: true, button: 0 }})); }};
              const from = sq('{uci[:2]}'), to = sq('{uci[2:]}');
              fire(from, 'pointerdown'); fire(from, 'pointerup');
              await new Promise(r => setTimeout(r, 120));
              fire(to, 'pointerdown'); fire(to, 'pointerup');
              return true;
            }})()""", await_promise=True)
            c.pump(2.5)
            if i == 1:
                # Ask for a hint once, on our turn.
                c.wait_for("!document.querySelector('.pp-hintbtn').disabled", timeout=40)
                c.eval("document.querySelector('.pp-hintbtn').click()")
                c.wait_for("!!document.querySelector('.cwt-arrow--hint')", timeout=30)
                print("hint", c.shot("41-match-hint"))
        c.pump(6)
        history = c.eval("document.querySelectorAll('.pp-moves > span:not(.num)').length")
        graded = c.eval("document.querySelectorAll('.pp-moves .pp-grade').length")
        print(f"moves in list: {history}, graded: {graded}")
        if graded == 0:
            failures.append("no move was graded")
        print("mid", c.shot("42-match-mid"))
        c.eval("window.__pap.current && document.querySelector('.pp-btn--red') && null")
        c.eval("""(async () => { const m = await import('./js/game/match.js'); return 1; })()""", await_promise=True)
        # Resign to reach the result card.
        c.eval("[...document.querySelectorAll('.pp-match__right button')].find(b => b.textContent.includes('Resign')).click()")
        c.pump(0.5)
        c.eval("[...document.querySelectorAll('.pp-overlay button')].find(b => b.textContent.includes('Resign')).click()")
        ok = c.wait_for("!!document.querySelector('.pp-result__word')", timeout=60)
        c.pump(0.5)
        print("result", ok, c.shot("43-match-result"))
        if not ok:
            failures.append("result card never appeared")
        saved = c.eval("JSON.parse(localStorage.getItem('PAP_career_v1')).stats.games")
        print("games saved:", saved)
        if saved != 1:
            failures.append(f"career stats.games = {saved}")
        for e in c.errors():
            print("  CONSOLE:", e)
            failures.append(f"console: {e}")
    finally:
        c.close()
    print(f"\n{len(failures)} failure(s)")
    for f in failures:
        print("  FAIL", f)
    return 1 if failures else 0


def puzzle():
    c = Chrome()
    failures = []
    try:
        c.goto()
        c.eval("localStorage.clear()")
        c.goto()
        c.wait_for("!!window.__pap")
        c.eval(NEW_CAREER % ("girl", "lon"), await_promise=True)
        c.eval("window.__pap.go('puzzle', { missionId: 'm-lon', returnScene: 'lon-venue' })", await_promise=True)
        c.wait_for("document.querySelectorAll('.cwt-piece').length > 2", timeout=15)
        c.pump(0.8)
        print("puzzle", c.shot("50-puzzle"))
        solutions = c.eval("import('./js/data/puzzles.js').then(m => m.PUZZLES.filter(p => p.mission === 'lon').map(p => p.solution))", await_promise=True)
        for n, line in enumerate(solutions):
            for k in range(0, len(line), 2):
                uci = line[k]
                c.eval(f"""(async () => {{
                  const board = document.querySelector('.cwt-board');
                  const sq = (s) => board.querySelector('[data-square="' + s + '"]');
                  const fire = (el, type) => {{ const r = el.getBoundingClientRect();
                    el.dispatchEvent(new PointerEvent(type, {{ bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, pointerId: 1, isPrimary: true, button: 0 }})); }};
                  fire(sq('{uci[:2]}'), 'pointerdown'); fire(sq('{uci[:2]}'), 'pointerup');
                  await new Promise(r => setTimeout(r, 100));
                  fire(sq('{uci[2:4]}'), 'pointerdown'); fire(sq('{uci[2:4]}'), 'pointerup');
                }})()""", await_promise=True)
                c.pump(1.2)
            solved = c.eval("Object.keys(JSON.parse(localStorage.getItem('PAP_career_v1')).puzzlesSolved).length")
            print(f"after puzzle {n + 1}: solved {solved}")
            if n == len(solutions) - 1:
                break
            c.eval("[...document.querySelectorAll('button')].find(b => /Next puzzle|Finish/.test(b.textContent))?.click()")
            c.pump(0.8)
        c.pump(2)
        # Dialogue then the postcard overlay.
        for _ in range(8):
            c.eval("document.querySelector('.pp-dialogue')?.click()")
            c.pump(0.4)
        print("postcard", c.shot("51-postcard"))
        got = c.eval("JSON.parse(localStorage.getItem('PAP_career_v1')).postcards['pc-lon'] ? 1 : 0")
        if not got:
            failures.append("London postcard not collected")
        for e in c.errors():
            print("  CONSOLE:", e)
            failures.append(f"console: {e}")
    finally:
        c.close()
    print(f"\n{len(failures)} failure(s)")
    for f in failures:
        print("  FAIL", f)
    return 1 if failures else 0


def trophy():
    """Star Player final: the bot resigns, then dialogue, result card and trophy ceremony."""
    c = Chrome()
    failures = []
    try:
        c.goto()
        c.eval("localStorage.clear()")
        c.goto()
        c.wait_for("!!window.__pap")
        c.eval(NEW_CAREER % ("girl", "vie"), await_promise=True)
        c.eval("""(async () => {
          const C = await import('./js/core/career.js');
          const app = window.__pap; const career = app.career;
          C.enterTournament(career, 'vie');
          // Five Swiss wins reach the final against the Star Player.
          for (let i = 0; i < 5; i += 1) C.recordTournamentGame(career, 'vie', 1);
          app.save();
          const r = C.currentRound(career, 'vie');
          const { starById } = await import('./js/data/starPlayers.js');
          const s = starById('clara');
          await app.go('match', { kind: 'star', colour: 'w', clubId: 'vie', returnScene: 'vie-int',
            opponent: { id: s.id, name: s.name, elo: r.elo, style: s.style, openingId: s.openingId, look: s.look } });
          return r.kind;
        })()""", await_promise=True)
        c.wait_for("document.querySelectorAll('.cwt-piece').length === 32", timeout=20)
        c.pump(1)
        # Effects gallery on the live board, captured mid-animation.
        for grade, sq in [("EPIC", "e4"), ("BRILLIANT", "d4"), ("CLUTCH", "f3")]:
            c.eval(f"""(async () => {{
              const {{ GRADE_META }} = await import('./js/core/grading.js');
              window.__pap.current.board.fx.grade({{ grade: '{grade}', tier: GRADE_META['{grade}'].tier, meta: GRADE_META['{grade}'], record: {{ to: '{sq}' }}, focusGain: 5 }});
            }})()""", await_promise=True)
            c.pump(0.35)
            print("fx", grade, c.shot(f"60-fx-{grade.lower()}"))
            c.pump(1.4)
        c.eval("window.__pap.current.match.game.resign('b')")
        for _ in range(12):
            c.pump(0.8)
            c.eval("document.querySelector('.pp-dialogue')?.click()")
            if c.eval("!!document.querySelector('.pp-result__word')"):
                break
        ok = c.wait_for("!!document.querySelector('.pp-result__word')", timeout=60)
        print("result", ok, c.shot("61-star-result"))
        c.eval("[...document.querySelectorAll('.pp-overlay button')].find(b => b.textContent.includes('Continue'))?.click()")
        # The tournament report (the final's line) comes before the ceremony.
        c.wait_for("[...document.querySelectorAll('.pp-overlay button')].some(b => b.textContent.includes('Continue'))", timeout=15)
        c.pump(0.4)
        c.eval("[...document.querySelectorAll('.pp-overlay button')].find(b => b.textContent.includes('Continue'))?.click()")
        ok2 = c.wait_for("[...document.querySelectorAll('.pp-overlay h2')].some(h => h.textContent.includes('Waltz'))", timeout=20)
        c.pump(0.6)
        print("ceremony", ok2, c.shot("62-trophy"))
        career = c.eval("JSON.parse(localStorage.getItem('PAP_career_v1'))")
        if not career["trophies"].get("vie"):
            failures.append("Vienna trophy not saved")
        if career["openings"]["vienna"] != 100:
            failures.append(f"vienna mastery {career['openings']['vienna']}")
        if not ok or not ok2:
            failures.append("result or ceremony missing")
        for e in c.errors():
            print("  CONSOLE:", e)
            failures.append(f"console: {e}")
    finally:
        c.close()
    print(f"\n{len(failures)} failure(s)")
    for f in failures:
        print("  FAIL", f)
    return 1 if failures else 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "smoke"
    if cmd == "shot":
        ch = Chrome()
        try:
            ch.goto(sys.argv[2] if len(sys.argv) > 2 else "")
            print(ch.shot("shot"))
        finally:
            ch.close()
        sys.exit(0)
    sys.exit({"smoke": smoke, "match": match, "puzzle": puzzle, "trophy": trophy}[cmd]())
