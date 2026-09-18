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
import { clubById, FINALE } from '../../data/clubs.js';
import { starById } from '../../data/starPlayers.js';
import { applyUci } from '../../chess/core/rules.js';
import {
  applyGameResult, recordTournamentGame, recordFinaleGame, maxFocus, hintPlies, masteryState, currentRound,
  repertoireSlots
} from '../../core/career.js';
import { starLines } from '../../core/dialogue.js';

const KIND_LABEL = { friendly: 'Friendly game', tournament: 'Tournament round', star: 'Star Player final', finale: 'Grand Finale' };

export function matchScreen(app, params) {
  const career = app.career;
  const { kind, opponent, colour = 'w', clubId, returnScene, returnSpawn } = params;
  const club = clubById(clubId);
  const match = new PapMatch({ career, kind, opponent, playerColour: colour });
  const opening = opponent.openingId ? openingById(opponent.openingId) : null;
  let guideOn = app.settings.guideArrows;
  let finished = false;

  /* The hover card for suggested squares (filled in by onBoardHover). */
  const tip = h('div.pp-tip', { hidden: true, role: 'tooltip' });

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
      h('div.pp-small', { text: `${opponent.elo} Elo · ${opponent.style}` }),
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
      kind === 'friendly' ? h('span.pp-muted', { text: ' · unrated' }) : null),
    oppCard,
    meCard,
    h('div.pp-panel.pp-col.pp-match__focus', null,
      h('div.pp-focus__row', null, h('span', { text: '✦ Focus' }), focusText),
      focusMeter,
      // The two Focus abilities side by side, at every viewport.
      h('div.pp-abilities', null, hintBtn, undoBtn),
      hintInfo,
      h('div.pp-small.pp-muted.pp-match__note', { text: `Level ${career.level} hint: ${band.label.toLowerCase()} (${band.plies} ${band.plies === 1 ? 'move' : 'moves'} shown).` })));

  /* The engine's state, always visible: a phone that cannot run Stockfish used
     to lose grades and hints without a word. */
  const engineLine = h('div.pp-engine');
  const paintEngine = () => {
    engineLine.dataset.status = engineService.status;
    engineLine.textContent = `⚙ ${engineService.statusText}`;
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
  const right = h('aside.pp-match__right', null,
    hintCard,
    h('div.pp-panel.pp-panel--dark.pp-match__banner', null, openingBanner),
    h('div.pp-panel.pp-col.pp-match__moves', null, h('h3.pp-h3', { text: 'Moves' }), moveList, lastGrade, engineLine),
    h('div.pp-panel.pp-col.pp-match__tools', null,
      guideBtn,
      h('div.pp-small.pp-muted', { text: `Gold arrows come from your equipped openings, as deep as you know them. Free, no Focus. ${tapWord() === 'tap' ? 'Tap' : 'Hover'} a suggested square for details.` }),
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
        }, { cls: 'pp-btn--small pp-btn--red' }))));

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
    if (b.depth > 1) why.push(`depth x${b.depth}`);
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
    for (const g of match.guide()) {
      renderer.drawArrow({ from: g.from, to: g.to }, g.main ? ARROW.BOOK : ARROW.BOOK_ALT);
      /* The square it points at carries the sparkle: preparation, not advice. */
      if (g.main) renderer.highlightSquare(g.to, HIGHLIGHT.BOOK);
      suggestions.push({ kind: 'guide', fen, uci: g.uci, san: g.san, from: g.from, to: g.to, openingId: g.openingId });
    }
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
    if (hint) titles.push(hint.reply ? `💡 Hint ${hint.step}: expected reply ${hint.san}` : `💡 Hint ${hint.step}: ${hint.san}`);
    if (guide) titles.push(hint ? '📖 also your opening guide' : `📖 Opening guide: ${guide.san}`);
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
    if (!suggestions.length) { tip.hidden = true; return; }
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
      tip.replaceChildren(...[...groups.values()].flatMap((g) => describeMove(g)));
    }
    tip.hidden = false;
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
        renderer.clearArrows(ARROW.HINT); renderer.clearArrows('hint-reply');
        renderer.clearHighlights(HIGHLIGHT.HINT); renderer.clearHighlights(HIGHLIGHT.DEFENCE);
        suggestions = suggestions.filter((sug) => sug.kind !== 'hint');
        tip.hidden = true;
        if (record.color === colour) { renderer.clearVerdicts(); hintCard.hidden = true; }
        paintPosition(record);
        if (record.checkmate || record.check) sfx.check(); else if (record.capturedPiece) sfx.capture(); else sfx.move();
        paintMoves(); paintGuide(); paintFocus();
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
        lastGrade.replaceChildren(`Move ${Math.ceil(record.ply / 2)}. ${record.san}: `, h(`b.pp-grade.pp-grade--${meta.tier}`, { text: `${meta.glyph} ${meta.label}` }),
          payload.focusGain ? ` · +${payload.focusGain} Focus` : '', payload.followedHint ? ' (hinted)' : '');
        paintMoves(); paintFocus();
        break;
      }
      case 'undo': {
        // The game emits one 'undo' per half-move; the match emits one with `state` when done.
        if (!payload?.state) break;
        renderer.clearArrows(ARROW.HINT); renderer.clearArrows('hint-reply');
        renderer.clearHighlights(HIGHLIGHT.HINT); renderer.clearHighlights(HIGHLIGHT.DEFENCE);
        suggestions = suggestions.filter((sug) => sug.kind !== 'hint');
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
      case 'thinking':
        thinking.style.visibility = payload ? 'visible' : 'hidden';
        paintFocus();
        if (!payload) paintGuide();
        break;
      case 'hint': {
        const { pv, san, quote } = payload;
        sfx.hint();
        suggestions = suggestions.filter((sug) => sug.kind !== 'hint');
        let stepFen = match.fen;
        pv.forEach((uci, i) => {
          const mine = i % 2 === 0;
          renderer.drawArrow({ from: uci.slice(0, 2), to: uci.slice(2, 4) }, mine ? ARROW.HINT : 'hint-reply', null, pv.length > 1 ? i + 1 : null);
          /* A reticle on your own move's square, a shield on the reply's. */
          renderer.highlightSquare(uci.slice(2, 4), mine ? HIGHLIGHT.HINT : HIGHLIGHT.DEFENCE);
          suggestions.push({ kind: 'hint', step: i + 1, reply: !mine, fen: stepFen, uci, san: san[i], from: uci.slice(0, 2), to: uci.slice(2, 4) });
          stepFen = applyUci(stepFen, uci)?.fen || stepFen;
        });
        hintCard.hidden = false;
        hintCard.textContent = pv.length === 1
          ? `Try ${san[0]}.`
          : `Plan: ${san.map((s, i) => `${i + 1}. ${s}${i % 2 ? ' (reply)' : ''}`).join('  ')}`;
        app.toast(`-${quote.cost} Focus`, { ms: 1400 });
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
  async function onFinished() {
    const result = match.game.result;
    const score = result.scoreFor(colour);
    if (score === 1) sfx.win(); else if (score === 0) sfx.lose();
    board.fx.word(score === 1 ? 'VICTORY!' : score === 0.5 ? 'DRAW' : 'DEFEAT', score === 1 ? '#ffc341' : score === 0.5 ? '#9ec7ff' : '#ff6b5e', result.headline);
    await wait(1400);
    const waiting = app.toast('Scoring the game...', { ms: 2500 });
    void waiting;
    const summary = await match.summary();
    const levelBefore = career.level;
    const focusBefore = maxFocus(levelBefore);
    const pliesBefore = hintPlies(levelBefore).plies;
    const rewards = applyGameResult(career, summary);
    let progress = null;
    if (kind === 'tournament' || kind === 'star') progress = recordTournamentGame(career, clubId, summary.score);
    if (kind === 'finale') progress = recordFinaleGame(career, summary.score);
    app.save();

    if (kind === 'star' || kind === 'finale') {
      const star = starById(opponent.id);
      if (star) await app.dialogue({ name: star.name, role: star.title, look: star.look, lines: starLines(career, star.id, summary.score === 1 ? 'won' : 'lost') });
    }

    await showResult({ summary, rewards, progress, levelBefore, focusBefore, pliesBefore });

    if (progress?.trophy) await trophyCeremony(progress.trophy);
    if (kind === 'finale' && progress?.won) { app.go('ending'); return; }
    app.go('scene', { sceneId: returnScene, node: returnSpawn });
  }

  function showResult({ summary, rewards, progress, levelBefore, focusBefore, pliesBefore }) {
    const ms = summary.matchScore;
    if (career.level > levelBefore) sfx.levelUp();
    const gradeTiles = GRADE_ORDER.filter((g) => summary.grades[g]).map((g) =>
      h(`div.pp-tile.pp-tile--${GRADE_META[g].tier}`, null, h('b', { text: summary.grades[g], style: { color: hex(GRADE_META[g].tier) } }), h('span', { text: GRADE_META[g].label })));
    const masteryLines = Object.entries(rewards.mastery).map(([id, gain]) =>
      h('li', null, h('span', { text: openingById(id).name }), h('b', { text: `+${gain}% → ${career.openings[id]}%` })));
    let progressText = null;
    if (kind === 'tournament' || kind === 'star') {
      const next = currentRound(career, clubId);
      progressText = progress.completed ? `${club.tournamentConfig.name} won!`
        : progress.cleared ? `Round cleared. Next: ${next ? `${next.kind === 'star' ? '★ ' : ''}${next.name}` : 'done'}.`
        : kind === 'star' ? `The Star Player must be beaten. Challenge ${opponent.name.split(' ')[0]} again whenever you are ready.`
        : 'Round not cleared (a win or draw is needed). You can replay it any time.';
    }
    if (kind === 'finale') {
      progressText = progress.won ? 'You won the Grand Finale!' : progress.cleared ? 'Through to the next round!' : 'Eliminated this time. The round can be replayed.';
    }

    return app.overlay((close) => h('div.pp-panel.pp-modal.pp-modal--wide', null,
      h('div.pp-result__head', null,
        h('div.pp-h3', { text: `${KIND_LABEL[kind]} · ${summary.headline}` }),
        h('div.pp-result__letter', { text: ms.letter }),
        h('div.pp-result__score', { text: `Match Score ${ms.total.toLocaleString('en')}` }),
        progressText ? h('p', null, h('b', { text: progressText })) : null),
      h('div.pp-result__grid', null,
        h('div.pp-col', null,
          h('h3.pp-h3', { text: 'Score breakdown' }),
          h('ul.pp-lines', null, ms.lines.map((l) => h('li', null, h('span', { text: l.label }), h(`b${l.points < 0 ? '.neg' : ''}`, { text: `${l.points > 0 ? '+' : ''}${l.points}` }))))),
        h('div.pp-col', null,
          h('h3.pp-h3', { text: 'Your moves' }),
          summary.accuracy === null ? h('p.pp-small', { text: engineService.available === false
            ? `Moves were not graded: ${engineService.statusText}`
            : 'Too few of your moves were graded to give an accuracy.' }) : null,
          h('div.pp-tiles', null,
            h('div.pp-tile', null, h('b', { text: summary.accuracy === null ? 'not graded' : `${summary.accuracy}%` }), h('span', { text: 'Accuracy' })),
            gradeTiles),
          h('h3.pp-h3', { text: 'Career' }),
          h('ul.pp-lines', null,
            h('li', null, h('span', { text: 'Elo' }), h('b', { class: rewards.eloDelta < 0 ? 'neg' : '', text: kind === 'friendly' ? `unrated · ${career.elo}` : `${rewards.eloDelta >= 0 ? '+' : ''}${rewards.eloDelta} → ${career.elo}` })),
            h('li', null, h('span', { text: 'XP' }), h('b', { text: `+${rewards.xp.xp}` })),
            progress?.trophy ? h('li', null, h('span', { text: `🏆 ${progress.trophy.trophyName}` }), h('b', { text: `+${progress.trophy.xp.xp} XP` })) : null,
            progress?.won && progress.xp ? h('li', null, h('span', { text: '🥇 Grand Finale' }), h('b', { text: `+${progress.xp.xp} XP` })) : null,
            career.level > levelBefore ? h('li', null, h('span', { text: '⬆ LEVEL UP' }), h('b', { text: `Level ${career.level}` })) : null,
            maxFocus(career.level) > focusBefore ? h('li', null, h('span', { text: 'Max Focus' }), h('b', { text: `${focusBefore} → ${maxFocus(career.level)}` })) : null,
            hintPlies(career.level).plies > pliesBefore ? h('li', null, h('span', { text: 'Hint upgraded' }), h('b', { text: hintPlies(career.level).label })) : null,
            masteryLines))),
      h('div.pp-row', { style: { justifyContent: 'center', marginTop: '12px' } },
        button('Continue', () => close(), { cls: 'pp-btn--gold', icon: '▶' }))), { dismissable: false });
  }

  function trophyCeremony(trophy) {
    const o = openingById(trophy.openingId);
    sfx.trophy();
    confetti();
    return app.overlay((close) => h('div.pp-panel.pp-modal', { style: { textAlign: 'center' } },
      h('div', { style: { fontSize: '84px', lineHeight: '1' }, text: '🏆' }),
      h('h2.pp-h1', { text: trophy.trophyName }),
      h('p', { text: `${club.clubName} champion!` }),
      h('p', null, 'Opening mastered: ', h('b', { text: `${o.name} ${trophy.masteryBefore}% → 100%` })),
      h('p.pp-small', { text: `+${trophy.xp.xp} XP` }),
      trophy.finaleUnlocked ? h('p', null, h('b', { text: '🏟 All six trophies! The Madrid Grand Finale is now open on the world map.' })) : null,
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

  /* ------------------------------------------------------------- start -- */
  paintPosition();
  paintFocus();
  paintMoves();
  match.start().then(() => { paintPosition(match.game.lastMove); paintFocus(); paintGuide(); });

  return {
    el,
    match,        // exposed for tools/cdp.py
    board,
    destroy() {
      document.removeEventListener('keydown', onKey);
      stopEngineWatch();
      match.dispose();
      board.destroy();
    }
  };
}

export default matchScreen;
