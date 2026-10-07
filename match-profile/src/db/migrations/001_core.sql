-- 001_core: accounts, consent and raw games.
--
-- Three separations from the spec, visible in the tables:
--   account data (accounts, sessions, password_resets: the only place email lives)
--   chess identity (players, lichess_links) and consent (consent_events, append-only)
--   raw games (games_raw, moves_raw: frozen once a game ends)
-- Derived tables (analysis, profiles, exports) arrive with the milestones
-- that write them, as 002 and later. Ids are UUID text; times are ISO-8601 UTC.

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'master')),
  created_at    TEXT NOT NULL
);

-- id is the SHA-256 of the cookie's session id, never the id itself.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX sessions_account ON sessions (account_id);

CREATE TABLE password_resets (
  token_hash  TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX password_resets_account ON password_resets (account_id);

-- A master account may have no player row; a player always has an account.
CREATE TABLE players (
  id            TEXT PRIMARY KEY,          -- also the profile's player_id
  account_id    TEXT NOT NULL UNIQUE REFERENCES accounts (id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT,
  country       TEXT,
  created_at    TEXT NOT NULL
);

-- Written only after Lichess OAuth succeeds. One Lichess account, one player.
CREATE TABLE lichess_links (
  player_id         TEXT PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
  lichess_username  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  verified_at       TEXT NOT NULL
);

-- Append-only: the current state of a consent is its latest row.
CREATE TABLE consent_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id       TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  consent_type    TEXT NOT NULL CHECK (consent_type IN (
                    'store_games', 'analyse_games', 'import_lichess', 'pnp_profile_use',
                    'public_name', 'likeness_use', 'promotional_use')),
  granted         INTEGER NOT NULL CHECK (granted IN (0, 1)),
  policy_version  TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX consent_events_current ON consent_events (player_id, consent_type, id);
CREATE TRIGGER consent_events_append_only BEFORE UPDATE ON consent_events
BEGIN
  SELECT RAISE(ABORT, 'consent_events is append-only');
END;

CREATE TABLE games_raw (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('chess_match_profile', 'lichess')),
  source_game_id  TEXT NOT NULL,
  player_id       TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  colour          TEXT NOT NULL CHECK (colour IN ('white', 'black')),
  opponent_type   TEXT NOT NULL CHECK (opponent_type IN ('bot', 'human')),
  opponent_label  TEXT,
  bot_level       INTEGER,
  time_control    TEXT NOT NULL,             -- 'untimed', or 'base+increment' in seconds
  result          TEXT NOT NULL DEFAULT '*' CHECK (result IN ('1-0', '0-1', '1/2-1/2', '*')),
  termination     TEXT,
  pgn             TEXT,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,                      -- NULL while an in-app game is being played
  raw_json        TEXT,                      -- the original Lichess NDJSON object
  imported_at     TEXT,
  UNIQUE (source, source_game_id)
);
CREATE INDEX games_raw_player ON games_raw (player_id, ended_at);

CREATE TABLE moves_raw (
  game_id    TEXT NOT NULL REFERENCES games_raw (id) ON DELETE CASCADE,
  ply        INTEGER NOT NULL CHECK (ply >= 1),
  san        TEXT NOT NULL,
  uci        TEXT NOT NULL,
  fen_after  TEXT NOT NULL,
  clock_ms   INTEGER,
  think_ms   INTEGER,
  PRIMARY KEY (game_id, ply)
);

-- Raw data never changes once a game has ended. A game is written open,
-- its moves added, then closed by setting ended_at (imports do all three in
-- one transaction). Deletion stays possible: account deletion removes rows.
CREATE TRIGGER games_raw_frozen BEFORE UPDATE ON games_raw
WHEN OLD.ended_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'games_raw: a finished game never changes');
END;
CREATE TRIGGER moves_raw_frozen_update BEFORE UPDATE ON moves_raw
WHEN (SELECT ended_at FROM games_raw WHERE id = OLD.game_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'moves_raw: a finished game never changes');
END;
CREATE TRIGGER moves_raw_frozen_insert BEFORE INSERT ON moves_raw
WHEN (SELECT ended_at FROM games_raw WHERE id = NEW.game_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'moves_raw: a finished game never changes');
END;
