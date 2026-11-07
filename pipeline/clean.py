"""Stage 1 — clean: filter the raw 3DGS splats and export them in the world frame.

Filters (thresholds justified by the measured distributions, see clean_report.json):
  * sane:     all 14 core attributes finite and in physical range (guards against the
              garbage values seen in the earlier boiler-room file)
  * geometry: sigmoid(opacity) > OPACITY_MIN and exp(max log-scale) < SCALE_MAX —
              drops translucent floaters and huge background blobs

Outputs:
  data/derived/splats_clean.npz      geometry set: xyz (world), rgb, alpha, scale (linear), rot
  data/derived/clean_report.json
  public/assets/equipment_room_splats.bin   web point cloud (format read by BoilerRoomViewport.jsx)
"""

from __future__ import annotations

import argparse

import numpy as np

from pipeline.common import DERIVED, PLY_PATH, PLY_TO_WORLD, SH_C0, WEB_ASSETS, open_ply, write_json

OPACITY_MIN = 0.1
SCALE_MAX = 0.3
WEB_MAX_POINTS = 450_000


def clean(ply_path=PLY_PATH, web_max_points: int = WEB_MAX_POINTS, seed: int = 0) -> dict:
    table, idx = open_ply(ply_path)
    n = table.shape[0]
    core = np.asarray(table[:, : idx["opacity"] + 1])  # x..opacity, 14 columns

    xyz = core[:, 0:3]
    log_scale = core[:, idx["scale_0"] : idx["scale_0"] + 3]
    rot = np.asarray(table[:, [idx["rot_0"], idx["rot_1"], idx["rot_2"], idx["rot_3"]]])  # (w, x, y, z)
    f_dc = core[:, idx["f_dc_0"] : idx["f_dc_0"] + 3]
    opacity_logit = core[:, idx["opacity"]]

    with np.errstate(all="ignore"):
        sane = (
            np.isfinite(core).all(axis=1)
            & (np.abs(xyz) < 1e3).all(axis=1)
            & (log_scale > -20).all(axis=1)
            & (log_scale < 5).all(axis=1)
            & (np.abs(opacity_logit) < 30)
            & (np.abs(f_dc) < 10).all(axis=1)
        )
        alpha = 1.0 / (1.0 + np.exp(-opacity_logit))
        scale = np.exp(log_scale)
    geometry = sane & (alpha > OPACITY_MIN) & (scale.max(axis=1) < SCALE_MAX)

    world = xyz[geometry] * PLY_TO_WORLD
    rgb = np.clip(0.5 + SH_C0 * f_dc[geometry], 0.0, 1.0).astype(np.float32)
    # Quaternion (w, x, y, z) rotated by 180° about x: q' = (-x, w, -z, y) up to sign.
    q = rot[geometry]
    q_world = np.stack([-q[:, 1], q[:, 0], -q[:, 3], q[:, 2]], axis=1)

    DERIVED.mkdir(parents=True, exist_ok=True)
    np.savez(
        DERIVED / "splats_clean.npz",
        xyz=world.astype(np.float32),
        rgb=rgb,
        alpha=alpha[geometry].astype(np.float32),
        scale=scale[geometry].astype(np.float32),
        rot=q_world.astype(np.float32),
    )

    web_count = _write_web_bin(world, rgb, scale[geometry].max(axis=1), web_max_points, seed)

    s_alpha, s_scale = alpha[sane], scale[sane].max(axis=1)
    report = {
        "source": str(ply_path.resolve()),
        "raw_splats": int(n),
        "sane_splats": int(sane.sum()),
        "geometry_splats": int(geometry.sum()),
        "web_points": int(web_count),
        "thresholds": {"opacity_min": OPACITY_MIN, "scale_max": SCALE_MAX},
        "alpha_percentiles_10_50_90": np.percentile(s_alpha, [10, 50, 90]).round(4).tolist(),
        "max_scale_percentiles_50_99": np.percentile(s_scale, [50, 99]).round(4).tolist(),
        "world_extent_p1": np.percentile(world, 1, axis=0).round(3).tolist(),
        "world_extent_p99": np.percentile(world, 99, axis=0).round(3).tolist(),
        "frame": "world = (x, -y, -z) of the PLY; y up",
    }
    write_json(DERIVED / "clean_report.json", report)
    return report


def _write_web_bin(world, rgb, max_scale, max_points: int, seed: int) -> int:
    """int32 count, then per point: 3×float32 xyz, 3×uint8 rgb, uint8 scale (×1200, as the prototype)."""
    rng = np.random.default_rng(seed)
    keep = np.arange(len(world))
    if len(keep) > max_points:
        keep = np.sort(rng.choice(keep, max_points, replace=False))
    rec = np.zeros(len(keep), dtype=[("xyz", "<f4", 3), ("rgb", "u1", 3), ("sc", "u1")])
    rec["xyz"] = world[keep]
    rec["rgb"] = np.round(rgb[keep] * 255).astype(np.uint8)
    rec["sc"] = np.clip(np.floor(max_scale[keep] * 1200), 1, 255).astype(np.uint8)
    WEB_ASSETS.mkdir(parents=True, exist_ok=True)
    with open(WEB_ASSETS / "equipment_room_splats.bin", "wb") as f:
        f.write(np.int32(len(keep)).tobytes())
        f.write(rec.tobytes())
    return len(keep)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--web-max-points", type=int, default=WEB_MAX_POINTS)
    args = ap.parse_args()
    report = clean(web_max_points=args.web_max_points)
    print(
        f"clean: raw={report['raw_splats']:,} sane={report['sane_splats']:,} "
        f"geometry={report['geometry_splats']:,} web={report['web_points']:,}"
    )
    print(f"  extent p1={report['world_extent_p1']} p99={report['world_extent_p99']}")


if __name__ == "__main__":
    main()
