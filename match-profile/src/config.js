/**
 * config.js - every setting the server reads from its environment.
 *
 *   loadConfig(process.env) -> a frozen config object, or throws on a bad value
 *
 * Nothing else reads process.env: modules receive the config they need.
 * Tunables that are not secrets or per-machine (bot levels, analysis
 * settings, style reference ranges) live in config/*.json; loadJson reads
 * them. Master-user credentials are never read here: only the create-master
 * CLI sees MASTER_EMAIL / MASTER_PASSWORD (docs/DECISIONS.md).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ENVS = ['development', 'production', 'test'];

function int(env, key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`config: ${key} must be an integer from ${min} to ${max}, got "${raw}"`);
  return n;
}

function bool(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`config: ${key} must be true or false, got "${raw}"`);
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  if (!ENVS.includes(nodeEnv)) throw new Error(`config: NODE_ENV must be one of ${ENVS.join(', ')}, got "${nodeEnv}"`);
  const production = nodeEnv === 'production';

  const databasePath = env.DATABASE_PATH || (nodeEnv === 'test' ? ':memory:' : path.join(APP_ROOT, 'data', 'chess-match-profile.db'));
  const smtpHost = env.SMTP_HOST || '';
  const config = {
    env: nodeEnv,
    production,
    host: env.HOST || '127.0.0.1',
    port: int(env, 'PORT', 3100, { min: 0, max: 65535 }),
    // The address people reach the app at (Tailscale Funnel in production);
    // used for Lichess OAuth redirects and password-reset links.
    publicUrl: (env.PUBLIC_URL || `http://localhost:${int(env, 'PORT', 3100, { min: 0, max: 65535 })}`).replace(/\/+$/, ''),
    databasePath: databasePath === ':memory:' ? databasePath : path.resolve(APP_ROOT, databasePath),
    // Secure cookies everywhere except a plain-http dev machine.
    cookieSecure: bool(env, 'COOKIE_SECURE', production),
    logLevel: env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),
    stockfishPath: env.STOCKFISH_PATH || null,
    analysisConcurrency: int(env, 'ANALYSIS_CONCURRENCY', 1, { min: 1, max: 4 }),
    // argon2id cost: OWASP's minimum profile (19 MiB, 2 passes, 1 lane); tests
    // use the cheapest settings argon2 allows.
    passwordHash: nodeEnv === 'test'
      ? { memoryCost: 1024, timeCost: 1, parallelism: 1 }
      : { memoryCost: 19456, timeCost: 2, parallelism: 1 },
    // Unset SMTP: password-reset links are logged to the server console instead.
    smtp: smtpHost ? {
      host: smtpHost,
      port: int(env, 'SMTP_PORT', 587, { min: 1, max: 65535 }),
      user: env.SMTP_USER || '',
      password: env.SMTP_PASSWORD || '',
      from: env.SMTP_FROM || ''
    } : null
  };
  if (production && !env.PUBLIC_URL) throw new Error('config: PUBLIC_URL is required in production');
  return Object.freeze(config);
}

/** A JSON file from config/, parsed. Throws with the file name when it is missing or broken. */
export function loadJson(name, { dir = path.join(APP_ROOT, 'config') } = {}) {
  const file = path.join(dir, name);
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { throw new Error(`config: missing ${path.relative(APP_ROOT, file)}`); }
  try { return JSON.parse(text); } catch (error) { throw new Error(`config: ${path.relative(APP_ROOT, file)} is not valid JSON (${error.message})`); }
}

/** What /api/health may say about the config: nothing that names a path or a secret. */
export const publicConfig = (config) => ({
  env: config.env,
  engine: config.stockfishPath ? 'configured' : 'not configured',
  email: config.smtp ? 'smtp' : 'console'
});

export default { loadConfig, loadJson, publicConfig, APP_ROOT };
