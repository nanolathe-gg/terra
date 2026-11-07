#!/bin/sh
# Render every scenes/<world>.json and tile the pairs.
#   repro/all.sh <out-dir> [server] [cdp-port] [--chrome]
# The scenes render under Node on Dawn (render.mjs's default, repro/headless.mjs): with no server, from this checkout (the world configs are
# dumped once with sculpt.py --dump-configs); with a server, from its files; the CDP port is not used. --chrome renders them in headless
# Chrome instead (the page itself), against the server, which --chrome needs (your own; there is no default), on the CDP port (default 9450).
# Both write the same files for the same pixels. Under Node the scenes render REPRO_JOBS at a time (default 4), each in its own process,
# with the same bytes as one at a time; --chrome renders one at a time, on its one CDP port.
# Retail crops are read from $REPRO_CROPS/<world> (retail_crop.py output;
# default /private/tmp/nanolathe-map-editor/repro-r7, the crops every merge
# since round 7 is judged on), or from the window a scene's "crop" names (a
# variant's scenes, such as green-modern-1, are judged on their world's windows). REPRO_QUERY adds page parameters to every
# scene (render.mjs --query), e.g. REPRO_QUERY='sun=90,45'. Writes <out-dir>/<world>/
# pair.png and layout.png, and <out-dir>/sheet.png with every world.
set -e
crops=${REPRO_CROPS:-/private/tmp/nanolathe-map-editor/repro-r7}
py=${PYTHON:-/Users/daniel/src/terraform/.venv/bin/python}
here=$(cd "$(dirname "$0")" && pwd)
# One scene (the loop below runs these): all.sh --one <scene> <out-dir> <configs> <chrome> <server> <port>
if [ "$1" = --one ]; then
  scene=$2 out=$3 configs=$4 chrome=$5 server=$6 port=$7
  world=$(basename "$scene" .json)
  crop=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).crop || process.argv[2])' "$scene" "$world")
  if [ ! -f "$crops/$crop/retail.png" ]; then echo "$world: no crop in $crops/$crop, skipped"; exit 0; fi
  mkdir -p "$out/$world"
  cp "$crops/$crop/retail.png" "$crops/$crop/heights.npy" "$crops/$crop/crop.json" "$out/$world/"
  if [ -n "$chrome" ]; then line=$(node "$here/render.mjs" "$scene" "$out/$world" --chrome --server "$server" --port "${port:-9450}" ${REPRO_QUERY:+--query "$REPRO_QUERY"})
  elif [ -n "$server" ]; then line=$(node "$here/render.mjs" "$scene" "$out/$world" --server "$server" ${REPRO_QUERY:+--query "$REPRO_QUERY"})
  else line=$(node "$here/render.mjs" "$scene" "$out/$world" --configs "$configs" ${REPRO_QUERY:+--query "$REPRO_QUERY"})
  fi
  echo "$world: $line"
  "$py" "$here/pair.py" "$out/$world" >/dev/null
  exit 0
fi
out=; server=; port=; chrome=
for arg; do
  case $arg in
    --chrome) chrome=1 ;;
    *) if [ -z "$out" ]; then out=$arg; elif [ -z "$server" ]; then server=$arg; elif [ -z "$port" ]; then port=$arg; fi ;;
  esac
done
if [ -n "$chrome" ] && [ -z "$server" ]; then echo "all.sh: --chrome needs a server: repro/all.sh <out-dir> http://127.0.0.1:<port> <cdp-port> --chrome, with your own sculpt.py server" >&2; exit 2; fi
mkdir -p "$out"
configs=
if [ -z "$chrome" ] && [ -z "$server" ]; then
  configs=$(mktemp -d "${TMPDIR:-/tmp}/terraform-configs.XXXXXX")
  trap 'rm -f "$configs"/config/*.json "$configs"/*.json; rmdir "$configs/config" "$configs"' EXIT
  "$py" "$here/../sculpt.py" --dump-configs "$configs"
fi
jobs=${REPRO_JOBS:-4}; [ -n "$chrome" ] && jobs=1
status=0
ls "$here"/scenes/*.json | xargs -P "$jobs" -I {} sh "$here/all.sh" --one {} "$out" "$configs" "$chrome" "$server" "$port" || status=1
"$py" "$here/sheet.py" "$out"
exit $status
