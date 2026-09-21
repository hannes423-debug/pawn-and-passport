/**
 * match.js (screen) - a game of chess, and what it earns.
 *
 * Left rail:  both players, Focus, the Hint button (cost and depth shown
 *             before you pay), the opening banner.
 * Centre:     the ornate board, guide arrows, hint arrows, grade effects.
 * Right rail: the move list with live grades, controls.
 *
 * When the game ends the career is paid (Elo, XP, opening knowledge,
 * tournament progress, trophy) and the sports-style result card is shown.
 */

import { h, button, wait, meter } from '../dom.js';
import { tapWord } from '../touch.js';
import { sfx } from '../audio.js';
import { portraitUrl, PLAYER_LOOKS } from '../sprites.js';
import { createBoard } from '../board.js';
import { PapMatch } from '../../game/match.js';
import { UNDO } from '../../data/config.js';
import { engineService } from '../../chess/engine/engineService.js';
import { HIGHLIGHT, ARROW } from '../../chess/render/boardRenderer.js';
import { hex } from '../../chess/render/feedback.js';
import { GRADE_META, GRADE_ORDER } from '../../core/grading.js';
import { openingById } from '../../data/openings.js';
import { clubById, FINALE, CLUBS } from '../../data/clubs.js';
import { starById } from '../../data/starPlayers.js';
import { applyUci } from '../../chess/core/rules.js';
import {
  applyGameResult, recordTournamentGame, recordFinaleGame, maxFocus, hintPlies, masteryState, currentRound,
  repertoireSlots, commitMatchResult, undoUses
} from '../../core/career.js';
import { roundReport, roundLabel } from '../tournamentView.js';
import { QUALITY_META } from '../../core/focusHints.js';

/* Arrow and square kinds for the three plan qualities (css/board.css). */
const PLAN_KINDS = ['hint-green', 'hint-purple', 'hint-gold'];
import { starLines } from '../../core/dialogue.js';

const KIND_LABEL = { friendly: 'Friendly game', challenge: 'Challenge match', tournament: 'Tournament round', star: 'Tournament final', finale: 'Grand Finale' };

export function matchScreen(app, params) {
  const career = app.career;
  const { kind, opponent, colour = 'w', clubId, returnScene, returnSpawn } = params;
  const club = clubById(clubId);
  const match = new PapMatch({ career, kind, opponent, playerColour: colour });
  const opening = opponent.openingId ? openingById(opponent.openingId) : null;
  let guideOn = app.settings.guideArrows;
  let finished = false;

  /* The hover card for suggested squares (filled in by onBoardHover). On a
     touch screen it is pinned beside the board and can cover part of it, so
     it can be hidden: the 📖 Notes button (and the card's own Hide button)
     switches it off and on, and the choice is remembered. */
  let notesOn = app.settings.openingNotes !== false;
  const tipBody = h('div');
  const tipHide = h('button.pp-tip__hide', { type: 'button', 'aria-label': 'Hide opening notes', text: 'Hide ▾', onclick: (e) => { e.stopPropagation(); setNotes(false); } });
  const tip = h('div.pp-tip', { hidden: true, role: 'tooltip' }, tipHide, tipBody);
  const notesBtn = h('button.pp-btn.pp-btn--small.pp-notesbtn', { type: 'button', onclick: () => setNotes(!notesOn) });
  function paintNotes() {
    notesBtn.replaceChildren('📖 ', h('span', { text: notesOn ? 'Notes: on' : 'Notes: off' }));
    notesBtn.setAttribute('aria-pressed', String(notesOn));
    notesBtn.title = notesOn ? 'Hide the opening notes card' : 'Show the opening notes card on suggested squares';
  }
  function setNotes(on) {
    notesOn = on;
    app.settings.openingNotes = on;
    app.applySettings();
    tip.hidden = true;
    paintNotes();
    if (!on) app.toast('Opening notes hidden. The arrows stay; 📖 Notes brings the card back.', { ms: 2600 });
  }
  paintNotes();

  const board = createBoard(app, {
    orientation: colour,
    getFen: () => match.fen,
    getDestinations: (square) => match.game.destinationsFrom(square),
    getMovableColour: () => (match.isPlayersTurn && !match.thinking ? colour : null),
    onMove: async (move) => {
      const record = await match.playMove(move);
      if (!record) sfx.illegal();
    }
  });
  const { renderer } = board;

  /* ------------------------------------------------------------ rails -- */
  const oppCard = h('div.pp-panel.pp-player.pp-match__opp', null,
    h('img', { alt: '', src: portraitUrl(opponent.look || PLAYER_LOOKS.boy, { ring: kind === 'star' || kind === 'finale' ? '#e8b04a' : '#8a6437' }) }),
    h('div', null,
      h('div.pp-player__name', { text: opponent.name }),
      h('div.pp-small', { text: `${opponent.elo} Elo · ${opponent.style}${kind === 'challenge' ? ` · ${opponent.stake}🪙 on it` : ''}` }),
      opening ? h('div.pp-small.pp-muted', { text: `Plays the ${opening.name}` }) : null,
      // visibility, not display: the card must not change height while the bot thinks.
      h('div.pp-thinking', { style: { visibility: 'hidden' }, text: 'thinking...' })));
  const thinking = oppCard.querySelector('.pp-thinking');
  const meCard = h('div.pp-panel.pp-player.pp-match__me', null,
    h('img', { alt: '', src: portraitUrl(PLAYER_LOOKS[career.avatar], { ring: '#3d7fd9' }) }),
    h('div', null,
      h('div.pp-player__name', { text: career.name }),
      h('div.pp-small', { text: `${career.elo} Elo · Level ${career.level}` }),
      h('div.pp-small.pp-muted', { text: `You play ${colour === 'w' ? 'White' : 'Black'}` })));

  const focusText = h('span');
  const focusMeter = h('div.pp-meter.pp-meter--focus', null, h('div.pp-meter__fill'));
  const hintBtn = h('button.pp-btn.pp-btn--blue.pp-hintbtn', { type: 'button', onclick: () => askHint() });
  const undoBtn = h('button.pp-btn.pp-undobtn', { type: 'button', onclick: () => askUndo(), 'aria-label': 'Undo your last move' });
  const hintInfo = h('div.pp-cost');
  const hintCard = h('div.pp-hint-card', { hidden: true });
  const openingBanner = h('div.pp-opening-banner');
  const band = hintPlies(career.level);

  const left = h('aside.pp-match__left', null,
    h('div.pp-panel.pp-small.pp-match__kind', null, h('b', { text: KIND_LABEL[kind] }), club ? ` · ${club.clubName}` : kind === 'finale' ? ` · ${FINALE.venueName}` : '',
      kind === 'friendly' ? h('span.pp-muted', { text: ' · unrated' }) : null,
      kind === 'challenge' ? h('span.pp-muted', { text: ` · ${opponent.stake} coins` }) : null),
    oppCard,
    meCard,
    h('div.pp-panel.pp-col.pp-match__focus', null,
      h('div.pp-focus__row', null, h('span', { text: '✦ Focus' }), focusText),
      focusMeter,
      // The two Focus abilities side by side, at every viewport.
      h('div.pp-abilities', null, hintBtn, undoBtn),
      hintInfo,
      h('div.pp-small.pp-muted.pp-match__note', { text: `Hint: ${band.label} · green 1 move, purple 2, gold 3` })));

  /* The engine's state, always visible: a phone that cannot run Stockfish used
     to lose grades and hints without a word. */
  const engineLine = h('div.pp-engine');
  /* Only worth a line when it is NOT simply working. */
  const paintEngine = () => {
    engineLine.dataset.status = engineService.status;
    engineLine.textContent = `⚙ ${engineService.statusText}`;
    engineLine.hidden = engineService.status === 'ready';
  };
  const stopEngineWatch = engineService.onStatus(paintEngine);
  paintEngine();

  const moveList = h('div.pp-moves');
  const lastGrade = h('div.pp-small', { text: 'Your moves are graded live.' });
  const guideBtn = button(guideOn ? 'Guide arrows: on' : 'Guide arrows: off', () => {
    guideOn = !guideOn;
    app.settings.guideArrows = guideOn; app.applySettings();
    guideBtn.querySelector('span:last-child').textContent = guideOn ? 'Guide arrows: on' : 'Guide arrows: off';
    paintGuide();
  }, { cls: 'pp-btn--small' });
  const moreBody = h('div.pp-col.pp-match__morebody', { hidden: true });
  const moreBtn = h('button.pp-match__more', { type: 'button', 'aria-expanded': 'false', text: '▸ More: guide, notes, draw, resign',
    onclick: () => {
      moreBody.hidden = !moreBody.hidden;
      moreBtn.setAttribute('aria-expanded', String(!moreBody.hidden));
      moreBtn.textContent = `${moreBody.hidden ? '▸' : '▾'} More: guide, notes, draw, resign`;
    } });
  const right = h('aside.pp-match__right', null,
    hintCard,
    h('div.pp-panel.pp-panel--dark.pp-match__banner', null, openingBanner),
    h('div.pp-panel.pp-col.pp-match__moves', null, h('h3.pp-h3', { text: 'Moves' }), moveList, lastGrade, engineLine),
    /* Everything a game can do without: folded away, one tap to open. */
    h('div.pp-panel.pp-col.pp-match__tools', null,
      moreBtn,
      moreBody));
  /* The folded options, opened by moreBtn. */
  moreBody.append(
      h('div.pp-row.pp-match__toggles', null, guideBtn, notesBtn),
      h('div.pp-small.pp-muted', { text: `Blue arrows come from your equipped openings, as deep as you know them (a mastered opening keeps guiding after the book ends). Free, no Focus. ${tapWord() === 'tap' ? 'Tap' : 'Hover'} a suggested square for details.` }),
      h('div.pp-small', null, h('b', { text: `Repertoire ${(career.equipped || []).length}/${repertoireSlots(career.level)}: ` }),
        (career.equipped || []).map((id) => `${openingById(id).name} ${career.openings[id] ?? 0}%`).join(', ') || 'none (equip openings in the Journal)'),
      h('div.pp-row', null,
        button('Offer draw', () => {
          if (finished) return;
          const r = match.offerDraw();
          app.toast(r ? 'Draw agreed.' : `${opponent.name.split(' ')[0]} declines the draw.`);
        }, { cls: 'pp-btn--small' }),
        button('Resign', async () => {
          if (finished) return;
          const ok = await app.overlay((close) => h('div.pp-panel.pp-modal', null,
            h('h2.pp-h2', { text: 'Resign this game?' }),
            h('div.pp-row', null, button('Resign', () => close(true), { cls: 'pp-btn--red' }), button('Keep playing', () => close(false)))));
          if (ok) match.resign();
        }, { cls: 'pp-btn--small pp-btn--red' })));

  const el = h('div.pp-screen.pp-match', null, left, h('main.pp-match__board', null, board.frame), right, tip);

  /* ---------------------------------------------------------- painting -- */
  function paintFocus() {
    focusText.textContent = `${match.focus} / ${match.focusMax}`;
    focusMeter.firstChild.style.width = `${(match.focus / match.focusMax) * 100}%`;
    const q = match.quoteHint();
    const affordable = match.focus >= q.cost;
    hintBtn.replaceChildren('💡 ', h('span.pp-hintbtn__ask', { text: 'Ask for ' }), 'Hint', h('small', { text: `${q.cost} Focus · ${q.label}` }));
    hintBtn.disabled = !match.isPlayersTurn || match.hintBusy || !affordable || finished;
    const u = match.undoState();
    const undoNote = u.reason === 'used' ? (u.max === 1 ? 'Used' : 'All used')
      : u.reason === 'cooldown' ? `In ${u.cooldown} move${u.cooldown === 1 ? '' : 's'}`
      : u.reason === 'nothing' ? 'Move first'
      : `${u.cost} Focus · ${u.left} left`;
    undoBtn.replaceChildren('↶ ', 'Undo', h('small', { text: undoNote }));
    undoBtn.disabled = !u.ok || finished;
    undoBtn.dataset.state = u.reason || 'ready';
    undoBtn.title = `Take back your last move. Costs ${u.cost} Focus, ${u.max} per game at level ${career.level}, then ${UNDO.cooldownMoves} moves of cooldown.`;
    const b = q.breakdown;
    const why = [];
    if (q.inBook && b.familiarity < 1) why.push(`known line x${b.familiarity}`);
    else if (q.inBook) why.push('unfamiliar line');
    if (b.specialty < 1) why.push(`home opening x${b.specialty}`);
    why.push(`${q.phase} x${b.phase}`);
    if (b.complexity > 1) why.push(`sharp x${b.complexity}`);
    if (b.rolls > 1) why.push(`${q.rolls} rolls x${b.rolls}`);
    hintInfo.textContent = affordable || !match.isPlayersTurn ? `Cost: ${why.join(' · ')}` : 'Not enough Focus. Strong moves earn some back.';
  }

  function paintMoves() {
    moveList.replaceChildren();
    const history = match.game.history;
    for (let i = 0; i < history.length; i += 2) {
      moveList.append(h('span.num', { text: `${Math.floor(i / 2) + 1}.` }));
      for (const rec of [history[i], history[i + 1]]) {
        if (!rec) { moveList.append(h('span')); continue; }
        const g = rec.grade && GRADE_META[rec.grade];
        moveList.append(h('span', null, rec.san, g ? h(`span.pp-grade.pp-grade--${g.tier}`, { text: g.glyph, title: g.label }) : null));
      }
    }
    moveList.scrollTop = moveList.scrollHeight;
  }

  /* Everything the game is currently suggesting, for the hover card. */
  let suggestions = [];

  function paintGuide() {
    renderer.clearArrows(ARROW.BOOK);
    renderer.clearArrows(ARROW.BOOK_ALT);
    renderer.clearHighlights(HIGHLIGHT.BOOK);
    suggestions = suggestions.filter((sug) => sug.kind !== 'guide');
    if (!guideOn || !match.isPlayersTurn) return;
    const fen = match.fen;
    const draw = (list) => {
      for (const g of list) {
        renderer.drawArrow({ from: g.from, to: g.to }, g.main ? ARROW.BOOK : ARROW.BOOK_ALT);
        /* The square it points at carries the sparkle: preparation, not advice. */
        if (g.main) renderer.highlightSquare(g.to, HIGHLIGHT.BOOK);
        suggestions.push({ kind: 'guide', fen, uci: g.uci, san: g.san, from: g.from, to: g.to, openingId: g.openingId, mastered: !!g.mastered });
      }
    };
    const book = match.guide();
    draw(book);
    if (book.length) app.coach('guide', 'Blue arrows are your own opening preparation: free, no Focus. Follow them while you know the line; the more you master an opening, the further they go.', { title: 'Opening guide', host: right });
    /* A mastered opening keeps guiding when the opponent leaves the book. */
    if (!book.length) {
      const token = ++guideToken;
      match.masteredGuide().then((list) => {
        if (token !== guideToken || match.fen !== fen || !guideOn || !match.isPlayersTurn) return;
        draw(list);
      });
    }
  }
  let guideToken = 0;

  function clearPlans() {
    for (const kind of PLAN_KINDS) { renderer.clearArrows(kind); renderer.clearHighlights(kind); }
    suggestions = suggestions.filter((sug) => sug.kind !== 'hint');
  }

  /**
   * One card per suggested MOVE (a guide arrow and a hint for the same move
   * share a card). Openings in your repertoire are explained in full; any
   * other opening the move also belongs to gets one compact line.
   */
  function describeMove(group) {
    const sug = group[0];
    const info = match.book.describe(sug.fen, sug.uci);
    const hint = group.find((g) => g.kind === 'hint');
    const guide = group.find((g) => g.kind === 'guide');
    const titles = [];
    if (hint) titles.push(`💡 ${QUALITY_META[hint.quality].label} plan, move ${hint.step} of ${hint.total}: ${hint.san}`);
    if (guide) titles.push(hint ? '📖 also your opening guide' : `📖 Opening guide: ${guide.san}`);
    if (guide?.mastered && !hint) titles.push('The game has left your prepared lines, but you have mastered this opening: this is how you would carry on.');
    const equipped = (e) => (career.equipped || []).includes(e.openingId);
    let primary = info.entries.filter(equipped);
    if (!primary.length) primary = info.entries.filter((e) => (career.openings[e.openingId] ?? 0) > 0);
    if (!primary.length) primary = info.entries.slice(0, 1);
    const others = info.entries.filter((e) => !primary.includes(e));
    const out = [h('div.pp-tip__title', { text: titles.join(' · ') })];
    for (const e of primary) {
      const mastery = career.openings[e.openingId] ?? 0;
      out.push(h('div.pp-tip__entry', null,
        h('div.pp-tip__name', null, `${e.name} `, h('span.pp-muted', { text: `${e.eco} · ${mastery}%${equipped(e) ? ' · equipped' : ''}` })),
        e.mainLine
          ? h('div', { text: e.description })
          : h('div', null, h('b', { text: e.variations.length > 1 ? 'Variations: ' : 'Variation: ' }), e.variations.join(' / ')),
        e.mainLine ? h('div.pp-muted', { text: `Idea: ${e.idea}` }) : null));
    }
    if (others.length) out.push(h('div.pp-muted', { text: `Also part of: ${others.map((e) => e.name).join(', ')}` }));
    if (!info.entries.length) {
      out.push(h('div', { text: info.inBook
        ? 'This move leaves every club opening line.'
        : 'Out of book: no club opening covers this position. This is the engine\'s own choice.' }));
    }
    return out;
  }

  function onBoardHover(e) {
    if (!notesOn || !suggestions.length) { tip.hidden = true; return; }
    const square = renderer.squareAtPoint(e.clientX, e.clientY);
    const hits = square ? suggestions.filter((sug) => sug.from === square || sug.to === square) : [];
    if (!hits.length) { tip.hidden = true; return; }
    const key = hits.map((sug) => `${sug.kind}${sug.step || ''}${sug.uci}`).join('|');
    if (tip.dataset.key !== key) {
      tip.dataset.key = key;
      const groups = new Map();
      for (const sug of hits) {
        const k = `${sug.fen}|${sug.uci}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(sug);
      }
      tipBody.replaceChildren(...[...groups.values()].flatMap((g) => describeMove(g)));
    }
    tip.hidden = false;
    tip.classList.toggle('is-pinned', e.pointerType === 'touch');
    if (e.pointerType === 'touch') {
      // A finger covers whatever sits beside it: pin the card clear of the board instead.
      const rect = board.host.getBoundingClientRect();
      const w = tip.offsetWidth; const hgt = tip.offsetHeight;
      const above = rect.top - hgt - 8;
      tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, rect.left + (rect.width - w) / 2))}px`;
      tip.style.top = `${above >= 8 ? above : Math.min(innerHeight - hgt - 8, rect.bottom + 8)}px`;
      return;
    }
    const pad = 16;
    const w = tip.offsetWidth; const hgt = tip.offsetHeight;
    const x = e.clientX + pad + w > innerWidth ? e.clientX - pad - w : e.clientX + pad;
    const y = Math.min(innerHeight - hgt - 8, Math.max(8, e.clientY + pad));
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${y}px`;
  }
  board.host.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') onBoardHover(e); });
  // Touch has no hover: a tap on a suggested square shows its card until the next tap.
  board.host.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') onBoardHover(e); });
  board.host.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') tip.hidden = true; });

  function paintPosition(record = null) {
    renderer.render(match.fen, { move: record ? { from: record.from, to: record.to } : null });
    renderer.clearHighlights(HIGHLIGHT.LAST_MOVE);
    renderer.clearHighlights(HIGHLIGHT.CHECK);
    if (record) { renderer.highlightMove(record, HIGHLIGHT.LAST_MOVE); renderer.showLastMove?.(record); }
    const king = match.game.checkedKingSquare();
    if (king) renderer.highlightSquare(king, HIGHLIGHT.CHECK);
    board.input.setEnabled(match.isPlayersTurn && !finished);
    meCard.classList.toggle('is-turn', match.isPlayersTurn);
    oppCard.classList.toggle('is-turn', !match.isPlayersTurn && !finished);
  }

  /* ------------------------------------------------------------ events -- */
  match.on(async ({ type, payload }) => {
    switch (type) {
      case 'move': {
        const record = payload;
        clearPlans();
        tip.hidden = true;
        if (record.color === colour) { renderer.clearVerdicts(); hintCard.hidden = true; }
        paintPosition(record);
        if (record.checkmate || record.check) sfx.check(); else if (record.capturedPiece) sfx.capture(); else sfx.move();
        paintMoves(); paintGuide(); paintFocus();
        if (record.color === colour && match.game.history.filter((m) => m.color === colour).length >= 4) {
          app.coach('hint', 'Stuck? 💡 Hint spends ✦ Focus and rolls for ideas: green shows one move, purple a two-move plan, gold three. Play a lesser idea, or your own move, and some Focus comes back.', { title: 'Focus and Hint', host: right });
        }
        break;
      }
      case 'graded': {
        const { record, grade, tier } = payload;
        if (record.undone) break;
        if (app.settings.moveGrades) {
          renderer.markVerdict(record.ply, record.to, tier === 'playable' ? 'good' : tier);
          board.fx.grade(payload);
        }
        const meta = GRADE_META[grade];
        lastGrade.replaceChildren(`Move ${Math.ceil(record.ply / 2)}. ${record.san}: `,
          h(`b.pp-grade.pp-grade--${meta.tier}`, { text: `${meta.glyph} ${meta.label}`, style: payload.quality ? { color: QUALITY_META[payload.quality].colour } : null }),
          payload.focusGain ? ` · +${payload.focusGain} Focus` : '', payload.followedHint ? ' (from your Focus hint: no Focus back)' : '');
        paintMoves(); paintFocus();
        break;
      }
      case 'undo': {
        // The game emits one 'undo' per half-move; the match emits one with `state` when done.
        if (!payload?.state) break;
        clearPlans();
        tip.hidden = true; hintCard.hidden = true;
        renderer.clearVerdicts();
        paintPosition(match.game.lastMove);
        paintMoves(); paintGuide(); paintFocus();
        board.fx.word('UNDO', '#c9a6ff', `${payload.state.left} left this game`);
        break;
      }
      case 'opening': {
        const { opening: o, mastery } = payload;
        openingBanner.textContent = `${o.name} · ${mastery}% ${masteryState(mastery).label}`;
        sfx.opening();
        const equipped = (career.equipped || []).includes(o.id);
        if (app.settings.moveGrades) board.fx.word(o.name.toUpperCase(), '#ffd34d', equipped ? 'In your repertoire' : mastery > 0 ? 'You know some of this line' : 'An opening you have not learned yet');
        break;
      }
      case 'bot-fallback':
        app.toast(`${opponent.name.split(' ')[0]} had engine trouble and played a quick move instead.`, { ms: 3200 });
        break;
      case 'thinking':
        thinking.style.visibility = payload ? 'visible' : 'hidden';
        paintFocus();
        if (!payload) paintGuide();
        break;
      case 'hint': {
        const { plans, rolls, continuation, quote, refund } = payload;
        if (!continuation) sfx.hint();
        clearPlans();
        for (const plan of plans) {
          const kind = `hint-${plan.quality}`;
          const step = plan.step + 1;
          renderer.drawArrow({ from: plan.uci.slice(0, 2), to: plan.uci.slice(2, 4) }, kind, null, plan.total > 1 ? step : null);
          renderer.highlightSquare(plan.uci.slice(2, 4), kind);
          suggestions.push({ kind: 'hint', quality: plan.quality, step, total: plan.total, fen: plan.fen, uci: plan.uci, san: plan.san,
            from: plan.uci.slice(0, 2), to: plan.uci.slice(2, 4) });
        }
        hintCard.hidden = false;
        if (continuation) {
          const plan = plans[0];
          hintCard.replaceChildren(h('b', { text: `${QUALITY_META[plan.quality].label} plan, move ${plan.step + 1} of ${plan.total}: ` }), plan.san);
          break;
        }
        const ordinal = ['Best', 'Second', 'Third'];
        hintCard.replaceChildren(...rolls.map((r) => {
          if (r.quality === 'fail') return h('div.pp-hintroll.is-fail', { text: `✖ ${ordinal[r.rank]} idea: it slipped away.` });
          const q = QUALITY_META[r.quality];
          const moves = { green: 'just this move', purple: 'a two-move plan', gold: 'a three-move plan' }[r.quality];
          return h('div.pp-hintroll', null, h('b', { text: `✦ ${q.label}`, style: { color: q.colour } }), ` ${ordinal[r.rank]} idea: ${r.san} (${moves})`);
        }));
        app.toast(refund ? `-${quote.cost} Focus. Nothing came to mind: +${refund} back.` : `-${quote.cost} Focus`, { ms: refund ? 2600 : 1400 });
        paintFocus();
        break;
      }
      case 'hint-follow': {
        const { plan, refund, done } = payload;
        if (refund) app.toast(`+${refund} Focus back: you chose a lesser idea.`, { ms: 2200 });
        hintCard.hidden = done;
        if (!done) hintCard.replaceChildren(h('b', { text: `${QUALITY_META[plan.quality].label} plan: ` }), `move ${plan.step + 1} of ${plan.total} appears after the reply.`);
        paintFocus();
        break;
      }
      case 'hint-ignored': {
        hintCard.hidden = true;
        if (payload.refund) app.toast(`+${payload.refund} Focus back: you trusted your own move.`, { ms: 2200 });
        paintFocus();
        break;
      }
      case 'end':
        finished = true;
        board.input.setEnabled(false);
        paintFocus();
        onFinished();
        break;
      default: break;
    }
  });

  function askUndo() {
    const r = match.undo();
    if (!r.ok) {
      const why = { focus: `Undo needs ${r.cost} Focus.`, cooldown: `Undo is cooling down: ${r.cooldown} more move${r.cooldown === 1 ? '' : 's'}.`,
        used: 'No undos left this game.', nothing: 'Nothing to undo yet.', over: 'The game is over.' }[r.reason];
      if (why) app.toast(why);
      return;
    }
    sfx.click();
  }

  async function askHint() {
    sfx.click();
    const r = await match.requestHint();
    if (!r.ok && r.reason === 'focus') app.toast('Not enough Focus for that hint.');
    if (!r.ok && r.reason === 'engine') app.toast(`No hint: ${engineService.statusText}`, { ms: 5000 });
    if (!r.ok && r.reason === 'no-line') app.toast('The engine found no line here. Try again.');
    paintFocus();
  }

  const onKey = (e) => {
    if (document.querySelector('.pp-overlay, .pp-dialogue')) return;
    if ((e.key === 'h' || e.key === 'H') && !hintBtn.disabled) askHint();
    if ((e.key === 'u' || e.key === 'U') && !undoBtn.disabled) askUndo();
  };
  document.addEventListener('keydown', onKey);

  /* ---------------------------------------------------------- the end -- */
  /* The end of a game. Rewards are committed ONCE (commitMatchResult is
     keyed by the game id) and saved before anything is shown; every piece of
     presentation after that is optional, and whatever fails, the player is
     taken back to the venue rather than left on a dead board. */
  let finishing = null;
  function onFinished() {
    if (!finishing) finishing = finishGame();
    return finishing;
  }

  async function finishGame() {
    const leave = () => app.go('scene', { sceneId: returnScene, node: returnSpawn });
    let committed = null;
    try {
      const result = match.game.result;
      const score = result ? result.scoreFor(colour) : 0;
      if (score === 1) sfx.win(); else if (score === 0) sfx.lose();
      try {
        board.fx.word(score === 1 ? 'VICTORY!' : score === 0.5 ? 'DRAW' : 'DEFEAT', score === 1 ? '#ffc341' : score === 0.5 ? '#9ec7ff' : '#ff6b5e', result?.headline);
      } catch { /* an effect is never worth losing a result over */ }
      await wait(1400);
      app.toast('Scoring the game...', { ms: 2500 });
      const summary = await match.summary();
      const levelBefore = career.level;
      const focusBefore = maxFocus(levelBefore);
      const pliesBefore = hintPlies(levelBefore).rolls;
      committed = commitMatchResult(career, { gameId: match.gameId, kind, clubId, summary, opponent });
      app.save();
      const { rewards, progress, coinDelta } = committed;

      if (kind === 'star' || kind === 'finale') {
        const star = starById(opponent.id);
        if (star) await app.dialogue({ name: star.name, role: star.title, look: star.look, lines: starLines(career, star.id, summary.score === 1 ? 'won' : 'lost') });
      }
      await showResult({ summary, rewards, progress, levelBefore, focusBefore, pliesBefore, coinDelta });
      if ((kind === 'tournament' || kind === 'star') && progress?.roundIndex >= 0) await tournamentReport(progress);
      if (progress?.trophy) await trophyCeremony(progress.trophy);
      if (kind === 'finale' && progress?.won) { app.go('ending'); return; }
      leave();
    } catch (error) {
      console.error('[match] finishing the game failed', error);
      try { app.save(); } catch { /* the save layer reports its own failures */ }
      app.toast(committed ? 'Your result is saved. Something went wrong showing it.' : 'This game could not be scored.', { ms: 4200 });
      if (kind === 'finale' && committed?.progress?.won) { app.go('ending'); return; }
      leave();
    }
  }

  /* After a tournament game: the rest of the round, played out, and the table. */
  function tournamentReport(progress) {
    const run = career.tournaments[clubId];
    if (!run) return null;
    const index = progress.final ? run.rounds.length : progress.roundIndex;
    return app.overlay((close) => h('div.pp-panel.pp-modal.pp-modal--wide', null,
      h('h2.pp-h2', { text: club.tournamentConfig.name }),
      roundReport(run, index),
      h('div.pp-row', { style: { justifyContent: 'center', marginTop: '10px' } }, button('Continue', () => close(), { cls: 'pp-btn--gold', icon: '▶' }))),
    { dismissable: false });
  }

  function tournamentText(progress) {
    const run = career.tournaments[clubId];
    const star = starById(run?.star?.id);
    const starName = star?.name || 'the Star Player';
    if (progress.outcome === 'champion') return `${club.tournamentConfig.name} won! You beat ${starName} in the final.`;
    if (progress.outcome === 'runner-up') return `Runner-up. ${starName} won the final. Enter again from the tournament desk whenever you are ready.`;
    if (progress.toFinal) return `You made the final! ${starName} is waiting. Play it from the tournament desk.`;
    if (progress.outcome === 'eliminated') return `Knocked out in the ${roundLabel(run, progress.roundIndex).toLowerCase()}. The bracket played on without you. You can enter again any time.`;
    if (progress.outcome === 'placed') return `You finished ${run.place} of ${run.players.length}. Only first place reaches the final: enter again any time.`;
    const next = currentRound(career, clubId);
    return next ? `${roundLabel(run, progress.roundIndex)} done. Next: ${next.label} against ${next.name} (${next.elo}).` : 'Round done.';
  }

  /**
   * The reward sequence, in the order a player cares about it: the result,
   * Elo, XP, the opening, what a level-up improved, and what it means for the
   * event. Score breakdown and move grades are one tap away underneath.
   */
  function showResult({ summary, rewards, progress, levelBefore, focusBefore, pliesBefore, coinDelta = 0 }) {
    const ms = summary.matchScore;
    const levelled = career.level > levelBefore;
    if (levelled) sfx.levelUp();
    const outcome = summary.score === 1 ? 'win' : summary.score === 0.5 ? 'draw' : 'loss';
    const gradeTiles = GRADE_ORDER.filter((g) => summary.grades[g]).map((g) =>
      h(`div.pp-tile.pp-tile--${GRADE_META[g].tier}`, null, h('b', { text: summary.grades[g], style: { color: hex(GRADE_META[g].tier) } }), h('span', { text: GRADE_META[g].label })));
    let progressText = null;
    if (kind === 'tournament' || kind === 'star') progressText = tournamentText(progress);
    if (kind === 'challenge') {
      const first = opponent.name.split(' ')[0];
      progressText = coinDelta > 0 ? `You win ${coinDelta} coins from ${first}.` : coinDelta < 0 ? `${first} takes ${-coinDelta} of your coins.` : `A draw: ${first} hands your stake back.`;
    }
    if (kind === 'finale') {
      progressText = progress.won ? 'You won the Grand Finale!' : progress.cleared ? 'Through to the next round!' : 'Not this time. The round can be replayed.';
    }
    const row = (icon, label, value, cls = '') => h(`li.pp-reward${cls ? `.${cls}` : ''}`, null, h('span.pp-reward__icon', { text: icon }), h('span', { text: label }), h('b', { text: value }));
    const rewardsList = [
      row('♟', 'Elo', kind === 'friendly' ? `unrated · ${career.elo}` : `${rewards.eloDelta >= 0 ? '+' : ''}${rewards.eloDelta} → ${career.elo}`, rewards.eloDelta < 0 ? 'is-neg' : ''),
      row('★', 'XP', `+${rewards.xp.xp}${progress?.trophy ? ` +${progress.trophy.xp.xp} trophy` : ''}${progress?.won && progress.xp ? ` +${progress.xp.xp} finale` : ''}`),
      ...Object.entries(rewards.mastery).map(([id, gain]) => row('📖', openingById(id).name, `+${gain}% → ${career.openings[id]}%`)),
      progress?.mastery ? row('📖', `${openingById(club.openingId).name} (tournament)`, `+${progress.mastery}% → ${career.openings[club.openingId]}%`) : null,
      coinDelta ? row('🪙', kind === 'challenge' ? 'Stake' : 'Prize money', `${coinDelta > 0 ? '+' : ''}${coinDelta} → ${career.coins}`, coinDelta < 0 ? 'is-neg' : '') : null
    ].filter(Boolean);
    /* A level-up says exactly what got better. */
    const improved = [];
    if (maxFocus(career.level) > focusBefore) improved.push(`Max Focus ${focusBefore} → ${maxFocus(career.level)}`);
    if (hintPlies(career.level).rolls > pliesBefore) improved.push(`Hint: ${hintPlies(levelBefore).label} → ${hintPlies(career.level).label}`);
    else if (hintPlies(career.level).odds !== hintPlies(levelBefore).odds) improved.push('Hint rolls: better odds of purple and gold');
    if (repertoireSlots(career.level) > repertoireSlots(levelBefore)) improved.push(`Repertoire slots ${repertoireSlots(levelBefore)} → ${repertoireSlots(career.level)}: equip another opening in the Journal`);
    if (undoUses(career.level) > undoUses(levelBefore)) improved.push(`Undo ${undoUses(levelBefore)} → ${undoUses(career.level)} per game`);

    return app.overlay((close) => h('div.pp-panel.pp-modal.pp-modal--wide.pp-result', null,
      h('div.pp-result__head', null,
        h(`div.pp-result__word.is-${outcome}`, { text: outcome === 'win' ? 'Victory!' : outcome === 'draw' ? 'Draw' : 'Defeat' }),
        h('div.pp-small', { text: `${KIND_LABEL[kind]} · ${summary.headline}` })),
      h('ul.pp-rewards', null, rewardsList),
      levelled ? h('div.pp-levelup', null, h('b', { text: `⬆ Level ${career.level}!` }), improved.length ? h('ul', null, improved.map((t) => h('li', { text: t }))) : null) : null,
      progressText ? h('p.pp-result__next', null, h('b', { text: progressText })) : null,
      h('details.pp-result__details', null,
        h('summary', { text: `Match details · Score ${ms.letter} ${ms.total.toLocaleString('en')}${summary.accuracy === null ? '' : ` · accuracy ${summary.accuracy}%`}` }),
        h('div.pp-result__grid', null,
          h('div.pp-col', null,
            h('h3.pp-h3', { text: 'Score breakdown' }),
            h('ul.pp-lines', null, ms.lines.map((l) => h('li', null, h('span', { text: l.label }), h(`b${l.points < 0 ? '.neg' : ''}`, { text: `${l.points > 0 ? '+' : ''}${l.points}` }))))),
          h('div.pp-col', null,
            h('h3.pp-h3', { text: 'Your moves' }),
            summary.accuracy === null ? h('p.pp-small', { text: engineService.available === false
              ? `Moves were not graded: ${engineService.statusText}`
              : 'Too few of your moves were graded to give an accuracy.' }) : null,
            h('div.pp-tiles', null, gradeTiles)))),
      h('div.pp-row', { style: { justifyContent: 'center', marginTop: '10px' } },
        button('Continue', () => close(), { cls: 'pp-btn--gold', icon: '▶' }))), { dismissable: false });
  }

  /* One of the game's main rewards: the trophy, the rival beaten, the opening
     mastered, the passport stamped, the count toward Madrid. */
  function trophyCeremony(trophy) {
    const o = openingById(trophy.openingId);
    const star = starById(club.starPlayerId);
    const count = Object.keys(career.trophies).length;
    sfx.trophy();
    confetti();
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return app.overlay((close) => h('div.pp-panel.pp-modal.pp-ceremony', null,
      h('div.pp-ceremony__cup', { text: '🏆' }),
      h('h2.pp-h1', { text: trophy.trophyName }),
      h('p', null, h('b', { text: `${club.clubName} champion!` }), ` You beat ${star.name} in the final.`),
      h('div.pp-stamp', { 'aria-label': 'Passport stamp' },
        h('span.pp-stamp__city', { text: club.city.toUpperCase() }),
        h('span.pp-stamp__cup', { text: '🏆' }),
        h('span.pp-stamp__date', { text: date })),
      h('ul.pp-rewards', null,
        h('li.pp-reward', null, h('span.pp-reward__icon', { text: '📖' }), h('span', { text: `${o.name} mastered` }), h('b', { text: `${trophy.masteryBefore}% → 100%` })),
        h('li.pp-reward', null, h('span.pp-reward__icon', { text: '★' }), h('span', { text: 'Trophy XP' }), h('b', { text: `+${trophy.xp.xp}` }))),
      trophy.equipped ? null : h('p.pp-small', { text: `Your repertoire is full: equip the ${o.name} in the Journal (Openings) to get its guide arrows.` }),
      h('div.pp-ceremony__shelf', { 'aria-label': `${count} of 6 Club Trophies` },
        CLUBS.map((cl) => h('span', { class: career.trophies[cl.clubId] ? `is-won${cl.clubId === club.clubId ? ' is-new' : ''}` : '', title: cl.trophyName, text: '🏆' })),
        h('b', { text: `${count}/6` })),
      trophy.finaleUnlocked
        ? h('p.pp-ceremony__madrid', null, h('b', { text: '🏟 All six trophies! You are invited to the Grand Finale in Madrid.' }))
        : h('p.pp-small', { text: `${6 - count} more ${6 - count === 1 ? 'trophy' : 'trophies'} to an invitation to Madrid.` }),
      button('Add it to my passport', () => close(), { cls: 'pp-btn--gold' })), { dismissable: false });
  }

  function confetti() {
    if (app.settings.reducedMotion) return;
    const canvas = h('canvas.pp-confetti');
    document.body.append(canvas);
    canvas.width = innerWidth; canvas.height = innerHeight;
    const c = canvas.getContext('2d');
    const bits = Array.from({ length: 160 }, () => ({ x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5,
      vy: 2 + Math.random() * 4, vx: -1 + Math.random() * 2, s: 5 + Math.random() * 6, c: ['#ffc341', '#b46cff', '#ff4fa3', '#36d6d6', '#fff6dc'][Math.floor(Math.random() * 5)] }));
    let frames = 0;
    const tick = () => {
      c.clearRect(0, 0, canvas.width, canvas.height);
      for (const b of bits) { b.x += b.vx; b.y += b.vy; c.fillStyle = b.c; c.fillRect(Math.round(b.x), Math.round(b.y), b.s, b.s); }
      if ((frames += 1) < 260) requestAnimationFrame(tick); else canvas.remove();
    };
    tick();
  }

  /* ---------------------------------------------------------- watchdog -- */
  /* Nothing may leave the player waiting for an opponent move that no one
     is computing. The match already retries and falls back; this catches any
     path that never started the bot at all, and after repeated stalls offers
     a way out instead of a frozen board. */
  let stalls = 0;
  let stallDialog = false;
  const watchdog = setInterval(async () => {
    if (finished || stallDialog || !match.botStalled) { if (!match.botStalled) stalls = 0; return; }
    stalls += 1;
    if (stalls < 3) { match.maybePlayBot(); return; }
    stallDialog = true;
    const choice = await app.overlay((close) => h('div.pp-panel.pp-modal', null,
      h('h2.pp-h2', { text: `${opponent.name.split(' ')[0]} can't find a move` }),
      h('p', { text: 'The chess engine stopped answering. You can try again, or leave: this game will not count.' }),
      h('div.pp-row', null, button('Try again', () => close('retry'), { cls: 'pp-btn--gold' }), button('Leave the game', () => close('leave')))),
    { dismissable: false });
    stallDialog = false;
    stalls = 0;
    if (choice === 'leave') { finished = true; app.go('scene', { sceneId: returnScene, node: returnSpawn }); return; }
    match.maybePlayBot();
  }, 2500);

  /* ------------------------------------------------------------- start -- */
  paintPosition();
  paintFocus();
  paintMoves();
  match.start().then(() => { paintPosition(match.game.lastMove); paintFocus(); paintGuide(); });
  app.coach('match', `${tapWord() === 'tap' ? 'Tap a piece, then the square' : 'Drag a piece (or click it, then its square)'} to move. ${kind === 'friendly' || kind === 'challenge' ? 'Win and the game is yours.' : 'Win to go through; in a Swiss round a draw still scores half a point.'}`, { title: 'Your move', host: right });

  return {
    el,
    match,        // exposed for tools/cdp.py
    board,
    destroy() {
      clearInterval(watchdog);
      document.removeEventListener('keydown', onKey);
      stopEngineWatch();
      match.dispose();
      board.destroy();
    }
  };
}

export default matchScreen;
