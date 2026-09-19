#!/usr/bin/env python3
"""
tools/cdp_campaign.py - play the WHOLE campaign through the real UI.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_campaign.py [nyc|lon|vie|ist|che|wen|all] [390x844]

From a clean save: create a career, then for every club travel on the world
map, walk in, enter the tournament at the desk, play every round through the
match screen, click through the result card, the round report, the Star
Player's dialogue and the trophy ceremony, and on to Madrid: three finale
rounds and the ending. Games are decided by a resignation (the chess itself is
tested elsewhere); everything around them is the real game.

The first club also takes the unhappy paths: a lost game, a knockout exit or a
lost Swiss, re-entry, and a lost Star final; Madrid loses a round once and
replays it. Any wait that times out is a softlock: the script saves a
screenshot and the career, and fails.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp  # noqa: E402

CLUBS = ["nyc", "lon", "vie", "ist", "che", "wen"]
CITY = {"nyc": "New York", "lon": "London", "vie": "Vienna", "ist": "Istanbul", "che": "Chennai", "wen": "Wenzhou"}
args = [a for a in sys.argv[1:]]
spec = next((a for a in args if "x" in a), "1280x800")
starts = [a for a in args if a in CLUBS] or (CLUBS if "all" in args else ["vie"])
W, H = map(int, spec.split("x"))
mobile = min(W, H) < 700


class Stuck(Exception):
    pass


def run(start):
    c = cdp.Chrome(W, H)
    log = []
    games = 0

    def note(msg):
        log.append(msg)
        print(f"  [{start}] {msg}", flush=True)

    def js(expr, **kw):
        return c.eval(expr, **kw)

    def wait(expr, what, timeout=45):
        if not c.wait_for(expr, timeout=timeout):
            c.shot(f"stuck-{start}")
            state = js("JSON.stringify({ screen: window.__pap.currentName, overlays: [...document.querySelectorAll('.pp-overlay, .pp-dialogue')].map(e => e.textContent.slice(0, 120)), loc: window.__pap.career?.location })")
            raise Stuck(f"{what}: {state}")

    def click(selector_js, what):
        ok = js(f"(() => {{ const el = {selector_js}; if (!el) return false; el.click(); return true; }})()")
        if not ok:
            c.shot(f"stuck-{start}")
            raise Stuck(f"no {what} to press")

    def button(pattern):
        return f"[...document.querySelectorAll('.pp-overlay button, .pp-dialogue button, .pp-scene__dock button, .pp-map button, button')].find(b => b.offsetParent !== null && /{pattern}/.test(b.textContent))"

    def settle_ui(prefer=r"Continue|Add it to my passport|Next|Done|Bye|Later|Close", until="!!document.querySelector('.pp-scene') && !document.querySelector('.pp-overlay, .pp-dialogue, .pp-arrival')", timeout=60):
        """Click through arrival cards, dialogues and result overlays until `until` holds."""
        end = time.time() + timeout
        while time.time() < end:
            if js(until):
                return
            js(f"""(() => {{
              const arrival = document.querySelector('.pp-arrival'); if (arrival) {{ arrival.click(); return; }}
              const pick = [...document.querySelectorAll('.pp-overlay button, .pp-dialogue__actions button')].find(b => /{prefer}/.test(b.textContent));
              if (pick) {{ pick.click(); return; }}
              const d = document.querySelector('.pp-dialogue'); if (d) d.click();
            }})()""")
            c.pump(0.5)
        c.shot(f"stuck-{start}")
        raise Stuck(f"UI never settled (waiting for {until})")

    def play_current(win):
        nonlocal games
        wait("window.__pap.currentName === 'match' && window.__pap.current?.match?.status === 'active'", "the match to start", 60)
        c.pump(0.6)
        if win:
            js("(() => { const m = window.__pap.current.match; m.game.resign(m.playerColour === 'w' ? 'b' : 'w'); })()")
        else:
            js("window.__pap.current.match.resign()")
        # A Star Player or finale game has the rival's words first.
        settle_ui(prefer=r"^$", until="!!document.querySelector('.pp-result__letter')", timeout=60)
        games += 1

    def walk_to(label_pattern):
        click(f"[...document.querySelectorAll('.pp-hotspot')].find(b => /{label_pattern}/.test(b.getAttribute('aria-label')))", f"hotspot {label_pattern}")

    def travel(club_or_madrid):
        js("window.__pap.go('map')", await_promise=False)
        wait("window.__pap.currentName === 'map' && !!document.querySelector('.pp-pin')", "the map")
        c.pump(0.6)
        city = "Madrid" if club_or_madrid == "mad" else CITY[club_or_madrid]
        click(f"[...document.querySelectorAll('.pp-pin')].find(b => b.getAttribute('aria-label').startsWith('{city}'))", f"the {city} pin")
        c.pump(0.4)
        pattern = "Fly to Madrid" if club_or_madrid == "mad" else "Fly to the club|Go to the club"
        wait(f"!!{button(pattern)}", f"the {city} travel button")
        click(button(pattern), "the travel button")
        wait("window.__pap.currentName === 'scene'", f"arrival in {city}", 30)
        settle_ui()

    def enter_club(club):
        if js("window.__pap.career.location.sceneId") != f"{club}-int":
            walk_to("Enter")
            wait(f"window.__pap.career.location.sceneId === '{club}-int' && !!document.querySelector('.pp-actor')", "the club floor")
            settle_ui()

    def tournament_game(club, win):
        walk_to("Tournament hall|Play")
        wait(f"!!{button('Enter the tournament|Enter again|Play round|Play the final|Play last|Play quarter|Play semi|Play bracket')}", "the tournament desk", 30)
        if js(f"!!{button('Enter the tournament|Enter again')}"):
            click(button("Enter the tournament|Enter again"), "Enter")
            wait(f"!!{button('Play ')}", "the round panel")
        click(button("Play "), "Play")
        # The final starts with the Star Player's challenge dialogue.
        settle_ui(prefer=r"Continue", until="window.__pap.currentName === 'match'", timeout=40)
        play_current(win)
        settle_ui()

    try:
        c.send("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": mobile})
        if mobile:
            c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        c.goto(); js("localStorage.clear()"); c.goto()
        wait("!!window.__pap && !document.getElementById('curtain')", "boot", 60)
        # A real new game through the creation screen.
        click(button("New Game"), "New Game")
        wait("window.__pap.currentName === 'create'", "character creation")
        js("(() => { const i = document.querySelector('.pp-create input'); i.value = 'Judge'; i.dispatchEvent(new Event('input', { bubbles: true })); })()")
        click(f"[...document.querySelectorAll('.pp-create button, .pp-create [role=button]')].find(b => b.textContent.includes('{CITY[start]}'))", "the starting city")
        click(button("Get my passport"), "Get my passport")
        wait("window.__pap.currentName === 'scene'", "the first scene", 40)
        settle_ui()
        assert js("window.__pap.career.startClubId") == start
        note("career created")

        order = [start] + [x for x in CLUBS if x != start]
        for n, club in enumerate(order):
            if js("window.__pap.career.location.clubId") != club:
                travel(club)
            enter_club(club)
            fmt = js(f"import('./js/data/config.js').then(m => m.TOURNAMENT.format['{club}'])", await_promise=True)
            if n == 0:
                # Unhappy paths: lose the first game (Swiss plays on; knockout ends).
                tournament_game(club, win=False)
                run_ = json.loads(js(f"JSON.stringify(window.__pap.career.tournaments['{club}'])"))
                if fmt == "knockout":
                    assert run_["outcome"] == "eliminated", run_["outcome"]
                    note("knocked out in round 1, re-entering")
                # Win through to the final and LOSE it, then win the event again.
                while not js(f"!!window.__pap.career.tournaments['{club}'].completed"):
                    final = js(f"window.__pap.career.tournaments['{club}'].stage === 'final'")
                    tournament_game(club, win=not final)
                outcome = js(f"window.__pap.career.tournaments['{club}'].outcome")
                note(f"first event ended: {outcome}")
                assert not js(f"!!window.__pap.career.trophies['{club}']"), "no trophy without winning the final"
                if outcome != "runner-up":
                    # Reach the Star final and lose it: runner-up, no trophy.
                    while not js(f"!!window.__pap.career.tournaments['{club}'].completed && window.__pap.career.tournaments['{club}'].attempt > 1"):
                        final = js(f"window.__pap.career.tournaments['{club}']?.stage === 'final'")
                        tournament_game(club, win=not final)
                    outcome = js(f"window.__pap.career.tournaments['{club}'].outcome")
                    note(f"second event ended: {outcome}")
                    assert outcome == "runner-up" and not js(f"!!window.__pap.career.trophies['{club}']"), outcome
            while not js(f"!!window.__pap.career.trophies['{club}']"):
                tournament_game(club, win=True)
                assert js(f"window.__pap.career.tournaments['{club}'].attempt") <= 4, "too many attempts"
            trophies = js("Object.keys(window.__pap.career.trophies).length")
            note(f"{club} trophy ({trophies}/6), coins {js('window.__pap.career.coins')}, games {games}")
            assert trophies == n + 1

        assert js("window.__pap.career.finale.unlocked"), "Madrid unlocked"
        travel("mad")
        walk_to("Palacio")
        wait("window.__pap.career.location.sceneId === 'mad-int' && !!document.querySelector('.pp-actor')", "the Palacio")
        settle_ui()
        lost_once = False
        while not js("window.__pap.career.completed"):
            walk_to("Championship stage")
            wait(f"!!{button('vs ')}", "the finale panel", 30)
            click(button("vs "), "the finale round")
            settle_ui(prefer=r"Continue", until="window.__pap.currentName === 'match'", timeout=40)
            win = lost_once
            play_current(win)
            if not win:
                lost_once = True
                settle_ui()
                note("lost a Madrid round, replaying")
            else:
                settle_ui(until="window.__pap.currentName === 'ending' || (!!document.querySelector('.pp-scene') && !document.querySelector('.pp-overlay, .pp-dialogue'))")
        wait("window.__pap.currentName === 'ending'", "the ending", 30)
        note(f"ENDING reached after {games} games")
        # A finished campaign can still open the journal.
        click(button("Open the journal"), "Open the journal")
        wait("window.__pap.currentName === 'journal'", "the journal after the ending")
        saved = json.loads(js("localStorage.getItem('PAP_career_v1')"))
        assert saved["completed"], "completion saved"
        errs = [e for e in c.errors() if "favicon" not in e]
        if errs:
            raise Stuck(f"console errors: {errs[:3]}")
        return True
    except (Stuck, AssertionError) as error:
        print(f"  FAIL [{start}] {error}")
        try:
            with open(os.path.join(cdp.SHOTS, f"stuck-{start}.json"), "w") as fh:
                fh.write(js("localStorage.getItem('PAP_career_v1')") or "null")
        except Exception:  # noqa: BLE001
            pass
        return False
    finally:
        c.close()


failed = [s for s in starts if not run(s)]
print(f"{len(failed)} of {len(starts)} campaign(s) failed {failed}" if failed else f"all {len(starts)} campaign(s) completed")
sys.exit(1 if failed else 0)
