"""Stage 3 — segment: split the cleaned splat cloud into objects and fit oriented 3D boxes.

Method (CPU, no learned model):
  1. drop the floor slab, the ceiling slab and wall planes (RANSAC on vertical planes)
  2. voxelise (VOXEL m), keep voxels with >= MIN_PTS_PER_VOXEL splats
  3. 26-connected components on the occupancy grid
  4. components that are too big (pipes and shelving bridge many objects) are split with a
     distance-transform watershed: markers = components of the eroded grid
  5. per object: oriented box (yaw from 2D PCA of the footprint, y kept vertical),
     robust extents (percentiles), colour and shape statistics

Output: data/derived/objects.json, renders/segments_*.png
"""

from __future__ import annotations

import argparse

import numpy as np
from scipy import ndimage
from scipy.cluster.vq import kmeans2
from skimage.segmentation import watershed

from pipeline.common import DERIVED, read_json, write_json
from pipeline import render

VOXEL = 0.04
MIN_PTS_PER_VOXEL = 2
FLOOR_CLEARANCE = 0.05
CEILING_CLEARANCE = 0.08
WALL_TOL = 0.04
WALL_MIN_FRAC = 0.012
FOOTPRINT_CELL = 0.05
FOOTPRINT_CLOSE_M = 0.3
FOOTPRINT_MARGIN_M = 0.15
BRIDGE_ITERS = 2  # dilation used only for connectivity (bridges sparse surfaces)
MIN_OBJECT_VOXELS = 60
SPLIT_MAX_EXTENT = 1.6  # m — larger components get watershed-split
SPLIT_MAX_VOXELS = 12_000
EROSION_ITERS = 2


def find_walls(xyz: np.ndarray, max_walls: int = 6, seed: int = 0) -> list[dict]:
    """Greedy RANSAC for large vertical planes (normal ⟂ y)."""
    rng = np.random.default_rng(seed)
    pts2 = xyz[:, [0, 2]]
    remaining = np.ones(len(xyz), dtype=bool)
    walls = []
    for _ in range(max_walls):
        idx = np.flatnonzero(remaining)
        sample = idx[rng.choice(len(idx), min(len(idx), 80_000), replace=False)]
        best = (0, None)
        for _ in range(400):
            a, b = pts2[rng.choice(sample, 2, replace=False)]
            d = b - a
            if np.linalg.norm(d) < 0.5:
                continue
            n = np.array([-d[1], d[0]]) / np.linalg.norm(d)
            inl = int((np.abs((pts2[sample] - a) @ n) < WALL_TOL).sum())
            if inl > best[0]:
                best = (inl, (n, a))
        if best[1] is None:
            break
        n, a = best[1]
        on_plane = remaining & (np.abs((pts2 - a) @ n) < WALL_TOL)
        frac = on_plane.sum() / len(xyz)
        if frac < WALL_MIN_FRAC:
            break
        # a wall must be on the room boundary: most other points on one side of it
        side = (pts2[remaining & ~on_plane] - a) @ n
        one_sided = max((side > 0).mean(), (side < 0).mean())
        if one_sided < 0.9:
            remaining &= ~on_plane  # big interior plane (e.g. shelving face): skip it, keep searching
            continue
        walls.append({"normal_xz": n.tolist(), "point_xz": a.tolist(), "frac": float(frac), "mask": on_plane})
        remaining &= ~on_plane
    return walls


def floor_footprint(xyz: np.ndarray, floor_y: float) -> tuple[np.ndarray, np.ndarray]:
    """2D occupancy of the scanned floor (closed, hole-filled, slightly dilated) -> (mask, origin_xz)."""
    slab = xyz[np.abs(xyz[:, 1] - floor_y) < 0.05][:, [0, 2]]
    origin = slab.min(axis=0) - 1.0
    ij = np.floor((slab - origin) / FOOTPRINT_CELL).astype(np.int32)
    grid = np.zeros(ij.max(axis=0) + 40, dtype=bool)
    grid[tuple(ij.T)] = True
    r = int(round(FOOTPRINT_CLOSE_M / FOOTPRINT_CELL))
    disk = _disk(r)
    grid = ndimage.binary_closing(grid, structure=disk)
    grid = ndimage.binary_fill_holes(grid)
    grid = ndimage.binary_opening(grid, structure=_disk(2))
    lab, n = ndimage.label(grid)
    if n > 1:
        grid = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
    grid = ndimage.binary_dilation(grid, structure=_disk(int(round(FOOTPRINT_MARGIN_M / FOOTPRINT_CELL))))
    return grid, origin


def in_footprint(xz: np.ndarray, grid: np.ndarray, origin: np.ndarray) -> np.ndarray:
    ij = np.floor((xz - origin) / FOOTPRINT_CELL).astype(np.int64)
    ok = (ij >= 0).all(axis=1) & (ij[:, 0] < grid.shape[0]) & (ij[:, 1] < grid.shape[1])
    out = np.zeros(len(xz), dtype=bool)
    out[ok] = grid[ij[ok, 0], ij[ok, 1]]
    return out


def _disk(r: int) -> np.ndarray:
    yy, xx = np.mgrid[-r : r + 1, -r : r + 1]
    return xx**2 + yy**2 <= r * r


def _too_big(mask: np.ndarray, voxel: float) -> bool:
    idx = np.argwhere(mask)
    ext = (idx.max(axis=0) - idx.min(axis=0) + 1) * voxel
    return max(ext[0], ext[2]) > SPLIT_MAX_EXTENT or mask.sum() > SPLIT_MAX_VOXELS


def _chunk_split(mask: np.ndarray, voxel: float) -> np.ndarray | None:
    """k-means on the footprint (x, z) into ~SPLIT_MAX_EXTENT-sized chunks, then connected components."""
    idx = np.argwhere(mask)
    ext = (idx.max(axis=0) - idx.min(axis=0) + 1) * voxel
    k = int(np.ceil(max(ext[0], ext[2]) / SPLIT_MAX_EXTENT)) * max(1, int(np.ceil(min(ext[0], ext[2]) / SPLIT_MAX_EXTENT)))
    k = max(2, min(k, 40))
    xz = idx[:, [0, 2]].astype(np.float64)
    rng = np.random.default_rng(0)
    _, assign = kmeans2(xz, k, minit="++", seed=rng)
    out = np.zeros(mask.shape, dtype=np.int32)
    next_lab = 1
    for c in range(k):
        chunk = np.zeros(mask.shape, dtype=bool)
        sel = idx[assign == c]
        if len(sel) == 0:
            continue
        chunk[tuple(sel.T)] = True
        cl, n = ndimage.label(chunk, structure=np.ones((3, 3, 3)))
        out[chunk] = cl[chunk] + next_lab - 1
        next_lab += n
    return out if next_lab > 2 else None


def _split_component(mask: np.ndarray, voxel: float, depth: int = 0) -> list[np.ndarray]:
    """Recursively watershed-split an oversized component into parts below the size limits.

    Erosion depth grows until the eroded mask breaks into >= 2 seeds; each part is re-checked.
    Returns boolean masks (same shape as `mask`).
    """
    if depth > 6 or not _too_big(mask, voxel):
        return [mask]
    dist = ndimage.distance_transform_edt(mask)
    markers = None
    for ero in range(EROSION_ITERS, EROSION_ITERS + 5):
        m, n = ndimage.label(ndimage.binary_erosion(mask, iterations=ero), structure=np.ones((3, 3, 3)))
        sizes = np.bincount(m.ravel())
        sizes[0] = 0
        if (sizes >= 8).sum() >= 2:
            m[np.isin(m, np.flatnonzero(sizes < 8))] = 0  # ignore crumbs as seeds
            markers = m
            break
    if markers is not None:
        labels = watershed(-dist, markers, mask=mask)
    else:
        labels = _chunk_split(mask, voxel)  # thin networks (pipe runs) erode away: cut spatially
        if labels is None:
            return [mask]
    parts = []
    for lab in np.unique(labels[labels > 0]):
        parts.extend(_split_component(labels == lab, voxel, depth + 1))
    return parts


def oriented_box(p: np.ndarray) -> dict:
    lo_y, hi_y = np.percentile(p[:, 1], [1, 99])
    xz = p[:, [0, 2]]
    c = xz.mean(axis=0)
    if len(xz) >= 3:
        cov = np.cov((xz - c).T)
        evals, evecs = np.linalg.eigh(cov)
        major = evecs[:, 1]
    else:
        major = np.array([1.0, 0.0])
    yaw = float(np.arctan2(major[1], major[0]))
    ca, sa = np.cos(yaw), np.sin(yaw)
    local = (xz - c) @ np.array([[ca, -sa], [sa, ca]])
    lo, hi = np.percentile(local, [1, 99], axis=0)
    mid_local = (lo + hi) / 2
    centre_xz = c + np.array([[ca, -sa], [sa, ca]]) @ mid_local
    return {
        "center": [float(centre_xz[0]), float((lo_y + hi_y) / 2), float(centre_xz[1])],
        "extents": [float(hi[0] - lo[0]), float(hi_y - lo_y), float(hi[1] - lo[1])],
        "yaw": yaw,
    }


def segment(voxel: float = VOXEL) -> dict:
    tf = read_json(DERIVED / "transform.json")
    data = np.load(DERIVED / "splats_clean.npz")
    xyz, rgb = data["xyz"], data["rgb"]
    floor_y, ceiling_y = tf["floor_y"], tf["ceiling_y"]

    footprint, fp_origin = floor_footprint(xyz, floor_y)
    keep = (xyz[:, 1] > floor_y + FLOOR_CLEARANCE) & (xyz[:, 1] < ceiling_y - CEILING_CLEARANCE)
    keep &= in_footprint(xyz[:, [0, 2]], footprint, fp_origin)
    walls = find_walls(xyz[keep])
    wall_mask = np.zeros(keep.sum(), dtype=bool)
    for w in walls:
        wall_mask |= w.pop("mask")
    obj_idx = np.flatnonzero(keep)[~wall_mask]
    pts, cols = xyz[obj_idx], rgb[obj_idx]

    origin = pts.min(axis=0)
    vox = np.floor((pts - origin) / voxel).astype(np.int32)
    shape = vox.max(axis=0) + 1
    counts = np.zeros(shape, dtype=np.int32)
    np.add.at(counts, tuple(vox.T), 1)
    occ = counts >= MIN_PTS_PER_VOXEL

    bridged = ndimage.binary_dilation(occ, iterations=BRIDGE_ITERS) if BRIDGE_ITERS else occ
    labels, n = ndimage.label(bridged, structure=np.ones((3, 3, 3)))
    sizes = np.bincount(labels.ravel(), weights=occ.ravel())  # occupied voxels per component
    slices = ndimage.find_objects(labels)
    final = np.zeros_like(labels)
    next_id = 1
    n_split = 0
    for lab, sl in enumerate(slices, start=1):
        if sl is None or sizes[lab] < MIN_OBJECT_VOXELS:
            continue
        comp = labels[sl] == lab  # dense (bridged) mask: watershed needs connected support
        parts = _split_component(comp, voxel)
        n_split += len(parts) > 1
        for part in parts:
            m = part & occ[sl]  # back to real occupied voxels
            if m.sum() < MIN_OBJECT_VOXELS:
                continue
            final[sl][m] = next_id
            next_id += 1

    point_label = np.zeros(len(pts), dtype=np.int32)
    inside = occ[tuple(vox.T)]
    point_label[inside] = final[tuple(vox[inside].T)]

    objects = []
    for lab in range(1, next_id):
        sel = point_label == lab
        if sel.sum() < 30:
            continue
        p = pts[sel]
        box = oriented_box(p)
        ex = box["extents"]
        mean_rgb = cols[sel].mean(axis=0)
        objects.append({
            "object_id": f"OBJ-{len(objects) + 1:03d}",
            **box,
            "n_points": int(sel.sum()),
            "mean_rgb": mean_rgb.round(3).tolist(),
            "height_above_floor": [round(float(box["center"][1] - ex[1] / 2 - floor_y), 3),
                                   round(float(box["center"][1] + ex[1] / 2 - floor_y), 3)],
            "touches_floor": bool(box["center"][1] - ex[1] / 2 - floor_y < 0.15),
            "elongation": float(max(ex) / max(1e-3, sorted(ex)[1])),
            "_label": lab,
        })

    # debug renders with each object in a random colour
    rng = np.random.default_rng(1)
    palette = rng.uniform(0.25, 1.0, size=(next_id + 1, 3)).astype(np.float32)
    seg_rgb = np.full_like(cols, 0.18)
    seg_rgb[point_label > 0] = palette[point_label[point_label > 0]]
    fx0, fx1, fz0, fz1 = tf["floor_extent_xz"]
    render.save(render.render_top(pts, seg_rgb, (fx0 - 0.3, fx1 + 0.3, fz0 - 0.3, fz1 + 0.3)),
                DERIVED / "renders" / "segments_top.png")
    centre = np.array([(fx0 + fx1) / 2, floor_y + 0.8, (fz0 + fz1) / 2])
    for name, (cx, cz) in {"se": (fx1 - 0.4, fz1 - 0.4), "nw": (fx0 + 0.4, fz0 + 0.4)}.items():
        img = render.render_perspective(pts, seg_rgb, eye=(cx, floor_y + 1.6, cz), target=centre)
        render.save(img, DERIVED / "renders" / f"segments_{name}.png")

    for o in objects:
        o.pop("_label")
    result = {
        "params": {"voxel": voxel, "min_pts_per_voxel": MIN_PTS_PER_VOXEL, "min_object_voxels": MIN_OBJECT_VOXELS,
                   "split_max_extent": SPLIT_MAX_EXTENT, "erosion_iters": EROSION_ITERS},
        "walls": walls,
        "footprint_area_m2": float(footprint.sum() * FOOTPRINT_CELL**2),
        "points_in_scope": int(len(pts)),
        "n_components": int(n),
        "n_split": n_split,
        "points_assigned_frac": float((point_label > 0).mean()),
        "objects": objects,
    }
    write_json(DERIVED / "objects.json", result)
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--voxel", type=float, default=VOXEL)
    args = ap.parse_args()
    r = segment(args.voxel)
    ex = np.array([o["extents"] for o in r["objects"]])
    print(f"segment: {len(r['objects'])} objects from {r['n_components']} components "
          f"({r['n_split']} split), walls={len(r['walls'])}, assigned={r['points_assigned_frac']:.2f}")
    if len(ex):
        print(f"  extents median={np.median(ex, axis=0).round(2)} max={ex.max(axis=0).round(2)}")


if __name__ == "__main__":
    main()
