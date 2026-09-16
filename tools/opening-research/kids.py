#!/usr/bin/env python3
"""kids.py <opening> <san...> : every continuation from that move sequence, with counts and shares."""
import json, os, sys
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tree.json")))
name, path = sys.argv[1], sys.argv[2:]
node = d["trees"][name]
for san in path:
    node = node[san]["c"]
total = sum(c["n"] for c in node.values())
print(" ".join(path), f"({total})", "  ".join(f"{s} {c['n']} {round(100*c['n']/max(1,total))}%" for s, c in sorted(node.items(), key=lambda kv: -kv[1]["n"])))
