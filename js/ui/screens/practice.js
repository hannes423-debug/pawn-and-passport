/**
 * practice.js - the club practice tree.
 *
 * Every club's practice room opens the same tree: tiers of lessons by rating
 * band, from the board and the pieces up to 1500, which is this game's Elo
 * ceiling. The beginner tier (up to 600) is open from the first visit; each
 * Club Trophy - one per tournament completed - opens the next tier.
 *
 * Nothing is compulsory. Inside the unlocked tiers a player can start
 * anywhere, skip a band, and go back to an earlier lesson whenever they want:
 * the tree only ever adds, it never gates one lesson behind another.
 *
 * Progress and unlocking live in js/core/lessons.js; the content is
 * js/data/lessons.js. One lesson is played by js/ui/screens/lesson.js.
 */

import { h, button } from '../dom.js';
import { pixelIcon } from '../icons.js';
import { sfx } from '../audio.js';
import { LESSONS } from '../../data/lessons.js';
import { clubById } from '../../data/clubs.js';
import { TIERS, isTierUnlocked, lessonProgress, practiceSummary, suggestedLesson, nextTier } from '../../core/lessons.js';

const BRANCH_ICON = {
  fundamentals: 'pawn', vision: 'hint', tactics: 'xp', calculation: 'practice', checkmates: 'side-white',
  openings: 'journal', strategy: 'map', pawns: 'pawn', endgames: 'trophy', defense: 'side-black',
  practical: 'club', analysis: 'practice'
};
const bandLabel = (band) => (band === 0 ? 'Start' : String(band));

/** replaceChildren() turns a null into the text "null"; h() drops it. */
const fill = (host, ...kids) => host.replaceChildren(...kids.flat().filter(Boolean));

export function practiceScreen(app, params) {
  const career = app.career;
  const club = clubById(params.clubId) || clubById(career.location?.clubId);
  const summary = practiceSummary(career);
  let branch = 'all';
  let focusId = params.lessonId || null;

  const openLesson = (lesson) => {
    sfx.click();
    app.go('lesson', { lessonId: lesson.id, clubId: params.clubId, returnScene: params.returnScene });
  };

  /* One lesson: what it teaches and how far the player has got with it. */
  function lessonCard(lesson) {
    const p = lessonProgress(career, lesson);
    const state = p.complete ? 'is-done' : p.started ? 'is-started' : '';
    return h('button.pp-tree__lesson', {
      type: 'button', class: `${state} ${focusId === lesson.id ? 'is-focus' : ''}`,
      onclick: () => openLesson(lesson),
      title: `${lesson.title} — ${p.solved}/${p.total} challenges solved`
    },
      h('span.pp-tree__icon', null, pixelIcon(BRANCH_ICON[lesson.branch] || 'practice', { size: 'md' })),
      h('span.pp-tree__name', null,
        h('b', { text: lesson.title }),
        h('span.pp-small.pp-muted', { text: `${bandLabel(lesson.band)} · ${lesson.branch}` })),
      h('span.pp-tree__marks', null,
        h('span', { class: p.read ? 'is-on' : '', title: 'Instructions read' }, pixelIcon('journal', { size: 'sm' })),
        lesson.demo.length ? h('span', { class: p.watched ? 'is-on' : '', title: 'Demonstration watched' }, pixelIcon('play', { size: 'sm' })) : null,
        h('span.pp-tree__count', { class: p.solved >= p.total ? 'is-on' : '', title: 'Challenges solved', text: `${p.solved}/${p.total}` })),
      p.complete ? h('span.pp-tree__tick', { text: 'done' }) : null);
  }

  /* One tier: its bands, or a locked panel saying what opens it. */
  function tierBlock(tier) {
    const unlocked = isTierUnlocked(career, tier);
    const lessons = LESSONS.filter((l) => tier.bands.includes(l.band) && (branch === 'all' || l.branch === branch));
    const done = lessons.filter((l) => lessonProgress(career, l).complete).length;
    const head = h('div.pp-tree__tierhead', null,
      h('div', null,
        h('b.pp-tree__tiername', { text: tier.label }),
        h('span.pp-small.pp-muted', { text: ` · ${tier.bands.map(bandLabel).join(', ')}` })),
      unlocked
        ? h('span.pp-small', { text: `${done}/${lessons.length} complete` })
        : h('span.pp-pill.pp-pill--locked', { text: `Locked: ${tier.trophies} ${tier.trophies === 1 ? 'trophy' : 'trophies'}` }));
    if (!unlocked) {
      const need = tier.trophies - Object.keys(career.trophies).length;
      return h('section.pp-tree__tier.is-locked', null, head,
        h('p.pp-small.pp-muted', { text: `${tier.blurb} Win ${need} more Club ${need === 1 ? 'Trophy' : 'Trophies'} and this tier opens.` }));
    }
    if (!lessons.length) {
      return h('section.pp-tree__tier', null, head, h('p.pp-small.pp-muted', { text: 'Nothing in this tier teaches that yet. Try another branch.' }));
    }
    const rows = tier.bands
      .filter((band) => lessons.some((l) => l.band === band))
      .map((band) => h('div.pp-tree__band', null,
        h('div.pp-tree__bandlabel', { text: bandLabel(band) }),
        h('div.pp-tree__lessons', null, lessons.filter((l) => l.band === band).map(lessonCard))));
    return h('section.pp-tree__tier', null, head, h('p.pp-small.pp-muted', { text: tier.blurb }), ...rows);
  }

  const list = h('div.pp-tree__list');
  const filters = h('div.pp-row.pp-tree__filters');

  function paint() {
    fill(list, TIERS.map(tierBlock));
    const branches = ['all', ...new Set(LESSONS.filter((l) => isTierUnlocked(career, TIERS.find((t) => t.bands.includes(l.band)) || TIERS[0])).map((l) => l.branch))];
    fill(filters, branches.map((id) => h('button.pp-tree__filter', {
      type: 'button', class: branch === id ? 'is-active' : '',
      onclick: () => { branch = id; sfx.click(); paint(); }
    }, id === 'all' ? 'Everything' : `${BRANCH_ICON[id] || '•'} ${id}`)));
    if (focusId) {
      requestAnimationFrame(() => list.querySelector('.is-focus')?.scrollIntoView({ block: 'center' }));
    }
  }

  const next = nextTier(career);
  const resume = suggestedLesson(career);
  const el = h('div.pp-screen.pp-tree', null,
    app.hud({ where: club ? `${club.clubName}: practice` : 'Practice' }),
    h('div.pp-tree__wrap', null,
      h('header.pp-panel.pp-tree__top', null,
        h('div', null,
          h('h2.pp-h2', { text: 'Practice tree' }),
          h('p.pp-small', { text: `Optional extra practice: read, watch, then try. ${summary.lessonsOpen} of ${summary.lessonsTotal} lessons open, ${summary.lessonsDone} done. Start anywhere.` }),
          next
            ? h('p.pp-small.pp-muted', { text: `${next.tier.label} opens after ${next.trophiesNeeded} more Club ${next.trophiesNeeded === 1 ? 'Trophy' : 'Trophies'}.` })
            : h('p.pp-small.pp-muted', { text: 'Every tier is open: you hold all six Club Trophies.' })),
        h('div.pp-row', null,
          resume ? button(lessonProgress(career, resume).started ? 'Continue' : 'Start here', () => openLesson(resume), { cls: 'pp-btn--gold', icon: pixelIcon('play', { size: 'sm' }) }) : null,
          button('Leave', () => app.go('scene', { sceneId: params.returnScene }), { cls: 'pp-btn--small' }))),
      filters,
      list));

  paint();
  return {
    el,
    /* Test handle: see tools/cdp_lessons.py. */
    tree: { get branch() { return branch; }, setBranch: (id) => { branch = id; paint(); }, open: openLesson, summary }
  };
}

export default practiceScreen;
