#!/usr/bin/env python3
"""
tools/cdp_lessons.py - the club practice tree in a real browser.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_lessons.py [390x844]

  1. the practice hotspot offers the tree, and the tree opens
  2. at zero trophies the beginner tier is open and every later tier is locked,
     each saying how many Club Trophies it needs
  3. a lesson's instructions are readable and count as read
  4. the animated demonstration steps frame by frame, the board changes with it,
     and reaching the last frame counts as watched
  5. a move challenge accepts its verified answer, rejects a wrong move with the
     authored reason, and pays XP once
  6. a square challenge accepts a tap on its target
  7. finishing everything in a lesson completes it and pays the lesson XP
  8. a Club Trophy opens the next tier, and nothing already open closes
  9. an earlier, already-complete lesson can still be replayed (nothing is a
     one-way door)
 10. no console errors, and the page never scrolls
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
    c.eval(cdp.NEW_CAREER % ("boy", "nyc"), await_promise=True)

    # ------------------------------------------------ 1. the hotspot and tree
    c.eval("window.__pap.go('scene', { sceneId: 'nyc-int' }).then(() => 1)", await_promise=True)
    c.wait_for("!!document.querySelector('.pp-actor')", timeout=15)
    c.pump(1)
    c.eval("[...document.querySelectorAll('.pp-hotspot')].find(b => /Practice|Study/.test(b.getAttribute('aria-label'))).click()")
    check(c.wait_for("document.querySelectorAll('.pp-practice__option').length === 5", timeout=20), "practice room lists the tree with the other four options")
    c.eval("[...document.querySelectorAll('.pp-practice__option')].find(b => b.textContent.includes('Practice tree')).click()")
    check(c.wait_for("!!document.querySelector('.pp-tree__list')", timeout=15), "the practice tree opens")
    c.pump(0.6); c.shot(f"l1-tree-{spec}")

    # ----------------------------------------- 2. what is open at zero trophies
    open_tiers = c.eval("document.querySelectorAll('.pp-tree__tier:not(.is-locked)').length")
    locked = c.eval("document.querySelectorAll('.pp-tree__tier.is-locked').length")
    check(open_tiers == 1 and locked == 6, f"one tier open, six locked at zero trophies (got {open_tiers}/{locked})")
    bands = c.eval("[...document.querySelectorAll('.pp-tree__tier:not(.is-locked) .pp-tree__bandlabel')].map(e => e.textContent)")
    check(bands == ["Start", "100", "200", "300", "400", "500", "600"], f"the open tier is the beginner path up to 600 ({bands})")
    pills = c.eval("[...document.querySelectorAll('.pp-tree__tier.is-locked .pp-pill--locked')].map(e => e.textContent.trim())")
    check(all("trophy" in p or "trophies" in p for p in pills) and len(pills) == 6, f"every locked tier names the trophies it needs ({pills[:2]})")
    open_lessons = c.eval("document.querySelectorAll('.pp-tree__lesson').length")
    check(open_lessons == 37, f"37 beginner lessons are open (got {open_lessons})")

    # --------------------------------------------- 3. instructions count as read
    c.eval("""(async () => { const m = await import('./js/data/lessons.js');
      window.__pap.current.tree.open(m.lessonById('fork')); return 1; })()""", await_promise=True)
    check(c.wait_for("!!window.__pap.current.lesson && !!document.querySelector('.pp-lesson__text')", timeout=15), "a lesson opens on its instructions")
    text = c.eval("document.querySelector('.pp-lesson__text').textContent")
    check(len(text) > 80 and "fork" in text.lower(), f"the instructions are there to read ({len(text)} chars)")
    check(c.eval("!!window.__pap.career.lessons.fork.read"), "opening the instructions marks them read")
    c.pump(0.4); c.shot(f"l2-read-{spec}")

    # ------------------------------------------------- 4. the animated demo
    c.eval("window.__pap.current.lesson.setStep('watch')")
    c.pump(0.5)
    frames = c.eval("window.__pap.current.lesson.data.demo.length")
    first_fen = c.eval("document.querySelectorAll('.cwt-piece').length")
    positions = set()
    for i in range(frames):
        c.eval(f"window.__pap.current.lesson.goFrame({i})")
        c.pump(0.35)
        positions.add(c.eval("[...document.querySelectorAll('.cwt-piece')].map(p => p.className + p.style.transform).join('|')"))
        if i == 1:
            c.shot(f"l3-watch-{spec}")
    check(len(positions) >= 2, f"the board really changes across the {frames} demo frames ({len(positions)} distinct)")
    check(c.eval("document.querySelector('.pp-lesson__frame .pp-lesson__text').textContent.trim().length") > 0, "each frame has its own text")
    check(c.eval("!!window.__pap.career.lessons.fork.watched"), "reaching the last frame marks the demo watched")

    # -------------------------------------------- 5. a move challenge, both ways
    c.eval("window.__pap.current.lesson.setStep('solve')")
    check(c.wait_for("window.__pap.current.lesson.step === 'solve' && document.querySelectorAll('.cwt-piece').length > 0", timeout=15), "challenges open with a position")
    c.pump(0.5); c.shot(f"l4-challenge-{spec}")
    info = c.eval("(() => { const c = window.__pap.current.lesson.challenge; return { id: c.id, kind: c.kind, answer: c.answers && c.answers[0], legal: c.verdicts ? Object.keys(c.verdicts) : [] }; })()")
    wrong = next((u for u in info["legal"] if u != info["answer"]), None)
    if wrong:
        c.eval(f"window.__pap.current.lesson.attempt('{wrong}')", await_promise=True)
        c.pump(0.4)
        verdict = c.eval("document.querySelector('.pp-lesson__verdict').textContent")
        check(len(verdict) > 20 and c.eval("!window.__pap.career.lessons.fork.solved['%s']" % info["id"]),
              f"a wrong move is refused with the authored reason ({verdict[:50]!r})")
        c.pump(1.7)
    xp_before = c.eval("window.__pap.career.xp")
    c.eval(f"window.__pap.current.lesson.attempt('{info['answer']}')", await_promise=True)
    c.pump(0.6)
    check(c.eval("!!window.__pap.career.lessons.fork.solved['%s']" % info["id"]), "the verified answer is accepted and recorded")
    check(c.eval("window.__pap.career.xp") > xp_before, f"solving pays XP ({xp_before} -> {c.eval('window.__pap.career.xp')})")
    again = c.eval("window.__pap.career.xp")
    c.eval("window.__pap.current.lesson.loadChallenge(window.__pap.current.lesson.index)")
    c.pump(0.3)
    c.eval(f"window.__pap.current.lesson.attempt('{info['answer']}')", await_promise=True)
    c.pump(0.4)
    check(c.eval("window.__pap.career.xp") == again, "solving the same challenge again pays nothing, and is still allowed")

    # ------------------------------------------------- 6. a square challenge
    sq = c.eval("""(async () => {
      const m = await import('./js/data/lessons.js');
      const l = m.LESSONS.find(x => x.band <= 600 && x.challenges.some(c => c.kind === 'square'));
      return l ? { id: l.id, challenge: l.challenges.findIndex(c => c.kind === 'square') } : null; })()""", await_promise=True)
    check(bool(sq), "the beginner tier has square-tapping challenges")
    if sq:
        c.eval(f"window.__pap.go('lesson', {{ lessonId: '{sq['id']}', clubId: 'nyc', returnScene: 'nyc-int' }}).then(() => 1)", await_promise=True)
        c.wait_for("!!window.__pap.current.lesson", timeout=15)
        c.eval(f"window.__pap.current.lesson.setStep('solve'); window.__pap.current.lesson.loadChallenge({sq['challenge']})")
        c.pump(0.5)
        target = c.eval("window.__pap.current.lesson.challenge.target")
        c.eval("window.__pap.current.lesson.attempt('a1' === window.__pap.current.lesson.challenge.target ? 'h8' : 'a1')", await_promise=True)
        c.pump(0.3)
        check("Not" in c.eval("document.querySelector('.pp-lesson__verdict').textContent"), "tapping the wrong square is refused")
        c.eval(f"window.__pap.current.lesson.attempt('{target}')", await_promise=True)
        c.pump(0.4)
        check(c.eval(f"!!window.__pap.career.lessons['{sq['id']}'].solved[window.__pap.current.lesson.challenge.id]"),
              f"tapping {target} solves the square challenge")
        c.shot(f"l5-square-{spec}")

    # --------------------------------------------- 7. finishing a whole lesson
    c.eval("""(async () => {
      const m = await import('./js/data/lessons.js');
      const l = m.lessonById('fork');
      await window.__pap.go('lesson', { lessonId: 'fork', clubId: 'nyc', returnScene: 'nyc-int' });
      const run = window.__pap.current.lesson;
      run.setStep('solve');
      for (let i = 0; i < l.challenges.length; i += 1) {
        run.loadChallenge(i);
        const ch = run.challenge;
        await run.attempt(ch.kind === 'square' ? ch.target : ch.answers[0]);
      }
      return 1; })()""", await_promise=True)
    c.pump(1.2)
    done = c.eval("!!window.__pap.career.lessons.fork.done")
    stats = c.eval("({ lessons: window.__pap.career.stats.lessonsDone, challenges: window.__pap.career.stats.lessonChallenges })")
    check(done, "a lesson with everything read, watched and solved is complete")
    check(stats["lessons"] >= 1 and stats["challenges"] >= 5, f"career stats count the practice ({stats})")
    c.shot(f"l6-complete-{spec}")

    # ------------------------------------------------- 8. a trophy opens a tier
    c.eval("""(() => { const a = window.__pap;
      a.career.trophies.nyc = { wonAt: Date.now(), starElo: 800, tier: 0 };
      a.save(); return 1; })()""")
    c.eval("window.__pap.go('practice', { clubId: 'nyc', returnScene: 'nyc-int' }).then(() => 1)", await_promise=True)
    c.wait_for("!!document.querySelector('.pp-tree__list')", timeout=15)
    c.pump(0.5)
    open2 = c.eval("document.querySelectorAll('.pp-tree__tier:not(.is-locked)').length")
    lessons2 = c.eval("document.querySelectorAll('.pp-tree__lesson').length")
    check(open2 == 2, f"one Club Trophy opens the second tier (got {open2} open)")
    check(lessons2 > open_lessons, f"and adds lessons without removing any ({open_lessons} -> {lessons2})")
    bands2 = c.eval("[...document.querySelectorAll('.pp-tree__tier:not(.is-locked) .pp-tree__bandlabel')].map(e => e.textContent)")
    check("700" in bands2 and "Start" in bands2, f"the new bands are 700-800 and the old ones are still there ({bands2})")
    c.shot(f"l7-unlocked-{spec}")

    # ------------------------------------- 9. an old lesson is still replayable
    c.eval("""(async () => {
      await window.__pap.go('lesson', { lessonId: 'fork', clubId: 'nyc', returnScene: 'nyc-int' });
      window.__pap.current.lesson.setStep('solve');
      return 1; })()""", await_promise=True)
    c.pump(0.5)
    check(c.eval("window.__pap.current.lesson.step === 'solve' && !!window.__pap.career.lessons.fork.done"),
          "a completed lesson still opens and can be replayed")

    # ------------------------------------------- 10. console and page scrolling
    errors = [e for e in c.errors() if "favicon" not in str(e)]
    check(not errors, f"no console errors ({[str(e)[:70] for e in errors[:3]]})")
    for screen, go in (("tree", "window.__pap.go('practice', { clubId: 'nyc', returnScene: 'nyc-int' })"),
                       ("lesson", "window.__pap.go('lesson', { lessonId: 'fork', clubId: 'nyc', returnScene: 'nyc-int' })")):
        c.eval(f"{go}.then(() => 1)", await_promise=True)
        c.pump(0.8)
        scroll = c.eval("({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight })")
        check(scroll["x"] <= 1 and scroll["y"] <= 1, f"the {screen} screen does not scroll the page ({scroll})")
        off = c.eval("""(() => {
          const scrollsOnItsOwn = (el) => {
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              if (p.matches('#app > .pp-screen')) return false;
              const cs = getComputedStyle(p);
              if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return true;
            }
            return false;
          };
          return [...document.querySelectorAll('.pp-screen button')].filter((b) => {
            const r = b.getBoundingClientRect();
            if (!r.width) return false;
            if (r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 && r.top >= -1) return false;
            return !scrollsOnItsOwn(b);
          }).map((b) => (b.textContent || b.getAttribute('aria-label') || '?').trim().slice(0, 24));
        })()""")
        check(not off, f"every button on the {screen} screen is reachable ({off[:4]})")

    print("\n" + (f"{len(fails)} FAILURES:\n - " + "\n - ".join(fails) if fails else "PRACTICE TREE OK"))
finally:
    c.close()
sys.exit(1 if fails else 0)
