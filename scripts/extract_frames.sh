#!/usr/bin/env bash
# Extract 1 fps frames from the boiler-room scan video into data/derived/frames/ (gitignored) plus contact sheets.
# Usage: scripts/extract_frames.sh [video] [fps]
set -euo pipefail
VIDEO="${1:-/home/acidelf/Work/tries/VALMET/Industrial Boiler Room (1).mp4}"
FPS="${2:-1}"
OUT=data/derived/frames
mkdir -p "$OUT/sheets"
ffmpeg -loglevel error -y -i "$VIDEO" -vf "fps=${FPS}" -q:v 2 "$OUT/t_%04d.jpg"
# contact sheets: 4x3 tiles of 480 px, frame number burnt in
ffmpeg -loglevel error -y -i "$VIDEO" -vf "fps=${FPS},scale=480:-1,drawtext=text='%{eif\:n+1\:d}':x=8:y=8:fontsize=28:fontcolor=yellow:box=1:boxcolor=black,tile=4x3" -q:v 3 "$OUT/sheets/sheet_%02d.jpg"
ls "$OUT"/t_*.jpg | wc -l
