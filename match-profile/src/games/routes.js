/**
 * games/routes.js - HTTP for in-app games; every route is the player's own.
 *
 *   GET  /api/bot-levels
 *   GET  /api/games/current            the game in progress, or null
 *   POST /api/games                    { level, colour, timeControl } -> 201 state
 *   GET  /api/games/:id                state (a game that is not yours is a 404)
 *   POST /api/games/:id/moves          { uci, ply } -> state after Stockfish's reply
 *   POST /api/games/:id/continue       Stockfish owes a move (after an engine hiccup)
 *   POST /api/games/:id/resign
 */

import { AppError } from '../errors.js';
import { requirePlayer } from '../auth/guard.js';
import { createGame, gameState, currentGame, playMove, continueGame, resign, TIME_CONTROLS } from './service.js';

const UUID = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const params = { params: { type: 'object', required: ['id'], properties: { id: UUID } } };

export function gameRoutes(app, ctx) {
  const needEngine = () => { if (!ctx.engine) throw new AppError(503, 'engine_unavailable', 'Stockfish is not set up on this server (STOCKFISH_PATH).'); };

  app.get('/api/bot-levels', { preValidation: requirePlayer }, async () => ({
    levels: ctx.levels.map((l) => ({ level: l.level, label: l.label })),
    timeControls: Object.keys(TIME_CONTROLS)
  }));

  app.get('/api/games/current', { preValidation: requirePlayer }, async (request) => ({ game: currentGame(ctx, request.auth.playerId) }));

  app.post('/api/games', {
    preValidation: requirePlayer,
    schema: { body: { type: 'object', required: ['level', 'colour', 'timeControl'], additionalProperties: false, properties: {
      level: { type: 'integer', minimum: 1, maximum: 8 },
      colour: { type: 'string', enum: ['white', 'black', 'random'] },
      timeControl: { type: 'string', enum: Object.keys(TIME_CONTROLS) } } } }
  }, async (request, reply) => {
    needEngine();
    const state = await createGame(ctx, request.auth.playerId, request.body);
    reply.code(201);
    return state;
  });

  app.get('/api/games/:id', { preValidation: requirePlayer, schema: params }, async (request) => gameState(ctx, request.params.id, request.auth.playerId));

  app.post('/api/games/:id/moves', {
    preValidation: requirePlayer,
    schema: { ...params, body: { type: 'object', required: ['uci'], additionalProperties: false, properties: {
      uci: { type: 'string', maxLength: 5 }, ply: { type: 'integer', minimum: 1 } } } }
  }, async (request) => {
    needEngine();
    return playMove(ctx, request.params.id, request.auth.playerId, request.body);
  });

  app.post('/api/games/:id/continue', { preValidation: requirePlayer, schema: params }, async (request) => {
    needEngine();
    return continueGame(ctx, request.params.id, request.auth.playerId);
  });

  app.post('/api/games/:id/resign', { preValidation: requirePlayer, schema: params }, async (request) => resign(ctx, request.params.id, request.auth.playerId));
}

export default { gameRoutes };
