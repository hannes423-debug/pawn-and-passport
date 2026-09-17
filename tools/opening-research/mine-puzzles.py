#!/usr/bin/env python3
"""
tools/opening-research/mine-puzzles.py - puzzle CANDIDATES from real games in
each club opening.

    python3 tools/opening-research/mine-puzzles.py      # -> puzzle-candidates.json

Reads the Lichess broadcast PGNs in ~/.cache/pap-broadcast (the same months as
analyze.py). Broadcast games carry the relay's engine evaluation after every
move ([%eval]). A candidate is the position right after a MISTAKE: the game was
balanced, one move later the side to move is clearly winning (at least
MIN_GAIN centipawns, or a short forced mate). Those positions are where a real
game offered exactly one strong answer, so they make natural puzzles.

This file only proposes. tools/verify-club-puzzles.mjs asks Stockfish to prove
each candidate (unique best move, clear margin) before anything ships.
"""

import glob
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze import ROOTS, is_london, games, elo  # noqa: E402

CACHE = os.path.expanduser('~/.cache/pap-broadcast')
HERE = os.path.dirname(os.path.abspath(__file__))
MIN_ELO = 1900
MIN_GAIN = 250          # centipawns, the mover's point of view
MAX_BEFORE = 120        # |eval| before the mistake: the game was still balanced
MAX_AFTER = 1200        # beyond this the position is already a rout, not a puzzle
PLY_RANGE = (9, 50)     # after the opening proper, before deep endgames
PER_OPENING = 80

TOKEN = re.compile(r'\{([^}]*)\}|(\d+\.(?:\.\.)?)|([^\s{}]+)')
EVAL = re.compile(r'\[%eval\s+(#?-?[\d.]+)\]')


def parse(movetext):
    """[(san, eval_cp_white_pov or ('mate', n))...] with the eval that followed each move."""
    text = movetext
    for _ in range(3):
        text = re.sub(r'\([^()]*\)', ' ', text)
    out = []
    for comment, number, word in TOKEN.findall(text):
        if comment:
            m = EVAL.search(comment)
            if m and out and out[-1][1] is None:
                v = m.group(1)
                out[-1] = (out[-1][0], ('mate', int(v[1:])) if v.startswith('#') else round(float(v) * 100))
        elif word and not number:
            if word in ('1-0', '0-1', '1/2-1/2', '*') or word.startswith('$'):
                continue
            out.append((word, None))
    return out


def pov(value, white_to_move):
    """Eval from the point of view of the side to move; mates as a big number."""
    if value is None:
        return None
    if isinstance(value, tuple):
        n = value[1]
        cp = 100000 - abs(n) * 100 if n > 0 else -100000 + abs(n) * 100
    else:
        cp = value
    return cp if white_to_move else -cp


def opening_of(sans):
    for name, root in ROOTS.items():
        if sans[:len(root)] == root:
            return name
    if is_london(sans):
        return 'london'
    return None


def main():
    files = sorted(glob.glob(os.path.join(CACHE, 'lichess_db_broadcast_*.pgn.zst')))
    found = {name: [] for name in [*ROOTS, 'london']}
    seen = set()
    for path in files:
        for h, text in games(path):
            if h.get('Variant', 'Standard') not in ('Standard', '') or 'FEN' in h:
                continue
            if elo(h, 'WhiteElo') < MIN_ELO or elo(h, 'BlackElo') < MIN_ELO:
                continue
            moves = parse(text)
            if len(moves) < PLY_RANGE[0] + 2:
                continue
            sans = [m[0] for m in moves]
            name = opening_of(sans)
            if not name:
                continue
            for k in range(max(1, PLY_RANGE[0]), min(len(moves) - 1, PLY_RANGE[1])):
                before = moves[k - 1][1]
                after = moves[k][1]
                if before is None or after is None:
                    continue
                # After move k (0-based) it is the other side's turn.
                white_to_move = (k + 1) % 2 == 0
                e_before = pov(before, white_to_move)   # same side's view, one ply earlier
                e_after = pov(after, white_to_move)
                is_mate = isinstance(after, tuple) and after[1] != 0 and ((after[1] > 0) == white_to_move)
                mate_n = abs(after[1]) if is_mate else None
                if abs(e_before) > MAX_BEFORE and not (e_before < 0):
                    continue
                gain = e_after - e_before
                if is_mate:
                    if mate_n > 4:
                        continue
                elif e_after < MIN_GAIN or e_after > MAX_AFTER or gain < MIN_GAIN:
                    continue
                key = ' '.join(sans[:k + 1])
                if key in seen:
                    continue
                seen.add(key)
                found[name].append({
                    'opening': name, 'moves': sans[:k + 1], 'ply': k + 1,
                    'evalAfter': e_after, 'mateIn': mate_n,
                    'played': sans[k + 1] if k + 1 < len(sans) else None,
                    'game': f"{h.get('White', '?')} - {h.get('Black', '?')}, {h.get('BroadcastName', h.get('Event', ''))} {h.get('Date', '')[:4]}"
                })
        print(os.path.basename(path), {k: len(v) for k, v in found.items()}, file=sys.stderr)

    def rank(c):
        # Short mates first, then clean material wins, earlier in the game first.
        return (0 if c['mateIn'] else 1, c['mateIn'] or 0, abs(c['evalAfter'] - 500), c['ply'])
    out = {name: sorted(cands, key=rank)[:PER_OPENING] for name, cands in found.items()}
    with open(os.path.join(HERE, 'puzzle-candidates.json'), 'w') as fh:
        json.dump(out, fh, indent=1)
    print(json.dumps({k: len(v) for k, v in out.items()}))


if __name__ == '__main__':
    main()
