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
# The collision data is GENERATED. A hand-edit to js/data/sceneLayers.js would
# survive until the next regeneration and then vanish, so the committed file
# has to still be what tools/build_layers.py makes from its LAYERS table.
python3 tools/build_layers.py --check >/dev/null
# Nothing walled off, and nothing standing where it cannot be reached.
node tools/dev/clearance.mjs >/dev/null
echo "PREDEPLOY OK"
