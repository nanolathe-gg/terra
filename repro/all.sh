#!/bin/sh
# Render every scenes/<world>.json against one server and tile the pairs.
#   repro/all.sh <out-dir> [server] [cdp-port]
# Retail crops are read from $REPRO_CROPS/<world> (retail_crop.py output;
# default /private/tmp/nanolathe-map-editor/repro). Writes <out-dir>/<world>/
# pair.png and layout.png, and <out-dir>/sheet.png with every world.
set -e
out=$1; server=${2:-http://127.0.0.1:8801}; port=${3:-9450}
crops=${REPRO_CROPS:-/private/tmp/nanolathe-map-editor/repro}
py=${PYTHON:-/private/tmp/nanolathe-neural-terrain-venv/bin/python}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
for scene in "$here"/scenes/*.json; do
  world=$(basename "$scene" .json)
  if [ ! -f "$crops/$world/retail.png" ]; then echo "$world: no crop in $crops/$world, skipped"; continue; fi
  mkdir -p "$out/$world"
  cp "$crops/$world/retail.png" "$crops/$world/heights.npy" "$crops/$world/crop.json" "$out/$world/"
  printf '%s: ' "$world"
  node "$here/render.mjs" "$scene" "$out/$world" --server "$server" --port "$port"
  "$py" "$here/pair.py" "$out/$world" >/dev/null
done
"$py" "$here/sheet.py" "$out"
