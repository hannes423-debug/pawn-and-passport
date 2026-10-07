# Architecture (draft, milestone 2)

Chess Match Profile collects chess games from real people and turns them
into a deterministic, versioned Player Profile JSON for Pawn & Passport's
future NPC opponents. It is a Node.js server with a SQLite database and a
static frontend, running on a Raspberry Pi 5 behind Tailscale Funnel.

## Process and modules

```
browser (public/, vanilla JS)  --HTTPS-->  Tailscale Funnel  -->  Node (Fastify, 127.0.0.1:3100)
                                                                   |
     CLI (npm run migrate / create-master / export / reanalyse) --+-- src/<area>/ plain functions
                                                                   |
                                                       SQLite (better-sqlite3, WAL)
                                                                   |
                                     Stockfish (separate processes: play + analysis, over UCI)
```

- `src/config.js` - the only reader of the environment; returns a frozen
  config. Per-machine settings and secrets come from `.env`; tunables
  (bot levels, analysis settings, style ranges) from `config/*.json`.
- `src/db/` - opens the database (WAL, foreign keys) and applies the numbered
  migrations in `src/db/migrations/`, each in a transaction.
- `src/server.js` - builds the Fastify app from a config and a database;
  each area registers its own routes.
- `src/<area>/` (`auth`, `consent`, `games`, `engine`, `analysis`, `lichess`,
  `profile`, `exports`, `admin`) - plain functions over the database. Routes
  and CLI commands are thin wrappers, so analysis, profiles and exports run
  without the web server.

Built so far: config, database and migrations, `/api/health`; accounts,
sessions and password reset (`src/auth/`), consent (`src/consent/`), the
master's player list (`src/admin/`, through `src/players/directory.js`), and
the frontend's sign-up, sign-in, reset and settings screens (`public/`).

## Requests

1. An `onRequest` hook (`src/auth/guard.js`) reads the session cookie,
   attaches `request.auth` and checks the CSRF token on state-changing
   requests made with a session.
2. Route guards (`requireAuth`, `requirePlayer`, `requireMaster`) run before
   body validation, so a signed-out request is always a 401.
3. Handlers call plain functions (`accounts.js`, `consent/index.js`, ...) and
   throw `AppError(status, code, message)`; one error handler turns those
   into `{ error, message }`.
4. `test/authz.test.js` walks every registered route: each is either on the
   short public list or answers 401 without a session.

## Data: raw versus derived

| Kind | Tables | Rule |
|---|---|---|
| Account | `accounts`, `sessions`, `password_resets` | the only place email lives |
| Chess identity and consent | `players`, `lichess_links`, `consent_events` | consent is append-only |
| Raw games | `games_raw`, `moves_raw` | frozen once a game ends (triggers) |
| Derived (later milestones) | `analysis_jobs`, `move_analysis`, `game_analysis`, `profiles`, `export_log` | keyed by `analysis_version`, regenerable |

Re-analysis writes new derived rows under a new `analysis_version` and never
touches raw rows.

## The hand-off to Pawn & Passport

1. **Collect** games (in-app vs Stockfish, and verified Lichess imports). *Built in v1.*
2. **Profile** them into `player-profile.v1` JSON. *Built in v1.*
3. Export consenting players' profiles (`pnp_profile_use`). *v1 export tools.*
4. Pawn & Passport's NPC generator turns a profile into an opponent. *Not built.*
