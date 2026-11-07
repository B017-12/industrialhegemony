"""Run the pipeline stages up to the nav grid on a PLY, cache them, and report floor/grid diagnostics.

    python3 _analysis/debug_nav.py _analysis/brush_out/aligned_5k.ply _analysis/brush_out/debug_5k
"""
from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pipeline.filtering import clean_splats, splat_cloud, voxel_aggregate  # noqa: E402
from pipeline.io_ply import load_splats  # noqa: E402
from pipeline.navigation import PARAMS, build_grid  # noqa: E402
from pipeline.structure import fit_structure  # noqa: E402

ply, out = Path(sys.argv[1]), Path(sys.argv[2])
frame = json.loads(Path(sys.argv[3]).read_text())["frame_calibration"] if len(sys.argv) > 3 else None
out.mkdir(parents=True, exist_ok=True)
cache = out / "stages.pkl"
if cache.exists():
    cloud, filter_stats, voxels = pickle.loads(cache.read_bytes())
else:
    data, _, col = load_splats(ply, None)
    cloud, filter_stats = clean_splats(splat_cloud(data, col))
    voxels = voxel_aggregate(cloud, voxel=0.02)
    cache.write_bytes(pickle.dumps((cloud, filter_stats, voxels)))
structure = fit_structure(voxels.xyz, voxels.weight, frame)

print("filter:", filter_stats)
print("planes:", [(p["label"], np.round(p["normal"], 3).tolist(), round(float(p["offset"]), 3), int(p["mask"].sum())) for p in structure["planes"]])
print("floor_y", structure["floor_y"], "ceiling_y", structure["ceiling_y"], "scale", structure["scale"])
mpu = structure["scale"]["metres_per_unit"]
grid = build_grid(cloud.xyz, structure["floor_y"], mpu, PARAMS)
print("grid:", grid.stats)

fig, ax = plt.subplots(1, 4, figsize=(24, 6))
for a, (name, img) in zip(ax, [("support", grid.support), ("blocked", grid.blocked), ("free", grid.free), ("walkable", grid.walkable)]):
    a.imshow(img, origin="lower", extent=[grid.x0, grid.x0 + img.shape[1] * grid.cell, grid.z0, grid.z0 + img.shape[0] * grid.cell])
    a.set_title(name)
    a.set_xlabel("x")
    a.set_ylabel("z")
fig.tight_layout()
fig.savefig(out / "grid.png", dpi=80)

h = structure["floor_y"] - cloud.xyz[:, 1]
fig, ax = plt.subplots(figsize=(10, 4))
ax.hist(h * mpu, bins=200, range=(-0.5, 3.0))
ax.set_xlabel("height above fitted floor (m)")
fig.savefig(out / "height_hist.png", dpi=80)
