#!/usr/bin/env python3
"""report.py - turn tree.json into report.md: every branch that at least
SHARE of the games reaching its parent chose, down to MAX_DEPTH plies."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SHARE = float(os.environ.get("PAP_SHARE", 0.12))
MAX_DEPTH = int(os.environ.get("PAP_DEPTH", 22))
data = json.load(open(os.path.join(HERE, "tree.json")))
ROOTS = {"italian": ["e4","e5","Nf3","Nc6","Bc4"], "vienna": ["e4","e5","Nc3"], "sicilian": ["e4","c5"], "caro": ["e4","c6"], "french": ["e4","e6"], "london": []}
out = [f"# Opening research\n\nSource: Lichess broadcast database, months {data['months'][0]}..{data['months'][-1]}, "
       f"both players rated {data['minElo']}+, standard chess, deduplicated. {data['stats']['kept']} games kept of {data['stats']['games']}.\n"
       f"Branches shown when at least {int(SHARE*100)}% of the games reaching the parent chose them (min 10 games), to {MAX_DEPTH} plies.\n"]
def walk(node, path, depth, total, lines):
    kids = sorted(node.items(), key=lambda kv: -kv[1]["n"])
    parent_n = sum(k[1]["n"] for k in kids)
    for san, child in kids:
        if child["n"] < 10 or (parent_n and child["n"] / parent_n < SHARE):
            continue
        ply = len(path)
        label = f"{ply//2+1}.{san}" if ply % 2 == 0 else f"{ply//2+1}...{san}"
        lines.append(f"{'  '*depth}- {label} **{child['n']}** ({round(100*child['n']/max(1,parent_n))}%)")
        if ply + 1 < MAX_DEPTH:
            walk(child["c"], path + [san], depth + 1, total, lines)
for name, tree in data["trees"].items():
    root = ROOTS[name]
    node = tree
    for san in root:
        node = node[san]["c"]
    lines = []
    walk(node, list(root), 0, data["roots"][name], lines)
    out.append(f"\n## {name} ({data['roots'][name]} games)\nRoot: {' '.join(root) or '1.d4 with Bf4 on move 2-3, no c4'}\n")
    out += lines
open(os.path.join(HERE, "report.md"), "w").write("\n".join(out) + "\n")
print(len(out))
