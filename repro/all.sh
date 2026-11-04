#!/bin/sh
# Render every scenes/<world>.json against one server and tile the pairs.
#   repro/all.sh <out-dir> [server] [cdp-port]
# Retail crops are read from $REPRO_CROPS/<world> (retail_crop.py output;
# default /private/tmp/nanolathe-map-editor/repro-r7, the crops every merge
# since round 7 is judged on), or from the window a scene's "crop" names (a
# variant's scenes, such as green-modern-1, are judged on their world's windows). REPRO_QUERY adds page parameters to every
# scene (render.mjs --query), e.g. REPRO_QUERY='sun=90,45'. Writes <out-dir>/<world>/
# pair.png and layout.png, and <out-dir>/sheet.png with every world.
set -e
out=$1; server=${2:-http://127.0.0.1:8801}; port=${3:-9450}
crops=${REPRO_CROPS:-/private/tmp/nanolathe-map-editor/repro-r7}
py=${PYTHON:-/Users/daniel/src/terraform/.venv/bin/python}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
for scene in "$here"/scenes/*.json; do
  world=$(basename "$scene" .json)
  crop=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).crop || process.argv[2])' "$scene" "$world")
  if [ ! -f "$crops/$crop/retail.png" ]; then echo "$world: no crop in $crops/$crop, skipped"; continue; fi
  mkdir -p "$out/$world"
  cp "$crops/$crop/retail.png" "$crops/$crop/heights.npy" "$crops/$crop/crop.json" "$out/$world/"
  printf '%s: ' "$world"
  node "$here/render.mjs" "$scene" "$out/$world" --server "$server" --port "$port" ${REPRO_QUERY:+--query "$REPRO_QUERY"}
  "$py" "$here/pair.py" "$out/$world" >/dev/null
done
"$py" "$here/sheet.py" "$out"
