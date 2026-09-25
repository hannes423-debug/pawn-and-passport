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
# Nothing walled off, and nothing standing where it cannot be reached.
node tools/dev/clearance.mjs >/dev/null
echo "PREDEPLOY OK"
