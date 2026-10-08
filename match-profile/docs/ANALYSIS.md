# Analysis

Every formula, threshold and metric id a profile's `basis` field points to.
(Milestone 3: only how time is measured. The engine analysis, classification,
phases and events arrive with milestone 4.)

## Time

- **Clocks are measured on the server.** A move's `think_ms` is the time
  from when its side got the move (the server recorded the previous move) to
  when the server recorded this one. For the player that includes the network
  round trip: sending Stockfish's move to the browser and the player's move
  back. Over Tailscale Funnel that is typically tens of milliseconds, so
  think times are slightly long and the shortest ones (premoves, instant
  recaptures) are never near zero. Time-pressure metrics should not read
  meaning into differences under about a quarter of a second.
- `moves_raw.clock_ms` is the mover's time left after the move, including the
  increment. Untimed games have no clock (NULL) but still record `think_ms`.
- A move that arrives after the mover's time ran out is not recorded: the
  game ends on time at the position before it.
