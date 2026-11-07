"""Forensic check of a COLMAP model before splat training.

    python3 _analysis/check_sfm.py _analysis/sfm_full/undist/sparse/0 --out _analysis/sfm_full/check
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from colmap_io import camera_centres, read_cameras, read_images, read_points3d


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-obs", type=int, default=100)
    args = ap.parse_args()
    model, out = Path(args.model), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    cams = read_cameras(model / "cameras.bin")
    images = read_images(model / "images.bin")
    pts = read_points3d(model / "points3D.bin")
    names, centres, c2w = camera_centres(images)

    obs = {im["name"]: int((im["pid"] >= 0).sum()) for im in images.values()}
    weak = sorted((n, o) for n, o in obs.items() if o < args.min_obs)
    per_cam = {cid: sum(1 for im in images.values() if im["camera_id"] == cid) for cid in cams}

    # Gravity: handheld video keeps the camera roughly level, so the mean camera
    # "down" axis (+y in the OpenCV camera frame) estimates world down.
    down = c2w[:, :, 1].mean(0)
    down /= np.linalg.norm(down)
    levelness = float(np.degrees(np.arccos(np.clip(c2w[:, :, 1] @ down, -1, 1))).mean())

    steps = np.linalg.norm(np.diff(centres, axis=0), axis=1)
    jumps = [(names[i], names[i + 1], float(s)) for i, s in enumerate(steps) if s > 6 * np.median(steps)]

    # Plan view in a gravity-aligned basis.
    a = np.cross(down, [1.0, 0, 0])
    a /= np.linalg.norm(a)
    b = np.cross(down, a)
    P = pts["xyz"]
    keep = np.all(np.abs(P - np.median(P, 0)) < 4 * np.percentile(np.abs(P - np.median(P, 0)), 95, axis=0), axis=1)
    fig, ax = plt.subplots(1, 2, figsize=(14, 7))
    ax[0].scatter(P[keep] @ a, P[keep] @ b, s=0.3, c=pts["rgb"][keep] / 255.0)
    ax[0].plot(centres @ a, centres @ b, "-", c="red", lw=1)
    ax[0].scatter(centres[0] @ a, centres[0] @ b, c="lime", s=60, label="first frame", zorder=5)
    ax[0].set_aspect("equal")
    ax[0].legend()
    ax[0].set_title(f"Plan view (gravity from cameras): {len(images)} cameras, {len(P)} points")
    ax[1].hist(list(obs.values()), bins=50)
    ax[1].axvline(args.min_obs, c="red")
    ax[1].set_title("Triangulated observations per image")
    fig.tight_layout()
    fig.savefig(out / "sfm_check.png", dpi=110)

    report = {
        "model": str(model),
        "cameras": {cid: {"model": c["model"], "size": [c["width"], c["height"]], "params": [round(float(v), 4) for v in c["params"]], "images": per_cam[cid]} for cid, c in cams.items()},
        "registered_images": len(images),
        "points3d": len(P),
        "mean_reprojection_error_px": round(float(pts["error"].mean()), 3),
        "track_length": {"mean": round(float(pts["track"].mean()), 2), "median": int(np.median(pts["track"])), "p90": int(np.percentile(pts["track"], 90))},
        "observations_per_image": {"min": min(obs.values()), "median": int(np.median(list(obs.values()))), "max": max(obs.values())},
        "weak_images": weak,
        "gravity_down_world": [round(float(v), 4) for v in down],
        "mean_camera_tilt_from_gravity_deg": round(levelness, 2),
        "trajectory_length_units": round(float(steps.sum()), 3),
        "trajectory_jumps": jumps,
        "loop_closure_gap_units": round(float(np.linalg.norm(centres[-1] - centres[0])), 3),
    }
    (out / "sfm_check.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != "weak_images"}, indent=2))
    print(f"weak images (<{args.min_obs} obs): {len(weak)}", weak[:10])


if __name__ == "__main__":
    main()
