-- 002_live_games: the clocks of in-app games being played.
--
-- Raw tables keep only what a game IS; how much time each side has left
-- while it is being played lives here, and the row is deleted when the game
-- ends (each move's remaining time is already in moves_raw.clock_ms).

CREATE TABLE live_games (
  game_id          TEXT PRIMARY KEY REFERENCES games_raw (id) ON DELETE CASCADE,
  white_ms         INTEGER,          -- time left as of turn_started_at; NULL when untimed
  black_ms         INTEGER,
  increment_ms     INTEGER NOT NULL DEFAULT 0,
  turn_started_at  TEXT NOT NULL,    -- when the side to move got the move (server time)
  last_move_at     TEXT NOT NULL     -- for abandoning untimed games
);

-- One in-app game in progress per player. The service checks this before it
-- inserts; the index makes it a rule of the data, whatever the code does.
CREATE UNIQUE INDEX games_raw_one_open ON games_raw (player_id)
  WHERE ended_at IS NULL AND source = 'chess_match_profile';
