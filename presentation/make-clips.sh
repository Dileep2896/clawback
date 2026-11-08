#!/usr/bin/env bash
# Cuts the live take's raw platform recording into the deck's demo clips: trim and scale only, no overlays.
# Times come from events.json beside the footage. call.wav starts at video 61.5 s.
#   ./make-clips.sh            write media/*.mp4 and notes.js
#   ./make-clips.sh --install  also copy the finished folder to ~/Desktop/clawback-presentation/
set -euo pipefail
cd "$(dirname "$0")"
RAW="${RAW:-$HOME/Desktop/clawback-video/raw-take-2026-11-08}"
SRC="$RAW/footage-master.mp4"
mkdir -p media
V=(-vf "scale=1920:1080:flags=lanczos,format=yuv420p" -c:v libx264 -crf 20 -preset medium -movflags +faststart)

silent() { # name from to
  ffmpeg -v error -y -ss "$2" -to "$3" -i "$SRC" -an "${V[@]}" "media/$1.mp4"
}
silent 01-signup 15.4 35.3
silent 02-agents 35.5 54.4
silent 03-approval 54.3 61.45
silent 05-findings 266.7 279.5
silent 06-overview 279.5 292.4

# The call: two stretches of the real call, each with its own audio from call.wav (offset 61.5 s), joined.
ffmpeg -v error -y \
  -ss 61.5 -to 67.3 -i "$SRC" -ss 0.0 -to 5.8 -i "$RAW/call.wav" \
  -ss 189.9 -to 206.3 -i "$SRC" -ss 128.4 -to 144.8 -i "$RAW/call.wav" \
  -filter_complex "[0:v]scale=1920:1080:flags=lanczos,format=yuv420p,setsar=1[v0];[2:v]scale=1920:1080:flags=lanczos,format=yuv420p,setsar=1[v1];[1:a]aresample=48000[a0];[3:a]aresample=48000[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 160k -movflags +faststart media/04-call.mp4

# notes.js: the presenter notes from notes.md, so file:// pages need no fetch.
node -e '
const fs = require("fs");
const notes = {};
let key = null;
for (const line of fs.readFileSync("notes.md", "utf8").split("\n")) {
  const h = line.match(/^## (\d+\.\d+)/);
  if (h) { key = h[1]; notes[key] = ""; continue; }
  if (key && line.trim()) notes[key] += (notes[key] ? " " : "") + line.trim();
}
fs.writeFileSync("notes.js", "window.NOTES = " + JSON.stringify(notes, null, 1) + ";\n");
const words = Object.values(notes).join(" ").split(/\s+/).filter(Boolean).length;
console.log(`notes: ${words} words, ${(words / 140).toFixed(2)} min at 140 wpm`);
'

for f in media/*.mp4; do echo "$f $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")s"; done

if [[ "${1:-}" == "--install" ]]; then
  DEST="$HOME/Desktop/clawback-presentation"
  mkdir -p "$DEST"
  rsync -a --delete --exclude steps index.html deck.css deck.js notes.js notes.md README.md fonts media "$DEST/"
  echo "installed to $DEST"
fi
