#!/usr/bin/env node
/**
 * index.js - start the server: read .env if there is one, migrate, listen.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, APP_ROOT } from './config.js';
import { openDatabase, migrate } from './db/index.js';
import { buildApp } from './server.js';
import { UciEngine } from './engine/uci.js';

const envFile = path.join(APP_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const db = openDatabase(config.databasePath);
const { applied, version } = migrate(db);
// The play engine: its own Stockfish process, shared by every game in progress.
const playEngine = config.stockfishPath ? new UciEngine({ path: config.stockfishPath }) : null;
const app = buildApp({ config, db, playEngine });
if (applied.length) app.log.info({ applied, version }, 'migrations applied');
if (!playEngine) app.log.warn('STOCKFISH_PATH is not set: games cannot be started');
else playEngine.start().then(() => app.log.info({ engine: playEngine.name }, 'play engine ready'), (err) => app.log.error({ err }, 'play engine failed to start'));

const close = async () => {
  await app.close();
  playEngine?.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ host: config.host, port: config.port });
