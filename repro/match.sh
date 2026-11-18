#!/bin/sh
# Retail match harness: one trial of a world against its retail windows (docs/retail-match/README.md).
#   repro/match.sh <world> --note "what you changed and why" [--query 'key=v&key=v']    one trial of this checkout's world files
#   repro/match.sh <world> --probe key=v1,v2,v3 [--note TEXT]                           one trial per value of one World control
#   repro/match.sh <world> --holdout --note TEXT                                         the held-out window (only at a checkpoint)
#   repro/match.sh <world> --log                                                         the trial log so far
#   options: --out DIR (default $R/match/<this worktree>/<world>), --keep (keep this trial's pictures past pruning)
# A trial: validate the world files (repro/match_validate.mjs), refresh REFERENCE.md, render the world's windows under Node on Dawn and
# score them (repro/retail.sh: shape and look per window against the first trial), split each window by terrain class with 1x crops
# (repro/match_classes.py), save the candidate as a diff of materials/ and repro/scenes/, and append it to <out>/ledger.jsonl
# (repro/match_log.py). The first run is trial-000, the base: run it before changing anything.
# The highest-numbered window (repro/scenes/<world>-<n>.json) is held out: trials never render it, so a change that only fits the
# windows it was tuned on shows when --holdout renders that one. Retail pixels stay under <out>, outside the checkout.
# To save disk, pictures older than the last three trials are deleted (scores, findings and the diff stay); trial-000, holdout-000
# and --keep trials keep theirs.
here=$(cd "$(dirname "$0")" && pwd); repo=$(cd "$here/.." && pwd)
R=${R:-/tmp/nanolathe-map-editor}
py=${PYTHON:-/Users/daniel/src/terraform/.venv/bin/python}
world=$1; [ $# -gt 0 ] && shift
[ -n "$world" ] && [ "${world#-}" = "$world" ] || { sed -n '2,8p' "$0" >&2; exit 2; }
note=; query=; probe=; holdout=0; showlog=0; keep=0; out=
while [ $# -gt 0 ]; do
  case $1 in
    --note) note=$2; shift 2 ;;
    --query) query=$2; shift 2 ;;
    --probe) probe=$2; shift 2 ;;
    --holdout) holdout=1; shift ;;
    --log) showlog=1; shift ;;
    --keep) keep=1; shift ;;
    --out) out=$2; shift 2 ;;
    *) echo "match.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
out=${out:-$R/match/$(basename "$repo")/$world}
case $(cd "$(dirname "$out")" 2>/dev/null && pwd)/ in "$repo"/*) echo "match.sh: --out must be outside the checkout (retail pixels)" >&2; exit 2 ;; esac
mkdir -p "$out"
ledger=$out/ledger.jsonl
if [ $showlog = 1 ]; then "$py" "$here/match_log.py" show --ledger "$ledger"; exit; fi

all=$(ls "$here"/scenes/"$world"-[0-9].json 2>/dev/null)
[ -n "$all" ] || { echo "match.sh: no windows repro/scenes/$world-<n>.json" >&2; exit 2; }
held=$(printf '%s\n' "$all" | tail -1)
if [ $holdout = 1 ]; then scenes=$held; prefix=holdout; else scenes=$(printf '%s\n' "$all" | grep -vxF "$held"); prefix=trial; fi
[ -n "$scenes" ] || scenes=$all   # a world with one window has nothing to hold out

node "$here/match_validate.mjs" "$world" || { echo "match.sh: fix the errors above; nothing rendered" >&2; exit 1; }
node "$here/match_reference.mjs" "$world" --out "$out/REFERENCE.md" || exit 1

# trial (and probe) ids share one counter; the held-out window has its own.
n=$(ls -d "$out/$prefix"-[0-9][0-9][0-9] 2>/dev/null | wc -l | tr -d ' ')
base=$out/$prefix-000
[ "$n" = 0 ] && [ -z "$note" ] && note='base: the world files as they were before any change'
[ -n "$note" ] || { echo "match.sh: say what this trial changes and why: --note \"...\"" >&2; exit 2; }
[ "$n" != 0 ] || [ -z "$query$probe" ] || { echo "match.sh: run the base first (no --query or --probe), so later trials have something to compare with" >&2; exit 2; }

trial() {   # trial <dir> <query> <kind> <note>
  t=$1
  mkdir -p "$t"
  git -C "$repo" diff HEAD -- materials repro/scenes > "$t/candidate.diff"
  git -C "$repo" ls-files --others --exclude-standard -- materials repro/scenes > "$t/untracked.txt"
  [ $keep = 1 ] && : > "$t/keep"
  baseopt=; [ -d "$base/stats" ] && [ "$t" != "$base" ] && baseopt="--base $base"
  RETAIL_SCENES="$scenes" sh "$here/retail.sh" "$world" --out "$t" ${2:+--query "$2"} $baseopt > "$t/retail.log" 2>&1 || { cat "$t/retail.log" >&2; echo "match.sh: the render or scoring failed: $t/retail.log" >&2; return 1; }
  "$py" "$here/match_classes.py" "$t/scenes" --out "$t/classes" --worlds "$world" > "$t/classes.log" 2>&1 || { cat "$t/classes.log" >&2; return 1; }
  "$py" "$here/match_log.py" record "$t" --ledger "$ledger" --kind "$3" --note "$4" --query "$2" --commit "$(git -C "$repo" rev-parse --short HEAD)" --diff "$t/candidate.diff"
}

next() { dir=$(printf '%s/%s-%03d' "$out" "$prefix" "$n"); n=$((n + 1)); }   # sets $dir (not in a subshell, so the count moves)
if [ -n "$probe" ]; then
  key=${probe%%=*}; values=${probe#*=}
  [ "$key" != "$probe" ] && [ -n "$values" ] || { echo "match.sh: --probe key=v1,v2,v3" >&2; exit 2; }
  for v in $(printf '%s' "$values" | tr ',' ' '); do
    q="$key=$v${query:+&$query}"
    next; trial "$dir" "$q" probe "probe $key=$v${note:+: $note}" || exit 1
  done
else
  kind=trial; [ $holdout = 1 ] && kind=holdout
  next; trial "$dir" "$query" $kind "$note" || exit 1
fi

# Prune pictures of all but the last three trials of this kind (keeping the base and --keep trials).
ls -d "$out/$prefix"-[0-9][0-9][0-9] 2>/dev/null | sort | sed '$d' | sed '$d' | sed '$d' | while read -r old; do
  [ "$old" = "$base" ] || [ -e "$old/keep" ] || [ ! -d "$old/scenes" ] && continue
  find "$old/scenes" "$old/classes/crops" "$old/triptych" -name '*.png' -type f -delete 2>/dev/null
  find "$old/scenes" -name 'ours-heights.json' -type f -delete 2>/dev/null
done
exit 0
