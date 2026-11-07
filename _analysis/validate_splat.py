"""Validate a trained 3DGS PLY in the ply_raw frame: attributes, coverage, comparison with the old slice.

    python3 _analysis/validate_splat.py _analysis/brush_out/boiler_room_full_raw.ply \
        --alignment data/derived/splat_alignment.json --old _analysis/boiler_room_valid.ply \
        --out _analysis/brush_out/validation
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pipeline.io_ply import read_ply_header  # noqa: E402

MPU = 1.2865
FLOOR_Y = 1.07191


def load(path: Path) -> tuple[np.ndarray, dict[str, int]]:
    header, count, props = read_ply_header(path)
    data = np.array(np.memmap(path, dtype="<f4", mode="r", offset=len(header), shape=(count, len(props))))
    return data, {p: i for i, p in enumerate(props)}


def attributes(data: np.ndarray, col: dict[str, int]) -> dict:
    finite = np.all(np.isfinite(data), axis=1)
    d = data[finite].astype(np.float64)
    alpha = 1 / (1 + np.exp(-d[:, col["opacity"]]))
    scale_m = np.exp(d[:, [col[f"scale_{k}"] for k in range(3)]]) * MPU
    qn = np.linalg.norm(d[:, [col[f"rot_{k}"] for k in range(4)]], axis=1)
    pct = lambda v: {f"p{p}": round(float(np.percentile(v, p)), 5) for p in (1, 50, 99)}  # noqa: E731
    rest = [c for c in col if c.startswith("f_rest_")]
    return {
        "splats": int(len(data)),
        "non_finite_rows": int((~finite).sum()),
        "properties": len(col),
        "sh_degree": {0: 0, 9: 1, 24: 2, 45: 3}.get(len(rest), f"unknown ({len(rest)} f_rest)"),
        "alpha": {**pct(alpha), "fraction_gt_0.5": round(float((alpha > 0.5).mean()), 4)},
        "max_axis_scale_m": pct(scale_m.max(1)),
        "splats_larger_than_1m": int((scale_m.max(1) > 1.0).sum()),
        "quaternion_norm": pct(qn),
        "zero_quaternions": int((qn < 1e-6).sum()),
    }


def opaque_xyz(data: np.ndarray, col: dict[str, int]) -> np.ndarray:
    finite = np.all(np.isfinite(data[:, :3]), axis=1)
    alpha = 1 / (1 + np.exp(-data[:, col["opacity"]].astype(np.float64)))
    return data[finite & (alpha > 0.3), :3].astype(np.float64)


def coverage(xyz: np.ndarray, lo: np.ndarray, hi: np.ndarray, cell: float) -> tuple[np.ndarray, list[float], list[float]]:
    h = FLOOR_Y - xyz[:, 1]
    sel = xyz[(h > 0.05) & (h < 1.9)]
    xe = np.arange(lo[0], hi[0] + cell, cell)
    ze = np.arange(lo[1], hi[1] + cell, cell)
    grid, _, _ = np.histogram2d(sel[:, 0], sel[:, 2], [xe, ze])
    return grid, xe, ze


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ply")
    ap.add_argument("--alignment", default="data/derived/splat_alignment.json")
    ap.add_argument("--old", default="_analysis/boiler_room_valid.ply")
    ap.add_argument("--out", required=True)
    ap.add_argument("--eval-log", default=None, help="Brush training log, for held-out PSNR/SSIM")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    data, col = load(Path(args.ply))
    report = {"ply": args.ply, "attributes": attributes(data, col)}
    xyz = opaque_xyz(data, col)
    al = json.loads(Path(args.alignment).read_text())
    cams = np.array(al["camera_centres"])

    # Room box: the 1-99 percentile extent of opaque splats between floor and ceiling.
    h = FLOOR_Y - xyz[:, 1]
    body = xyz[(h > 0.05) & (h < 1.9)]
    lo = np.percentile(body[:, [0, 2]], 1, axis=0)
    hi = np.percentile(body[:, [0, 2]], 99, axis=0)
    cell = 0.25 / MPU
    grid, xe, ze = coverage(xyz, lo, hi, cell)
    old_data, old_col = load(Path(args.old))
    old_xyz = opaque_xyz(old_data, old_col)
    old_grid, _, _ = coverage(old_xyz, lo, hi, cell)

    occupied = grid > 5
    old_occupied = old_grid > 5
    mid_x, mid_z = (lo + hi) / 2
    xc = (xe[:-1] + xe[1:]) / 2
    zc = (ze[:-1] + ze[1:]) / 2
    X, Z = np.meshgrid(xc, zc, indexing="ij")
    sectors = {}
    for name, m in {
        "south (z < mid)": Z < mid_z,
        "north (z >= mid)": Z >= mid_z,
        "west (x < mid)": X < mid_x,
        "east (x >= mid)": X >= mid_x,
    }.items():
        sectors[name] = {
            "new_cells_occupied": round(float(occupied[m].mean()), 3),
            "old_cells_occupied": round(float(old_occupied[m].mean()), 3),
        }
    # Perimeter band: walls must be present on all four sides.
    band = 4
    sides = {
        "x_min wall": occupied[:band].any(0).mean(),
        "x_max wall": occupied[-band:].any(0).mean(),
        "z_min wall": occupied[:, :band].any(1).mean(),
        "z_max wall": occupied[:, -band:].any(1).mean(),
    }
    old_sides = {
        "x_min wall": old_occupied[:band].any(0).mean(),
        "x_max wall": old_occupied[-band:].any(0).mean(),
        "z_min wall": old_occupied[:, :band].any(1).mean(),
        "z_max wall": old_occupied[:, -band:].any(1).mean(),
    }
    report["room_box_ply_raw"] = {"x": [round(float(lo[0]), 3), round(float(hi[0]), 3)], "z": [round(float(lo[1]), 3), round(float(hi[1]), 3)], "size_m": [round(float((hi - lo)[0] * MPU), 2), round(float((hi - lo)[1] * MPU), 2)]}
    report["coverage"] = {
        "cell_m": 0.25,
        "new_cells_occupied": round(float(occupied.mean()), 3),
        "old_cells_occupied": round(float(old_occupied.mean()), 3),
        "sectors": sectors,
        "wall_presence_new": {k: round(float(v), 3) for k, v in sides.items()},
        "wall_presence_old": {k: round(float(v), 3) for k, v in old_sides.items()},
    }
    floor_cells = np.histogram2d(xyz[np.abs(xyz[:, 1] - FLOOR_Y) < 0.06][:, 0], xyz[np.abs(xyz[:, 1] - FLOOR_Y) < 0.06][:, 2], [xe, ze])[0] > 3
    report["coverage"]["floor_cells_with_surface"] = round(float(floor_cells.mean()), 3)
    if args.eval_log:
        import re

        text = Path(args.eval_log).read_text(errors="replace")
        psnr = re.findall(r"psnr[^0-9]*([0-9.]+)", text, re.I)
        ssim = re.findall(r"ssim[^0-9]*([0-9.]+)", text, re.I)
        report["eval_from_log"] = {"psnr_last": float(psnr[-1]) if psnr else None, "ssim_last": float(ssim[-1]) if ssim else None, "psnr_count": len(psnr)}

    (out / "validation.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))

    fig, ax = plt.subplots(1, 3, figsize=(20, 6.5))
    ext = [ze[0], ze[-1], xe[0], xe[-1]]
    for a, g, title in [(ax[0], old_grid, "supplied PLY, valid slice"), (ax[1], grid, "video splat (aligned)")]:
        a.imshow(np.log1p(g), origin="lower", extent=ext, cmap="magma", aspect="equal")
        a.plot(cams[:, 2], cams[:, 0], c="cyan", lw=0.7)
        a.set_title(f"{title}: plan density 0.05-1.9 u above floor")
        a.set_xlabel("z (ply_raw)")
        a.set_ylabel("x (ply_raw)")
    rng = np.random.default_rng(0)
    sub = xyz[rng.choice(len(xyz), min(len(xyz), 200_000), replace=False)]
    ax[2].scatter(sub[:, 0], sub[:, 1], s=0.05, c="tab:blue", alpha=0.3)
    ax[2].invert_yaxis()
    ax[2].set_aspect("equal")
    ax[2].set_title("front view x-y (y down), opaque splats")
    fig.tight_layout()
    fig.savefig(out / "coverage.png", dpi=100)


if __name__ == "__main__":
    main()
