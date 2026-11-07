"""Free-space check of a nav grid against the walked video camera path.

A person carried the camera everywhere along that path, so the floor under it cannot be blocked.
Usage: python3 _analysis/check_camera_path.py data/derived data/derived/splat_alignment.json
"""
import json
import sys
from pathlib import Path

import numpy as np

nav_dir, alignment = Path(sys.argv[1]), Path(sys.argv[2])
raw = (nav_dir / "nav_map.pgm").read_bytes()
magic, size, _, body = raw.split(b"\n", 3)
w, h = map(int, size.split())
img = np.flipud(np.frombuffer(body, np.uint8).reshape(h, w))  # rows = z cells, cols = x cells
nav = json.loads((nav_dir / "nav.json").read_text())
x0, _, z0 = nav["grid_origin"]
cell = nav["cell_size"]
cams = np.array(json.loads(alignment.read_text())["camera_centres"])
i = np.clip(((cams[:, 2] - z0) / cell).astype(int), 0, h - 1)
j = np.clip(((cams[:, 0] - x0) / cell).astype(int), 0, w - 1)
v = img[i, j]
report = {
    "cameras": int(len(v)),
    "blocked": int((v == 0).sum()),
    "floor": int((v == 254).sum()),
    "unknown": int((v == 205).sum()),
}
report["blocked_fraction"] = round(report["blocked"] / len(v), 4)
print(json.dumps(report))
