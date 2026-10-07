/**
 * server.js - the Fastify app, built from a config and an open database.
 *
 *   const app = buildApp({ config, db })   // nothing listens yet
 *   await app.listen({ host, port })
 *
 * Routes are added per area (auth, games, ...) as the milestones land; each
 * area is a plain-function module the CLI can call without this server.
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { APP_ROOT, publicConfig } from './config.js';
import { schemaVersion } from './db/index.js';

const VERSION = JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version;

export function buildApp({ config, db }) {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : {
      level: config.logLevel,
      // Never log bodies, cookies or auth headers: they carry emails, passwords and tokens.
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]']
    },
    trustProxy: true,          // Tailscale Funnel terminates TLS in front of us
    bodyLimit: 1024 * 1024
  });
  app.decorate('config', config);
  app.decorate('db', db);

  app.get('/api/health', async (request, reply) => {
    let database = 'ok';
    let schema = null;
    try { schema = schemaVersion(db); } catch { database = 'error'; }
    if (database !== 'ok') reply.code(503);
    return { status: database === 'ok' ? 'ok' : 'degraded', app: 'chess-match-profile', version: VERSION, schema, database, ...publicConfig(config) };
  });

  app.register(fastifyStatic, { root: path.join(APP_ROOT, 'public'), index: 'index.html' });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(request.url.startsWith('/api/') ? { error: 'not_found' } : 'Not found');
  });

  return app;
}

export { VERSION };
export default { buildApp, VERSION };
