/**
 * server.js - the Fastify app, built from a config and an open database.
 *
 *   const app = buildApp({ config, db })   // nothing listens yet
 *   await app.listen({ host, port })
 *
 * Each area (auth, consent, admin, ...) registers its own routes from plain
 * functions the CLI can also call. Tests pass their own mailer, clock and
 * auth settings. app.routeList holds every route, so a test can check that
 * each one is either marked public or refuses a request without a session.
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { APP_ROOT, publicConfig, loadJson } from './config.js';
import { schemaVersion } from './db/index.js';
import { registerGuard } from './auth/guard.js';
import { authRoutes } from './auth/routes.js';
import { createLimiter } from './auth/rateLimit.js';
import { consentRoutes } from './consent/routes.js';
import { adminRoutes } from './admin/routes.js';
import { createMailer } from './mail/index.js';

const VERSION = JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version;

export function buildApp({ config, db, auth = loadJson('auth.json'), mailer = createMailer(config), now = () => new Date(), limiter = createLimiter() }) {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : {
      level: config.logLevel,
      // Never log bodies, cookies or auth headers: they carry emails, passwords and tokens.
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]']
    },
    // Tailscale Funnel's local proxy is the only hop we trust: request.ip is the
    // address it adds to X-Forwarded-For, never one a client wrote there itself.
    trustProxy: 'loopback',
    bodyLimit: 1024 * 1024
  });
  app.decorate('config', config);
  app.decorate('db', db);

  // JSON bodies only: a cross-site form cannot send one (docs/DECISIONS.md, CSRF).
  app.removeContentTypeParser('text/plain');

  const routeList = [];
  app.decorate('routeList', routeList);
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/api/')) {
      for (const method of [].concat(route.method)) if (method !== 'HEAD') routeList.push({ method, url: route.url, public: route.config?.public === true });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) return reply.code(400).send({ error: 'invalid_request', message: error.message });
    if (error.statusCode === 415) return reply.code(415).send({ error: 'json_only', message: 'Send JSON.' });
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) request.log.error({ err: error }, 'unhandled error');
    if (error.retryAfter) reply.header('retry-after', String(error.retryAfter));
    const code = typeof error.code === 'string' && !error.code.startsWith('FST_') && !error.code.startsWith('SQLITE_') ? error.code : (status === 500 ? 'server_error' : 'bad_request');
    return reply.code(status).send({ error: code, message: status === 500 ? 'Something went wrong on the server.' : error.message });
  });

  app.register(fastifyCookie);
  app.register(async (api) => {
    const deps = { config, db, auth, limiter, mailer, now };
    registerGuard(api, deps);

    api.get('/api/health', { config: { public: true } }, async (request, reply) => {
      let database = 'ok';
      let schema = null;
      try { schema = schemaVersion(db); } catch { database = 'error'; }
      if (database !== 'ok') reply.code(503);
      return { status: database === 'ok' ? 'ok' : 'degraded', app: 'chess-match-profile', version: VERSION, schema, database, ...publicConfig(config) };
    });
    authRoutes(api, deps);
    consentRoutes(api, deps);
    adminRoutes(api, deps);
  });

  app.register(fastifyStatic, { root: path.join(APP_ROOT, 'public'), index: 'index.html' });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(request.url.startsWith('/api/') ? { error: 'not_found' } : 'Not found');
  });

  return app;
}

export { VERSION };
export default { buildApp, VERSION };
