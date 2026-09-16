#!/usr/bin/env python3
"""greedy.py <opening> <san...>: extend a line by the most-played move until the data runs out."""
import json, os, sys
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tree.json")))
name, path = sys.argv[1], sys.argv[2:]
node = d["trees"][name]
for san in path:
    node = node[san]["c"]
ext = []
while node:
    san, child = max(node.items(), key=lambda kv: kv[1]["n"])
    total = sum(c["n"] for c in node.values())
    ext.append(f"{san}({child['n']},{round(100*child['n']/total)}%)")
    node = child["c"]
print(" ".join(path), "=>", " ".join(ext))
