"""Export the scan as an antimatter15-style .splat file for photoreal browser rendering (viewer.html).

32 bytes per splat: position 3×float32, scale 3×float32 (linear), RGBA 4×uint8 (SH DC colour + sigmoid
opacity), rotation 4×uint8 (normalised quaternion w,x,y,z mapped to q*128+128). Splats are sorted by
importance (volume × opacity, largest first) as in the reference converter.

Splats are cropped to the scanned room (floor extent + ROOM_MARGIN, nothing far below the floor): the
reconstruction's large background blobs outside the walls only add haze.

By default the ceiling slab is cut away (splats above ceiling_y − CEILING_CUT, the same limit segment.py
uses), so the room can be viewed from above like a dollhouse; the hanging pipes stay. --keep-ceiling keeps it.

The world frame (x, −y, −z; y up) is baked in: positions are flipped and quaternions are pre-multiplied
by a 180° rotation about x, so the splats line up with objects.json / path.json without any viewer-side
transform. Only near-invisible splats (opacity <= ALPHA_MIN) are dropped.

Output: public/assets/equipment_room.splat (gitignored; regenerate with this stage).
"""

from __future__ import annotations

import argparse

import numpy as np

from pipeline.common import DERIVED, PLY_TO_WORLD, SH_C0, WEB_ASSETS, open_ply, read_json

ALPHA_MIN = 0.04
SCALE_MAX = 3.0
CEILING_CUT = 0.08
ROOM_MARGIN = 0.5


def export_splat(max_splats: int | None = None, alpha_min: float = ALPHA_MIN, keep_ceiling: bool = False) -> dict:
    table, idx = open_ply()
    xyz = np.asarray(table[:, 0:3])
    log_scale = np.asarray(table[:, idx["scale_0"] : idx["scale_0"] + 3])
    f_dc = np.asarray(table[:, idx["f_dc_0"] : idx["f_dc_0"] + 3])
    opacity = np.asarray(table[:, idx["opacity"]])
    rot = np.asarray(table[:, [idx["rot_0"], idx["rot_1"], idx["rot_2"], idx["rot_3"]]])  # (w, x, y, z)

    with np.errstate(all="ignore"):
        alpha = 1.0 / (1.0 + np.exp(-opacity))
        scale = np.exp(log_scale)
        qn = np.linalg.norm(rot, axis=1)
        keep = (
            np.isfinite(xyz).all(axis=1) & np.isfinite(log_scale).all(axis=1) & np.isfinite(f_dc).all(axis=1)
            & np.isfinite(alpha) & (alpha > alpha_min) & (scale.max(axis=1) < SCALE_MAX) & (qn > 1e-6)
        )
    tf = read_json(DERIVED / "transform.json")
    world = xyz * PLY_TO_WORLD
    x0, x1, z0, z1 = tf["floor_extent_xz"]
    keep &= (world[:, 0] > x0 - ROOM_MARGIN) & (world[:, 0] < x1 + ROOM_MARGIN)
    keep &= (world[:, 2] > z0 - ROOM_MARGIN) & (world[:, 2] < z1 + ROOM_MARGIN)
    keep &= world[:, 1] > tf["floor_y"] - 0.25
    if not keep_ceiling:
        keep &= world[:, 1] < tf["ceiling_y"] - CEILING_CUT
    order = np.flatnonzero(keep)
    importance = scale[order].prod(axis=1) * alpha[order]
    order = order[np.argsort(-importance, kind="stable")]
    if max_splats:
        order = order[:max_splats]

    q = rot[order] / qn[order, None]
    w, x, y, z = q.T
    q_world = np.column_stack([-x, w, -z, y])  # 180° about x, pre-multiplied: (0,1,0,0) ⊗ q

    rec = np.zeros(len(order), dtype=[("pos", "<f4", 3), ("scale", "<f4", 3), ("rgba", "u1", 4), ("rot", "u1", 4)])
    rec["pos"] = xyz[order] * PLY_TO_WORLD
    rec["scale"] = scale[order]
    rgb = np.clip(0.5 + SH_C0 * f_dc[order], 0, 1)
    rec["rgba"] = np.clip(np.column_stack([rgb, alpha[order]]) * 255, 0, 255).astype(np.uint8)
    rec["rot"] = np.clip(q_world * 128 + 128, 0, 255).astype(np.uint8)

    out = WEB_ASSETS / "equipment_room.splat"
    out.parent.mkdir(parents=True, exist_ok=True)
    rec.tofile(out)
    return {"splats": int(len(order)), "bytes": int(out.stat().st_size), "path": str(out)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--max-splats", type=int, help="keep only the N most important splats (lighter file)")
    ap.add_argument("--alpha-min", type=float, default=ALPHA_MIN)
    ap.add_argument("--keep-ceiling", action="store_true")
    args = ap.parse_args()
    r = export_splat(args.max_splats, args.alpha_min, args.keep_ceiling)
    print(f"export_splat: {r['splats']:,} splats, {r['bytes'] / 1e6:.0f} MB -> {r['path']}")


if __name__ == "__main__":
    main()
