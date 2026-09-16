/**
 * journal.js - the travel journal.
 *
 *   Passport    profile page + the Club Trophy shelf (album art)
 *   Openings    six opening slots, WHITE 1-3 / BLACK 1-3, and the seven
 *               location polaroids (openings book art)
 *   Postcards   the six collectibles, flip to read the back
 *   Career      Brilliant / Epic / Clutch totals, scores, records
 *   Beyond      hidden until all six postcards are held
 *
 * Content is laid over the empty slots painted in the book art; slot rects
 * are percentages measured from the source images.
 */

import { h, button } from '../dom.js';
import { openOpeningStudy } from '../openingStudy.js';
import { tapWord } from '../touch.js';
import { sfx } from '../audio.js';
import { portraitUrl, PLAYER_LOOKS } from '../sprites.js';
import { CLUBS, FINALE, clubById } from '../../data/clubs.js';
import { OPENINGS } from '../../data/openings.js';
import { POSTCARDS, BEYOND_THE_TOUR } from '../../data/postcards.js';
import { starById } from '../../data/starPlayers.js';
import { GRADE_META } from '../../core/grading.js';
import { hasAllPostcards, masteryState, trophyCount, postcardCount, missionProgress, xpProgress, maxFocus, hintPlies, repertoireSlots, equipOpening, unequipOpening, isUnlocked } from '../../core/career.js';

const pct = (x0, y0, x1, y1) => ({ left: `${x0}%`, top: `${y0}%`, width: `${x1 - x0}%`, height: `${y1 - y0}%` });

const ALBUM = {
  photo: pct(11.5, 27.5, 23.5, 48.5),
  fields: [[25, 29.5], [31, 35], [36.5, 41], [42, 46.5], [48, 52.5], [53.5, 58.5]].map(([a, b]) => pct(30.2, a, 46.8, b)),
  notes: pct(11.5, 60.5, 46.5, 74.5),
  banner: pct(62, 21.2, 82, 26.5),
  trophies: [[28, 50], [52, 74]].flatMap(([y0, y1]) => [[52.8, 61.8], [62.8, 71.8], [72.8, 81.8], [82.8, 91.8]].map(([x0, x1]) => pct(x0, y0 + 1, x1, y1 - 1)))
};
const BOOK = {
  white: [[11.2, 22.3], [23.8, 34.8], [36.2, 47.3]].map(([x0, x1]) => pct(x0 + 0.5, 27.5, x1 - 0.5, 44.5)),
  black: [[11.2, 22.3], [23.8, 34.8], [36.2, 47.3]].map(([x0, x1]) => pct(x0 + 0.5, 58, x1 - 0.5, 75.5)),
  polaroids: [[55.5, 22.5, 63.5, 36.5], [68, 22.5, 76.5, 35.5], [81, 22.5, 89, 35.5], [55, 46.5, 63, 60.5], [67.5, 46.5, 75.5, 60.5], [81, 46.5, 89, 60.5], [65, 69.5, 76, 82]]
    .map(([a, b, c, d]) => pct(a, b, c, d))
};

/** A postcard that flips on click. Shared with the puzzle reward. */
export function postcardFlip(postcard, { collected = true, startFlipped = false } = {}) {
  const club = clubById(postcard.clubId);
  const card = h('button.pp-postcard', {
    type: 'button', class: `${collected ? '' : 'is-locked'} ${startFlipped ? 'is-flipped' : ''}`,
    'aria-label': collected ? `Postcard from ${club.city}. ${tapWord() === 'tap' ? 'Tap' : 'Click'} to turn over.` : `Postcard from ${club.city}, not collected`,
    onclick: () => { if (!collected) return; sfx.postcard(); card.classList.toggle('is-flipped'); }
  },
    h('div.pp-postcard__inner', null,
      h('div.pp-postcard__face', null,
        h('img', { src: postcard.image, alt: '' }),
        h('span.pp-postcard__caption', { text: collected ? postcard.front : `${club.city}: ${club.casualLocationName}` })),
      h('div.pp-postcard__face.pp-postcard__back', null,
        h('div.pp-postcard__msg', null, collected ? [h('b', { text: postcard.secret[0] }), postcard.secret.slice(1), h('div.pp-small.pp-muted', { text: `- ${postcard.from}` })] : 'Not collected yet.'),
        h('div.pp-postcard__stamp', { text: postcard.stamp }))));
  return card;
}

export function journalScreen(app, params) {
  const career = app.career;
  const back = params.back || { screen: 'map', params: {} };
  const secret = hasAllPostcards(career);
  const tabs = [
    ['passport', '🛂 Passport'], ['openings', '♟ Openings & Cities'], ['postcards', `✉ Postcards ${postcardCount(career)}/6`], ['career', '📈 Career'],
    ...(secret ? [['beyond', '✦ Beyond the Tour']] : [])
  ];
  let tab = params.tab && tabs.some(([id]) => id === params.tab) ? params.tab : 'passport';
  const tabBar = h('nav.pp-journal__tabs');
  const body = h('div.pp-journal__body');

  function paintTabs() {
    tabBar.replaceChildren(...tabs.map(([id, label]) => h('button.pp-btn.pp-btn--small', {
      type: 'button', class: id === tab ? 'is-active' : '', 'aria-pressed': String(id === tab),
      onclick: () => { tab = id; sfx.click(); paint(); }
    }, label)), button('Close', () => app.go(back.screen, back.params), { cls: 'pp-btn--small pp-btn--ghost', icon: '✕' }));
  }

  /* The book art is a landscape spread: on a phone held upright it would be
     too small to read, so those pages switch to a plain list. */
  const compact = () => body.clientWidth > 0 && body.clientWidth < 640 && body.clientHeight > body.clientWidth;
  let wasCompact = null;
  const onResize = () => { if (compact() !== wasCompact && (tab === 'passport' || tab === 'openings')) paint(); };

  function paint() {
    paintTabs();
    wasCompact = compact();
    const pages = wasCompact ? { passport: passportList, openings: openingsList } : { passport, openings };
    body.replaceChildren(({ ...pages, postcards, career: careerTab, beyond })[tab]());
    if (tab === 'beyond' && !career.secretRevealSeen) { career.secretRevealSeen = true; app.save(); sfx.trophy(); }
  }

  const passport = () => {
    const book = h('div.pp-book.pp-book--album');
    const xp = xpProgress(career);
    const home = clubById(career.startClubId);
    const place = career.location.clubId === FINALE.id ? FINALE.city : clubById(career.location.clubId)?.city;
    const rows = [
      career.name,
      `Since ${new Date(career.createdAt).toLocaleDateString('en-GB')} · home: ${home.city}`,
      `Level ${career.level}${xp.max ? ' (max)' : ` · ${xp.into}/${xp.needed} XP`} · ${career.elo} Elo`,
      `Now in ${place}`,
      `🏆 ${trophyCount(career)}/6 trophies · ✉ ${postcardCount(career)}/6 postcards`,
      `Career score ${career.stats.careerScore.toLocaleString('en')}`
    ];
    book.append(h('img.pp-slot', { src: portraitUrl(PLAYER_LOOKS[career.avatar], { size: 128, ring: '#e8b04a' }), alt: '', style: { ...ALBUM.photo, objectFit: 'contain' } }));
    ALBUM.fields.forEach((rect, i) => book.append(h('div.pp-slot', { style: { ...rect, justifyContent: 'flex-start', flexDirection: 'row', paddingLeft: '2%', fontWeight: i === 0 ? 700 : 600, fontSize: 'max(9px, 1.24cqw)', whiteSpace: 'nowrap' }, text: rows[i] })));
    book.append(h('div.pp-slot', { style: { ...ALBUM.notes, fontSize: 'max(9px, 1.18cqw)', padding: '1%', textAlign: 'left', alignItems: 'flex-start' } },
      h('div', null, h('b', { text: 'Focus ' }), `${maxFocus(career.level)} max · `, h('b', { text: 'Hint ' }), hintPlies(career.level).label.toLowerCase()),
      h('div', null, career.completed ? '★ Qualified for the Big Leagues!' : career.finale.unlocked ? '🏟 Grand Finale unlocked: fly to Madrid.' : `Next goal: win ${6 - trophyCount(career)} more Club Trophies.`)));
    // The ribbon is narrow and curls at both ends: one short word in its middle.
    book.append(h('div.pp-slot', { style: { ...ALBUM.banner, fontFamily: 'var(--font-pixel)', fontSize: '0.95cqw', color: '#4a2e18', paddingBottom: '0.3cqw' }, text: 'TROPHIES' }));
    const shelf = [...CLUBS.map((c) => ({ label: c.trophyName, sub: c.city, won: !!career.trophies[c.clubId] })),
      { label: FINALE.trophyName, sub: 'Madrid', won: career.finale.won },
      { label: 'Beyond the Tour', sub: secret ? 'Secret found' : '?', won: secret, glyph: '✦' }];
    shelf.forEach((t, i) => book.append(h('div.pp-slot', { style: { ...ALBUM.trophies[i], fontSize: 'max(7px, 0.94cqw)' } },
      h('div.pp-trophy', { class: t.won ? '' : 'is-empty', text: t.glyph || (i === 6 ? '🥇' : '🏆') }),
      h('div.pp-slot__name', { text: t.won || i < 6 ? t.label : '???' }), h('div.pp-muted', { text: t.sub }))));
    return book;
  };

  const openings = () => {
    const book = h('div.pp-book.pp-book--openings');
    const slots = repertoireSlots(career.level);
    const equipped = career.equipped || [];
    for (const o of OPENINGS) {
      const m = career.openings[o.id] ?? 0;
      const rect = (o.side === 'w' ? BOOK.white : BOOK.black)[o.shelf - 1];
      const home = clubById(CLUBS.find((c) => c.openingId === o.id).clubId);
      const on = equipped.includes(o.id);
      const unlocked = isUnlocked(career, o.id);
      const toggle = h('button.pp-btn.pp-btn--small', {
        type: 'button', class: on ? 'pp-btn--gold' : '', disabled: !unlocked,
        style: { minHeight: '0', padding: '0.2cqw 0.7cqw', fontSize: 'max(10px, 0.95cqw)' },
        title: unlocked ? '' : 'Play this opening or win its club to unlock it',
        onclick: () => toggleEquip(o, on, slots)
      }, unlocked ? (on ? '✔ Equipped' : 'Equip') : '🔒');
      const studyBtn = unlocked ? h('button.pp-btn.pp-btn--small.pp-btn--blue', {
        type: 'button', title: 'Review the lines you know',
        style: { minHeight: '0', padding: '0.2cqw 0.7cqw', fontSize: 'max(10px, 0.95cqw)' },
        onclick: () => study(o.id)
      }, '📖 Study') : null;
      book.append(h('div.pp-slot', { class: m > 0 ? 'pp-slot--known' : '', style: { ...rect, fontSize: 'max(9px, 0.95cqw)', padding: '2%', gap: '3%', outline: on ? '3px solid #e8b04a' : '' }, title: `${o.description}\n\nIdea: ${o.idea}` },
        h('div.pp-slot__name', { text: m > 0 ? o.name : '???' }),
        h('div.pp-muted', { text: home.city }),
        h('div.pp-meter.pp-meter--mastery', { style: { width: '90%', height: '0.7cqw', minHeight: '6px' } }, h('div.pp-meter__fill', { style: { width: `${m}%` } })),
        h('div', null, h('b', { text: `${m}%` }), ` ${masteryState(m).label}`),
        h('div', { style: { display: 'flex', gap: '4%', justifyContent: 'center', flexWrap: 'wrap' } }, toggle, studyBtn)));
    }
    book.append(h('div.pp-slot', { style: { left: '12%', top: '84%', width: '30%', height: '5%', fontSize: 'max(10px, 1.05cqw)', background: 'rgba(255,248,230,0.92)', borderRadius: '4px' } },
      h('b', { text: `Repertoire ${equipped.length}/${slots}` }), h('span.pp-muted', { text: slots < 6 ? `more slots at higher levels` : 'all six can be equipped' })));
    const places = [...CLUBS.map((c) => ({ id: c.clubId, city: c.city, img: `assets/cities/${c.clubId}.webp`, seen: !!career.visited[c.clubId], extra: `${career.trophies[c.clubId] ? '🏆' : ''}${career.postcards[c.postcardId] ? '✉' : ''}` })),
      { id: 'mad', city: 'Madrid', img: 'assets/cities/mad.webp', seen: career.location.clubId === 'mad' || career.finale.results.length > 0, extra: career.finale.won ? '🥇' : '' }];
    places.forEach((p, i) => book.append(h('div.pp-slot', { style: { ...BOOK.polaroids[i], justifyContent: 'flex-end' }, title: p.city },
      p.seen ? h('img', { src: p.img, alt: '', style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'auto' } }) : null,
      h('span.pp-badge', { style: { position: 'relative', fontSize: 'max(8px, 0.94cqw)', marginBottom: '3%' }, text: `${p.seen ? p.city : '???'} ${p.extra}` }))));
    return book;
  };

  function toggleEquip(o, on, slots) {
    const r = on ? unequipOpening(career, o.id) : equipOpening(career, o.id);
    if (!r.ok) { app.toast(r.reason === 'full' ? `Repertoire full (${slots} slot${slots > 1 ? 's' : ''} at level ${career.level}). Unequip one first.` : 'Locked'); return; }
    sfx.stamp(); app.save(); paint();
  }

  async function study(openingId) {
    sfx.click();
    await openOpeningStudy(app, openingId, { mode: 'review' });
  }

  /* ---- phone (portrait) versions of the two book pages ---- */
  const openingsList = () => {
    const slots = repertoireSlots(career.level);
    const equipped = career.equipped || [];
    const card = (o) => {
      const m = career.openings[o.id] ?? 0;
      const home = CLUBS.find((c) => c.openingId === o.id);
      const on = equipped.includes(o.id);
      const unlocked = isUnlocked(career, o.id);
      return h('div.pp-panel.pp-openingcard', { class: on ? 'is-equipped' : '' },
        h('div.pp-openingcard__head', null,
          h('b', { text: m > 0 ? o.name : '???' }),
          h('span.pp-small.pp-muted', { text: `${o.side === 'w' ? '♔' : '♚'} ${home.city}` })),
        h('div.pp-meter.pp-meter--mastery', null, h('div.pp-meter__fill', { style: { width: `${m}%` } })),
        h('div.pp-small', null, h('b', { text: `${m}%` }), ` ${masteryState(m).label}`, m > 0 ? h('span.pp-muted', { text: ` · ${o.idea}` }) : null),
        h('div.pp-row', null,
          h('button.pp-btn.pp-btn--small', { type: 'button', class: on ? 'pp-btn--gold' : '', disabled: !unlocked, onclick: () => toggleEquip(o, on, slots) },
            unlocked ? (on ? '✔ Equipped' : 'Equip') : '🔒 Locked'),
          unlocked ? h('button.pp-btn.pp-btn--small.pp-btn--blue', { type: 'button', onclick: () => study(o.id) }, '📖 Study') : null));
    };
    return h('div.pp-journal__list', null,
      h('div.pp-panel.pp-small', null, h('b', { text: `Repertoire ${equipped.length}/${slots}` }),
        ' · Equipped openings draw guide arrows in games. Study shows the lines you know.'),
      h('h3.pp-h3.pp-journal__shelf', { text: '♔ White' }), OPENINGS.filter((o) => o.side === 'w').map(card),
      h('h3.pp-h3.pp-journal__shelf', { text: '♚ Black' }), OPENINGS.filter((o) => o.side === 'b').map(card));
  };

  const passportList = () => {
    const xp = xpProgress(career);
    const home = clubById(career.startClubId);
    const shelf = [...CLUBS.map((c) => ({ label: c.trophyName, sub: c.city, won: !!career.trophies[c.clubId] })),
      { label: FINALE.trophyName, sub: 'Madrid', won: career.finale.won }];
    return h('div.pp-journal__list', null,
      h('div.pp-panel.pp-passportcard', null,
        h('img', { src: portraitUrl(PLAYER_LOOKS[career.avatar], { size: 128, ring: '#e8b04a' }), alt: '' }),
        h('div', null,
          h('div.pp-player__name', { text: career.name }),
          h('div.pp-small', { text: `Level ${career.level}${xp.max ? ' (max)' : ` · ${xp.into}/${xp.needed} XP`} · ${career.elo} Elo` }),
          h('div.pp-small', { text: `Home: ${home.city} · since ${new Date(career.createdAt).toLocaleDateString('en-GB')}` }),
          h('div.pp-small', { text: `🏆 ${trophyCount(career)}/6 · ✉ ${postcardCount(career)}/6 · score ${career.stats.careerScore.toLocaleString('en')}` }),
          h('div.pp-small.pp-muted', { text: `Focus ${maxFocus(career.level)} max · hint: ${hintPlies(career.level).label.toLowerCase()}` }))),
      h('h3.pp-h3.pp-journal__shelf', { text: 'Trophies' }),
      h('div.pp-tiles', null, shelf.map((t) => h('div.pp-tile', { class: t.won ? 'pp-tile--epic' : '' },
        h('b.pp-trophy', { class: t.won ? '' : 'is-empty', text: '🏆' }), h('span', { text: t.label }), h('div.pp-small.pp-muted', { text: t.sub })))));
  };

  const postcards = () => h('div.pp-postcards', null,
    [...POSTCARDS].sort((a, b) => a.order - b.order).map((p) => {
      const club = clubById(p.clubId);
      const got = !!career.postcards[p.id];
      const progress = missionProgress(career, club.puzzleMissionId);
      return h('div.pp-col', null, postcardFlip(p, { collected: got }),
        h('div.pp-small', { style: { color: 'var(--paper)' }, text: got ? `${club.casualLocationName} · ${tapWord()} to read the back` : `${club.casualLocationName}: puzzles ${progress.solved}/${progress.total}` }));
    }),
    h('div.pp-panel.pp-small', { style: { gridColumn: '1 / -1' } }, secret
      ? 'All six collected. Read the first letter of each message, in order. Then open the new tab.'
      : 'Postcards are optional. Each casual venue gives one for finishing its puzzle challenge. The messages on the back seem to belong together.'));

  const careerTab = () => {
    const s = career.stats;
    const tile = (label, value, tier = null) => h('div.pp-tile', { class: tier ? `pp-tile--${tier}` : '' }, h('b', { text: value }), h('span', { text: label }));
    const avgAcc = s.accuracyGames ? Math.round(s.accuracyTotal / s.accuracyGames) : null;
    const avgScore = s.games ? Math.round(s.careerScore / s.games) : null;
    return h('div.pp-panel.pp-modal.pp-modal--wide', { style: { margin: '10px auto' } },
      h('h2.pp-h2', { text: `${career.name}'s career` }),
      h('h3.pp-h3', { text: 'Special moves' }),
      h('div.pp-tiles', null,
        tile(GRADE_META.EPIC.label, s.grades.EPIC || 0, 'epic'),
        tile(GRADE_META.BRILLIANT.label, s.grades.BRILLIANT || 0, 'brilliant'),
        tile(GRADE_META.CLUTCH.label, s.grades.CLUTCH || 0, 'clutch'),
        tile('Best', s.grades.BEST || 0), tile('Excellent', s.grades.EXCELLENT || 0), tile('Blunders', s.grades.BLUNDER || 0)),
      h('h3.pp-h3', { text: 'Scores' }),
      h('div.pp-tiles', null,
        tile('Career score', s.careerScore.toLocaleString('en')),
        tile('Average score', avgScore === null ? '—' : avgScore.toLocaleString('en')),
        tile('Best game', s.bestScore ? `${s.bestScore.score.toLocaleString('en')} ${s.bestScore.letter || ''}` : '—'),
        tile('Avg accuracy', avgAcc === null ? '—' : `${avgAcc}%`),
        tile('Best accuracy', s.bestAccuracy === null ? '—' : `${s.bestAccuracy}%`)),
      s.bestScore?.opponent ? h('p.pp-small.pp-muted', { text: `Highest-scoring game: vs ${s.bestScore.opponent}.` }) : null,
      h('h3.pp-h3', { text: 'Record' }),
      h('div.pp-tiles', null,
        tile('Games', s.games), tile('Wins', s.wins), tile('Draws', s.draws), tile('Losses', s.losses),
        tile('Peak Elo', s.peakElo), tile('Puzzles', s.puzzlesSolved), tile('Hints used', s.hintsUsed)),
      h('h3.pp-h3', { text: 'Rivals' }),
      h('ul.pp-lines', null, CLUBS.map((c) => {
        const star = starById(c.starPlayerId);
        const r = career.stars[star.id];
        return h('li', null, h('span', { text: `${star.name} (${c.city})` }), h('b', { text: !r?.met ? 'not met' : r.beaten ? `beaten${r.losses ? ` after ${r.losses} loss${r.losses > 1 ? 'es' : ''}` : ''}` : `met · ${r.losses} loss${r.losses === 1 ? '' : 'es'}` }));
      })));
  };

  const beyond = () => h('div.pp-beyond', null,
    h('div.pp-h3', { style: { color: 'var(--gold)' }, text: 'Hidden page' }),
    h('div.pp-beyond__word', null, [...BEYOND_THE_TOUR.word].map((ch, i) => h('span', { text: ch, style: { animationDelay: `${i * 120}ms` } }))),
    h('h1.pp-h1', { text: BEYOND_THE_TOUR.title }),
    h('p', { style: { fontSize: '22px' } }, h('b', { text: BEYOND_THE_TOUR.lead })),
    BEYOND_THE_TOUR.body.map((line) => h('p', { text: line })),
    h('div.pp-beyond__grid', null, BEYOND_THE_TOUR.silhouettes.map((s) => h('div.pp-beyond__card', null, h('b', { text: s.glyph }), h('span', { text: s.label })))),
    h('p.pp-h2', { style: { color: 'var(--gold-hi)' }, text: BEYOND_THE_TOUR.signoff }),
    h('p.pp-small', { style: { opacity: 0.7 }, text: 'Nothing on this page is a promise. It is where the road might go.' }));

  const el = h('div.pp-screen.pp-journal', null, app.career ? app.hud({ where: 'Journal' }) : null, tabBar, body);
  requestAnimationFrame(paint);
  paint();
  const ro = new ResizeObserver(onResize);
  ro.observe(body);
  return { el, destroy() { ro.disconnect(); } };
}

export default journalScreen;
