#!/usr/bin/env bash
# tools/build-itch.sh - package Pawn & Passport as an itch.io HTML5 zip.
#
#   ./tools/build-itch.sh            -> dist/pawn-and-passport-<version>.zip
#
# Ships only what the game loads: index.html, css/, js/, assets/, vendor/.
# The artist's source PNGs, tools/ and tests/ stay out. Every path in the game
# is relative, so it runs from itch's sub-folder as-is. Stockfish is the
# single-threaded lite build, which needs no COOP/COEP headers.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -e "import('./js/data/config.js').then(m => console.log(m.GAME.version))")
out="dist/pawn-and-passport-${version}"
rm -rf "$out" "$out.zip"
mkdir -p "$out"

cp index.html "$out/"
cp -r css js vendor "$out/"
mkdir -p "$out/assets"
cp -r assets/ui assets/scenes assets/cities assets/postcards assets/pieces assets/board assets/fonts assets/characters assets/layers "$out/assets/"
cp docs/LICENSES.md "$out/LICENSES.md"
cp vendor/stockfish/COPYING-GPLv3.txt "$out/COPYING-GPLv3.txt"

# The Node-only package.json in vendor/stockfish is harmless in a browser; drop dev pages.
rm -rf "$out/js/dev" 2>/dev/null || true

# Sanity: every module parses, and nothing references a file that is not shipped.
for f in $(find "$out/js" -name '*.js'); do node --check "$f" >/dev/null; done
missing=0
while IFS= read -r ref; do
  [ -e "$out/$ref" ] || { echo "MISSING in build: $ref"; missing=1; }
done < <(grep -rhoE "assets/[A-Za-z0-9_./-]+\.(webp|png|woff2)" "$out/js" "$out/css" "$out/index.html" | sed 's#^\.\./##' | sort -u | grep -v '\${')
[ "$missing" = 0 ] || exit 1

(cd dist && zip -qr "$(basename "$out").zip" "$(basename "$out")")
echo "built $out.zip ($(du -h "$out.zip" | cut -f1))"
