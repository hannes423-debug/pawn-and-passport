#!/usr/bin/env bash
# tools/predeploy.sh - run before pushing main (GitHub Pages deploys from it)
# or packaging for itch. Fast, engine-free, exits non-zero on any failure.
#
#   ./tools/predeploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/validate-content.mjs
node tests/run.js
for f in $(git ls-files 'js/*.js'); do node --check "$f"; done
# The collision and depth data is GENERATED from the artist's walk masks and
# occlusion layers: the committed file has to still be what they make.
python3 tools/build_occlusion.py --check >/dev/null
# The Vienna floor-mask experiment (docs/FLOORMASK.md): same rule for its data.
python3 tools/floor_depth.py --check >/dev/null
# Nothing walled off, and nothing standing where it cannot be reached.
node tools/dev/clearance.mjs >/dev/null
# Every key and button picture the prompts and the Controls page name is
# really there: their paths are built from names, so no reference sweep sees them.
for n in $(grep -ohE "'(key|xbox|nin|ps|cursor)-[a-z0-9-]+'" js/ui/prompts.js js/ui/controlsHelp.js | tr -d "'" | sort -u); do
  [ -s "assets/ui/prompts/$n.png" ] || { echo "MISSING prompt picture: assets/ui/prompts/$n.png"; exit 1; }
done
for n in $(grep -ohE "'(device|panel)-[a-z0-9-]+'" js/ui/controlsHelp.js | tr -d "'" | sort -u); do
  [ -s "assets/ui/controls/$n.webp" ] || { echo "MISSING controls picture: assets/ui/controls/$n.webp"; exit 1; }
done
echo "PREDEPLOY OK"
