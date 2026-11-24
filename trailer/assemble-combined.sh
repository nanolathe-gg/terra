#!/bin/bash
# The combined announcement cut (docs/TRAILER.md, "Combined cut"): title, sections vs Terra, the real-time take on Green Planet, the same map
# playing in Nanolathe, the end card.
#   trailer/assemble-combined.sh <cuts-dir> <take-dir> [cartoon]
# With `cartoon`, the cartoon cold open (cuts.html?cut=cartoon, out/cartoon.mp4) replaces the title and the sections comparison, then its
# quick cut of every world plays before the take, and the result is <take-dir>/terra-trailer-cartoon.mp4.
# <cuts-dir>/out holds title.mp4, sections.mp4, slate-rt.mp4 and end.mp4 (render-explainer.mjs); <take-dir> holds realtime-raw.mp4
# (capture-realtime.mjs), labels/ (labels.mjs, the step labels laid over the take) and film/terra-gameplay.mp4 (Nanolathe's tools/film on
# the take's .ufo). Writes <take-dir>/terra-trailer.mp4 with music made to the cut (music.mjs, its .wav beside it).
# Segments join with hard cuts on the music's beat; only the first fades in and the last fades out. The gameplay loses its bottom 3.4%,
# where the film tool still draws its game clock.
set -euo pipefail
C=${1:?cuts dir}/out
T=${2:?take dir}
# file:start:end (seconds; end empty for the whole clip). The gameplay trims are whole bars of the music (120 a minute): the arrival from
# just after the film's opening iris, the battle from its advance to the first volleys.
gameplay=("$T/film/terra-gameplay.mp4:1.0:11.0" "$T/film/terra-gameplay.mp4:13.5:21.5")
# styles: the music's style for each segment, in order (trailer/music.mjs)
if [ "${3:-}" = cartoon ]; then
  segments=("$C/cartoon.mp4::" "$C/sections.mp4:21.5:27.5" "$T/realtime-raw.mp4::" "${gameplay[@]}" "$C/end.mp4::"); result=$T/terra-trailer-cartoon.mp4
  styles=(cartoon worlds take game game end)
else
  segments=("$C/title.mp4::" "$C/sections.mp4:3.2:27.5" "$C/slate-rt.mp4::" "$T/realtime-raw.mp4::" "${gameplay[@]}" "$C/end.mp4::"); result=$T/terra-trailer.mp4
  styles=(title compare slate take game game end)
fi
inputs=() filters="" labels="" sections="" i=0 n=${#segments[@]} count=0   # count: ffmpeg inputs so far
for seg in "${segments[@]}"; do
  IFS=: read -r file a b <<< "$seg"
  [ -f "$file" ] || { echo "assemble: missing $file" >&2; exit 1; }
  len=${b:-$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$file")}; a=${a:-0}
  d=$(python3 -c "print(round($len - $a, 3))")
  si=$count; inputs+=(-i "$file"); count=$((count + 1))   # si: this segment's input
  chain="trim=start=$a:end=$len,setpts=PTS-STARTPTS"
  case "$file" in *terra-gameplay*) chain+=",crop=iw*0.966:ih*0.966:iw*0.017:0";; esac
  chain+=",scale=1280:720:flags=lanczos,fps=30,setsar=1,format=yuv420p"
  [ "$i" = 0 ] && chain+=",fade=in:st=0:d=0.3"
  [ "$i" = $((n - 1)) ] && chain+=",fade=out:st=$(python3 -c "print(max(0, $d - 0.6))"):d=0.6"
  filters+="[$si:v]$chain[s$i];"
  out="s$i"
  # The step labels over the take, each fading in and out on its own times.
  if [[ "$file" == *realtime-raw.mp4 && -f "$T/labels/labels.json" ]]; then
    while IFS=$'\t' read -r png from to; do
      k=$count; inputs+=(-loop 1 -t "$d" -i "$T/labels/$png"); count=$((count + 1))
      filters+="[$k:v]format=rgba,fade=in:st=$from:d=0.15:alpha=1,fade=out:st=$to:d=0.15:alpha=1[l$k];[$out][l$k]overlay=0:0:shortest=1[o$k];"
      out="o$k"
    done < <(python3 -c "
import json; L = json.load(open('$T/labels/labels.json'))
for x in L: print(x['file'], max(0, x['from'] - 0.05), (x['to'] if x['to'] is not None else $d - 0.4) - 0.15, sep='\t')")
  fi
  labels+="[$out]"; sections+="${sections:+,}${styles[$i]}:$d"; i=$((i + 1))
done
# The music follows the segments' own lengths, so every section's pattern starts on its cut.
node "$(dirname "$0")/music.mjs" "${result%.mp4}.wav" --sections "$sections"
m=$count
ffmpeg -loglevel error -y "${inputs[@]}" -i "${result%.mp4}.wav" -filter_complex "${filters}${labels}concat=n=$n:v=1:a=0[v]" -map "[v]" -map "$m:a" -c:v libx264 -crf 19 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart "$result"
echo "assemble: $result ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$result") s)"
