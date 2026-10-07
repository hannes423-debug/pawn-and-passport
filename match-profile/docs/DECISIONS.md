# Decisions

Choices made where the spec was silent, or where it was changed, with one
line of reasoning each. Newest at the bottom of each milestone.

## Milestone 1: skeleton (2026-10-07)

- **Location: `match-profile/` in the Pawn & Passport repo**, not a new
  `chess-match-profile` repo (the owner's call; the spec was updated). The
  folder is self-contained: own `package.json`, tests, docs and deploy, and
  no imports to or from the game's `js/`.
- **HTTP: Fastify 5.** Built-in JSON schema validation and `inject`, MIT, and
  fast enough on a Pi; Express would need more middleware for the same.
- **Migrations arrive with the milestone that first writes them.** `001_core`
  has accounts, sessions, resets, players, Lichess links, consent and raw
  games; analysis, profiles and the export log come as `002`+ so their shape
  is fixed when the code that fills them is written.
- **Ids are UUID v4 text, times ISO-8601 UTC text.** Readable in exports and
  in the sqlite shell, and sortable as strings.
- **Raw-data immutability is enforced by SQLite triggers**, not only by code:
  a game is frozen once `ended_at` is set, and `consent_events` rejects
  updates. Imports write a game open, add its moves, then close it, in one
  transaction.
- **Session ids are stored hashed** (SHA-256 in `sessions.id`), like reset
  tokens: a leaked database copy cannot be used to log in.
- **Per-session CSRF token lives in the `sessions` row** (`csrf_token`).
- **`.env` is read with Node's `process.loadEnvFile`**, so no dotenv
  dependency; this sets the floor at Node 20.12.
- **Default port 3100, bound to 127.0.0.1.** The Aurora Chess server already
  uses 3000 on the same Pi; Tailscale Funnel is the only way in.
- **Deploy pattern.** The `aurora-chess` repo holds only its client; the
  server pattern was read from `js/19_online.js`: a Node server on a local
  port published with `tailscale funnel <port>`. The systemd unit is our own.
