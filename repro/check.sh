#!/bin/sh
# The checks of AGENTS.md "Checks", in three tiers, with one summary line per check and its time:
#   repro/check.sh quick [--worlds green,lava] [--out DIR]                                   Node only: no server, no browser
#   repro/check.sh land  --server http://127.0.0.1:<yours> --port <cdp> [--worlds ...] [--out DIR]
#   repro/check.sh full  --server http://127.0.0.1:<yours> --port <cdp> [--worlds ...] [--out DIR]
# quick: the unit tests, the world-name gate (its list no longer than the base's), the regional replay of every scene, and every scene rendered
#   and compared with the base's renders. The base is the commit this branch grew from (git merge-base HEAD main); its renders are made once,
#   from a copy of its tree (git archive), and kept in $R/baseline/<commit>. --worlds names the worlds the change may move: a scene of any
#   other world that moves fails the run (compare.py --worlds; --worlds none: no scene may move). Without it the moved scenes are listed, for
#   the retail sheet (<out>/scenes/sheet.png).
# land: quick, then the checks in Chrome (smoke with --page8, features, the passability view) and the shape repeat check.
# full: land, then the slow sweeps: the curve editor, export bytes, the three control sweeps and the realism report on modern Green.
# The interaction check (perf.mjs) compares two builds and is run by hand. Every check runs even when an earlier one fails; exit 1 if any failed.
# Output goes to --out (default $R/check/<worktree>), never into the checkout. Logs: <out>/<check>.log.
here=$(cd "$(dirname "$0")" && pwd); repo=$(cd "$here/.." && pwd)
R=${R:-/private/tmp/nanolathe-map-editor}
py=${PYTHON:-/Users/daniel/src/terraform/.venv/bin/python}
tier=$1; [ $# -gt 0 ] && shift
case $tier in quick|land|full) ;; *) sed -n '2,5p' "$0" >&2; exit 2 ;; esac
server=; port=; worlds=; out=
while [ $# -gt 0 ]; do
  case $1 in
    --server) server=$2; shift 2 ;;
    --port) port=$2; shift 2 ;;
    --worlds) worlds=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    *) echo "check.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
if [ "$tier" != quick ] && { [ -z "$server" ] || [ -z "$port" ]; }; then echo "check.sh: $tier runs Chrome: give --server (your own sculpt.py server) and --port (your CDP port)" >&2; exit 2; fi
out=${out:-$R/check/$(basename "$repo")}
mkdir -p "$out"
failed=0
step() {   # step <name> <command...>: run it, log it, time it
  name=$1; shift; t0=$(date +%s)
  if "$@" > "$out/$name.log" 2>&1; then result=ok; else result=FAILED; failed=$((failed + 1)); fi
  printf '%-12s %-6s %4ss  %s\n' "$name" "$result" $(( $(date +%s) - t0 )) "$out/$name.log"
}

# The base's renders and gate list, made once per commit.
base=$(git -C "$repo" merge-base HEAD main); short=$(git -C "$repo" rev-parse --short "$base")
baseline=$R/baseline/$base
if [ ! -f "$baseline/done" ]; then
  echo "baseline: rendering the scenes of $short (once; kept in $baseline)"
  mkdir -p "$R/baseline"
  build=$(mktemp -d "$R/baseline/.build.XXXXXX")
  mkdir "$build/src"
  git -C "$repo" archive "$base" | tar -x -C "$build/src" -f -
  if sh "$build/src/repro/all.sh" "$build/out" > "$build/all.log" 2>&1; then
    (cd "$build/src" && sh repro/gate.sh > "$build/gate.txt" 2>&1)
    touch "$build/done"
    mv "$build" "$baseline" 2>/dev/null || [ -f "$baseline/done" ] || { echo "check.sh: cannot keep the baseline in $baseline" >&2; exit 1; }
  else echo "check.sh: the base's scenes did not render: $build/all.log" >&2; exit 1
  fi
fi

gate() {
  sh "$repo/repro/gate.sh" > "$out/gate.txt"; ok=$?
  cat "$out/gate.txt"
  now=$(sed -n '/^---/,$p' "$out/gate.txt" | wc -l); was=$(sed -n '/^---/,$p' "$baseline/gate.txt" | wc -l)
  echo "world-named identifiers: $((now - 1)) (base $((was - 1)))"
  [ $ok -eq 0 ] && [ "$now" -le "$was" ]
}
scenes() {
  sh "$repo/repro/all.sh" "$out/scenes" || return 1
  "$py" "$repo/repro/compare.py" "$baseline/out" "$out/scenes" ${worlds:+--worlds "$worlds"}
}
regional() { ls "$repo"/repro/scenes/*.json | xargs -P 4 -n 8 node "$repo/repro/regional.mjs"; }   # four processes, eight scenes each

step unit node --test "$repo"/repro/*.test.mjs
step gate gate
step scenes scenes
step regional regional
if [ "$tier" != quick ]; then
  step smoke node "$repo/repro/smoke.mjs" --server "$server" --port "$port" --out "$out/smoke" --page8
  step features node "$repo/repro/features.mjs" --server "$server" --port "$port" --out "$out/features"
  step passability node "$repo/repro/passability.mjs" --server "$server" --port "$port" --out "$out/passability"
  step shapecheck node "$repo/repro/shapecheck.mjs" "$repo"/repro/scenes/*.json --out "$out/shapecheck"
fi
if [ "$tier" = full ]; then
  step curveedit node "$repo/repro/curveedit.mjs" --server "$server" --port "$port" --out "$out/curveedit"
  step exportbytes node "$repo/repro/export-bytes.mjs" --out "$out/export-bytes"
  step worldctl node "$repo/measure/world_controls.mjs" --out "$out/world-controls"
  step shapectl node "$repo/measure/shape_controls.mjs" --out "$out/shape-controls"
  step geologyctl node "$repo/measure/geology_controls.mjs" --out "$out/geology-controls"
  step realism "$py" "$repo/measure/realism.py" --scenes "$out/scenes/green-modern-1" "$out/scenes/green-modern-2" "$out/scenes/green-modern-3"
fi
echo "---"
echo "against $short: $(grep 'scenes changed' "$out/scenes.log" 2>/dev/null || echo 'the scenes did not compare'); sheet $out/scenes/sheet.png"
[ $failed -eq 0 ] && echo "check.sh $tier: all passed" || echo "check.sh $tier: $failed failed"
exit $((failed > 0))
