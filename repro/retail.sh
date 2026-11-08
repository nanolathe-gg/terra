#!/bin/sh
# One world's reproduction windows against retail, as numbers and sheets: the command a retail round runs (docs/RETAIL_ROUND.md).
#   repro/retail.sh <world> [--query 'key=value&key=value'] [--base DIR] [--out DIR]
# <world> is a world (red) or a variant's windows (green-modern): it renders repro/scenes/<world>-<n>.json under Node on Dawn (no server,
# no browser), four at a time, with --query added to every scene's page parameters (render.mjs --query: World rows by their key, such as
# 'reliefAmount=.4&banding=.2'; the keys are sculpt-knobs.js KNOBS and sculpt.py KNOB_DEFAULTS). Then:
#  - repro/stats.py for the world: each retail window's numbers, ours, and the world's retail family p10-p90 (<out>/stats/stats.md);
#  - repro/retail_gap.py: one shape score and one look score per window (mean |ours - retail| in family-band units; lower is closer),
#    the metrics furthest from retail, and with --base the change from an earlier run (<out>/gap.txt);
#  - sheets: <out>/scenes/<scene>/pair.png (retail | ours, full size) and layout.png (the height reliefs), <out>/scenes/sheet.png, and with
#    --base <out>/triptych/<world>.png (retail | base | ours, half size).
# --base is an earlier retail.sh output folder of the same world (its stats/stats.json and scenes/). Default --out:
# $R/retail/<worktree>/<world>, or <world>-<hash of the query> with a query. Retail pixels stay there, never in the checkout.
here=$(cd "$(dirname "$0")" && pwd); repo=$(cd "$here/.." && pwd)
R=${R:-/private/tmp/nanolathe-map-editor}
py=${PYTHON:-/Users/daniel/src/terraform/.venv/bin/python}
world=$1; [ $# -gt 0 ] && shift
[ -n "$world" ] && [ "${world#-}" = "$world" ] || { sed -n '2,3p' "$0" >&2; exit 2; }
query=; base=; out=
while [ $# -gt 0 ]; do
  case $1 in
    --query) query=$2; shift 2 ;;
    --base) base=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    *) echo "retail.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
scenes=$(ls "$here"/scenes/"$world"-[0-9].json 2>/dev/null)
[ -n "$scenes" ] || { echo "retail.sh: no scenes repro/scenes/$world-<n>.json" >&2; exit 2; }
tag=$world; [ -n "$query" ] && tag=$world-$(printf '%s' "$query" | cksum | cut -d' ' -f1)
out=${out:-$R/retail/$(basename "$repo")/$tag}
mkdir -p "$out"
printf '%s\n' "$query" > "$out/query.txt"
echo "retail.sh: $world${query:+ with $query} -> $out"
REPRO_SCENES="$scenes" REPRO_QUERY="$query" sh "$here/all.sh" "$out/scenes" > "$out/render.log" 2>&1 || { echo "retail.sh: the scenes did not render: $out/render.log" >&2; exit 1; }
"$py" "$here/stats.py" "$out/scenes" --out "$out/stats" --worlds "$world" --no-check > "$out/stats.log" 2>&1 || { echo "retail.sh: stats.py failed: $out/stats.log" >&2; exit 1; }
"$py" "$here/retail_gap.py" "$out/stats/stats.json" ${base:+--base "$base/stats/stats.json"} > "$out/gap.txt" || exit 1
if [ -n "$base" ]; then (cd "$here" && "$py" triptych.py "$base/scenes" "$out/scenes" "$out/triptych" --worlds "$world") > /dev/null || exit 1; fi
cat "$out/gap.txt"
echo "numbers $out/stats/stats.md; sheets $out/scenes/<scene>/pair.png${base:+, $out/triptych/$world.png}"
