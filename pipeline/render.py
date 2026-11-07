"""Tiny CPU point renderer (numpy z-buffer) for sanity views and cluster thumbnails."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


def look_at(eye, target, up=(0.0, 1.0, 0.0)) -> np.ndarray:
    """World-to-camera rotation rows (right, up, forward) for a camera at eye looking at target."""
    eye, target, up = (np.asarray(v, dtype=np.float64) for v in (eye, target, up))
    fwd = target - eye
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, up)
    right /= np.linalg.norm(right)
    cam_up = np.cross(right, fwd)
    return np.stack([right, cam_up, fwd])


def render_perspective(
    xyz: np.ndarray,
    rgb: np.ndarray,
    eye,
    target,
    width: int = 960,
    height: int = 540,
    fov_deg: float = 70.0,
    point_px: int = 2,
    background=(18, 18, 22),
) -> Image.Image:
    rot = look_at(eye, target)
    cam = (xyz - np.asarray(eye)) @ rot.T
    depth = cam[:, 2]
    front = depth > 0.05
    cam, depth, colors = cam[front], depth[front], rgb[front]
    f = 0.5 * width / np.tan(np.radians(fov_deg) / 2)
    u = (f * cam[:, 0] / depth + width / 2).astype(np.int64)
    v = (height / 2 - f * cam[:, 1] / depth).astype(np.int64)
    return _rasterise(u, v, depth, colors, width, height, point_px, background)


def render_top(
    xyz: np.ndarray,
    rgb: np.ndarray,
    bounds_xz: tuple[float, float, float, float],
    px_per_m: float = 80.0,
    background=(18, 18, 22),
) -> Image.Image:
    """Orthographic top-down view (looking down -y); highest point wins. Image right = +x, image up = -z."""
    x0, x1, z0, z1 = bounds_xz
    width, height = int((x1 - x0) * px_per_m), int((z1 - z0) * px_per_m)
    u = ((xyz[:, 0] - x0) * px_per_m).astype(np.int64)
    v = ((xyz[:, 2] - z0) * px_per_m).astype(np.int64)
    return _rasterise(u, v, -xyz[:, 1], rgb, width, height, 1, background)


def _rasterise(u, v, depth, colors, width, height, point_px, background) -> Image.Image:
    img = np.empty((height, width, 3), dtype=np.uint8)
    img[:] = background
    zbuf = np.full((height, width), np.inf)
    for dy in range(point_px):
        for dx in range(point_px):
            uu, vv = u + dx, v + dy
            ok = (uu >= 0) & (uu < width) & (vv >= 0) & (vv < height)
            pix = vv[ok] * width + uu[ok]
            d = depth[ok]
            order = np.lexsort((d, pix))
            pix, first = np.unique(pix[order], return_index=True)
            d_best = d[order][first]
            c_best = colors[ok][order][first]
            flat_z = zbuf.reshape(-1)
            closer = d_best < flat_z[pix]
            flat_z[pix[closer]] = d_best[closer]
            img.reshape(-1, 3)[pix[closer]] = (c_best[closer] * 255).astype(np.uint8)
    return Image.fromarray(img)


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
