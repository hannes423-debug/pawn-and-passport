# Architecture (draft, milestone 1)

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

Built so far: config, database and migrations, `/api/health`, a placeholder
front page. Everything else is listed in the spec's milestones.

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
