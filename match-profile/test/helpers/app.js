/**
 * helpers/app.js - a fresh app on its own in-memory database, per test.
 */

import { loadConfig } from '../../src/config.js';
import { openDatabase, migrate } from '../../src/db/index.js';
import { buildApp } from '../../src/server.js';

export async function testApp(env = {}) {
  const config = loadConfig({ NODE_ENV: 'test', ...env });
  const db = openDatabase(':memory:');
  migrate(db);
  const app = buildApp({ config, db });
  await app.ready();
  return { app, db, config, close: async () => { await app.close(); db.close(); } };
}
