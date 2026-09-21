#!/usr/bin/env python3
"""
tools/cdp_release.py - the release checks that need a real browser.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_release.py

Covers what the Node tests cannot: that the soundtrack really loads and
changes track, that a difficulty chosen in Settings survives a reload, and
that ?debugCollision=1 paints an overlay while a normal run paints none.
"""
import sys

from cdp import Chrome, BASE  # noqa: E402

FAILS = []


def check(name, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{(' - ' + str(detail)) if detail and not ok else ''}")
    if not ok:
        FAILS.append(name)


def main():
    c = Chrome()
    try:
        # ---------------------------------------------------------- music --
        c.goto("", settle=2.5)
        c.eval("""
          window.__music = null;
          import('./js/ui/music.js').then(m => { window.__music = m; });
          1""")
        c.wait_for("!!window.__music", timeout=20)
        tracks = c.eval("JSON.stringify(window.__music.TRACKS)")
        check("music module exposes four tracks", tracks and tracks.count("assets/audio/") == 4, tracks)
        check("no long original filename in a track path", "%20" not in (tracks or "") and "Town Square" not in (tracks or ""), tracks)

        # Every file really serves.
        served = c.eval("""
          Promise.all(Object.values(window.__music.TRACKS).map(u =>
            fetch(u, { method: 'HEAD' }).then(r => r.status + ':' + (r.headers.get('content-length') || '0')).catch(e => 'ERR')
          )).then(a => a.join(' '))""", await_promise=True)
        check("every track is served", served and "ERR" not in served and "404" not in served, served)

        # Asking for the same track twice must not restart it.
        c.eval("window.__music.configure({ music: true, volume: 0.5 }); window.__music.play('town'); 1")
        c.pump(0.6)
        again = c.eval("""
          (() => { const a = window.__music.playing(); window.__music.play('town');
                   return a + '/' + window.__music.playing(); })()""")
        check("re-asking for the playing track is a no-op", again == "town/town", again)
        crossfade = c.eval("window.__music.CROSSFADE_MS")
        check("crossfade is 0.7-1.2s", 700 <= int(crossfade or 0) <= 1200, crossfade)
        c.eval("window.__music.stop({ ms: 1 }); 1")

        # ----------------------------------------------------- difficulty --
        c.eval("""
          localStorage.clear();
          Promise.all([import('./js/core/career.js'), import('./js/core/save.js')]).then(([C, S]) => {
            const career = C.newCareer({ name: 'Rel', avatar: 'boy', startClubId: 'nyc' });
            career.difficulty = 'hard';
            S.saveCareer(career);
            window.__wrote = career.difficulty;
          }); 1""")
        c.wait_for("window.__wrote === 'hard'", timeout=20)
        c.goto("", settle=2.0)                      # a real reload
        back = c.eval("""
          import('./js/core/save.js').then(S => { window.__read = (S.loadCareer() || {}).difficulty; }); 1""")
        c.wait_for("window.__read !== undefined", timeout=20)
        check("difficulty survives a reload", c.eval("window.__read") == "hard", c.eval("window.__read"))

        default_mode = c.eval("""
          (() => { let v = null; return import('./js/data/config.js').then(m => m.DIFFICULTY.default); })()""",
                              await_promise=True)
        check("the default mode is normal", default_mode == "normal", default_mode)

        # ------------------------------------------------ collision debug --
        c.goto("?scene=nyc-int", settle=3.0)
        plain = c.eval("document.querySelectorAll('.pp-scene__collision').length")
        check("no collision overlay in a normal run", plain == 0, plain)
        c.goto("?scene=nyc-int&debugCollision=1", settle=3.0)
        debug = c.eval("document.querySelectorAll('.pp-scene__collision').length")
        check("?debugCollision=1 paints the overlay", debug == 1, debug)

        errors = [e for e in c.errors() if "favicon" not in e]
        check("no console errors", not errors, errors[:3])
    finally:
        c.close()

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
