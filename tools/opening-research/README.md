# Opening research

Measures what strong players actually play in the six club openings, so
`js/data/openings.js` teaches real, current theory.

Source: the Lichess broadcast database, https://database.lichess.org/#broadcasts
(monthly PGN files of tournaments relayed on Lichess, with FIDE ratings).
Research run of 2026-09-16: months 2024-09 to 2026-08, 701,532 games read,
135,928 kept (both players 2200+, standard chess, deduplicated).

```bash
mkdir -p ~/.cache/pap-broadcast && cd ~/.cache/pap-broadcast
curl -O https://database.lichess.org/broadcast/lichess_db_broadcast_2026-08.pgn.zst   # one per month
cd -
python3 tools/opening-research/analyze.py          # tree.json (PAP_MIN_ELO=2200 by default)
python3 tools/opening-research/report.py           # report.md: branches chosen by >= PAP_SHARE of games
python3 tools/opening-research/kids.py sicilian e4 c5 Nf3   # every continuation at a position
python3 tools/opening-research/greedy.py caro e4 c6 d4 d5 e5 # follow the most-played path
node tools/opening-research/check-lines.mjs        # flags line moves strong players rarely choose
node tools/opening-research/stats.mjs              # js/data/openingStats.js
```

The tree is by move order (SAN from move 1), the same way `openings.js`
stores lines. Deep nodes are pruned below max(8, games/400), so "100%" deep in
a line means "the only branch above the floor", not literally every game.
`check-lines.mjs` keeps a SIDELINES allowlist for deliberate side branches that
are rare in share but common in absolute games (the Alapin, 2.Nc3 Sicilians,
the Fantasy, the Exchange and Rubinstein French, the Dragon).
