# Chess Match Profile

A separate app in the Pawn & Passport repo. It collects chess games from
real people, played in the app against Stockfish or imported from their own
Lichess account, and turns them into a deterministic, explainable, versioned
Player Profile JSON that Pawn & Passport will later use to build opponents.
No LLM is involved anywhere: every number comes from counted events in
stored games.

Status: **milestone 3 of 9: playable.** Accounts, consent, and games
against Stockfish at 8 levels with clocks, on phone and desktop. Analysis
and profiles come next. The spec is the Claude Docs page "Chess Match Profile - v1
spec for Claude Code"; choices it left open are in `docs/DECISIONS.md`.

## Run it

```bash
cd match-profile
npm install
npm run dev            # http://127.0.0.1:3100, restarts on file changes
npm test               # node:test, no Stockfish or network needed
npm run migrate        # apply pending migrations without starting the server
```

Node.js 20.12 or later. Settings come from the environment or a `.env` file
in this folder; `deploy/.env.example` lists them all.

## Stockfish

Games need a native Stockfish on the server; the app talks to it over UCI
and never ships it to the browser. On the Pi or a Debian/Ubuntu laptop:

```bash
sudo apt install stockfish
echo 'STOCKFISH_PATH=/usr/games/stockfish' >> .env
```

Without it the site runs but cannot start games. `npm test` uses stand-in
engines; `STOCKFISH_PATH=/usr/games/stockfish npm test` also checks the real
one.

## Playing

Pick a level (1-8, labels rather than ratings), a colour and a clock
(none, 10+0, 5+3, 15+10). The server owns the game: it checks every move,
keeps the clocks, asks Stockfish for its reply and records both. A game
survives a reload or a sleeping phone; one game is open at a time. Finished
games get a PGN with `[CMPSource "chess_match_profile"]` and
`[CMPBotLevel "N"]`. Details in `docs/DECISIONS.md`, timing in
`docs/ANALYSIS.md`.

## Accounts and the master user

Email and password (argon2id, at least 10 characters). Sessions are
server-side: a random 256-bit cookie (HttpOnly, SameSite=Lax, Secure outside
dev), stored hashed, 30 days sliding, replaced at sign-in and on a password
change. Every state-changing request carries the session's CSRF token.
Sign-in, sign-up and reset are rate-limited per IP and per email.

The master account (sees chess data and consent states, never emails) is
made only from the command line, and running it again is safe:

```bash
MASTER_EMAIL=you@example.com MASTER_PASSWORD='a long passphrase' npm run create-master
```

Without `SMTP_HOST`, password-reset links are printed on the server console.
Consent types, who sees what and the reset rules: `docs/PRIVACY.md`.

## Deploy (Raspberry Pi 5)

Clone only this folder, then run it under systemd behind Tailscale Funnel:

```bash
git clone --filter=blob:none --sparse https://github.com/hannes423-debug/pawn-and-passport
cd pawn-and-passport && git sparse-checkout set match-profile
cd match-profile && npm ci --omit=dev
cp deploy/.env.example .env      # then fill it in
sudo cp deploy/chess-match-profile.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now chess-match-profile
tailscale funnel --bg 3100
```

## Data never committed

`.gitignore` keeps the database, `.env` and exports out of git. GitHub Pages
publishes this repo's `main`, so anything committed here is public.

## Dependencies and licences

| Package | Licence | Used for |
|---|---|---|
| fastify | MIT | HTTP server |
| @fastify/static | MIT | serving `public/` |
| better-sqlite3 | MIT | SQLite |
| @fastify/cookie | MIT | session cookie |
| argon2 | MIT | password hashing |
| nodemailer | MIT-0 | reset email over SMTP |
| chess.js | BSD-2-Clause | move rules and PGN (server only) |
| Chessnut pieces (`public/board/pieces/`) | Apache-2.0 | piece images; licence and NOTICE included |
| Board code (`public/board/`) | Pawn & Passport's own | the 2D board, copied from the game |
| supertest (dev) | MIT | HTTP tests |

Stockfish (GPLv3) runs as a separate server process (`STOCKFISH_PATH`); the
app does not link it and never ships it to the browser.
