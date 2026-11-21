#!/bin/bash
# The combined announcement cut (docs/TRAILER.md, "Combined cut"): title, sections vs Terra, the real-time take on Green Planet, the same map
# playing in Nanolathe, the end card.
#   trailer/assemble-combined.sh <cuts-dir> <take-dir>
# <cuts-dir>/out holds title.mp4, sections.mp4, slate-rt.mp4 and end.mp4 (render-explainer.mjs); <take-dir> holds realtime-raw.mp4
# (capture-realtime.mjs) and film/terra-gameplay.mp4 (Nanolathe's tools/film on the take's .ufo). Writes <take-dir>/terra-trailer.mp4.
set -euo pipefail
C=${1:?cuts dir}/out
T=${2:?take dir}
# file:start:end (seconds; end empty for the whole clip)
segments=("$C/title.mp4::" "$C/sections.mp4:3.2:26.2" "$C/slate-rt.mp4::" "$T/realtime-raw.mp4::"
  "$T/film/terra-gameplay.mp4:0:4.2" "$T/film/terra-gameplay.mp4:21.2:26.5" "$T/film/terra-gameplay.mp4:34:41.5" "$C/end.mp4::")
inputs=() filters="" labels="" i=0
for seg in "${segments[@]}"; do
  IFS=: read -r file a b <<< "$seg"
  [ -f "$file" ] || { echo "assemble: missing $file" >&2; exit 1; }
  len=${b:-$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$file")}; a=${a:-0}
  d=$(python3 -c "print(round($len - $a, 3))"); out=$(python3 -c "print(max(0, $d - 0.25))")
  inputs+=(-i "$file")
  filters+="[$i:v]trim=start=$a:end=$len,setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos,fps=30,setsar=1,format=yuv420p,fade=in:st=0:d=0.2,fade=out:st=$out:d=0.25[v$i];"
  labels+="[v$i]"; i=$((i + 1))
done
ffmpeg -loglevel error -y "${inputs[@]}" -filter_complex "${filters}${labels}concat=n=$i:v=1:a=0[v]" -map "[v]" -c:v libx264 -crf 19 -pix_fmt yuv420p -movflags +faststart "$T/terra-trailer.mp4"
echo "assemble: $T/terra-trailer.mp4 ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$T/terra-trailer.mp4") s)"
