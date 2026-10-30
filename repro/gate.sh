#!/bin/sh
# The world-name gate of docs/TERRAIN_ENGINE.md "Share, don't copy", on code with comments stripped.
#   repro/gate.sh            prints the world-named identifiers still in the engine path (the list may only shrink)
# Exit 1 if a file names `biome`, `biomeId` or `worldId`, or a world's name as a string.
cd "$(dirname "$0")/.." || exit 2
files="engine-*.wgsl sculpt-gpu-fields.js sculpt-erosion.js sculpt-chunk-renderer.js sculpt-renderer.js"
strip() { sed -e 's://.*$::' -e 's:/\*.*\*/::' "$1"; }
bad=0
for f in $files; do
  # 'crystal' is left out: it is also a stroke kind and a material's colour key, not only a planet.
  hits=$(strip "$f" | /usr/bin/grep -n -E "biome|biomeId|worldId|['\"](green|red|archipelago|moon|zhon|lava|desert|ice)['\"]")
  [ -n "$hits" ] && { echo "$f:"; echo "$hits"; bad=1; }
done
echo "--- world-named identifiers (feature cards rename or replace them)"
for f in engine-*.wgsl sculpt-gpu-fields.js sculpt-erosion.js sculpt-chunk-renderer.js; do
  strip "$f" | /usr/bin/grep -o -E "\b(green|moon|ice|lava|crystal|desert|zhon|archipelago|shoal)[A-Z][A-Za-z0-9]*" | sort -u | sed "s:^:$f :"
done
exit $bad
