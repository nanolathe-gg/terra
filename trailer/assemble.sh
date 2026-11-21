#!/bin/bash
# Assemble the trailer's rough cut from the rendered pieces (trailer/README.md): explainer, editor clips, the in-game slate, the logo.
#   trailer/assemble.sh <assets-dir>     reads <dir>/out/explainer.mp4, <dir>/editor/<world>.mp4, <dir>/out/slate-game.mp4, <dir>/logo-desert/{clay,final}.png
# Writes <dir>/out/logo.mp4 and <dir>/out/trailer-rough.mp4 (1280x720, 30 fps, H.264).
set -euo pipefail
A=${1:?assets dir}
O=$A/out
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

# The logo: the engine's clay picture of the letters dissolves into its final picture, with a slow push in.
ffmpeg -loglevel error -y -loop 1 -t 2 -i "$A/logo-desert/clay.png" -loop 1 -t 5 -i "$A/logo-desert/final.png" -filter_complex \
  "[0][1]xfade=transition=fade:duration=1.2:offset=0.8,zoompan=z='1+0.0007*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=in:st=0:d=0.5,fade=out:st=5.3:d=0.5,format=yuv420p" \
  -c:v libx264 -crf 18 -movflags +faststart "$O/logo.mp4"

# Segments in order, each with its speed (setpts factor: below 1 plays faster).
segments=("$O/explainer.mp4:1" "$A/editor/green.mp4:0.8" "$A/editor/desert.mp4:0.6" "$A/editor/ice.mp4:0.6" "$A/editor/lava.mp4:0.6" "$O/slate-game.mp4:1" "$O/logo.mp4:1")
inputs=() filters="" labels=""
i=0
for seg in "${segments[@]}"; do
  file=${seg%:*} speed=${seg##*:}
  [ -f "$file" ] || { echo "assemble: missing $file" >&2; exit 1; }
  d=$(python3 -c "print(round($(dur "$file") * $speed, 3))")
  out=$(python3 -c "print(max(0, $d - 0.3))")
  inputs+=(-i "$file")
  filters+="[$i:v]setpts=$speed*PTS,scale=1280:720:flags=lanczos,fps=30,setsar=1,format=yuv420p,fade=in:st=0:d=0.25,fade=out:st=$out:d=0.3[v$i];"
  labels+="[v$i]"
  i=$((i + 1))
done
ffmpeg -loglevel error -y "${inputs[@]}" -filter_complex "${filters}${labels}concat=n=$i:v=1:a=0[v]" -map "[v]" -c:v libx264 -crf 19 -pix_fmt yuv420p -movflags +faststart "$O/trailer-rough.mp4"
echo "assemble: $O/trailer-rough.mp4 ($(dur "$O/trailer-rough.mp4") s)"
