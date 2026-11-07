from __future__ import annotations

from typing import Any

import numpy as np
from scipy.spatial import ConvexHull, QhullError


def yaw_rotation(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, 0.0, -s], [0.0, 1.0, 0.0], [s, 0.0, c]])


def min_area_yaw(xz: np.ndarray) -> float:
    """Yaw of the minimum-area enclosing rectangle of the x-z hull (rotating calipers)."""
    if len(xz) < 4:
        return 0.0
    try:
        hull = xz[ConvexHull(xz).vertices]
    except QhullError:
        return 0.0
    edges = np.roll(hull, -1, axis=0) - hull
    angles = np.unique(np.mod(np.arctan2(edges[:, 1], edges[:, 0]), np.pi / 2))
    c, s = np.cos(angles), np.sin(angles)
    u = hull[:, 0, None] * c + hull[:, 1, None] * s
    v = -hull[:, 0, None] * s + hull[:, 1, None] * c
    areas = np.ptp(u, axis=0) * np.ptp(v, axis=0)
    theta = float(angles[int(areas.argmin())])
    return theta - np.pi / 2 if theta > np.pi / 4 else theta


def oriented_box(pts: np.ndarray, lo_pct: float = 1.0, hi_pct: float = 99.0) -> dict[str, Any]:
    """Gravity-aligned (yaw-only) OBB. World point = center + R @ (local * extent), local in [-0.5, 0.5]^3."""
    lo_xz, hi_xz = np.percentile(pts[:, [0, 2]], [lo_pct, hi_pct], axis=0)
    trimmed = pts[np.all((pts[:, [0, 2]] >= lo_xz) & (pts[:, [0, 2]] <= hi_xz), axis=1)]
    if len(trimmed) < 4:
        trimmed = pts
    theta = min_area_yaw(trimmed[:, [0, 2]])
    rotation = yaw_rotation(theta)
    local = pts @ rotation
    lo, hi = np.percentile(local, [lo_pct, hi_pct], axis=0)
    extent = np.maximum(hi - lo, 1e-3)
    center = rotation @ ((lo + hi) / 2)
    return {"center": center, "extent": extent, "rotation": rotation, "yaw": theta}


def obb_corners_xz(obb: dict[str, Any]) -> np.ndarray:
    hx, hz = obb["extent"][0] / 2, obb["extent"][2] / 2
    local = np.array([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]])
    r = obb["rotation"]
    axes = np.array([[r[0][0], r[2][0]], [r[0][2], r[2][2]]])
    return np.asarray(obb["center"])[[0, 2]] + local @ axes


def _clip(subject: np.ndarray, clip: np.ndarray) -> np.ndarray:
    output = subject
    for i in range(len(clip)):
        if not len(output):
            break
        a, b = clip[i], clip[(i + 1) % len(clip)]
        edge = b - a
        inside = lambda p: edge[0] * (p[1] - a[1]) - edge[1] * (p[0] - a[0]) >= 0
        points, output = output, []
        for j in range(len(points)):
            cur, prev = points[j], points[j - 1]
            if inside(cur):
                if not inside(prev):
                    output.append(_intersect(prev, cur, a, b))
                output.append(cur)
            elif inside(prev):
                output.append(_intersect(prev, cur, a, b))
        output = np.asarray(output)
    return np.asarray(output)


def _intersect(p1: np.ndarray, p2: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    d1, d2 = p2 - p1, b - a
    denom = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(denom) < 1e-12:
        return p2
    t = ((a[0] - p1[0]) * d2[1] - (a[1] - p1[1]) * d2[0]) / denom
    return p1 + t * d1


def _ccw(poly: np.ndarray) -> np.ndarray:
    area = np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1])
    return poly if area > 0 else poly[::-1]


def polygon_area(poly: np.ndarray) -> float:
    if len(poly) < 3:
        return 0.0
    return 0.5 * abs(float(np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1])))


def obb_iou(a: dict[str, Any], b: dict[str, Any]) -> float:
    ya = (a["center"][1] - a["extent"][1] / 2, a["center"][1] + a["extent"][1] / 2)
    yb = (b["center"][1] - b["extent"][1] / 2, b["center"][1] + b["extent"][1] / 2)
    dy = min(ya[1], yb[1]) - max(ya[0], yb[0])
    if dy <= 0:
        return 0.0
    inter = polygon_area(_clip(_ccw(obb_corners_xz(a)), _ccw(obb_corners_xz(b)))) * dy
    vol_a = float(np.prod(a["extent"]))
    vol_b = float(np.prod(b["extent"]))
    return inter / max(vol_a + vol_b - inter, 1e-12)


def fit_cylinder(pts: np.ndarray) -> dict[str, Any]:
    """Axis from PCA, radius by least squares on radial distances."""
    centroid = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - centroid, full_matrices=False)
    direction = vt[0]
    rel = pts - centroid
    along = rel @ direction
    radial = np.linalg.norm(rel - np.outer(along, direction), axis=1)
    radius = float(radial.mean())
    lo, hi = np.percentile(along, [2, 98])
    return {
        "centre": centroid + direction * (lo + hi) / 2,
        "direction": direction,
        "radius": radius,
        "length": float(hi - lo),
        "rms": float(np.sqrt(np.mean((radial - radius) ** 2))),
    }


def eigen_features(pts: np.ndarray) -> dict[str, float]:
    if len(pts) < 4:
        return {"linearity": 0.0, "planarity": 0.0, "scattering": 0.0}
    ev = np.sort(np.linalg.eigvalsh(np.cov((pts - pts.mean(axis=0)).T)))[::-1]
    l1 = max(float(ev[0]), 1e-12)
    return {
        "linearity": float((ev[0] - ev[1]) / l1),
        "planarity": float((ev[1] - ev[2]) / l1),
        "scattering": float(ev[2] / l1),
    }
