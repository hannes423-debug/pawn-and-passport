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

## Milestone 2: auth and consent (2026-10-07)

- **argon2id at m=19456 KiB, t=2, p=1** (OWASP's minimum profile); tests use
  the cheapest settings so the suite stays fast.
- **Sessions slide at most once an hour**: a request extends the 30 days only
  when that moves the expiry by an hour or more, so not every request writes.
- **CSRF**: a per-session token, sent in `x-csrf-token` and compared in
  constant time, on every state-changing request made with a session. The
  routes that run before a session exists (register, login, reset) cannot
  have one; they are covered by SameSite=Lax and by the API accepting only
  `application/json` bodies (the `text/plain` parser is removed), which a
  cross-site form cannot send without a CORS preflight we never allow.
- **Sign-in checks run before body validation** (`preValidation`), so a
  signed-out request always gets 401, whatever its body.
- **Rate limits are in memory, fixed windows, counting every attempt**, in
  `config/auth.json`: login 20/15 min per IP and 8/15 min per email; sign-up
  10/hour per IP; reset 10/hour per IP and 3/hour per email. One server
  process, and a restart forgetting the counts is acceptable here.
- **Login answers the same for an unknown email** and still spends one
  argon2 verify, so timing does not tell. The reset request answers the same
  either way. **Sign-up does say "email taken"**: usability over hiding which
  addresses have accounts, and sign-up is rate-limited.
- **Reset links carry the token in the URL fragment** (`#/reset/<token>`), so
  it never reaches a server log or a Referer header. Without SMTP the console
  transport prints the link (the spec asks for that) but not the address.
- **Completing a reset signs out everywhere and does not sign in**; the
  person signs in with the new password.
- **create-master also sets the password when promoting or re-running**, and
  ends that account's sessions, so afterwards exactly those credentials sign
  in as master. A master needs no player row; player routes answer
  403 `no_player` for one.
- **Sign-up records an event for all seven consent types**, the optional ones
  as `granted = 0`, so every player's history starts complete.
- **Required consents are listed as conditions**, not tickboxes; the API
  refuses a sign-up without them and refuses withdrawing them (409, pointing
  to account deletion, milestone 8).
- **Consent wording lives in `src/consent/index.js` with `POLICY_VERSION`**
  (2026-10-07); any wording change means a new version.
- **Field rules**: username 3-20 of `A-Z a-z 0-9 _ -`, unique ignoring case;
  display name up to 40 characters; country an ISO 3166-1 alpha-2 code.
- **Who-sees-what is one module**: `src/players/directory.js` is the only
  code that returns one player to someone else. It never selects an email,
  and returns display name and country only with current `public_name`.
- **SMTP through nodemailer 10** (MIT-0), only when `SMTP_HOST` is set.
- **Only the loopback hop is a trusted proxy** (`trustProxy: 'loopback'`):
  `request.ip` is the address Tailscale's local proxy appends to
  `X-Forwarded-For`, so a client cannot dodge per-IP limits by writing its
  own. To check on the Pi: if Funnel turns out not to send the header, every
  request looks like 127.0.0.1 and the per-IP limits are shared by everyone.
