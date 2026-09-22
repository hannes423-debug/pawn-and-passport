#!/usr/bin/env python3
"""
tools/cdp_members.py - club members, challenges for coins, the tournament desk.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_members.py [390x844] [--scenes]

  1. members stand in the club under a speech bubble - NOT under a permanent
     name tag - and are listed by name in the dock
  2. talking to one offers a challenge with a stake; accepting starts a
     challenge match that shows the stake; losing it costs exactly the stake
  3. the tournament desk enters a real event (16-player Swiss in New York)
     with a standings table; a played round reports the other results
  4. the match's Notes button hides the opening card, and it stays hidden
  --scenes  also screenshots every scene that has members, for review
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


def click_through_dialogue(c, action_text, timeout=15):
    """Advance a dialogue line by line until a button with `action_text` shows, then press it."""
    for _ in range(40):
        found = c.eval(f"""(() => {{
          const b = [...document.querySelectorAll('.pp-dialogue__actions button')].find(x => x.textContent.includes({action_text!r}));
          if (b) {{ b.click(); return true; }}
          const d = document.querySelector('.pp-dialogue'); if (d) d.click();
          return false; }})()""")
        if found:
            return True
        c.pump(0.35)
    return False


def finish_game(c, resign=True):
    c.wait_for("!!document.querySelector('.pp-match') && !!window.__pap.current?.match", timeout=30)
    c.pump(1.5)
    if resign:
        c.eval("window.__pap.current.match.resign()")
    return c.wait_for("!!document.querySelector('.pp-result__word')", timeout=40)


c = cdp.Chrome(W, H)
try:
    c.send("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": mobile})
    if mobile:
        c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    c.goto(); c.eval("localStorage.clear()"); c.goto()
    c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=60)
    c.eval(cdp.NEW_CAREER % ("boy", "nyc"), await_promise=True)

    # 1. members in the club
    c.eval("window.__pap.go('scene', { sceneId: 'nyc-int' }).then(() => 1)", await_promise=True)
    c.wait_for("!!document.querySelector('.pp-actor')", timeout=15)
    c.pump(1.2)
    tags = c.eval("document.querySelectorAll('.pp-hotspot.is-member').length")
    actors = c.eval("document.querySelectorAll('canvas.pp-actor').length")
    people = c.eval("document.querySelectorAll('.pp-scene__people button').length")
    check(tags >= 2, f"members stand in nyc-int ({tags})")
    # Every member wears the speech bubble; NONE of them shows a name until
    # the player is near, or the room is a wall of name plates.
    bubbles = c.eval("document.querySelectorAll('.pp-hotspot.is-member .pp-hotspot__bubble img.pp-ico').length")
    check(bubbles == tags, f"every member has a speech-bubble icon ({bubbles}/{tags})")
    shown = c.eval("""[...document.querySelectorAll('.pp-hotspot.is-member .pp-hotspot__name')]
        .filter((n) => getComputedStyle(n).visibility !== 'hidden').length""")
    check(shown == 0, f"no member name is on screen before the player walks up ({shown} showing)")
    # Walking up to one reveals THAT name and no other.
    c.eval("""(() => { const s = window.__pap.current; const spot = document.querySelector('.pp-hotspot.is-member');
        spot.classList.add('is-near'); return 1; })()""")
    c.pump(0.4)
    near = c.eval("""[...document.querySelectorAll('.pp-hotspot.is-member .pp-hotspot__name')]
        .filter((n) => getComputedStyle(n).visibility !== 'hidden').map((n) => n.textContent)""")
    check(len(near) == 1 and near[0], f"approaching a member shows only that name ({near})")
    c.eval("document.querySelector('.pp-hotspot.is-member').classList.remove('is-near')")
    check(actors >= tags + 3, f"members are drawn as characters ({actors} actors)")
    check(people == tags, f"members are listed in the dock ({people})")
    hud = c.eval("document.querySelector('.pp-hud__coins b')?.textContent")
    check(hud == "100", f"the HUD shows 100 coins at the start ({hud})")
    c.shot(f"m1-members-{spec}")

    # 2. talk and challenge
    c.eval("document.querySelector('.pp-hotspot.is-member').click()")
    check(c.wait_for("!!document.querySelector('.pp-dialogue')", timeout=15), "walking up to a member opens a dialogue")
    c.pump(0.5); c.shot(f"m2-talk-{spec}")
    check(click_through_dialogue(c, "Play White"), "the dialogue ends in a challenge with a stake")
    ok = c.wait_for("!!document.querySelector('.pp-match')", timeout=20)
    kind = c.eval("document.querySelector('.pp-match__kind')?.textContent || ''")
    check(ok and "Challenge" in kind and "coins" in kind, f"a challenge match starts and shows its stake ({kind!r})")
    stake = c.eval("window.__pap.current.match.opponent.stake")
    c.shot(f"m3-challenge-{spec}")

    # 4 (in this match). The notes toggle.
    btn = c.eval("!!document.querySelector('.pp-notesbtn')")
    check(btn, "the match has a Notes button")
    c.eval("document.querySelector('.pp-notesbtn').click()")
    c.pump(0.3)
    check(c.eval("window.__pap.settings.openingNotes") is False, "Notes off is saved in the settings")
    c.eval("""(() => { const sq = document.querySelector('.pp-board, .pp-boardframe'); const r = sq.getBoundingClientRect();
      sq.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.56, clientY: r.top + r.height * 0.69, pointerType: 'mouse', bubbles: true })); })()""")
    c.pump(0.3)
    check(c.eval("document.querySelector('.pp-tip').hidden") is True, "with Notes off the card does not appear")
    c.eval("document.querySelector('.pp-notesbtn').click()")

    check(finish_game(c), "the challenge ends with a result card")
    coins_text = c.eval("document.querySelector('.pp-result').textContent")
    check("coins" in coins_text, f"the result says what the stake did ({coins_text[-60:]!r})")
    c.shot(f"m4-challenge-result-{spec}")
    c.eval("[...document.querySelectorAll('.pp-modal button')].find(b => b.textContent.includes('Continue')).click()")
    c.wait_for("!!document.querySelector('.pp-scene')", timeout=20)
    coins = c.eval("window.__pap.career.coins")
    check(coins == 100 - stake, f"losing cost exactly the stake ({coins} = 100 - {stake})")
    record = c.eval("JSON.stringify(window.__pap.career.memberRecords)")
    check('"l":1' in (record or ""), f"the head-to-head record is kept ({record})")

    # 3. the tournament desk
    c.pump(1)
    c.eval("[...document.querySelectorAll('.pp-hotspot')].find(b => /Tournament/.test(b.getAttribute('aria-label'))).click()")
    check(c.wait_for("[...document.querySelectorAll('.pp-modal button')].some(b => b.textContent.includes('Enter the tournament'))", timeout=20),
          "the desk explains the event and offers entry")
    c.shot(f"m5-desk-intro-{spec}")
    c.eval("[...document.querySelectorAll('.pp-modal button')].find(b => b.textContent.includes('Enter the tournament')).click()")
    check(c.wait_for("document.querySelectorAll('.pp-standings tbody tr').length === 16", timeout=10), "a 16-player Swiss table is shown")
    c.pump(0.4); c.shot(f"m6-desk-standings-{spec}")
    c.eval("[...document.querySelectorAll('.pp-modal button')].find(b => b.textContent.includes('Play round')).click()")
    ok = c.wait_for("!!document.querySelector('.pp-match')", timeout=20)
    kind = c.eval("document.querySelector('.pp-match__kind')?.textContent || ''")
    check(ok and "Tournament" in kind, f"round 1 starts ({kind!r})")
    check(finish_game(c), "round 1 ends")
    c.eval("[...document.querySelectorAll('.pp-modal button')].find(b => b.textContent.includes('Continue')).click()")
    check(c.wait_for("document.querySelectorAll('.pp-results li').length === 8", timeout=15), "the round report lists all 8 games")
    simulated = c.eval("window.__pap.career.tournaments.nyc.rounds[0].pairings.filter(p => p.result !== null).length")
    check(simulated == 8, f"every other game of the round has a result ({simulated}/8)")
    c.pump(0.4); c.shot(f"m7-round-report-{spec}")
    c.eval("[...document.querySelectorAll('.pp-modal button')].find(b => b.textContent.includes('Continue')).click()")
    check(c.wait_for("!!document.querySelector('.pp-scene')", timeout=20), "back in the club after the report")
    rnd = c.eval("window.__pap.career.tournaments.nyc.round")
    check(rnd == 1, f"the event moved on to round 2 ({rnd})")

    if "--scenes" in sys.argv:
        scenes = c.eval("import('./js/data/memberSpots.js').then(m => Object.keys(m.MEMBER_SPOTS))", await_promise=True)
        for sid in scenes:
            c.eval(f"window.__pap.go('scene', {{ sceneId: '{sid}' }}).then(() => 1)", await_promise=True)
            c.wait_for("!!document.querySelector('.pp-actor')", timeout=15)
            c.pump(1.0)
            c.shot(f"scene-{sid}-{spec}")

    errs = [e for e in c.errors() if "favicon" not in e]
    check(not errs, f"no console errors ({errs[:3]})")
finally:
    c.close()

print(f"{len(fails)} failed" if fails else "all passed")
sys.exit(1 if fails else 0)
