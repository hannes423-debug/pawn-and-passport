/**
 * gameExport.js - a finished game as a picture or an animated GIF, to look
 * at, save and share (the game viewer, js/ui/gameViewer.js).
 *
 *   picture  the position on screen, with the players and the move above it
 *   GIF      the whole game, one frame per move, the result held at the end
 *
 * Both are drawn from the stored game (js/core/history.js) on the board art
 * (js/ui/boardImage.js), never captured from the page. The pop-up shows the
 * result first - the GIF plays in it - and then offers:
 *   Share  the phone's share sheet (Web Share with a file), where offered
 *   Save   a download
 *   Copy   the picture on the clipboard (PNG only: browsers do not copy GIFs)
 * Each is its own tap, so the browser's "user gesture" rules are met even
 * when making the GIF took a few seconds.
 */

import { h, button } from './dom.js';
import { sfx } from './audio.js';
import { drawBoardImage, download, canCopyImage } from './boardImage.js';
import { GifWriter, buildPalette, createIndexer } from './gif.js';
import { replayEntry, resultWord } from './gameViewer.js';
import { GAME } from '../data/config.js';

const INK = '#1f140b'; const SOFT = '#6b5236'; const PAPER = '#f3e3bf'; const EDGE = '#c99a4a'; const BG = '#1a1110';
const RESULT_COLOUR = { 1: '#b57c06', 0.5: '#3f6fb0', 0: '#b3372a' };

// "Ömer Taş" -> "omer-tas": accents off, then anything else that is not a letter or digit.
const slug = (s) => String(s || 'game').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'game';
export const exportName = (entry, ext, suffix = '') => `pawn-and-passport-${slug(entry.opponent?.name)}${suffix}.${ext}`;

/* -------------------------------------------------------------- frames -- */

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** "12. Nf3" for ply i (1-based) of a replay. */
function moveLabel(replay, i) {
  const blackFirst = replay.fens[0].split(' ')[1] === 'b';
  const firstNo = Number(replay.fens[0].split(' ')[5]) || 1;
  const p = i - 1 + (blackFirst ? 1 : 0);
  const no = firstNo + Math.floor(p / 2);
  return `${no}${p % 2 === 0 ? '.' : '...'} ${replay.moves[i - 1].san}`;
}

/**
 * One frame: a header strip (players; the move, or the result on the last
 * frame) above the board. Resolves with a canvas.
 */
export async function drawGameFrame({ entry, replay, ply, style, playerName, scale = 0.5, coordinates = true }) {
  const fen = replay.fens[ply];
  const last = ply > 0 ? replay.moves[ply - 1] : null;
  const boardCanvas = await drawBoardImage({ fen, orientation: entry.colour, pieces: style.pieces, board: style.board, lastMove: last, coordinates, scale });
  const W = boardCanvas.width;
  const pad = Math.round(14 * scale * 2);
  const line = Math.round(30 * scale * 2);
  const headH = pad * 2 + line * 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = headH + boardCanvas.height;
  const c = canvas.getContext('2d');
  c.fillStyle = BG; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = PAPER; c.fillRect(0, 0, W, headH);
  c.fillStyle = EDGE; c.fillRect(0, headH - Math.max(2, Math.round(3 * scale)), W, Math.max(2, Math.round(3 * scale)));
  c.drawImage(boardCanvas, 0, headH);

  const body = Math.round(24 * scale * 2);
  const font = (weight = 400) => `${weight} ${body}px "Jersey 15", "Trebuchet MS", sans-serif`;
  const me = `${playerName}${entry.eloAfter != null && entry.eloDelta != null ? ` (${entry.eloAfter - entry.eloDelta})` : ''}`;
  const them = `${entry.opponent.name}${entry.opponent.elo ? ` (${entry.opponent.elo})` : ''}`;
  const white = entry.colour === 'w' ? me : them; const black = entry.colour === 'w' ? them : me;
  c.textBaseline = 'middle';
  c.fillStyle = INK; c.font = font(400);
  c.textAlign = 'left';
  c.fillText(fit(c, `White ${white}  ·  Black ${black}`, W - pad * 2), pad, pad + line / 2);
  const end = ply === replay.moves.length;
  const whiteScore = entry.colour === 'w' ? entry.score : 1 - entry.score;
  const resultText = `${whiteScore === 1 ? '1-0' : whiteScore === 0 ? '0-1' : '½-½'} · ${entry.headline || resultWord(entry.score)}`;
  const left = end && entry.moves ? resultText : ply === 0 ? 'Start' : moveLabel(replay, ply);
  c.fillStyle = end ? RESULT_COLOUR[entry.score] || INK : INK;
  c.fillText(fit(c, left, W * 0.62), pad, pad + line * 1.5);
  c.fillStyle = SOFT; c.textAlign = 'right';
  c.fillText(GAME.title, W - pad, pad + line * 1.5);
  return canvas;
}

async function fontsReady() {
  try { await Promise.all([document.fonts?.load('24px "Jersey 15"'), document.fonts?.load('12px "Press Start 2P"')]); } catch { /* fallback fonts */ }
}

/* ----------------------------------------------------------------- GIF -- */

export const GIF_TIMING = Object.freeze({ startCs: 120, moveCs: 85, endCs: 400 });

/**
 * The whole game as an animated GIF.
 * @param {Object} o
 * @param {Object} o.entry         a history entry
 * @param {Object} o.style         { pieces, board } (js/core/shop.js equippedStyle)
 * @param {string} o.playerName
 * @param {(done:number, total:number) => void} [o.onProgress]
 * @param {() => boolean} [o.cancelled]
 * @returns {Promise<Blob|null>} null when cancelled
 */
export async function gameGif({ entry, style, playerName, scale = 0.5, coordinates = true, onProgress = () => {}, cancelled = () => false }) {
  await fontsReady();
  const replay = replayEntry(entry);
  const total = replay.moves.length;
  const frame = (ply) => drawGameFrame({ entry, replay, ply, style, playerName, scale, coordinates });
  const pixels = (canvas) => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  // One palette for the game: the start (every piece), a move (the highlight), the end (the result colour).
  const samples = [0, Math.min(1, total), total].map(async (p) => pixels(await frame(p)));
  const palette = buildPalette(await Promise.all(samples), 255, 2);
  const toIndex = createIndexer(palette);
  const first = await frame(0);
  const gif = new GifWriter(first.width, first.height, palette);
  let indexed = new Uint8Array(first.width * first.height);
  for (let ply = 0; ply <= total; ply += 1) {
    if (cancelled()) return null;
    const canvas = ply === 0 ? first : await frame(ply);
    indexed = toIndex(pixels(canvas), indexed);
    gif.addFrame(indexed, ply === 0 ? GIF_TIMING.startCs : ply === total ? GIF_TIMING.endCs : GIF_TIMING.moveCs);
    onProgress(ply + 1, total + 1);
    // Let the page breathe (the progress text, a Close tap) between frames.
    await new Promise((r) => setTimeout(r, 0));
  }
  return new Blob([gif.finish()], { type: 'image/gif' });
}

/** The position at `ply`, with its header, as a PNG. */
export async function gamePicture({ entry, style, playerName, ply, coordinates = true }) {
  await fontsReady();
  const canvas = await drawGameFrame({ entry, replay: replayEntry(entry), ply, style, playerName, scale: 1, coordinates });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

/* ------------------------------------------------------- share / save -- */

/** Can this browser share a file of this type through the share sheet? */
export function canShareFile(type = 'image/png', name = 'x.png') {
  try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File([new Uint8Array(1)], name, { type })] })); } catch { return false; }
}

/** @returns {Promise<'shared'|'cancelled'|'saved'>} */
export async function shareFile(blob, filename, { title = GAME.title, text = '' } = {}) {
  const file = new File([blob], filename, { type: blob.type });
  if (canShareFile(blob.type, filename)) {
    try { await navigator.share({ files: [file], title, text }); return 'shared'; } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      /* refused (no fresh tap, a policy): save it instead */
    }
  }
  download(blob, filename);
  return 'saved';
}

/**
 * The pop-up: makes the file, shows it, then Share / Save / (Copy).
 * @param {Object} app
 * @param {Object} o
 * @param {string} o.title
 * @param {'png'|'gif'} o.kind
 * @param {string} o.filename
 * @param {string} [o.shareText]
 * @param {(progress:(d:number,t:number)=>void, cancelled:()=>boolean) => Promise<Blob|null>} o.make
 */
export function openExportSheet(app, { title, kind, filename, shareText = '', make }) {
  let blob = null; let url = null; let gone = false;
  return app.overlay((close) => {
    const status = h('p.pp-small.pp-muted', { 'aria-live': 'polite', text: kind === 'gif' ? 'Making the animation...' : 'Drawing the picture...' });
    const preview = h('div.pp-export__preview');
    const actions = h('div.pp-row.pp-export__actions');
    const finish = () => { gone = true; if (url) URL.revokeObjectURL(url); close(); };
    const type = kind === 'gif' ? 'image/gif' : 'image/png';
    const panel = h('div.pp-panel.pp-modal.pp-export', null,
      h('h2.pp-h2', { text: title }), preview, status, actions,
      h('div.pp-row', { style: { justifyContent: 'flex-end' } }, button('Close', finish, { cls: 'pp-btn--small', back: true })));
    (async () => {
      try {
        blob = await make((d, t) => { status.textContent = `Making the animation... ${d}/${t} frames`; }, () => gone);
        if (gone || !blob) return;
        url = URL.createObjectURL(blob);
        preview.replaceChildren(h('img', { src: url, alt: title }));
        status.textContent = `${kind === 'gif' ? 'Animated GIF' : 'PNG'} · ${Math.max(1, Math.round(blob.size / 1024)).toLocaleString('en')} KB`;
        const items = [];
        if (canShareFile(type, filename)) {
          items.push(button('Share', async () => {
            sfx.click();
            const how = await shareFile(blob, filename, { text: shareText });
            if (how === 'saved') app.toast(`Saved as ${filename}.`);
          }, { cls: 'pp-btn--gold' }));
        }
        items.push(button('Save', () => { sfx.click(); download(blob, filename); app.toast(`Saved as ${filename}.`); }, { cls: items.length ? '' : 'pp-btn--gold' }));
        if (kind === 'png' && canCopyImage()) {
          items.push(button('Copy', async () => {
            sfx.click();
            try { await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]); app.toast('Picture copied.'); } catch { app.toast('This browser did not allow copying the picture: use Save.'); }
          }));
        }
        actions.replaceChildren(...items);
        items[0]?.focus?.();
      } catch (error) {
        console.error('[export]', error);
        if (!gone) status.textContent = 'The file could not be made on this device.';
      }
    })();
    return panel;
  }, { dismissable: false });
}

export default { drawGameFrame, gameGif, gamePicture, canShareFile, shareFile, openExportSheet, exportName, GIF_TIMING };
