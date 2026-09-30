#!/usr/bin/env python3
"""
tools/cdp_controls.py - the whole game without a mouse: keyboard and gamepad.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_controls.py

Keys go in as real key events (CDP Input.dispatchKeyEvent). The gamepad is a
fake navigator.getGamepads() the test presses buttons on; js/ui/controls.js
finds it by polling, as it finds a pad that never fired gamepadconnected.

  keyboard
  - title: a direction lands on New Game (no career), Enter opens the creator
  - creator: type a name, Enter goes to page 2, arrows reach a city and the
    passport button, E presses them; the career starts in the home club
  - dialogue: E advances every line of the arrival talk
  - scene: holding D walks right, Esc hands the controls to the actions panel
    and back, the accept prompt names what E does
  - match: the cursor shows, starts on e2, W moves it up the board, E picks
    the pawn up (gold cursor) and E on e4 plays it; Esc drops a piece, then
    reaches the buttons, Esc again returns; 2 answers with a reason
  - pop-up: Esc closes a dismissable one
  - Controls page: every tab's pictures load
  gamepad (fake)
  - Xbox: A accepts, B goes back, the prompts turn into Xbox buttons
  - Nintendo: A is the RIGHT button (index 1) and accepts; the bottom one goes back
  - PlayStation: Cross accepts; the prompts are PlayStation's
  - the d-pad moves the board cursor, and the stick walks in a scene
  no console errors
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


KEYS = {
    "Enter": ("Enter", "Enter", 13, "\r"), "Escape": ("Escape", "Escape", 27, ""), " ": (" ", "Space", 32, " "),
    "ArrowUp": ("ArrowUp", "ArrowUp", 38, ""), "ArrowDown": ("ArrowDown", "ArrowDown", 40, ""),
    "ArrowLeft": ("ArrowLeft", "ArrowLeft", 37, ""), "ArrowRight": ("ArrowRight", "ArrowRight", 39, ""),
}
for ch in "abcdefghijklmnopqrstuvwxyz":
    KEYS[ch] = (ch, f"Key{ch.upper()}", ord(ch.upper()), ch)
for d in "123456789":
    KEYS[d] = (d, f"Digit{d}", ord(d), d)


def key(c, k, hold=0.0, settle=0.15):
    name, code, vk, text = KEYS[k]
    down = {"type": "keyDown" if text else "rawKeyDown", "key": name, "code": code, "windowsVirtualKeyCode": vk}
    if text:
        down["text"] = text
    c.send("Input.dispatchKeyEvent", down)
    if hold:
        c.pump(hold)
    c.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": name, "code": code, "windowsVirtualKeyCode": vk})
    c.pump(settle)


def active(c):
    return c.eval("(() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || a.textContent || a.tagName).trim().slice(0, 40) : ''; })()")


FAKE_PAD = """(() => {
  const pad = { id: %s, index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__pad, null, null, null] });
  window.__padSet = (i, on) => { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp += 1; };
  window.__padAxes = (x, y) => { pad.axes = [x, y, 0, 0]; pad.timestamp += 1; };
  return 1;
})()"""


def drain_tips(c):
    """Put away the one-time tips (they queue: the next one shows 250 ms after the last)."""
    for _ in range(8):
        if c.eval("!!document.querySelector('.pp-coach button')"):
            c.eval("document.querySelector('.pp-coach button').click()")
        c.pump(0.45)
        if not c.eval("!!document.querySelector('.pp-coach button')"):
            return


def pad(c, button, hold=0.12, settle=0.35):
    """A tap: well under the 420 ms before a held direction repeats (a loaded
    machine can add 200 ms to the release), long enough for the poll to see."""
    c.eval(f"window.__padSet({button}, true)")
    c.pump(hold)
    c.eval(f"window.__padSet({button}, false)")
    c.pump(settle)


GO_MATCH = """window.__pap.go('match', { kind: 'friendly', colour: 'w', clubId: 'nyc', returnScene: 'nyc-int',
  opponent: { id: 'nyc-x', name: 'Grace', elo: 650, style: 'balanced', openingId: 'italian', look: { sprite: 'woman' } } }).then(() => 1)"""
READY = "document.querySelector('.cwt-board')?.dataset.interactive === 'true' && !window.__pap.current.match.thinking"
CURSOR = "JSON.stringify((() => { const k = document.querySelector('.cwt-cursor'); return k ? { sq: k.dataset.square, gold: k.classList.contains('is-carrying'), shown: getComputedStyle(k).display !== 'none' } : null; })())"


c = cdp.Chrome(1366, 820)
try:
    c.goto(settle=3)
    c.eval("localStorage.clear()")
    c.goto(settle=3)
    assert c.wait_for("!!window.__pap && !document.getElementById('curtain') && !!document.querySelector('.pp-title__item')", timeout=90)

    print("keyboard: title and creator")
    key(c, "ArrowDown")
    check(c.eval("document.documentElement.dataset.input") == "keyboard", "a key press switches the game to keyboard mode")
    check(active(c).endswith("New Game"), f"a direction lands on New Game with no career (focus: {active(c)!r})")
    key(c, "Enter")
    check(c.wait_for("document.documentElement.dataset.screen === 'create'", timeout=10), "Enter on New Game opens the creator")
    c.pump(0.4)
    check(c.eval("document.activeElement?.classList.contains('pp-input')"), "the name field has focus")
    c.send("Input.insertText", {"text": "Keys"})
    key(c, "Enter")
    check(c.wait_for("!document.querySelector('.pp-create__cities').hidden", timeout=5), "Enter in the name field goes to page 2")
    c.pump(0.4)
    check(active(c) != "" and c.eval("document.activeElement?.classList.contains('pp-city')"), f"page 2 starts on a city ({active(c)!r})")
    key(c, "ArrowRight")
    moved_to = active(c)
    key(c, "e")
    check(c.eval("document.querySelectorAll('.pp-city[aria-pressed=true]').length") == 1, f"E picks the focused city ({moved_to!r})")
    picked = c.eval("document.querySelector('.pp-city[aria-pressed=true]')?.dataset.id")
    for _ in range(8):
        if "passport" in active(c).lower() or active(c) == "Back":
            break
        key(c, "ArrowDown")
    if active(c) == "Back":
        key(c, "ArrowLeft")          # the passport button sits left of Back
    check("passport" in active(c).lower(), f"the arrows reach 'Get my passport' ({active(c)!r})")
    key(c, " ")
    check(c.wait_for("document.documentElement.dataset.screen === 'scene'", timeout=15), "Space presses it: the career starts in a scene")
    check(c.eval("window.__pap.career?.name") == "Keys" and c.eval("window.__pap.career?.startClubId") == picked, f"the career has the typed name and the chosen city ({picked})")

    print("keyboard: dialogue and scene")
    lines = 0
    for _ in range(40):
        if not c.eval("!!document.querySelector('.pp-dialogue, .pp-overlay')"):
            break
        if c.eval("!!document.querySelector('.pp-dialogue')"):
            has_choices = c.eval("!!document.querySelector('.pp-dialogue__actions button')")
            key(c, "e", settle=0.25)
            lines += 1
            if has_choices:
                c.pump(0.4)
        else:
            key(c, "Escape", settle=0.4)
    check(not c.eval("!!document.querySelector('.pp-dialogue, .pp-overlay')"), f"E and Esc clear the arrival talk ({lines} presses)")
    drain_tips(c)
    fps = c.eval("new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n += 1; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); })", await_promise=True)
    print(f"  (requestAnimationFrame runs at {fps} fps here)")
    pos = lambda: c.eval("(() => { const a = document.querySelector('.pp-actor.is-player') || document.querySelector('.pp-actor'); const r = a.getBoundingClientRect(); return [r.left, r.top]; })()")
    p0 = pos()
    key(c, "d", hold=1.0)
    c.pump(0.4)
    p1 = pos()
    check(p1[0] > p0[0] + 5, f"holding D walks right ({p0[0]:.0f} -> {p1[0]:.0f} px)")
    key(c, "a", hold=0.6)
    c.pump(0.3)
    prompt = c.eval("(() => { const p = document.querySelector('.pp-keyprompt'); return p && !p.hidden ? { label: p.textContent.trim(), img: p.querySelector('img')?.getAttribute('src'), shown: getComputedStyle(p).display !== 'none' } : null; })()")
    check(bool(prompt) and prompt["shown"] and "key-e" in (prompt["img"] or ""), f"the corner prompt shows E and what it does ({prompt})")
    key(c, "Escape")
    in_dock = c.eval("!!document.activeElement?.closest('.pp-scene__dock')")
    check(in_dock, f"Esc hands the controls to the actions panel ({active(c)!r})")
    key(c, "ArrowRight")
    check(c.eval("!!document.activeElement?.closest('.pp-scene__dock, .pp-hud')"), f"arrows move between those buttons ({active(c)!r})")
    key(c, "Escape")
    check(c.eval("document.activeElement === document.body || !document.activeElement"), "Esc again gives the controls back to walking")
    p2 = pos()
    key(c, "d", hold=0.6)
    c.pump(0.3)
    check(pos()[0] > p2[0] + 3, "and D walks again")

    print("keyboard: match")
    c.eval(GO_MATCH, await_promise=True)
    c.wait_for(READY, timeout=60)
    drain_tips(c)
    key(c, "s")      # any direction: the first press shows the cursor
    cur = json.loads(c.eval(CURSOR))
    check(bool(cur) and cur["shown"], f"a key press shows the board cursor ({cur})")
    c.pump(0.4)
    tip = c.eval("document.querySelector('.pp-coach')?.dataset.key || ''")
    check(tip == "board-keys", f"the first key on a board teaches the cursor, once ({tip!r})")
    key(c, "Escape", settle=0.5)
    check(not c.eval("!!document.querySelector('.pp-coach')"), "Esc puts the tip away (its button shows Esc)")
    drain_tips(c)
    key(c, "w")
    cur = json.loads(c.eval(CURSOR))
    check(cur["sq"] == "e2", f"the cursor starts on e2 and moves in board directions (at {cur['sq']})")
    key(c, "e")
    cur = json.loads(c.eval(CURSOR))
    check(c.eval("window.__pap.current.board.input.selected") == "e2" and cur["gold"], f"E picks the e2 pawn up and the cursor turns gold ({cur})")
    key(c, "w")
    key(c, "w")
    key(c, "e", settle=0.6)
    check(c.wait_for("window.__pap.current.match.game.history[0]?.san === 'e4'", timeout=10), "W W E plays e4")
    c.wait_for(READY, timeout=60)
    cur = json.loads(c.eval(CURSOR))
    check(not cur["gold"] and cur["sq"] == "e4", f"the cursor stays on e4, blue again ({cur})")
    key(c, "ArrowLeft")
    key(c, "ArrowDown")
    key(c, "ArrowDown")
    key(c, "e")
    had = c.eval("window.__pap.current.board.input.selected")
    key(c, "Escape")
    check(had == "d2" and not c.eval("window.__pap.current.board.input.selected"), f"Esc puts a picked-up piece back ({had})")
    key(c, "Escape")
    check(c.eval("!!document.activeElement && document.activeElement !== document.body && !document.activeElement.closest('.cwt-board')"), f"Esc with nothing in hand goes to the buttons ({active(c)!r})")
    check(c.eval("document.querySelector('.cwt-boardhost').classList.contains('is-parked')"), "the cursor hides while the buttons have the controls")
    key(c, "ArrowDown")
    check(c.eval("!!document.activeElement?.closest('.pp-match__left, .pp-match__right')"), f"arrows move between the buttons ({active(c)!r})")
    key(c, "Escape")
    check(c.eval("!!document.activeElement?.closest('.cwt-board')") and not c.eval("document.querySelector('.cwt-boardhost').classList.contains('is-parked')"), "Esc again returns to the board")
    toasts = c.eval("document.querySelectorAll('.pp-toast').length")
    plies = c.eval("window.__pap.current.match.game.history.length")
    key(c, "2", settle=0.6)
    undone = c.eval("window.__pap.current.match.game.history.length") < plies
    check(undone or c.eval("document.querySelectorAll('.pp-toast').length") > toasts, f"2 undoes, or says why it cannot (undone: {undone})")
    prompts = c.eval("[...document.querySelectorAll('.pp-hintbtn .pp-prompt, .pp-undobtn .pp-prompt')].map(p => p.textContent.trim()).join(',')")
    check(prompts == "1,2", f"Hint and Undo show their keys ({prompts})")

    print("keyboard: pop-up and Controls page")
    c.eval("window.__pap.go('settings', { back: { screen: 'title', params: {} } })", await_promise=True)
    c.pump(0.6)
    c.eval("[...document.querySelectorAll('.pp-btn')].find(b => /All the controls/.test(b.textContent)).click()")
    c.pump(1.0)
    check(c.eval("!!document.querySelector('.pp-controls')"), "Settings opens the Controls page")
    broken = []
    for i in range(5):
        c.eval(f"document.querySelectorAll('.pp-controls__tab')[{i}].click()")
        c.pump(0.8)
        bad = c.eval("[...document.querySelectorAll('.pp-controls img')].filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute('src'))")
        broken += bad
    check(not broken, f"every picture on every tab loads ({broken[:4]})")
    c.eval("document.querySelectorAll('.pp-controls__tab')[1].click()")
    c.pump(0.8)
    print("  shot", c.shot("controls-page-xbox"))
    key(c, "Escape", settle=0.4)
    check(not c.eval("!!document.querySelector('.pp-overlay')"), "Esc closes the Controls page")
    key(c, "Escape", settle=0.8)
    check(c.eval("document.documentElement.dataset.screen") == "title", "Esc on Settings presses Done")

    print("gamepad: Xbox")
    c.eval(FAKE_PAD % json.dumps("Xbox 360 Controller (XInput STANDARD GAMEPAD)"))
    c.pump(1.5)
    pad(c, 13)                       # d-pad down
    check(c.eval("document.documentElement.dataset.input") == "gamepad", "a pad press switches the game to gamepad mode")
    check(c.eval("document.documentElement.dataset.pad") == "xbox", "an XInput pad is read as Xbox")
    check(c.eval("!!document.activeElement?.classList.contains('pp-title__item')"), f"the d-pad moves focus on the title ({active(c)!r})")
    c.eval("window.__pap.go('scene', { sceneId: window.__pap.career.location.sceneId })", await_promise=True)
    c.pump(1.5)
    drain_tips(c)
    src = c.eval("document.querySelector('.pp-keyprompt img')?.getAttribute('src')")
    check("xbox-a" in (src or ""), f"the scene prompt is the Xbox A button ({src})")
    p0 = pos()
    c.eval("window.__padAxes(0.95, 0)")
    c.pump(1.0)
    c.eval("window.__padAxes(0, 0)")
    c.pump(0.4)
    check(pos()[0] > p0[0] + 5, "the left stick walks")
    pad(c, 1)                        # B
    check(c.eval("!!document.activeElement?.closest('.pp-scene__dock')"), "B hands the controls to the actions panel")
    pad(c, 1)
    c.eval(GO_MATCH, await_promise=True)
    c.wait_for(READY, timeout=60)
    drain_tips(c)
    pad(c, 12)                       # d-pad up: e2 -> e3
    cur = json.loads(c.eval(CURSOR))
    check(cur["shown"] and cur["sq"] == "e3", f"the d-pad moves the board cursor ({cur})")
    pad(c, 13)
    pad(c, 0)                        # A picks e2
    check(c.eval("window.__pap.current.board.input.selected") == "e2", "A picks a piece up")
    pad(c, 12)
    pad(c, 12)
    pad(c, 0, settle=0.8)            # A on e4
    check(c.wait_for("window.__pap.current.match.game.history[0]?.san === 'e4'", timeout=10), "A on e4 plays the move")
    src = c.eval("document.querySelector('.pp-hintbtn .pp-prompt img')?.getAttribute('src')")
    check("xbox-x" in (src or ""), f"Hint shows the X button ({src})")

    print("gamepad: Nintendo and PlayStation")
    c.eval(FAKE_PAD % json.dumps("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"))
    c.pump(0.6)
    c.eval("window.__pap.go('settings', { back: { screen: 'title', params: {} } })", await_promise=True)
    c.pump(0.8)
    pad(c, 13)
    check(c.eval("document.documentElement.dataset.pad") == "nintendo", "a Switch Pro Controller is read as Nintendo")
    c.eval("[...document.querySelectorAll('.pp-btn')].find(b => /All the controls/.test(b.textContent)).focus()")
    pad(c, 1)                        # the RIGHT face button: Nintendo's A
    check(c.eval("!!document.querySelector('.pp-controls')"), "Nintendo A (the right button) accepts")
    check(c.eval("document.querySelector('.pp-controls__tab.is-active')?.textContent.trim()") == "Nintendo", "the Controls page opens on the pad in use")
    pad(c, 0)                        # the BOTTOM face button: Nintendo's B
    check(not c.eval("!!document.querySelector('.pp-overlay')"), "Nintendo B (the bottom button) goes back")
    c.eval(FAKE_PAD % json.dumps("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"))
    c.pump(0.6)
    pad(c, 13)
    check(c.eval("document.documentElement.dataset.pad") == "playstation", "a DualSense is read as PlayStation")
    c.eval("[...document.querySelectorAll('.pp-btn')].find(b => /All the controls/.test(b.textContent)).focus()")
    pad(c, 0)                        # Cross
    check(c.eval("!!document.querySelector('.pp-controls')"), "Cross accepts")
    shown = c.eval("[...document.querySelectorAll('.pp-controls .pp-prompt img')].map(i => i.getAttribute('src').split('/').pop()).slice(0, 3).join(',')")
    check("ps-" in shown, f"the page shows PlayStation buttons ({shown})")
    pad(c, 1)                        # Circle
    check(not c.eval("!!document.querySelector('.pp-overlay')"), "Circle goes back")

    errors = [e for e in c.errors() if "favicon" not in e]
    check(not errors, f"no console errors ({errors[:3]})")
finally:
    c.close()

print(f"\n{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
