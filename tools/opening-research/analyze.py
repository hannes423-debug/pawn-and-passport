#!/usr/bin/env python3
"""
tools/opening-research/analyze.py - what strong players actually play in the
six club openings, measured from real tournament games.

Source: the Lichess broadcast database (https://database.lichess.org/#broadcasts),
monthly PGN files of every tournament Lichess relays (classical, rapid and blitz
events with FIDE-rated players). Download the months you want into
~/.cache/pap-broadcast/ (see README.md in this folder), then:

    python3 tools/opening-research/analyze.py            # -> tools/opening-research/tree.json + report.md

Filters: both players rated >= MIN_ELO, standard chess only (no Variant/SetUp
tag), deduplicated (the same game is often relayed by several broadcasts).
The tree is by MOVE ORDER (SAN from the start), which is exactly how
js/data/openings.js stores its lines.
"""

import glob
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict

MIN_ELO = int(os.environ.get("PAP_MIN_ELO", 2200))
MAX_PLIES = 28
CACHE = os.path.expanduser("~/.cache/pap-broadcast")
HERE = os.path.dirname(os.path.abspath(__file__))

# Root move sequences. London is special-cased (Bf4 on move 2 or 3 without c4).
ROOTS = {
    "italian": ["e4", "e5", "Nf3", "Nc6", "Bc4"],
    "vienna": ["e4", "e5", "Nc3"],
    "sicilian": ["e4", "c5"],
    "caro": ["e4", "c6"],
    "french": ["e4", "e6"],
}

TOKEN_JUNK = re.compile(r"\{[^}]*\}|\([^()]*\)|\$\d+|\d+\.(\.\.)?|1-0|0-1|1/2-1/2|\*")


def is_london(moves):
    if len(moves) < 3 or moves[0] != "d4":
        return False
    white = moves[0::2]
    if "c4" in white[:3]:
        return False
    return "Bf4" in white[1:3]


def games(path):
    proc = subprocess.Popen(["zstd", "-dc", path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, errors="replace")
    headers, moves = {}, []
    in_moves = False
    for line in proc.stdout:
        line = line.rstrip("\n")
        if line.startswith("["):
            if in_moves:
                yield headers, " ".join(moves)
                headers, moves, in_moves = {}, [], False
            m = re.match(r'\[(\w+) "(.*)"\]', line)
            if m:
                headers[m.group(1)] = m.group(2)
        elif line.strip():
            in_moves = True
            moves.append(line)
    if in_moves:
        yield headers, " ".join(moves)


def sans(movetext):
    text = movetext
    for _ in range(3):  # nested variations
        text = re.sub(r"\([^()]*\)", " ", text)
    text = TOKEN_JUNK.sub(" ", text)
    return [t for t in text.split() if t and not t[0].isdigit()][:MAX_PLIES]


def elo(h, key):
    try:
        return int(h.get(key, "0"))
    except ValueError:
        return 0


def main():
    files = sorted(glob.glob(os.path.join(CACHE, "lichess_db_broadcast_*.pgn.zst")))
    if not files:
        sys.exit(f"no PGN files in {CACHE}")
    trees = {k: {} for k in [*ROOTS, "london"]}
    roots_count = Counter()
    seen = set()
    stats = Counter()
    by_month = Counter()

    def add(tree, seq):
        node = tree
        for san in seq:
            child = node.setdefault(san, {"n": 0, "c": {}})
            child["n"] += 1
            node = child["c"]

    for path in files:
        month = re.search(r"(\d{4}-\d{2})", path).group(1)
        for h, text in games(path):
            stats["games"] += 1
            if h.get("Variant", "Standard") not in ("Standard", "") or h.get("SetUp") == "1" or "FEN" in h:
                stats["variant"] += 1
                continue
            if elo(h, "WhiteElo") < MIN_ELO or elo(h, "BlackElo") < MIN_ELO:
                continue
            seq = sans(text)
            if len(seq) < 10:
                continue
            key = (h.get("White"), h.get("Black"), h.get("Date"), " ".join(seq[:24]))
            if key in seen:
                stats["duplicate"] += 1
                continue
            seen.add(key)
            stats["kept"] += 1
            by_month[month] += 1
            for name, root in ROOTS.items():
                if seq[:len(root)] == root:
                    roots_count[name] += 1
                    add(trees[name], seq)
            if is_london(seq):
                roots_count["london"] += 1
                add(trees["london"], seq)
        print(f"{month}: {by_month[month]} kept", file=sys.stderr)

    def prune(node, floor):
        return {san: {"n": child["n"], "c": prune(child["c"], floor)} for san, child in node.items() if child["n"] >= floor}

    out = {"minElo": MIN_ELO, "months": sorted(by_month), "stats": stats, "roots": roots_count, "trees": {}}
    for name, tree in trees.items():
        out["trees"][name] = prune(tree, max(8, roots_count[name] // 400))
    with open(os.path.join(HERE, "tree.json"), "w") as fh:
        json.dump(out, fh)
    print(json.dumps({"stats": stats, "roots": roots_count, "months": len(by_month)}, indent=1))


if __name__ == "__main__":
    main()
