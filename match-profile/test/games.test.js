import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { testApp, register, csrf } from './helpers/app.js';
import { scriptedEngine, brokenEngine } from './helpers/engines.js';
import { createMaster } from '../src/auth/accounts.js';
import { login } from './helpers/app.js';
import { sweep } from '../src/games/service.js';

const start = (p, body) => p.agent.post('/api/games').set(csrf(p)).send({ level: 3, colour: 'white', timeControl: 'untimed', ...body });
const move = (p, id, uci, ply) => p.agent.post(`/api/games/${id}/moves`).set(csrf(p)).send(ply ? { uci, ply } : { uci });

test('a new game as White: twenty legal moves, your turn, nothing played yet', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'a@example.com', username: 'alice' });
  const res = await start(p, { timeControl: '5+3' }).expect(201);
  const g = res.body;
  assert.equal(g.colour, 'white');
  assert.equal(g.status, 'active');
  assert.equal(g.playerToMove, true);
  assert.equal(g.legal.length, 20);
  assert.equal(g.moves.length, 0);
  assert.equal(g.opponent, 'Stockfish level 3');
  assert.deepEqual([g.clocks.white, g.clocks.black, g.clocks.increment, g.clocks.running], [300000, 300000, 3000, 'white']);
  const row = t.db.prepare('SELECT source, source_game_id, opponent_type, bot_level, time_control, ended_at FROM games_raw').get();
  assert.deepEqual(row, { source: 'chess_match_profile', source_game_id: g.id, opponent_type: 'bot', bot_level: 3, time_control: '5+3', ended_at: null });
  await t.close();
});

test('as Black, Stockfish moves first; the levels it uses come from config', async () => {
  const engine = scriptedEngine(['d2d4']);
  const t = await testApp({}, { playEngine: engine });
  const p = await register(t, { email: 'b@example.com', username: 'bob' });
  const g = (await start(p, { colour: 'black', level: 6 }).expect(201)).body;
  assert.deepEqual(g.moves.map((m) => m.san), ['d4']);
  assert.equal(g.playerToMove, true);
  assert.deepEqual(engine.calls[0], { moves: [], skill: 13, nodes: 150000 });
  const levels = (await p.agent.get('/api/bot-levels').expect(200)).body;
  assert.equal(levels.levels.length, 8);
  assert.ok(levels.levels.every((l) => /^Level \d$/.test(l.label)), 'labels, never ratings');
  await t.close();
});

test('the server checks every move: illegal, malformed and out-of-turn moves are refused', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'c@example.com', username: 'carol' });
  const { id } = (await start(p).expect(201)).body;
  for (const bad of ['e2e5', 'e7e5', 'zz99', 'e2e4q', 'g1g3']) {
    const res = await move(p, id, bad);
    assert.equal(res.status, 400, bad);
    assert.equal(res.body.error, bad === 'zz99' || bad === 'e2e4q' ? 'illegal_move' : 'illegal_move');
  }
  assert.equal(t.db.prepare('SELECT count(*) n FROM moves_raw').get().n, 0);
  const ok = await move(p, id, 'e2e4', 1).expect(200);
  assert.deepEqual(ok.body.moves.map((m) => m.uci), ['e2e4', 'a7a5'], 'Stockfish replied (the stand-in plays the first legal move)');
  const stored = t.db.prepare('SELECT ply, san, uci, fen_after FROM moves_raw ORDER BY ply').all();
  assert.equal(stored.length, 2);
  assert.equal(stored[1].fen_after, ok.body.fen);
  await t.close();
});

test('a stale board (wrong ply) or a double tap is refused with the current state', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'd@example.com', username: 'dave' });
  const { id } = (await start(p).expect(201)).body;
  const [a, b] = await Promise.all([move(p, id, 'e2e4', 1), move(p, id, 'd2d4', 1)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const refused = a.status === 409 ? a : b;
  assert.equal(refused.body.error, 'out_of_sync');
  assert.equal(refused.body.state.moves.length, 2, 'the refusal carries the board as it now is');
  assert.equal(t.db.prepare('SELECT count(*) n FROM moves_raw').get().n, 2);
  await t.close();
});

test('one game at a time, and it survives a reload', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'e@example.com', username: 'erin' });
  const g = (await start(p).expect(201)).body;
  await move(p, g.id, 'g1f3', 1).expect(200);
  const again = await start(p).expect(409);
  assert.equal(again.body.error, 'game_in_progress');
  assert.equal(again.body.gameId, g.id);
  const current = (await p.agent.get('/api/games/current').expect(200)).body.game;
  assert.equal(current.id, g.id);
  assert.deepEqual(current.moves.map((m) => m.uci), ['g1f3', 'a7a5']);
  await p.agent.post(`/api/games/${g.id}/resign`).set(csrf(p)).send({}).expect(200);
  assert.equal((await p.agent.get('/api/games/current')).body.game, null);
  await start(p).expect(201);
  await t.close();
});

test('checkmate ends the game: result, PGN, frozen raw data, queued for analysis', async () => {
  const t = await testApp({}, { playEngine: scriptedEngine(['f2f3', 'g2g4']) });
  const p = await register(t, { email: 'f@example.com', username: 'fool' });
  const g = (await start(p, { colour: 'black' }).expect(201)).body;
  await move(p, g.id, 'e7e5', 2).expect(200);
  const end = (await move(p, g.id, 'd8h4', 4).expect(200)).body;
  assert.equal(end.status, 'ended');
  assert.equal(end.result, '0-1');
  assert.equal(end.termination, 'checkmate');
  assert.deepEqual(t.ended, [g.id]);
  assert.equal(t.db.prepare('SELECT count(*) n FROM live_games').get().n, 0);
  assert.throws(() => t.db.prepare("UPDATE games_raw SET result = '1-0' WHERE id = ?").run(g.id), /never changes/);
  const after = await move(p, g.id, 'a7a6');
  assert.equal(after.status, 409);
  assert.equal(after.body.error, 'game_over');

  // The PGN reads back to the same game, with the app's own tags.
  const chess = new Chess();
  chess.loadPgn(end.pgn);
  assert.deepEqual(chess.history(), ['f3', 'e5', 'g4', 'Qh4#']);
  const tags = chess.getHeaders();
  assert.deepEqual([tags.Result, tags.White, tags.Black, tags.CMPSource, tags.CMPBotLevel, tags.TimeControl],
    ['0-1', 'Stockfish (Level 3)', 'fool', 'chess_match_profile', '3', '-']);
  await t.close();
});

test('resigning: a loss, and the game is over', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'g@example.com', username: 'gus' });
  const g = (await start(p).expect(201)).body;
  const r = (await p.agent.post(`/api/games/${g.id}/resign`).set(csrf(p)).send({}).expect(200)).body;
  assert.deepEqual([r.result, r.termination, r.status], ['0-1', 'resignation', 'ended']);
  await p.agent.post(`/api/games/${g.id}/resign`).set(csrf(p)).send({}).expect(409);
  await t.close();
});

test('clocks are measured on the server, with the increment added after the move', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'h@example.com', username: 'hana' });
  const g = (await start(p, { timeControl: '5+3' }).expect(201)).body;
  t.clock.advance(7000);
  const after = (await move(p, g.id, 'e2e4', 1).expect(200)).body;
  const row = t.db.prepare('SELECT clock_ms, think_ms FROM moves_raw WHERE ply = 1').get();
  assert.deepEqual(row, { clock_ms: 300000 - 7000 + 3000, think_ms: 7000 });
  assert.equal(after.clocks.white, 296000);
  assert.equal(after.clocks.running, 'white');
  assert.match(after.moves.length === 2 ? 'ok' : '', /ok/);
  await t.close();
});

test('running out of time loses (or draws when Stockfish has only a king), even without a move', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'i@example.com', username: 'ivan' });
  const g = (await start(p, { timeControl: '10+0' }).expect(201)).body;
  t.clock.advance(600001);
  const state = (await p.agent.get(`/api/games/${g.id}`).expect(200)).body;
  assert.deepEqual([state.status, state.result, state.termination], ['ended', '0-1', 'time']);
  await t.close();

  // A move that arrives after the flag fell is not recorded.
  const t2 = await testApp();
  const q = await register(t2, { email: 'j@example.com', username: 'joe' });
  const h = (await start(q, { timeControl: '10+0' }).expect(201)).body;
  t2.clock.advance(600500);
  const late = await move(q, h.id, 'e2e4', 1);
  assert.equal(late.status, 409);
  assert.equal(late.body.state.termination, 'time');
  assert.equal(t2.db.prepare('SELECT count(*) n FROM moves_raw').get().n, 0);
  await t2.close();
});

test('an untimed game left for 24 hours is abandoned (not a loss); the sweep finds it', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'k@example.com', username: 'kim' });
  const g = (await start(p).expect(201)).body;
  await move(p, g.id, 'e2e4', 1).expect(200);
  t.clock.advance(23 * 3600 * 1000);
  assert.equal(sweep(t.app.gameCtx), 0);
  t.clock.advance(3600 * 1000);
  assert.equal(sweep(t.app.gameCtx), 1);
  const row = t.db.prepare('SELECT result, termination FROM games_raw WHERE id = ?').get(g.id);
  assert.deepEqual(row, { result: '*', termination: 'abandoned' });
  await t.close();
});

test('if Stockfish fails, the game waits for it, and "continue" gets its move', async () => {
  const t = await testApp({}, { playEngine: brokenEngine() });
  const p = await register(t, { email: 'l@example.com', username: 'lee' });
  const g = (await start(p).expect(201)).body;
  const stuck = (await move(p, g.id, 'e2e4', 1).expect(200)).body;
  assert.equal(stuck.engineError, true);
  assert.equal(stuck.botToMove, true);
  assert.equal(stuck.moves.length, 1, 'your move is kept');
  const notYours = await move(p, g.id, 'd2d4', 2);
  assert.equal(notYours.body.error, 'not_your_turn');
  t.app.gameCtx.engine = scriptedEngine(['e7e5']);
  const fixed = (await p.agent.post(`/api/games/${g.id}/continue`).set(csrf(p)).send({}).expect(200)).body;
  assert.deepEqual(fixed.moves.map((m) => m.uci), ['e2e4', 'e7e5']);
  assert.equal(fixed.playerToMove, true);
  await t.close();
});

test("another player's game is a 404 on every route; a master without a player gets 403", async () => {
  const t = await testApp();
  const a = await register(t, { email: 'm@example.com', username: 'mona' });
  const b = await register(t, { email: 'n@example.com', username: 'nils' });
  const g = (await start(a).expect(201)).body;
  for (const [method, url, body] of [['get', `/api/games/${g.id}`], ['post', `/api/games/${g.id}/moves`, { uci: 'e2e4' }],
    ['post', `/api/games/${g.id}/continue`, {}], ['post', `/api/games/${g.id}/resign`, {}]]) {
    const res = await b.agent[method](url).set(csrf(b)).send(body);
    assert.equal(res.status, 404, `${method} ${url}`);
  }
  assert.equal((await b.agent.get('/api/games/current')).body.game, null);
  await createMaster(t.db, { email: 'boss@example.com', password: 'master passphrase' }, { password: { minLength: 10, maxLength: 256 }, hash: t.config.passwordHash });
  const m = await login(t, 'boss@example.com', 'master passphrase');
  assert.equal((await m.agent.get(`/api/games/${g.id}`)).status, 403);
  await t.close();
});

test('without Stockfish configured, games cannot start', async () => {
  const t = await testApp({}, { playEngine: null });
  const p = await register(t, { email: 'o@example.com', username: 'otto' });
  const res = await start(p).expect(503);
  assert.equal(res.body.error, 'engine_unavailable');
  await t.close();
});

test('timed games write each move’s clock into the PGN', async () => {
  const t = await testApp();
  const p = await register(t, { email: 'q@example.com', username: 'quinn' });
  const g = (await start(p, { timeControl: '15+10' }).expect(201)).body;
  t.clock.advance(4000);
  await move(p, g.id, 'e2e4', 1).expect(200);
  const end = (await p.agent.post(`/api/games/${g.id}/resign`).set(csrf(p)).send({}).expect(200)).body;
  assert.match(end.pgn, /\[TimeControl "900\+10"\]/);
  assert.match(end.pgn, /e4 \{\[%clk 0:15:06\]\}/);
  await t.close();
});

test('promotion: the four choices are offered and the one you pick is played', async () => {
  const t = await testApp({}, { playEngine: scriptedEngine(['h7h6', 'h6h5', 'h5h4', 'h4h3', 'h3g2']) });
  const p = await register(t, { email: 'r@example.com', username: 'runner' });
  const g = (await start(p).expect(201)).body;
  let s;
  for (const [i, uci] of ['a2a4', 'a4a5', 'a5a6', 'a6b7'].entries()) s = (await move(p, g.id, uci, i * 2 + 1).expect(200)).body;
  const promos = s.legal.filter((m) => m.uci.startsWith('b7a8')).map((m) => m.uci).sort();
  assert.deepEqual(promos, ['b7a8b', 'b7a8n', 'b7a8q', 'b7a8r']);
  assert.ok(s.legal.find((m) => m.uci === 'b7a8n').capture);
  await move(p, g.id, 'b7a8', 9).expect(400);
  const after = (await move(p, g.id, 'b7a8n', 9).expect(200)).body;
  assert.equal(after.moves[8].san, 'bxa8=N');
  await t.close();
});

test('two "Play" taps at once open one game, not two', async () => {
  const t = await testApp();
  const p = await register(t, { email: 's@example.com', username: 'speedy' });
  const results = await Promise.all([start(p), start(p), start(p)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
  const open = t.db.prepare('SELECT count(*) n FROM games_raw WHERE ended_at IS NULL').get().n;
  assert.equal(open, 1);
  const winner = results.find((r) => r.status === 201).body.id;
  assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.gameId === winner));
  await t.close();
});
