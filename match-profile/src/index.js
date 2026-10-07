#!/usr/bin/env node
/**
 * index.js - start the server: read .env if there is one, migrate, listen.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, APP_ROOT } from './config.js';
import { openDatabase, migrate } from './db/index.js';
import { buildApp } from './server.js';

const envFile = path.join(APP_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const db = openDatabase(config.databasePath);
const { applied, version } = migrate(db);
const app = buildApp({ config, db });
if (applied.length) app.log.info({ applied, version }, 'migrations applied');

const close = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ host: config.host, port: config.port });
