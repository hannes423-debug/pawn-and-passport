/**
 * games/service.js - in-app games against Stockfish, as plain functions.
 *
 *   createGame(ctx, playerId, { level, colour, timeControl })   -> state
 *   gameState(ctx, gameId, playerId)                            -> state
 *   playMove(ctx, gameId, playerId, { uci, ply })               -> state (after the bot's reply)
 *   continueGame(ctx, gameId, playerId)                         -> state (the bot owes a move)
 *   resign(ctx, gameId, playerId)                               -> state
 *   sweep(ctx)                                                  -> ends flagged and abandoned games
 *
 * ctx = { db, engine, levels, now, onGameEnded, publicUrl }.
 *
 * The server owns the game: the position is always rebuilt from moves_raw,
 * the client only names a move, and chess.js decides whether it is legal.
 * Clocks are measured here: a side's time runs from the moment it got the
 * move (turn_started_at) to the moment its move is recorded, so the network
 * delay counts against the player (docs/ANALYSIS.md will note it).
 */

import { randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import { AppError } from '../errors.js';
import { buildPgn } from './pgn.js';

export const TIME_CONTROLS = Object.freeze({
  untimed: null,
  '10+0': { baseMs: 600000, incMs: 0 },
  '5+3': { baseMs: 300000, incMs: 3000 },
  '15+10': { baseMs: 900000, incMs: 10000 }
});
export const ABANDON_AFTER_MS = 24 * 3600 * 1000;

const SIDE = { w: 'white', b: 'black' };
const RESULT_FOR_WINNER = { white: '1-0', black: '0-1' };

/* One move at a time per game: a double tap, or two tabs, cannot interleave. */
const locks = new Map();
function withLock(gameId, fn) {
  const prev = locks.get(gameId) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(gameId, tail);
  tail.then(() => { if (locks.get(gameId) === tail) locks.delete(gameId); });
  return run;
}

/* ------------------------------------------------------------ reading -- */

function loadGame(db, gameId, playerId) {
  const g = db.prepare(`SELECT g.*, p.username FROM games_raw g JOIN players p ON p.id = g.player_id
    WHERE g.id = ? AND g.player_id = ? AND g.source = 'chess_match_profile'`).get(gameId, playerId);
  if (!g) throw new AppError(404, 'game_not_found', 'No such game.');
  return g;
}

const loadMoves = (db, gameId) => db.prepare('SELECT ply, san, uci, fen_after, clock_ms, think_ms FROM moves_raw WHERE game_id = ? ORDER BY ply').all(gameId);
const loadLive = (db, gameId) => db.prepare('SELECT * FROM live_games WHERE game_id = ?').get(gameId) || null;

function replay(moves) {
  const chess = new Chess();
  for (const m of moves) chess.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
  return chess;
}

/** Time left for each side right now: the side to move has been thinking since turn_started_at. */
function clocksNow(live, toMove, now) {
  if (!live || live.white_ms === null) return null;
  const spent = Math.max(0, now.getTime() - Date.parse(live.turn_started_at));
  return {
    white: toMove === 'white' ? live.white_ms - spent : live.white_ms,
    black: toMove === 'black' ? live.black_ms - spent : live.black_ms,
    running: toMove
  };
}

function stateOf(ctx, game, { moves = loadMoves(ctx.db, game.id), chess = replay(moves), live = loadLive(ctx.db, game.id), extra = {} } = {}) {
  const toMove = SIDE[chess.turn()];
  const open = !game.ended_at;
  const playerToMove = open && toMove === game.colour;
  const clocks = open ? clocksNow(live, toMove, ctx.now()) : null;
  return {
    id: game.id,
    colour: game.colour,
    level: game.bot_level,
    opponent: game.opponent_label,
    timeControl: game.time_control,
    startedAt: game.started_at,
    status: open ? 'active' : 'ended',
    result: game.result,
    termination: game.termination,
    endedAt: game.ended_at,
    fen: chess.fen(),
    // Each move's resulting position, so the browser can show the player's
    // move and then the reply without knowing the rules itself.
    moves: moves.map((m) => ({ ply: m.ply, san: m.san, uci: m.uci, fen: m.fen_after })),
    toMove,
    playerToMove,
    botToMove: open && !playerToMove,
    legal: playerToMove ? chess.moves({ verbose: true }).map((m) => ({ uci: m.from + m.to + (m.promotion || ''), capture: !!m.captured })) : [],
    check: chess.inCheck(),
    clocks: clocks ? { ...clocks, increment: live.increment_ms, at: ctx.now().toISOString() } : null,
    pgn: open ? null : game.pgn,
    ...extra
  };
}

/* ------------------------------------------------------------- ending -- */

/** Lichess's rule for a flag: a side with only a king, or king and one minor piece, cannot win. */
function canMate(chess, side) {
  const colour = side === 'white' ? 'w' : 'b';
  const pieces = chess.board().flat().filter((c) => c && c.color === colour && c.type !== 'k');
  if (pieces.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return true;
  return pieces.length >= 2;
}

function endOnBoard(chess) {
  if (chess.isCheckmate()) return { result: RESULT_FOR_WINNER[SIDE[chess.turn()] === 'white' ? 'black' : 'white'], termination: 'checkmate' };
  if (chess.isStalemate()) return { result: '1/2-1/2', termination: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', termination: 'insufficient_material' };
  if (chess.isThreefoldRepetition()) return { result: '1/2-1/2', termination: 'threefold_repetition' };
  if (chess.isDrawByFiftyMoves()) return { result: '1/2-1/2', termination: 'fifty_moves' };
  return null;
}

function flagResult(chess, flagged) {
  const other = flagged === 'white' ? 'black' : 'white';
  return canMate(chess, other) ? { result: RESULT_FOR_WINNER[other], termination: 'time' } : { result: '1/2-1/2', termination: 'time' };
}

function endGame(ctx, game, chess, moves, { result, termination }) {
  const endedAt = ctx.now().toISOString();
  const pgn = buildPgn({ game, moves, result, termination, endedAt, site: ctx.publicUrl });
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE games_raw SET result = ?, termination = ?, pgn = ?, ended_at = ? WHERE id = ? AND ended_at IS NULL')
      .run(result, termination, pgn, endedAt, game.id);
    ctx.db.prepare('DELETE FROM live_games WHERE game_id = ?').run(game.id);
  })();
  ctx.onGameEnded?.(game.id);
  return { ...game, result, termination, pgn, ended_at: endedAt };
}

/** End a game whose side to move has run out of time, or an untimed one left for 24 hours. */
function settle(ctx, game) {
  if (game.ended_at) return game;
  const moves = loadMoves(ctx.db, game.id);
  const chess = replay(moves);
  const live = loadLive(ctx.db, game.id);
  if (!live) return game;
  const toMove = SIDE[chess.turn()];
  const clocks = clocksNow(live, toMove, ctx.now());
  if (clocks && clocks[toMove] <= 0) return endGame(ctx, game, chess, moves, flagResult(chess, toMove));
  if (!clocks && ctx.now().getTime() - Date.parse(live.last_move_at) >= ABANDON_AFTER_MS) {
    return endGame(ctx, game, chess, moves, { result: '*', termination: 'abandoned' });
  }
  return game;
}

/* -------------------------------------------------------------- moves -- */

/** Record a move for the side to move, with its clock; ends the game when the board or the clock says so. */
function record(ctx, game, chess, moves, uci) {
  const live = loadLive(ctx.db, game.id);
  const mover = SIDE[chess.turn()];
  const now = ctx.now();
  const thinkMs = Math.max(0, now.getTime() - Date.parse(live.turn_started_at));
  let left = null;
  if (live.white_ms !== null) {
    left = live[`${mover}_ms`] - thinkMs;
    if (left <= 0) return { game: endGame(ctx, game, chess, moves, flagResult(chess, mover)), moves, chess };
    left += live.increment_ms;
  }
  const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const row = { ply: moves.length + 1, san: move.san, uci: move.from + move.to + (move.promotion || ''), fen_after: chess.fen(), clock_ms: left, think_ms: thinkMs };
  ctx.db.transaction(() => {
    ctx.db.prepare('INSERT INTO moves_raw (game_id, ply, san, uci, fen_after, clock_ms, think_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(game.id, row.ply, row.san, row.uci, row.fen_after, left, thinkMs);
    ctx.db.prepare(`UPDATE live_games SET ${mover}_ms = ?, turn_started_at = ?, last_move_at = ? WHERE game_id = ?`)
      .run(left, now.toISOString(), now.toISOString(), game.id);
  })();
  const all = [...moves, row];
  const over = endOnBoard(chess);
  return { game: over ? endGame(ctx, game, chess, all, over) : game, moves: all, chess };
}

const isLegal = (chess, uci) => typeof uci === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)
  && chess.moves({ verbose: true }).some((m) => m.from + m.to + (m.promotion || '') === uci);

/** Ask the engine for the bot's move and record it. Engine trouble leaves the bot owing a move. */
async function botMove(ctx, game, playerId) {
  const level = ctx.levels.find((l) => l.level === game.bot_level);
  const moves = loadMoves(ctx.db, game.id);
  let reply;
  try {
    reply = await ctx.engine.bestMove({ moves: moves.map((m) => m.uci), skill: level.skill, nodes: level.nodes });
  } catch {
    return { game, engineError: true };
  }
  // The world may have moved on while the engine thought (a resignation, a flag): check again.
  const fresh = settle(ctx, loadGame(ctx.db, game.id, playerId));
  const now = loadMoves(ctx.db, game.id);
  if (fresh.ended_at || now.length !== moves.length) return { game: fresh };
  const chess = replay(now);
  if (SIDE[chess.turn()] === fresh.colour) return { game: fresh };
  if (!isLegal(chess, reply.uci)) return { game: fresh, engineError: true };
  return { game: record(ctx, fresh, chess, now, reply.uci).game };
}

/* ----------------------------------------------------------- the API -- */

export async function createGame(ctx, playerId, { level, colour, timeControl }, { random = Math.random } = {}) {
  if (!ctx.levels.some((l) => l.level === level)) throw new AppError(400, 'level_invalid', 'Pick a level from 1 to 8.');
  if (!Object.hasOwn(TIME_CONTROLS, timeControl)) throw new AppError(400, 'time_control_invalid', 'Pick a time control.');
  if (!['white', 'black', 'random'].includes(colour)) throw new AppError(400, 'colour_invalid', 'Pick white, black or random.');
  const open = ctx.db.prepare("SELECT id FROM games_raw WHERE player_id = ? AND source = 'chess_match_profile' AND ended_at IS NULL").get(playerId);
  if (open) {
    const g = settle(ctx, loadGame(ctx.db, open.id, playerId));
    if (!g.ended_at) throw Object.assign(new AppError(409, 'game_in_progress', 'Finish or resign your current game first.'), { gameId: open.id });
  }
  const side = colour === 'random' ? (random() < 0.5 ? 'white' : 'black') : colour;
  const tc = TIME_CONTROLS[timeControl];
  const id = randomUUID();
  const now = ctx.now().toISOString();
  try {
    ctx.db.transaction(() => {
      ctx.db.prepare(`INSERT INTO games_raw (id, source, source_game_id, player_id, colour, opponent_type, opponent_label, bot_level, time_control, started_at)
        VALUES (?, 'chess_match_profile', ?, ?, ?, 'bot', ?, ?, ?, ?)`).run(id, id, playerId, side, `Stockfish level ${level}`, level, timeControl, now);
      ctx.db.prepare('INSERT INTO live_games (game_id, white_ms, black_ms, increment_ms, turn_started_at, last_move_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, tc ? tc.baseMs : null, tc ? tc.baseMs : null, tc ? tc.incMs : 0, now, now);
    })();
  } catch (error) {
    // games_raw_one_open: the database's own copy of the one-open-game rule.
    if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
    const other = ctx.db.prepare("SELECT id FROM games_raw WHERE player_id = ? AND source = 'chess_match_profile' AND ended_at IS NULL").get(playerId);
    throw Object.assign(new AppError(409, 'game_in_progress', 'Finish or resign your current game first.'), { gameId: other?.id });
  }
  return withLock(id, async () => {
    let game = loadGame(ctx.db, id, playerId);
    let extra = {};
    if (side === 'black') ({ game, ...extra } = await botMove(ctx, game, playerId));
    return stateOf(ctx, game, { extra });
  });
}

export function gameState(ctx, gameId, playerId) {
  return stateOf(ctx, settle(ctx, loadGame(ctx.db, gameId, playerId)));
}

export function currentGame(ctx, playerId) {
  const open = ctx.db.prepare("SELECT id FROM games_raw WHERE player_id = ? AND source = 'chess_match_profile' AND ended_at IS NULL").get(playerId);
  if (!open) return null;
  const state = gameState(ctx, open.id, playerId);
  return state.status === 'active' ? state : null;
}

export function playMove(ctx, gameId, playerId, { uci, ply }) {
  return withLock(gameId, async () => {
    let game = settle(ctx, loadGame(ctx.db, gameId, playerId));
    if (game.ended_at) throw Object.assign(new AppError(409, 'game_over', 'This game has ended.'), { state: stateOf(ctx, game) });
    const moves = loadMoves(ctx.db, gameId);
    const chess = replay(moves);
    if (SIDE[chess.turn()] !== game.colour) throw new AppError(409, 'not_your_turn', 'Wait for Stockfish to move.');
    if (ply !== undefined && ply !== moves.length + 1) throw Object.assign(new AppError(409, 'out_of_sync', 'The board was out of date; it has been refreshed.'), { state: stateOf(ctx, game) });
    if (!isLegal(chess, uci)) throw new AppError(400, 'illegal_move', 'That move is not legal here.');
    ({ game } = record(ctx, game, chess, moves, uci));
    let extra = {};
    if (!game.ended_at) ({ game, ...extra } = await botMove(ctx, game, playerId));
    return stateOf(ctx, game, { extra });
  });
}

export function continueGame(ctx, gameId, playerId) {
  return withLock(gameId, async () => {
    let game = settle(ctx, loadGame(ctx.db, gameId, playerId));
    let extra = {};
    const chess = replay(loadMoves(ctx.db, gameId));
    if (!game.ended_at && SIDE[chess.turn()] !== game.colour) ({ game, ...extra } = await botMove(ctx, game, playerId));
    return stateOf(ctx, game, { extra });
  });
}

export function resign(ctx, gameId, playerId) {
  return withLock(gameId, async () => {
    let game = settle(ctx, loadGame(ctx.db, gameId, playerId));
    if (game.ended_at) throw Object.assign(new AppError(409, 'game_over', 'This game has ended.'), { state: stateOf(ctx, game) });
    const moves = loadMoves(ctx.db, gameId);
    game = endGame(ctx, game, replay(moves), moves, { result: game.colour === 'white' ? '0-1' : '1-0', termination: 'resignation' });
    return stateOf(ctx, game);
  });
}

/** End every open in-app game that has flagged or been left untimed for 24 hours. */
export function sweep(ctx) {
  const open = ctx.db.prepare("SELECT id, player_id FROM games_raw WHERE source = 'chess_match_profile' AND ended_at IS NULL").all();
  let ended = 0;
  for (const g of open) if (settle(ctx, loadGame(ctx.db, g.id, g.player_id)).ended_at) ended += 1;
  return ended;
}

export default { TIME_CONTROLS, ABANDON_AFTER_MS, createGame, gameState, currentGame, playMove, continueGame, resign, sweep };
