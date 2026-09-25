#!/usr/bin/env python3
"""
tools/cdp_citypop.py - the world map's city preview, in the browser.

    python3 tools/serve.py 8123 &
    python3 tools/cdp_citypop.py [WIDTHxHEIGHT ...]     (default 1440x900 390x844 844x390)

Per viewport: no plane on the map, every pin has the pin marker, a pin opens
the preview, the preview fits the window (no page scroll), its picture, title
and info are filled, the map button closes it, and the fly button travels.
Screenshots: $PAP_SHOTS/citypop-<w>x<h>.png
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


sizes = [tuple(map(int, a.split('x'))) for a in sys.argv[1:]] or [(1440, 900), (390, 844), (844, 390)]
for w, hgt in sizes:
    print(f'{w}x{hgt}')
    c = cdp.Chrome(w, hgt)
    try:
        c.goto(settle=3); c.eval("localStorage.clear()"); c.goto(settle=3)
        assert c.wait_for("!!window.__pap && !document.getElementById('curtain')", timeout=90), "boot"
        c.eval(cdp.NEW_CAREER % ("girl", "nyc"), await_promise=True)
        c.eval("window.__pap.go('map').then(() => 1)", await_promise=True)
        c.wait_for("document.querySelectorAll('.pp-pin').length === 7", timeout=20)
        c.pump(1)
        c.eval("document.querySelectorAll('.pp-coach, .pp-overlay').forEach(e => e.remove())")
        check(not c.eval("!!document.querySelector('.pp-map__plane')"), 'no plane on the map')
        check(c.eval("[...document.querySelectorAll('.pp-pin')].every(p => p.querySelector('img.pp-pin__marker'))"), 'every pin has the pin marker')
        check(not c.eval("!!document.querySelector('.pp-citypop')"), 'no preview until a city is chosen')
        c.eval("[...document.querySelectorAll('.pp-pin')].find(p => p.getAttribute('aria-label').startsWith('Vienna')).click()")
        check(c.wait_for("!!document.querySelector('.pp-citypop')", timeout=5), 'a pin opens the preview')
        c.pump(1.2)
        box = json.loads(c.eval("""JSON.stringify((() => { const r = document.querySelector('.pp-citypop').getBoundingClientRect();
            const pic = document.querySelector('.pp-citypop__pic');
            return { t: r.top, b: r.bottom, l: r.left, r: r.right, vw: innerWidth, vh: innerHeight,
              scroll: document.scrollingElement.scrollHeight > innerHeight + 1,
              hscroll: (() => { const o = document.querySelector('.pp-overlay'); return o.scrollWidth > o.clientWidth + 1 || o.scrollHeight > o.clientHeight + 1; })(),
              pic: pic.complete && pic.naturalWidth > 0, frame: document.querySelector('.pp-citypop__frame').naturalWidth,
              title: document.querySelector('.pp-citypop__title').textContent,
              info: document.querySelector('.pp-citypop__info').textContent,
              infoFits: [...document.querySelectorAll('.pp-citypop__info > *')].every(e => e.scrollWidth <= e.clientWidth + 1),
              lit: document.querySelectorAll('.pp-citypop__tile.is-lit').length }; })())"""))
        print('   ', box)
        check(box['t'] >= -1 and box['l'] >= -1 and box['b'] <= box['vh'] + 1 and box['r'] <= box['vw'] + 1, 'the preview fits the window')
        check(not box['scroll'], 'the page does not scroll')
        check(not box['hscroll'], 'the preview layer does not scroll either')
        check(box['pic'] and box['frame'] > 0, 'city picture and frame loaded')
        check(box['title'] == 'Vienna' and 'Vienna' in box['info'], 'title and info filled')
        check(box['infoFits'], 'info lines fit (ellipsis at most)')
        c.shot(f'citypop-{w}x{hgt}')
        c.eval("document.querySelector('.pp-citypop__close').click()")
        check(c.wait_for("!document.querySelector('.pp-citypop')", timeout=5), 'the map button closes it')
        c.eval("[...document.querySelectorAll('.pp-pin')].find(p => p.getAttribute('aria-label').startsWith('Madrid')).click()")
        c.wait_for("!!document.querySelector('.pp-citypop')", timeout=5)
        check(c.eval("document.querySelector('.pp-citypop__fly').disabled"), 'Madrid is locked')
        c.shot(f'citypop-madrid-{w}x{hgt}')
        c.eval("document.querySelector('.pp-citypop__close').click()")
        c.eval("[...document.querySelectorAll('.pp-pin')].find(p => p.getAttribute('aria-label').startsWith('London')).click()")
        c.wait_for("!!document.querySelector('.pp-citypop')", timeout=5)
        c.eval("document.querySelector('.pp-citypop__fly').click()")
        check(c.wait_for("window.__pap.currentName === 'scene' && !!document.querySelector('.pp-scene__bg[src*=\"lon-\"]')", timeout=20), 'fly travels to the city')
        for e in c.errors():
            fails.append(f'console: {e[:160]}')
            print('  CONSOLE', e[:200])
    finally:
        c.close()
print(f'\n{len(fails)} failure(s)')
for f in fails:
    print('  FAIL', f)
sys.exit(1 if fails else 0)
