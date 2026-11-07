"""Similarity transform from the video (COLMAP / Brush) frame into the app's ply_raw frame.

ply_raw is the frame of the supplied PLY: y-down, floor at max y (pipeline/config.py UP = [0,-1,0]).
--target is the supplied PLY (now the intact "Equipment Room.ply"); --calibration-from is the
pipeline's scene_objects.json for that PLY and supplies its floor, ceiling and metres per unit.

    # 1. solve from the COLMAP sparse model (no trained splat needed)
    python3 _analysis/align_to_ply_raw.py solve --model _analysis/sfm_full/undist/sparse/0 \
        --target "Equipment Room.ply" --calibration-from data/derived/scene_objects.json \
        --out data/derived/splat_alignment.json
    # 2. optionally refine against trained splat centres, then apply to the splat
    python3 _analysis/align_to_ply_raw.py solve ... --splat brush_out/export_30000.ply
    python3 _analysis/align_to_ply_raw.py apply --splat in.ply --alignment data/derived/splat_alignment.json --out aligned.ply
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from colmap_io import camera_centres, read_images, read_points3d  # noqa: E402
from pipeline.io_ply import read_ply_header  # noqa: E402

# ---------------------------------------------------------------- loading

def load_ply(path: Path) -> tuple[bytes, list[str], np.ndarray]:
    header, count, props = read_ply_header(path)
    data = np.array(np.memmap(path, dtype="<f4", mode="r", offset=len(header), shape=(count, len(props))))
    return header, props, data


def splat_points(path: Path, min_alpha: float = 0.5, max_points: int = 400_000) -> np.ndarray:
    _, props, data = load_ply(path)
    col = {p: i for i, p in enumerate(props)}
    ok = np.all(np.isfinite(data[:, :3]), axis=1)
    alpha = 1 / (1 + np.exp(-data[:, col["opacity"]]))
    scale = np.exp(data[:, [col["scale_0"], col["scale_1"], col["scale_2"]]]).max(1)
    xyz = data[ok & (alpha > min_alpha) & (scale < np.percentile(scale[ok], 95)), :3].astype(np.float64)
    if len(xyz) > max_points:
        xyz = xyz[np.random.default_rng(0).choice(len(xyz), max_points, replace=False)]
    return xyz


def voxel_down(xyz: np.ndarray, voxel: float) -> np.ndarray:
    keys = np.floor(xyz / voxel).astype(np.int64)
    _, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.ravel()
    out = np.zeros((inv.max() + 1, 3))
    np.add.at(out, inv, xyz)
    return out / np.bincount(inv)[:, None]


# ---------------------------------------------------------------- geometry helpers

def rot_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), float(a @ b)
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else Rotation.from_rotvec(np.pi * np.array([1.0, 0, 0])).as_matrix()
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))


def plane_fit(points: np.ndarray) -> np.ndarray:
    centred = points - points.mean(0)
    return np.linalg.svd(centred, full_matrices=False)[2][2]


def floor_ceiling(y: np.ndarray, bin_width: float) -> tuple[float, float]:
    """Strongest horizontal density peak in the lower (max y) and upper (min y) halves."""
    lo, hi = np.percentile(y, [0.5, 99.5])
    edges = np.arange(lo, hi + bin_width, bin_width)
    hist, _ = np.histogram(y, edges)
    hist = ndimage.gaussian_filter1d(hist.astype(float), 1.0)
    centres = (edges[:-1] + edges[1:]) / 2
    mid = (lo + hi) / 2
    floor = centres[centres > mid][hist[centres > mid].argmax()]
    ceiling = centres[centres < mid][hist[centres < mid].argmax()]
    return float(floor), float(ceiling)


def level(points: np.ndarray, down: np.ndarray, iters: int = 3) -> tuple[np.ndarray, float, float]:
    """Rotation taking world down to +y, refined on the floor and ceiling planes."""
    R = rot_between(down, np.array([0.0, 1.0, 0.0]))
    for _ in range(iters):
        p = points @ R.T
        span = np.percentile(p[:, 1], 99.5) - np.percentile(p[:, 1], 0.5)
        floor, ceiling = floor_ceiling(p[:, 1], span / 120)
        band = span / 60
        normals = []
        for h in (floor, ceiling):
            sel = p[np.abs(p[:, 1] - h) < band]
            if len(sel) > 200:
                n = plane_fit(sel)
                normals.append(n if n[1] > 0 else -n)
        n = np.mean(normals, 0)
        R = rot_between(n, np.array([0.0, 1.0, 0.0])) @ R
    p = points @ R.T
    span = np.percentile(p[:, 1], 99.5) - np.percentile(p[:, 1], 0.5)
    floor, ceiling = floor_ceiling(p[:, 1], span / 200)
    return R, floor, ceiling


def plan_image(xz: np.ndarray, origin: np.ndarray, cell: float, shape: tuple[int, int]) -> np.ndarray:
    ij = np.floor((xz - origin) / cell).astype(int)
    ok = (ij[:, 0] >= 0) & (ij[:, 1] >= 0) & (ij[:, 0] < shape[0]) & (ij[:, 1] < shape[1])
    img = np.zeros(shape)
    np.add.at(img, (ij[ok, 0], ij[ok, 1]), 1.0)
    img = np.log1p(img)
    return ndimage.gaussian_filter(img, 1.0)


def umeyama(src: np.ndarray, dst: np.ndarray, with_scale: bool = True) -> tuple[float, np.ndarray, np.ndarray]:
    mu_s, mu_d = src.mean(0), dst.mean(0)
    xs, xd = src - mu_s, dst - mu_d
    cov = xd.T @ xs / len(src)
    U, D, Vt = np.linalg.svd(cov)
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1
    R = U @ S @ Vt
    s = float(np.trace(np.diag(D) @ S) / xs.var(0).sum()) if with_scale else 1.0
    return s, R, mu_d - s * R @ mu_s


def frame_calibration(scene_objects: Path) -> dict:
    """The ply_raw calibration established on the valid slice; the aligned splat inherits it."""
    scene = json.loads(scene_objects.read_text())
    cal = scene["scale_calibration"]
    return {
        "frame": "ply_raw",
        "metres_per_unit": cal["metres_per_unit"],
        "metres_per_unit_range": cal["metres_per_unit_range"],
        "floor_y": scene["pipeline"]["floor_y"],
        "ceiling_y": scene["pipeline"]["ceiling_y"],
        "source": f"{scene_objects} ({scene['source_ply']}, {cal['method']})",
        "reasoning": cal["reasoning"],
    }


# ---------------------------------------------------------------- solve

def solve(args: argparse.Namespace) -> None:
    images = read_images(Path(args.model) / "images.bin")
    names, centres, c2w = camera_centres(images)
    down = c2w[:, :, 1].mean(0)
    if args.splat:
        src = voxel_down(splat_points(Path(args.splat)), args.voxel_src)
        source_kind = f"splat centres ({args.splat})"
    else:
        pts = read_points3d(Path(args.model) / "points3D.bin")
        keep = (pts["error"] < 1.5) & (pts["track"] >= 3)
        src = pts["xyz"][keep]
        source_kind = f"COLMAP points ({keep.sum()} of {len(keep)}, error<1.5px, track>=3)"
    med = np.median(src, 0)
    src = src[np.linalg.norm(src - med, axis=1) < 4 * np.percentile(np.linalg.norm(src - med, axis=1), 90)]

    tgt_all = splat_points(Path(args.target))
    tgt = voxel_down(tgt_all, 0.03)
    print(f"{len(src)} source points ({source_kind}); {len(tgt)} target voxels", flush=True)

    # 1. gravity, floor and ceiling in both clouds
    R_level, src_floor, src_ceiling = level(src, down)
    calibration = frame_calibration(Path(args.calibration_from))
    tgt_floor, tgt_ceiling = calibration["floor_y"], calibration["ceiling_y"]
    # Scale from the floor-referenced height profile (floor, pipe racks, ceiling).
    # A floor-to-ceiling ratio is unreliable on sparse SfM points: the ceiling has
    # little texture, so its histogram peak is often a wall band instead.
    src_h = src_floor - (src @ R_level.T)[:, 1]
    tgt_h = tgt_floor - tgt[:, 1]
    edges = np.linspace(-0.1, 2.3, 121)
    tprof = ndimage.gaussian_filter1d(np.histogram(tgt_h, edges)[0].astype(float), 1.0)
    tprof = (tprof - tprof.mean()) / tprof.std()
    profile = []
    for sc in np.geomspace(0.3, 2.0, 400):
        sprof = ndimage.gaussian_filter1d(np.histogram(src_h * sc, edges)[0].astype(float), 1.0)
        if sprof.std() == 0:
            continue
        profile.append((float(((sprof - sprof.mean()) / sprof.std() * tprof).mean()), float(sc)))
    profile.sort(reverse=True)
    s0 = profile[0][1]
    print(f"floor-ceiling ratio would give {(tgt_floor - tgt_ceiling) / (src_floor - src_ceiling):.4f}; height-profile scale {s0:.4f} (r={profile[0][0]:.3f})", flush=True)

    # 2. yaw (and mirror check) + plan translation by FFT cross-correlation of
    #    plan-view density between 0.15 and 1.7 units above the floor
    def walls(p: np.ndarray, floor: float) -> np.ndarray:
        h = floor - p[:, 1]
        return p[(h > 0.15) & (h < 1.7)][:, [0, 2]]

    def levelled(scale: float) -> np.ndarray:
        p = (src @ R_level.T) * scale
        p[:, 1] += tgt_floor - src_floor * scale
        return p

    tw = walls(tgt, tgt_floor)
    span = lambda p: np.ptp(np.percentile(p, [1, 99], axis=0), 0).max()  # noqa: E731

    def setup(scale: float, cell: float):
        sw = walls(levelled(scale), tgt_floor)
        sw = sw[np.all(np.abs(sw - np.median(sw, 0)) < 1.5 * np.ptp(np.percentile(sw, [2, 98], axis=0), 0), axis=1)]
        extent = (span(sw) + span(tw)) * 1.2
        n = int(extent / cell) + 1
        origin = tw.mean(0) - extent / 2
        timg = plan_image(tw, origin, cell, (n, n))
        timg -= timg.mean()
        return sw, n, origin, timg, np.fft.rfft2(timg)

    if args.scale is None:
        # Global coarse search over scale: the height profile and floor-ceiling ratio
        # are only priors; the plan correlation of the walls decides.
        coarse = []
        for sc in np.geomspace(args.scale_min, args.scale_max, 25):
            sw0, n, t_origin, timg, ftimg = setup(sc, 0.1)
            cell = 0.1
            for y in np.arange(0, 360, 6.0):
                c_, s_ = np.cos(np.radians(y)), np.sin(np.radians(y))
                R2 = np.array([[c_, -s_], [s_, c_]])
                sw = sw0 @ R2.T
                simg = plan_image(sw - sw.mean(0) + tw.mean(0), t_origin, cell, (n, n))
                simg -= simg.mean()
                corr = np.fft.irfft2(ftimg * np.conj(np.fft.rfft2(simg)), s=timg.shape)
                coarse.append((float(corr.max() / (np.linalg.norm(timg) * np.linalg.norm(simg))), float(sc), float(y)))
        coarse.sort(reverse=True)
        print("global (score, scale, yaw) top 8:", [tuple(round(v, 3) for v in c) for c in coarse[:8]], flush=True)
        s0 = coarse[0][1]
    else:
        s0 = args.scale
    cell = 0.05
    sw0, n, t_origin, timg, ftimg = setup(s0, cell)
    print(f"plan grid {n}x{n} at {cell} u; {len(tw)} target and {len(sw0)} source wall points; scale {s0:.4f}", flush=True)

    def score_at(yaw: float, mirror: bool, f: float = 1.0):
        c, s_ = np.cos(np.radians(yaw)), np.sin(np.radians(yaw))
        R2 = np.array([[c, -s_], [s_, c]])
        if mirror:
            R2 = R2 @ np.diag([1.0, -1.0])
        sw = (sw0 * f) @ R2.T
        sw = sw - sw.mean(0) + tw.mean(0)
        simg = plan_image(sw, t_origin, cell, (n, n))
        simg -= simg.mean()
        corr = np.fft.irfft2(ftimg * np.conj(np.fft.rfft2(simg)), s=timg.shape)
        k = np.unravel_index(corr.argmax(), corr.shape)
        score = corr[k] / (np.linalg.norm(timg) * np.linalg.norm(simg))
        shift = np.array([k[0] if k[0] < n / 2 else k[0] - n, k[1] if k[1] < n / 2 else k[1] - n]) * cell
        return float(score), float(yaw), mirror, R2, tw.mean(0) - (sw0.mean(0) * f) @ R2.T + shift, f

    results = [score_at(y, m) for m in (False, True) for y in np.arange(0, 360, 5.0)]
    results.sort(key=lambda r: -r[0])
    print("coarse yaw top 5:", [(round(r[0], 3), r[1], r[2]) for r in results[:5]], flush=True)
    for coarse in results[:4]:
        results += [score_at(y, coarse[2], f) for y in np.arange(coarse[1] - 5, coarse[1] + 5.01, 1.0) for f in np.geomspace(0.85, 1.15, 13)]
    results.sort(key=lambda r: -r[0])
    top = results[0]
    results += [score_at(y, top[2], f) for y in np.arange(top[1] - 1, top[1] + 1.01, 0.25) for f in top[5] * np.geomspace(0.97, 1.03, 7)]
    results.sort(key=lambda r: -r[0])
    score, yaw, mirror, R2, t2, f = results[0]
    s0 *= f
    print(f"plan search: yaw {yaw} mirror={mirror} scale factor {f:.4f} -> scale {s0:.4f}", flush=True)
    best_unmirrored = max((r[0] for r in results if not r[2]), default=0.0)
    best_mirrored = max((r[0] for r in results if r[2]), default=0.0)
    print(f"plan correlation: best yaw {yaw:.0f} deg mirror={mirror} score {score:.3f}; unmirrored {best_unmirrored:.3f} vs mirrored {best_mirrored:.3f}")
    if mirror:
        raise SystemExit("best plan alignment is mirrored: refusing, a similarity cannot mirror the room")

    R_yaw = np.eye(3)
    R_yaw[np.ix_([0, 2], [0, 2])] = R2
    t_plan = np.array([t2[0], 0.0, t2[1]])

    # Full initial similarity: X' = s R X + t
    R = R_yaw @ R_level
    s = s0
    t = R_yaw @ np.array([0.0, tgt_floor - src_floor * s0, 0.0]) + t_plan
    # 3. trimmed scaled ICP against the valid slice (overlap only)
    tree = cKDTree(tgt)
    for it in range(40):
        cur = s * src @ R.T + t
        d, j = tree.query(cur, distance_upper_bound=args.icp_max)
        ok = np.isfinite(d)
        if ok.sum() < 500:
            raise SystemExit(f"ICP lost overlap at iteration {it}")
        thr = np.percentile(d[ok], 80)
        ok &= d <= thr
        ds, dR, dt = umeyama(cur[ok], tgt[j[ok]], with_scale=True)
        s, R, t = ds * s, dR @ R, ds * dR @ t + dt
        if abs(ds - 1) < 1e-5 and np.degrees(np.arccos(np.clip((np.trace(dR) - 1) / 2, -1, 1))) < 1e-3:
            break
    cur = s * src @ R.T + t
    d, _ = tree.query(cur, distance_upper_bound=0.3)
    overlap = np.isfinite(d)
    tgt_d, _ = cKDTree(cur).query(tgt)
    mpu = calibration["metres_per_unit"]
    T = np.eye(4)
    T[:3, :3] = s * R
    T[:3, 3] = t
    report = {
        "frame_from": "colmap (_analysis/sfm_full/undist/sparse/0), identical to the Brush training frame",
        "frame_to": "ply_raw (y-down, floor at max y)",
        "matrix": T.round(8).tolist(),
        "scale": s,
        "rotation": R.round(8).tolist(),
        "translation": t.round(6).tolist(),
        "det_rotation": float(np.linalg.det(R)),
        "source": source_kind,
        "target": f"{args.target} (alpha>0.5, 3 cm voxels, {len(tgt)} points)",
        "initial": {"scale": s0, "yaw_deg": float(yaw), "plan_score": float(score), "plan_score_unmirrored": float(best_unmirrored), "plan_score_mirrored": float(best_mirrored)},
        "icp_iterations": it + 1,
        "residual": {
            "source_points_within_0.3u_of_slice": int(overlap.sum()),
            "median_source_to_slice_m": float(np.median(d[overlap]) * mpu),
            "p90_source_to_slice_m": float(np.percentile(d[overlap], 90) * mpu),
            "median_slice_to_source_m": float(np.median(tgt_d) * mpu),
            "slice_points_within_5cm_m": float((tgt_d * mpu < 0.05).mean()),
        },
        "room_after": {
            "floor_y": float(np.percentile(cur[:, 1], 99.5)),
            "x_range": [float(v) for v in np.percentile(cur[:, 0], [1, 99])],
            "z_range": [float(v) for v in np.percentile(cur[:, 2], [1, 99])],
        },
        "frame_calibration": calibration,
        "camera_centres": (s * centres @ R.T + t).round(5).tolist(),
        "camera_names": names,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items() if k not in ("camera_centres", "camera_names")}, indent=1))
    if args.plot:
        plot(cur, tgt, s * centres @ R.T + t, Path(args.plot))


def plot(src: np.ndarray, tgt: np.ndarray, cams: np.ndarray, path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(1, 2, figsize=(16, 7))
    for a, (i, j, lab) in zip(ax, [(0, 2, "plan (x, z)"), (0, 1, "front (x, y)")]):
        a.scatter(src[:, i], src[:, j], s=0.2, c="tab:blue", alpha=0.4, label="video reconstruction (aligned)")
        a.scatter(tgt[:, i], tgt[:, j], s=0.2, c="tab:orange", alpha=0.3, label="supplied PLY (target)")
        if i == 0 and j == 2:
            a.plot(cams[:, 0], cams[:, 2], c="red", lw=0.8, label="camera path")
        a.set_aspect("equal")
        a.set_title(f"ply_raw frame, {lab}")
        a.legend(markerscale=20, loc="upper right")
    ax[1].invert_yaxis()
    fig.tight_layout()
    fig.savefig(path, dpi=110)


# ---------------------------------------------------------------- apply to a 3DGS PLY

SH_C = {
    1: 0.4886025119029199,
    2: [1.0925484305920792, -1.0925484305920792, 0.31539156525252005, -1.0925484305920792, 0.5462742152960396],
    3: [-0.5900435899266435, 2.890611442640554, -0.4570457994644658, 0.3731763325901154, -0.4570457994644658, 1.445305721320277, -0.5900435899266435],
}


def sh_basis(d: np.ndarray, degree: int) -> np.ndarray:
    """Real SH basis in the 3DGS ordering (bands 1..degree, no DC), shape (N, (degree+1)^2 - 1)."""
    x, y, z = d[:, 0], d[:, 1], d[:, 2]
    out = []
    if degree >= 1:
        c = SH_C[1]
        out += [-c * y, c * z, -c * x]
    if degree >= 2:
        c = SH_C[2]
        xx, yy, zz, xy, yz, xz = x * x, y * y, z * z, x * y, y * z, x * z
        out += [c[0] * xy, c[1] * yz, c[2] * (2 * zz - xx - yy), c[3] * xz, c[4] * (xx - yy)]
    if degree >= 3:
        c = SH_C[3]
        xx, yy, zz = x * x, y * y, z * z
        out += [
            c[0] * y * (3 * xx - yy),
            c[1] * x * y * z,
            c[2] * y * (4 * zz - xx - yy),
            c[3] * z * (2 * zz - 3 * xx - 3 * yy),
            c[4] * x * (4 * zz - xx - yy),
            c[5] * z * (xx - yy),
            c[6] * x * (xx - 3 * yy),
        ]
    return np.stack(out, 1)


def sh_rotation(R: np.ndarray, degree: int) -> np.ndarray:
    """Matrix M with c' = M c, so that f'(d) = f(R^T d) for the rotated scene. Exact for orthogonal R."""
    dirs = np.random.default_rng(1).normal(size=(4000, 3))
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    Y = sh_basis(dirs, degree)
    Yr = sh_basis(dirs @ R, degree)  # rows: R^T d
    M = np.linalg.lstsq(Y, Yr, rcond=None)[0]
    blocks = [0, 3, 8, 15][: degree + 1]
    mask = np.zeros_like(M, dtype=bool)
    for lo, hi in zip(blocks[:-1], blocks[1:]):
        mask[lo:hi, lo:hi] = True
    M[~mask] = 0  # bands do not mix under rotation
    return M


def apply(args: argparse.Namespace) -> None:
    al = json.loads(Path(args.alignment).read_text())
    s, R, t = al["scale"], np.array(al["rotation"]), np.array(al["translation"])
    assert np.linalg.det(R) > 0.999, "alignment contains a reflection"
    header, props, data = load_ply(Path(args.splat))
    col = {p: i for i, p in enumerate(props)}
    out = data.copy()
    finite = np.all(np.isfinite(data), axis=1)
    out = out[finite]
    xyz = out[:, [col["x"], col["y"], col["z"]]].astype(np.float64)
    out[:, [col["x"], col["y"], col["z"]]] = s * xyz @ R.T + t
    for k in range(3):
        out[:, col[f"scale_{k}"]] += np.log(s)
    q = out[:, [col["rot_0"], col["rot_1"], col["rot_2"], col["rot_3"]]].astype(np.float64)  # w, x, y, z
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    rq = Rotation.from_matrix(R) * Rotation.from_quat(q[:, [1, 2, 3, 0]])
    xyzw = rq.as_quat()
    out[:, [col["rot_0"], col["rot_1"], col["rot_2"], col["rot_3"]]] = xyzw[:, [3, 0, 1, 2]]
    rest = sorted((c for c in props if c.startswith("f_rest_")), key=lambda c: int(c.split("_")[-1]))
    if rest:
        per = len(rest) // 3
        degree = {3: 1, 8: 2, 15: 3}[per]
        M = sh_rotation(R, degree)
        for ch in range(3):
            cols = [col[rest[ch * per + i]] for i in range(per)]  # inria layout: channel-major
            out[:, cols] = out[:, cols].astype(np.float64) @ M.T
    if args.crop:
        lo, hi = np.array(args.crop[:3]), np.array(args.crop[3:])
        p = out[:, :3]
        out = out[np.all((p >= lo) & (p <= hi), axis=1)]
    text = header.decode()
    lines = [ln for ln in text.splitlines() if not ln.startswith("element vertex")]
    new_header = []
    for ln in text.splitlines():
        if ln.startswith("element vertex"):
            new_header.append(f"element vertex {len(out)}")
        elif ln.startswith("comment Vertical axis"):
            new_header.append("comment Vertical axis: 0 -1 0 (ply_raw, y-down)")
        else:
            new_header.append(ln)
    del lines
    with open(args.out, "wb") as f:
        f.write(("\n".join(new_header) + "\n").encode())
        f.write(out.astype("<f4").tobytes())
    print(f"wrote {args.out}: {len(out)} splats ({(~finite).sum()} non-finite dropped), scale {s:.5f}, SH bands rotated: {bool(rest)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("solve")
    a.add_argument("--model", default="_analysis/sfm_full/undist/sparse/0")
    a.add_argument("--target", default="Equipment Room.ply")
    a.add_argument("--splat", default=None, help="trained splat in the COLMAP frame (refines the solve)")
    a.add_argument("--voxel-src", type=float, default=0.03)
    a.add_argument("--icp-max", type=float, default=0.15)
    a.add_argument("--scale", type=float, default=None, help="skip the global scale search")
    a.add_argument("--calibration-from", default="data/derived/scene_objects.json")
    a.add_argument("--scale-min", type=float, default=0.5)
    a.add_argument("--scale-max", type=float, default=2.0)
    a.add_argument("--out", default="data/derived/splat_alignment.json")
    a.add_argument("--plot", default=None)
    b = sub.add_parser("apply")
    b.add_argument("--splat", required=True)
    b.add_argument("--alignment", default="data/derived/splat_alignment.json")
    b.add_argument("--out", required=True)
    b.add_argument("--crop", type=float, nargs=6, default=None, metavar=("X0", "Y0", "Z0", "X1", "Y1", "Z1"))
    args = ap.parse_args()
    solve(args) if args.cmd == "solve" else apply(args)


if __name__ == "__main__":
    main()
