#!/usr/bin/env node
/**
 * create-master.js - the only way to make the master account.
 *
 *   MASTER_EMAIL=you@example.com MASTER_PASSWORD='a long passphrase' npm run create-master
 *
 * Creates the account, or promotes an existing one, and sets its password
 * through the same argon2id path as everyone else's. Running it again is
 * safe: it just sets the same credentials. The server never reads these two
 * variables; they are passed on the command line, not kept in .env.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, loadJson, APP_ROOT } from '../config.js';
import { openDatabase, migrate } from '../db/index.js';
import { createMaster } from '../auth/accounts.js';

const envFile = path.join(APP_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const email = process.env.MASTER_EMAIL;
const password = process.env.MASTER_PASSWORD;
if (!email || !password) {
  console.error('Set MASTER_EMAIL and MASTER_PASSWORD for this one command, e.g.\n  MASTER_EMAIL=you@example.com MASTER_PASSWORD=\'a long passphrase\' npm run create-master');
  process.exit(2);
}

const config = loadConfig();
const auth = loadJson('auth.json');
const db = openDatabase(config.databasePath);
migrate(db);
try {
  const { action } = await createMaster(db, { email, password }, { password: auth.password, hash: config.passwordHash });
  console.log({ created: 'Master account created.', promoted: 'Existing account promoted to master; its password was set.', updated: 'Master account already existed; its password was set.' }[action]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
