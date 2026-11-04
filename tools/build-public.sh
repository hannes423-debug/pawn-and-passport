#!/usr/bin/env bash
# tools/build-public.sh - build the PUBLIC, playable web copy of Pawn & Passport.
#
#   ./tools/build-public.sh            -> dist/public/
#
# Everything in dist/public can be downloaded by any player, so it is built
# from an ALLOWLIST - the same one tools/build-itch.sh ships, plus the files a
# browser install needs (icons, favicon, web manifest). docs/ (DESIGN, TODO),
# tools/, tests/, the artist's source PNGs, walkmasks-original/ and Git history
# stay in the source repo.
#
# tools/verify-public.mjs then rejects the build if it holds git metadata, dev
# files, source maps, anything shaped like a credential, a private IP address,
# or a reference to a file that is not shipped.
#
# Content gates: the Node checks from tools/predeploy.sh run here. Its Python
# checks (generated occlusion/floor data still matches the artist's masks)
# need OpenCV and guard the art pipeline, not the deploy - keep running
# ./tools/predeploy.sh locally before pushing main.
set -euo pipefail
cd "$(dirname "$0")/.."

# --- content and rules first: never publish broken puzzles, lessons or drills
node tools/validate-content.mjs >/dev/null
node tests/run.js >/dev/null
for f in $(git ls-files 'js/*.js'); do node --check "$f"; done
node tools/dev/clearance.mjs >/dev/null

out="dist/public"
rm -rf "$out"
mkdir -p "$out"

# --- allowlist: the playable game, nothing else -------------------------------
cp index.html manifest.webmanifest favicon.ico "$out/"
cp -r css js vendor icons "$out/"
mkdir -p "$out/assets"
cp -r assets/ui assets/scenes assets/cities assets/postcards assets/pieces assets/board \
      assets/fonts assets/characters assets/layers assets/layers-floor assets/audio "$out/assets/"
cp assets/manifest.json "$out/assets/"
cp docs/LICENSES.md "$out/LICENSES.md"
cp vendor/stockfish/COPYING-GPLv3.txt "$out/COPYING-GPLv3.txt"
touch "$out/.nojekyll"          # serve files as-is on GitHub Pages

# Development-only pages and npm metadata never ship.
rm -rf "$out/js/dev"
rm -f "$out/vendor/stockfish/package.json" "$out/vendor/stockfish/README-stockfish.js.md"
find "$out" \( -name '*.map' -o -name '.DS_Store' -o -name '*.bak' -o -name '__pycache__' \) -prune -exec rm -rf {} +

# --- verify --------------------------------------------------------------------
node tools/verify-public.mjs "$out"

# Every icon js/ui/icons.js names is really in the build (paths are built from
# names, so the reference sweep cannot see them).
for i in $(grep -oE "^  '?[a-z-]+'?:" "$out/js/ui/icons.js" | tr -d " ':" | sort -u); do
  [ -s "$out/assets/ui/icons/$i.png" ] || { echo "MISSING icon: assets/ui/icons/$i.png"; exit 1; }
done
# Every soundtrack js/ui/music.js names is really there.
for t in $(grep -oE "assets/audio/[A-Za-z0-9_-]+\.mp3" "$out/js/ui/music.js" | sort -u); do
  [ -s "$out/$t" ] || { echo "MISSING soundtrack: $t"; exit 1; }
done
# Every prompt/controls picture the UI builds from a name is there.
for n in $(grep -ohE "'(key|xbox|nin|ps|cursor)-[a-z0-9-]+'" js/ui/prompts.js js/ui/controlsHelp.js | tr -d "'" | sort -u); do
  [ -s "$out/assets/ui/prompts/$n.png" ] || { echo "MISSING prompt picture: $n"; exit 1; }
done
for n in $(grep -ohE "'(device|panel)-[a-z0-9-]+'" js/ui/controlsHelp.js | tr -d "'" | sort -u); do
  [ -s "$out/assets/ui/controls/$n.webp" ] || { echo "MISSING controls picture: $n"; exit 1; }
done

(cd "$out" && find . -type f | sort | sed 's#^\./##' | tr '\n' '\0' | xargs -0 sha256sum) > dist/public-manifest.sha256
echo "built $out ($(du -sh "$out" | cut -f1), $(wc -l < dist/public-manifest.sha256) files)"
