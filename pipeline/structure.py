from __future__ import annotations

from typing import Any

import numpy as np

from .config import UP

ROOM_HEIGHT_PRIOR_M = (2.4, 2.6)


def ransac_plane(
    pts: np.ndarray,
    thresh: float,
    iters: int = 600,
    normal_hint: np.ndarray | None = None,
    hint_tol: float = 0.9,
    vertical: bool = False,
    seed: int = 0,
    eval_points: int = 20000,
) -> tuple[np.ndarray, float]:
    if len(pts) < 3:
        raise ValueError("Need at least three points for plane fitting")
    rng = np.random.default_rng(seed)
    sample = pts[rng.choice(len(pts), (iters, 3))]
    normals = np.cross(sample[:, 1] - sample[:, 0], sample[:, 2] - sample[:, 0])
    norms = np.linalg.norm(normals, axis=1)
    valid = norms > 1e-9
    normals = normals[valid] / norms[valid, None]
    sample = sample[valid]
    alignment = np.abs(normals @ UP) if normal_hint is None else np.abs(normals @ normal_hint)
    if vertical:
        valid = alignment < 0.1
    else:
        valid = alignment >= hint_tol if normal_hint is not None else np.ones(len(normals), dtype=bool)
    normals, sample = normals[valid], sample[valid]
    if not len(normals):
        raise ValueError("RANSAC failed to find a plane")
    offsets = -np.einsum("ij,ij->i", normals, sample[:, 0])
    probe = pts[rng.choice(len(pts), min(eval_points, len(pts)), replace=False)]
    counts = (np.abs(probe @ normals.T + offsets) < thresh).sum(axis=0)
    best = int(counts.argmax())
    return normals[best], float(offsets[best])


def refine_plane(pts: np.ndarray, normal: np.ndarray, offset: float, thresh: float, rounds: int = 3) -> tuple[np.ndarray, float, float]:
    rms = float("nan")
    for _ in range(rounds):
        inliers = pts[np.abs(pts @ normal + offset) < thresh]
        if len(inliers) < 3:
            break
        centroid = inliers.mean(axis=0)
        _, _, vt = np.linalg.svd(inliers - centroid, full_matrices=False)
        refined = vt[-1] if vt[-1] @ normal >= 0 else -vt[-1]
        normal, offset = refined, -float(refined @ centroid)
        rms = float(np.sqrt(np.mean((inliers @ normal + offset) ** 2)))
    return normal, offset, rms


def wall_footprint(pts: np.ndarray, normal: np.ndarray, cell: float = 0.05) -> tuple[float, float, float]:
    horizontal = np.cross(normal, UP)
    horizontal /= np.linalg.norm(horizontal)
    uv = np.column_stack([pts @ horizontal, pts @ UP])
    lo, hi = np.percentile(uv, [2, 98], axis=0)
    inside = np.all((uv >= lo) & (uv <= hi), axis=1)
    cells = np.unique(np.floor((uv[inside] - lo) / cell).astype(np.int64), axis=0)
    total = max(1, int(np.ceil((hi[0] - lo[0]) / cell)) * int(np.ceil((hi[1] - lo[1]) / cell)))
    return float(hi[0] - lo[0]), float(hi[1] - lo[1]), len(cells) / total


def outside_fraction(points: np.ndarray, normal: np.ndarray, offset: float, room_centre: np.ndarray, margin: float = 0.05) -> float:
    signed = points @ normal + offset
    inward = np.sign(room_centre @ normal + offset) or 1.0
    return float(np.mean(signed * inward < -margin))


def horizontal_peaks(y: np.ndarray, weight: np.ndarray) -> tuple[float, float]:
    hist, edges = np.histogram(y, bins=80, weights=weight)
    centres = (edges[:-1] + edges[1:]) / 2
    strong = hist > 0.25 * hist.max()
    lower_half = centres > np.median(y)
    floor_y = float(centres[strong & lower_half].max())
    ceiling_y = float(centres[strong & ~lower_half].min())
    return floor_y, ceiling_y


def fit_structure(points: np.ndarray, weight: np.ndarray | None = None, frame: dict[str, Any] | None = None) -> dict[str, Any]:
    """Floor, ceiling and wall planes plus the metric scale.

    `frame` is the calibration of an input that was registered into an already calibrated
    frame (see _analysis/align_to_ply_raw.py): its ceiling height seeds the ceiling fit and its
    metres_per_unit is kept, because a reconstruction that barely saw the ceiling cannot
    re-derive either.
    """
    weight = np.ones(len(points)) if weight is None else weight
    floor_seed, ceiling_seed = horizontal_peaks(points[:, 1], weight)
    if frame is not None:
        ceiling_seed = float(frame["ceiling_y"])
    structure = np.zeros(len(points), dtype=bool)
    planes: list[dict[str, Any]] = []

    for index, (label, seed_y) in enumerate((("floor", floor_seed), ("ceiling", ceiling_seed))):
        region = np.abs(points[:, 1] - seed_y) < 0.15
        source = "ransac"
        try:
            normal, offset = ransac_plane(points[region], 0.03, normal_hint=UP, hint_tol=0.95, seed=index)
            normal, offset, rms = refine_plane(points[region], normal, offset, 0.03)
            fitted_y = -offset / normal[1]
            if frame is not None and label == "ceiling" and (abs(fitted_y - seed_y) > 0.1 or (np.abs(points @ normal + offset) < 0.04).sum() < 0.005 * len(points)):
                raise ValueError("ceiling barely observed")
        except ValueError:
            if frame is None or label != "ceiling":
                raise
            normal, rms, source = UP.astype(float), float("nan"), "frame_calibration"
            offset = float(-(normal @ np.array([0.0, seed_y, 0.0])))
        mask = np.abs(points @ normal + offset) < 0.04
        if not np.isfinite(rms):
            rms = float(np.sqrt(np.mean((points[mask] @ normal + offset) ** 2))) if mask.any() else 0.0
        structure |= mask
        planes.append({"label": label, "normal": normal, "offset": offset, "mask": mask, "inliers": int(mask.sum()), "rms": rms, "fit": source})

    floor, ceiling = planes
    floor_y = -floor["offset"] / floor["normal"][1]
    ceiling_y = -ceiling["offset"] / ceiling["normal"][1]
    room_height = abs(floor_y - ceiling_y)

    interior = (points[:, 1] < floor_y - 0.05) & (points[:, 1] > ceiling_y + 0.05)
    room_centre = np.median(points[interior], axis=0)
    tried = np.zeros(len(points), dtype=bool)
    rejected: list[dict[str, Any]] = []
    wall_index = 0
    for k in range(12):
        rest_idx = np.flatnonzero(~structure & ~tried & interior)
        if len(rest_idx) < 500:
            break
        rest = points[rest_idx]
        try:
            normal, offset = ransac_plane(rest, 0.025, vertical=True, seed=10 + k)
        except ValueError:
            break
        normal, offset, rms = refine_plane(rest, normal, offset, 0.025)
        band = (np.abs(points @ normal + offset) < 0.03) & ~structure
        if band.sum() < 0.015 * len(points):
            break
        tried |= band
        width, height, fill = wall_footprint(points[band], normal)
        outside = outside_fraction(points, normal, offset, room_centre)
        candidate = {"normal": normal, "offset": offset, "inliers": int(band.sum()), "rms": rms, "span": [width, height], "fill": fill, "outside": outside}
        # Pipe rows and equipment fronts also form big vertical planes; a wall must be vertical,
        # on the room boundary (little geometry behind it) and mostly filled.
        if abs(float(normal @ UP)) > 0.05 or width < 1.0 or height < 0.5 * room_height or outside > 0.04 or fill < 0.2:
            rejected.append(candidate)
            continue
        planes.append({"label": f"wall{wall_index}", "mask": band, **candidate})
        structure |= band
        wall_index += 1

    prior_lo, prior_hi = ROOM_HEIGHT_PRIOR_M
    prior_mid = (prior_lo + prior_hi) / 2
    tilt_deg = float(np.degrees(np.arccos(min(1.0, abs(float(floor["normal"] @ ceiling["normal"]))))))
    scale = {
        "metres_per_unit": round(prior_mid / room_height, 4),
        "metres_per_unit_range": [round(prior_lo / room_height, 4), round(prior_hi / room_height, 4)],
        "floor_to_ceiling_units": round(float(room_height), 4),
        "room_height_prior_m": [prior_lo, prior_hi],
        "floor_ceiling_tilt_deg": round(tilt_deg, 2),
        "method": "floor_to_ceiling_prior",
        "reasoning": (
            f"Floor and ceiling RANSAC+SVD planes are {room_height:.3f} units apart (tilt {tilt_deg:.1f} deg). "
            f"A plant-room clear height of {prior_lo}-{prior_hi} m is assumed (midpoint {prior_mid} m), giving "
            f"{prior_lo / room_height:.3f}-{prior_hi / room_height:.3f} m/unit. The earlier 2.0 m door assumption gave 1.25 m/unit, "
            "which lies inside this range. Not calibrated against a measured reference."
        ),
    }
    if frame is not None:
        mpu = float(frame["metres_per_unit"])
        scale = {
            **scale,
            "metres_per_unit": mpu,
            "metres_per_unit_range": frame.get("metres_per_unit_range", [mpu, mpu]),
            "method": "inherited_frame_calibration",
            "ceiling_fit": planes[1]["fit"],
            "reasoning": (
                f"This splat was registered into the calibrated {frame.get('frame', 'ply_raw')} frame ({frame.get('source', 'alignment')}), "
                f"so it keeps that frame's {mpu} m/unit ({frame.get('reasoning', 'floor-to-ceiling prior')}). "
                f"Here the floor and ceiling planes are {room_height:.3f} units apart; ceiling fit: {planes[1]['fit']}."
            ),
        }
    return {
        "planes": planes,
        "rejected_walls": rejected,
        "structure": structure,
        "floor_y": float(floor_y),
        "ceiling_y": float(ceiling_y),
        "room_centre": room_centre,
        "scale": scale,
    }
