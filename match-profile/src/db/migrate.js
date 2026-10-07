#!/usr/bin/env node
/**
 * migrate.js - apply pending migrations from the command line.
 *
 *   npm run migrate            (uses DATABASE_PATH, or data/chess-match-profile.db)
 *
 * The server also migrates on start; this is for a deploy step or a fresh
 * database before the first run.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, APP_ROOT } from '../config.js';
import { openDatabase, migrate } from './index.js';

const envFile = path.join(APP_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const db = openDatabase(config.databasePath);
const { applied, version } = migrate(db);
db.close();
console.log(applied.length ? `applied ${applied.join(', ')}; schema at ${version}` : `nothing to apply; schema at ${version}`);
