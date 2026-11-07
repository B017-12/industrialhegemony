"""Stage 2 — orient: find floor and ceiling heights, check tilt, write transform.json and sanity renders.

The world frame is already y-up (applied in clean). Here we verify that claim from the data:
the floor must be the dense, flat slab at the bottom of the y distribution, and a RANSAC
plane fit on it must have a near-vertical normal.
"""

from __future__ import annotations

import numpy as np

from pipeline.common import DERIVED, write_json
from pipeline import render

SLAB_HALF = 0.05  # m, half-thickness of the floor/ceiling slab used for plane fitting


def _peak(y: np.ndarray, lo: float, hi: float, bin_m: float = 0.02) -> float:
    hist, edges = np.histogram(y, bins=np.arange(lo, hi + bin_m, bin_m))
    i = int(hist.argmax())
    return float((edges[i] + edges[i + 1]) / 2)


def _ransac_plane(pts: np.ndarray, iters: int = 300, tol: float = 0.02, seed: int = 0):
    rng = np.random.default_rng(seed)
    best_inliers, best = -1, None
    for _ in range(iters):
        a, b, c = pts[rng.choice(len(pts), 3, replace=False)]
        n = np.cross(b - a, c - a)
        norm = np.linalg.norm(n)
        if norm < 1e-9:
            continue
        n /= norm
        inliers = int((np.abs((pts - a) @ n) < tol).sum())
        if inliers > best_inliers:
            best_inliers, best = inliers, (n, a)
    n, a = best
    mask = np.abs((pts - a) @ n) < tol
    # least-squares refit on inliers
    centroid = pts[mask].mean(axis=0)
    _, _, vt = np.linalg.svd(pts[mask] - centroid, full_matrices=False)
    normal = vt[2] if vt[2][1] >= 0 else -vt[2]
    return normal, centroid, float(mask.mean())


def orient() -> dict:
    data = np.load(DERIVED / "splats_clean.npz")
    xyz, rgb = data["xyz"], data["rgb"]
    y = xyz[:, 1]
    y_lo, y_hi = np.percentile(y, [0.5, 99.5])
    mid = (y_lo + y_hi) / 2
    floor_y = _peak(y, y_lo - 0.1, mid)
    ceiling_y = _peak(y, mid, y_hi + 0.1)

    rng = np.random.default_rng(0)
    slab = xyz[np.abs(y - floor_y) < SLAB_HALF]
    sample = slab[rng.choice(len(slab), min(len(slab), 60_000), replace=False)]
    normal, centroid, inlier_frac = _ransac_plane(sample)
    tilt_deg = float(np.degrees(np.arccos(abs(normal[1]))))

    below = float((y < floor_y - 0.15).mean())
    above = float((y > floor_y + 0.15).mean())

    floor_pts = xyz[np.abs(y - floor_y) < SLAB_HALF]
    fx0, fz0 = np.percentile(floor_pts[:, [0, 2]], 1, axis=0)
    fx1, fz1 = np.percentile(floor_pts[:, [0, 2]], 99, axis=0)

    result = {
        "frame": "world = (x, -y_ply, -z_ply); y up; units = PLY units (scene_scale not yet calibrated)",
        "floor_y": round(floor_y, 3),
        "ceiling_y": round(ceiling_y, 3),
        "room_height": round(ceiling_y - floor_y, 3),
        "floor_slab_points": int(len(floor_pts)),
        "floor_normal": normal.round(4).tolist(),
        "floor_tilt_deg": round(tilt_deg, 2),
        "floor_ransac_inlier_frac": round(inlier_frac, 3),
        "frac_points_below_floor": round(below, 4),
        "frac_points_above_floor": round(above, 4),
        "floor_extent_xz": [round(float(v), 3) for v in (fx0, fx1, fz0, fz1)],
        "scene_scale": 1.0,
        "scene_scale_calibrated": False,
    }
    write_json(DERIVED / "transform.json", result)

    # sanity renders: top-down and four eye-level views from the room corners
    pad = 0.3
    bounds = (fx0 - pad, fx1 + pad, fz0 - pad, fz1 + pad)
    below_ceiling = y < ceiling_y - 0.15
    render.save(render.render_top(xyz[below_ceiling], rgb[below_ceiling], bounds), DERIVED / "renders" / "top.png")
    eye_y = floor_y + 1.6
    centre = np.array([(fx0 + fx1) / 2, floor_y + 0.8, (fz0 + fz1) / 2])
    inset = 0.4
    corners = {
        "corner_nw": (fx0 + inset, fz0 + inset),
        "corner_ne": (fx1 - inset, fz0 + inset),
        "corner_sw": (fx0 + inset, fz1 - inset),
        "corner_se": (fx1 - inset, fz1 - inset),
    }
    for name, (cx, cz) in corners.items():
        img = render.render_perspective(xyz, rgb, eye=(cx, eye_y, cz), target=centre)
        render.save(img, DERIVED / "renders" / f"{name}.png")
    return result


def main() -> None:
    r = orient()
    print(
        f"orient: floor_y={r['floor_y']} ceiling_y={r['ceiling_y']} height={r['room_height']} "
        f"tilt={r['floor_tilt_deg']}° inliers={r['floor_ransac_inlier_frac']} "
        f"below_floor={r['frac_points_below_floor']}"
    )
    print(f"  floor extent xz={r['floor_extent_xz']}; renders in data/derived/renders/")


if __name__ == "__main__":
    main()
