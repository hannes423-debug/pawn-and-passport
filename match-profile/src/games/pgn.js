/**
 * games/pgn.js - the PGN of a finished in-app game.
 *
 * Standard seven-tag roster plus TimeControl, Termination, UTC date/time,
 * and the app's own [CMPSource "chess_match_profile"] and [CMPBotLevel "N"].
 * Timed games carry each move's remaining time as a Lichess-style
 * {[%clk h:mm:ss]} comment, so an export reads back with its clocks.
 */

import { Chess } from 'chess.js';

const TERMINATION = { time: 'time forfeit', abandoned: 'abandoned' };

const pad = (n) => String(n).padStart(2, '0');
export function clk(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function timeControlTag(tc) {
  if (tc === 'untimed') return '-';
  const [base, inc] = tc.split('+').map(Number);
  return `${base * 60}+${inc}`;
}

export function buildPgn({ game, moves, result, termination, endedAt, site = '' }) {
  const chess = new Chess();
  const started = new Date(game.started_at);
  const bot = `Stockfish (Level ${game.bot_level})`;
  const tags = [
    ['Event', 'Chess Match Profile game'],
    ['Site', site || '?'],
    ['Date', `${started.getUTCFullYear()}.${pad(started.getUTCMonth() + 1)}.${pad(started.getUTCDate())}`],
    ['Round', '-'],
    ['White', game.colour === 'white' ? game.username : bot],
    ['Black', game.colour === 'black' ? game.username : bot],
    ['Result', result],
    ['UTCDate', `${started.getUTCFullYear()}.${pad(started.getUTCMonth() + 1)}.${pad(started.getUTCDate())}`],
    ['UTCTime', `${pad(started.getUTCHours())}:${pad(started.getUTCMinutes())}:${pad(started.getUTCSeconds())}`],
    ['TimeControl', timeControlTag(game.time_control)],
    ['Termination', TERMINATION[termination] || 'normal'],
    ['CMPSource', 'chess_match_profile'],
    ['CMPBotLevel', String(game.bot_level)],
    ['CMPGameId', game.id],
    ['CMPEnded', endedAt]
  ];
  for (const [k, v] of tags) chess.setHeader(k, v);
  for (const m of moves) {
    chess.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
    if (m.clock_ms !== null && m.clock_ms !== undefined) chess.setComment(`[%clk ${clk(m.clock_ms)}]`);
  }
  return chess.pgn();
}

export default { buildPgn, clk };
