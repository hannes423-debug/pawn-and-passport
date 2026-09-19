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
echo "PREDEPLOY OK"
