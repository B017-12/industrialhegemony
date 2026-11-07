"""Pick the sharpest video frame near each chosen time and save it for the vision demo.

Usage: uv run python scripts/pick_frames.py
Writes public/assets/vision/frames/FRM-###.jpg (1280 px) and data/derived/frames/grid/FRM-###.jpg (with a
100 px coordinate grid, for drawing regions by hand). Prints the chosen video time per frame.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

VIDEO = Path("/home/acidelf/Work/tries/VALMET/Industrial Boiler Room (1).mp4")
OUT = Path("public/assets/vision/frames")
GRID = Path("data/derived/frames/grid")
WIDTH = 1280
# frame_id -> approximate video time (s), chosen from the 1 fps contact sheets
PICKS = {
    "FRM-001": 1, "FRM-002": 11, "FRM-003": 15, "FRM-004": 18, "FRM-005": 22, "FRM-006": 36,
    "FRM-007": 50, "FRM-008": 56, "FRM-009": 69, "FRM-010": 72, "FRM-011": 85, "FRM-012": 90,
    "FRM-013": 94, "FRM-014": 100, "FRM-015": 103, "FRM-016": 105, "FRM-017": 106, "FRM-018": 110,
}


def sharpness(img: Image.Image) -> float:
    g = np.asarray(img.convert("L").resize((480, 270)), dtype=np.float32)
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var())


def best_frame(t: float) -> tuple[Image.Image, float]:
    with tempfile.TemporaryDirectory() as tmp:
        start = max(0.0, t - 0.45)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{start:.2f}", "-t", "0.9", "-i", str(VIDEO),
                        "-vf", "fps=15", "-q:v", "2", f"{tmp}/f_%03d.jpg"], check=True)
        files = sorted(Path(tmp).glob("f_*.jpg"))
        scored = [(sharpness(Image.open(f)), i, f) for i, f in enumerate(files)]
        s, i, f = max(scored)
        return Image.open(f).convert("RGB").copy(), round(start + i / 15, 2)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    GRID.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    times = {}
    for fid, t in PICKS.items():
        if only and fid not in only:
            continue
        img, t_s = best_frame(t)
        img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
        img.save(OUT / f"{fid}.jpg", quality=88)
        g = img.copy()
        d = ImageDraw.Draw(g)
        for x in range(0, g.width, 100):
            d.line([(x, 0), (x, g.height)], fill=(255, 255, 0), width=1)
            d.text((x + 2, 2), str(x), fill=(255, 255, 0))
        for y in range(0, g.height, 100):
            d.line([(0, y), (g.width, y)], fill=(0, 255, 255), width=1)
            d.text((2, y + 2), str(y), fill=(0, 255, 255))
        g.save(GRID / f"{fid}.jpg", quality=85)
        times[fid] = t_s
        print(fid, t_s, g.size)
    (GRID / "times.json").write_text(json.dumps(times, indent=1))


if __name__ == "__main__":
    main()
