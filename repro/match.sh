#!/bin/sh
# Retail match harness: one trial of a world against its retail windows (docs/retail-match/README.md).
#   repro/match.sh <world> --note "what you changed and why" [--query 'key=v&key=v']    one trial of this checkout's world files
#   repro/match.sh <world> --probe key=v1,v2,v3 [--note TEXT]                           one trial per value of one World control
#   repro/match.sh <world> --window green-5[,green-6] --note TEXT                        render only these tuning windows (a map's own change)
#   repro/match.sh <world> --holdout --note TEXT                                         the held-out window (only at a checkpoint)
#   repro/match.sh <world> --log                                                         the trial log so far
#   repro/match.sh <world> --keep-trial trial-NNN                                       keep a trial's pictures (one you cite or keep)
#   repro/match.sh <world> --aim green-2:slope:lines[,...] --note TEXT                  name the gaps a trial aims at (window:class:metric), for stalls
#   options: --out DIR (default $R/match/<this worktree>/<world>), --keep (keep this trial's pictures past pruning)
# A trial: validate the world files (repro/match_validate.mjs), refresh REFERENCE.md, render the world's windows under Node on Dawn and
# score them (repro/retail.sh: shape and look per window against the first trial), split each window by terrain class with 1x crops
# (repro/match_classes.py), save the candidate as a diff of materials/ and repro/scenes/, and append it to <out>/ledger.jsonl
# (repro/match_log.py). The first run renders the bases, trial-000 and holdout-000, from the committed world files: run it before changing
# anything.
# The highest-numbered window (repro/scenes/<world>-<n>.json) is held out: trials never render it, so a change that only fits the
# windows it was tuned on shows when --holdout renders that one. Retail pixels stay under <out>, outside the checkout.
# To save disk, scene pictures and triptychs older than the last KEEP_LAST trials are deleted; scores, findings, the diff and the
# class crops (classes/crops: about 4 MB for a trial of all windows, against 54 MB of scene pictures) always stay. trial-000,
# holdout-000 and trials marked to keep (--keep, --keep-trial) keep everything. Mark a trial while its scene pictures are still there.
here=$(cd "$(dirname "$0")" && pwd); repo=$(cd "$here/.." && pwd)
KEEP_LAST=8
R=${R:-/tmp/nanolathe-map-editor}
py=${PYTHON:-/Users/daniel/src/terraform/.venv/bin/python}
world=$1; [ $# -gt 0 ] && shift
[ -n "$world" ] && [ "${world#-}" = "$world" ] || { sed -n '2,9p' "$0" >&2; exit 2; }
note=; aim=; query=; probe=; holdout=0; showlog=0; keep=0; keeptrial=; out=; only=
while [ $# -gt 0 ]; do
  case $1 in
    --note) note=$2; shift 2 ;;
    --query) query=$2; shift 2 ;;
    --aim) aim=$2; shift 2 ;;
    --probe) probe=$2; shift 2 ;;
    --holdout) holdout=1; shift ;;
    --window) only=$2; shift 2 ;;
    --log) showlog=1; shift ;;
    --keep) keep=1; shift ;;
    --keep-trial) keeptrial=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    *) echo "match.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
out=${out:-$R/match/$(basename "$repo")/$world}
for k in $(printf '%s' "$aim" | tr ',' ' '); do   # window:class:metric, as the printout's findings name them
  printf '%s' "$k" | grep -qE "^$world-[0-9]+:(deep|shelf|shore|flat|gentle|slope|steep):[a-z0-9_]+$" || { echo "match.sh: --aim $k is not <window>:<class>:<metric> (green-2:slope:lines)" >&2; exit 2; }
done
case $(cd "$(dirname "$out")" 2>/dev/null && pwd)/ in "$repo"/*) echo "match.sh: --out must be outside the checkout (retail pixels)" >&2; exit 2 ;; esac
mkdir -p "$out"
ledger=$out/ledger.jsonl
if [ $showlog = 1 ]; then "$py" "$here/match_log.py" show --ledger "$ledger"; exit; fi

all=$(ls "$here"/scenes/"$world"-[0-9].json 2>/dev/null)
[ -n "$all" ] || { echo "match.sh: no windows repro/scenes/$world-<n>.json" >&2; exit 2; }
held=$(printf '%s\n' "$all" | tail -1)
tuning=$(printf '%s\n' "$all" | grep -vxF "$held"); [ -n "$tuning" ] || tuning=$all   # a world with one window has nothing to hold out
if [ -n "$only" ]; then   # --window: some of the tuning windows, for a change only those windows' scenes carry
  [ $holdout = 0 ] || { echo "match.sh: --window and --holdout do not mix" >&2; exit 2; }
  picked=
  for w in $(printf '%s' "$only" | tr ',' ' '); do
    f=$here/scenes/$w.json
    printf '%s\n' "$tuning" | grep -qxF "$f" || { echo "match.sh: --window $w is not one of the tuning windows: $(printf '%s\n' "$tuning" | sed 's|.*/||; s|\.json$||' | tr '\n' ' ')" >&2; exit 2; }
    picked="$picked${picked:+
}$f"
  done
  tuning=$picked
fi

if [ -n "$keeptrial" ]; then
  [ -d "$out/$keeptrial" ] || { echo "match.sh: no trial $out/$keeptrial" >&2; exit 2; }
  : > "$out/$keeptrial/keep"
  if [ -z "$(find "$out/$keeptrial" -name 'ours.png' -print -quit 2>/dev/null)" ]; then
    echo "match.sh: $keeptrial is marked, but its scene pictures were already deleted (only the last $KEEP_LAST trials keep theirs). Its class crops are still in classes/crops; to see the whole scene again, re-apply its candidate.diff and run a new trial." >&2; exit 1
  fi
  echo "match.sh: $keeptrial keeps its pictures"; exit 0
fi

# Validate the files and every query this run renders (a typo would render the base and look like a control that does nothing).
queries=$query
if [ -n "$probe" ]; then
  key=${probe%%=*}; values=${probe#*=}
  [ "$key" != "$probe" ] && [ -n "$values" ] || { echo "match.sh: --probe key=v1,v2,v3" >&2; exit 2; }
  queries=$(for v in $(printf '%s' "$values" | tr ',' ' '); do printf '%s\n' "$key=$v${query:+&$query}"; done)
fi
# The world's configs as the Go code builds them from this checkout (for the map's rock and material slots), made fresh each run.
mkdir -p "$out/configs"
node -e 'import(process.argv[1]).then(h => h.dumpConfigs(process.argv[2]))' "$here/headless.mjs" "$out/configs" || { echo "match.sh: could not build the world configs (go run ./cmd/terraform --dump-configs)" >&2; exit 1; }
basecommit=$(cat "$out/base-commit" 2>/dev/null || git -C "$repo" rev-parse HEAD)
: > "$out/validate.log"
printf '%s\n' "$queries" | while read -r q; do node "$here/match_validate.mjs" "$world" --configs "$out/configs" --base-commit "$basecommit" ${q:+--query "$q"} >> "$out/validate.log" 2>&1 || { cat "$out/validate.log" >&2; exit 1; }; done || { echo "match.sh: fix the errors above; nothing rendered" >&2; exit 1; }
grep -h '^warning\|^note' "$out/validate.log" 2>/dev/null | sort -u
node "$here/match_reference.mjs" "$world" --configs "$out/configs" --out "$out/REFERENCE.md" || exit 1

trial() {   # trial <dir> <scenes> <base dir> <query> <kind> <note>
  t=$1
  mkdir -p "$t"
  # The candidate: the world files against the commit the base rendered, so it stays whole after a kept change is committed.
  git -C "$repo" diff "$(cat "$out/base-commit")" -- materials repro/scenes > "$t/candidate.diff"
  git -C "$repo" ls-files --others --exclude-standard -- materials repro/scenes > "$t/untracked.txt"
  [ $keep = 1 ] && : > "$t/keep"
  baseopt=; [ -d "$3/stats" ] && [ "$t" != "$3" ] && baseopt="--base $3"
  RETAIL_SCENES="$2" sh "$here/retail.sh" "$world" --out "$t" ${4:+--query "$4"} $baseopt > "$t/retail.log" 2>&1 || { cat "$t/retail.log" >&2; echo "match.sh: the render or scoring failed: $t/retail.log" >&2; return 1; }
  "$py" "$here/match_classes.py" "$t/scenes" --out "$t/classes" --worlds "$world" > "$t/classes.log" 2>&1 || { cat "$t/classes.log" >&2; return 1; }
  "$py" "$here/match_log.py" record "$t" --ledger "$ledger" --kind "$5" --note "$6" --query "$4" --commit "$(git -C "$repo" rev-parse --short HEAD)" --diff "$t/candidate.diff" --base "$3" --repo "$repo" --world "$world" --aim "$aim"
}

# The bases: the first run renders trial-000 (the tuning windows) and holdout-000 (the held-out window) from unchanged files.
if [ ! -d "$out/trial-000/stats" ]; then
  [ -z "$query$probe$only" ] || { echo "match.sh: run the base first (no --query or --probe), so later trials have something to compare with" >&2; exit 2; }
  if ! git -C "$repo" diff --quiet HEAD -- materials repro/scenes || [ -n "$(git -C "$repo" ls-files --others --exclude-standard -- materials repro/scenes)" ]; then
    echo "match.sh: the base must render the world files as committed; materials/ or repro/scenes/ has changes (git status). Commit or restore them first." >&2; exit 2
  fi
  git -C "$repo" rev-parse HEAD > "$out/base-commit"
  note='base: the world files as they were before any change'
  trial "$out/trial-000" "$tuning" "$out/trial-000" "" trial "$note" || exit 1
  [ "$held" = "$tuning" ] || trial "$out/holdout-000" "$held" "$out/holdout-000" "" holdout "$note" || exit 1
  exit 0
fi
[ -n "$note" ] || { echo "match.sh: say what this trial changes and why: --note \"...\"" >&2; exit 2; }
if [ $holdout = 1 ]; then scenes=$held; prefix=holdout; kind=holdout; else scenes=$tuning; prefix=trial; kind=trial; fi
[ $holdout = 0 ] || [ "$held" != "$tuning" ] || { echo "match.sh: $world has one window; nothing is held out" >&2; exit 2; }
base=$out/$prefix-000
n=$(ls -d "$out/$prefix"-[0-9][0-9][0-9] 2>/dev/null | wc -l | tr -d ' ')   # trials and probes share one counter; the held-out window has its own

next() { dir=$(printf '%s/%s-%03d' "$out" "$prefix" "$n"); n=$((n + 1)); }   # sets $dir (not in a subshell, so the count moves)
if [ -n "$probe" ]; then
  printf '%s\n' "$queries" | { while read -r q; do next; trial "$dir" "$scenes" "$base" "$q" probe "probe ${q%%&*}: $note" || exit 1; done; } || exit 1
else
  next; trial "$dir" "$scenes" "$base" "$query" $kind "$note" || exit 1
fi

# Prune scene pictures and triptychs of all but the last KEEP_LAST trials of this kind (keeping the base and marked trials).
# The class crops stay for every trial: they are small, and later rounds read them.
total=$(ls -d "$out/$prefix"-[0-9][0-9][0-9] 2>/dev/null | wc -l | tr -d ' ')
[ "$total" -gt $KEEP_LAST ] && ls -d "$out/$prefix"-[0-9][0-9][0-9] | sort | head -n $((total - KEEP_LAST)) | while read -r old; do
  [ "$old" = "$base" ] || [ -e "$old/keep" ] || [ ! -d "$old/scenes" ] && continue
  find "$old/scenes" "$old/triptych" -name '*.png' -type f -delete 2>/dev/null
  find "$old/scenes" -name 'ours-heights.json' -type f -delete 2>/dev/null
done
exit 0
