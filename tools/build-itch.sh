#!/usr/bin/env bash
# tools/build-itch.sh - package Pawn & Passport as an itch.io HTML5 zip.
#
#   ./tools/build-itch.sh            -> dist/pawn-and-passport-<version>.zip
#
# Ships only what the game loads: index.html, css/, js/, assets/, vendor/.
# The artist's source PNGs, tools/ and tests/ stay out. Every path in the game
# is relative, and Stockfish is the single-threaded lite build, which needs no
# COOP/COEP headers.
#
# INDEX.HTML IS AT THE ROOT OF THE ZIP. itch.io serves whatever is at the top
# of the archive, so a zip whose only entry is a pawn-and-passport-0.x.y/
# folder gives the player a directory listing instead of the game. The build
# used to make exactly that. Everything below the "verify" line exists to make
# sure it never happens again.
set -euo pipefail
cd "$(dirname "$0")/.."

# Content and rules first: never package broken puzzles, lessons or drills.
./tools/predeploy.sh >/dev/null

version=$(node -e "import('./js/data/config.js').then(m => console.log(m.GAME.version))")
name="pawn-and-passport-${version}"
out="dist/${name}"
zipfile="dist/${name}.zip"
rm -rf "$out" "$zipfile"
mkdir -p "$out"

cp index.html "$out/"
cp -r css js vendor "$out/"
mkdir -p "$out/assets"
cp -r assets/ui assets/scenes assets/cities assets/postcards assets/pieces assets/board \
      assets/fonts assets/characters assets/layers assets/audio "$out/assets/"
# assets/manifest.json is a FILE at the top of assets/, not a folder, so the
# line above never took it. The game fetches it for every scene's size; without
# it a room lays out from whatever the bitmap happens to report once it loads.
cp assets/manifest.json "$out/assets/"
cp docs/LICENSES.md "$out/LICENSES.md"
cp vendor/stockfish/COPYING-GPLv3.txt "$out/COPYING-GPLv3.txt"

# The Node-only package.json in vendor/stockfish is harmless in a browser; drop dev pages.
rm -rf "$out/js/dev" 2>/dev/null || true

# ------------------------------------------------------------------ verify --
# Every module parses.
for f in $(find "$out/js" -name '*.js'); do node --check "$f" >/dev/null; done

# Nothing references a file that is not shipped - art, fonts AND the music.
missing=0
while IFS= read -r ref; do
  [ -e "$out/$ref" ] || { echo "MISSING in build: $ref"; missing=1; }
done < <(grep -rhoE "assets/[A-Za-z0-9_./-]+\.(webp|png|woff2|mp3|json)" "$out/js" "$out/css" "$out/index.html" \
         | sed 's#^\.\./##' | sort -u | grep -v '\${')
[ "$missing" = 0 ] || exit 1

# Every track js/ui/music.js names is really there, and is really an MP3.
tracks=$(grep -oE "assets/audio/[A-Za-z0-9_-]+\.mp3" "$out/js/ui/music.js" | sort -u)
[ -n "$tracks" ] || { echo "no soundtrack referenced by js/ui/music.js"; exit 1; }
for t in $tracks; do
  [ -s "$out/$t" ] || { echo "MISSING or empty soundtrack: $t"; exit 1; }
  head -c 3 "$out/$t" | grep -qE 'ID3|\xff\xfb' || \
    file -b "$out/$t" | grep -qi 'audio' || { echo "not an MP3: $t"; exit 1; }
done
echo "soundtrack: $(echo "$tracks" | wc -l) tracks"

# No development-only page rides along.
find "$out" -name '*debug*' -o -name '*-dev.*' | grep -q . && { echo "dev files in build"; exit 1; } || true

# ------------------------------------------------------------------- pack --
# Zipped from INSIDE $out, so index.html is the archive root, not a folder.
(cd "$out" && zip -qr "../${name}.zip" .)

# ...and prove it, rather than trusting the line above.
listing=$(unzip -Z1 "$zipfile")
grep -qx 'index.html' <<<"$listing" || { echo "FAIL: index.html is not at the zip root"; exit 1; }
if grep -qE "^${name}/" <<<"$listing"; then
  echo "FAIL: the zip wraps everything in a ${name}/ folder"; exit 1
fi
roots=$(sed 's#/.*##' <<<"$listing" | sort -u)
for r in $roots; do
  case "$r" in
    index.html|css|js|assets|vendor|LICENSES.md|COPYING-GPLv3.txt) ;;
    *) echo "FAIL: unexpected entry at the zip root: $r"; exit 1 ;;
  esac
done

count=$(wc -l <<<"$listing")
echo "built $zipfile ($(du -h "$zipfile" | cut -f1), $count files)"
echo "zip root: $(tr '\n' ' ' <<<"$roots")"
