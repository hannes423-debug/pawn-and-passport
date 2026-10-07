# Chess Match Profile

A separate app in the Pawn & Passport repo. It collects chess games from
real people, played in the app against Stockfish or imported from their own
Lichess account, and turns them into a deterministic, explainable, versioned
Player Profile JSON that Pawn & Passport will later use to build opponents.
No LLM is involved anywhere: every number comes from counted events in
stored games.

Status: **milestone 2 of 9**: skeleton, plus accounts, sessions, password
reset, roles, the master-user command and consent. The spec is the Claude Docs page "Chess Match Profile - v1
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
| supertest (dev) | MIT | HTTP tests |

Stockfish (GPLv3) will run as a separate server process and is never
shipped to the browser.
