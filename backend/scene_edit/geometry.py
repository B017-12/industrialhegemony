"""Object boxes and splat points in both frames. scene_objects.json OBBs are in ply_raw (y down);
splats_clean.npz and the rails grid are in the pipeline world frame = (x, -y, -z) of ply_raw, PLY units."""

from __future__ import annotations

import copy

import numpy as np

D = np.diag([1.0, -1.0, -1.0])
MPU = 1.2374  # metres per PLY unit (Ahmad's floor-to-ceiling calibration, +-4 %)
FLOOR_SKIP = 0.04  # points this close to the floor belong to the floor slab, never to a movable object


def ry(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


def world_box(obj: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(centre_w, R_w with box axes as columns, extent) of a ply_raw OBB."""
    obb = obj["obb"]
    return D @ np.array(obb["center"]), D @ np.array(obb["rotation"]), np.array(obb["extent"])


def inside(xyz_w: np.ndarray, obj: dict, margin: float = 0.01) -> np.ndarray:
    if obj.get("parts"):  # movable made of several boxes (objects that touch a neighbour)
        out = np.zeros(len(xyz_w), dtype=bool)
        for part in obj["parts"]:
            out |= inside(xyz_w, {"obb": part}, margin)
        return out
    c, R, e = world_box(obj)
    local = (xyz_w - c) @ R
    return (np.abs(local) <= e / 2 + margin).all(axis=1)


def moved_obj(obj: dict, translate_w: np.ndarray, yaw_rad: float, pivot_w: np.ndarray | None = None) -> dict:
    """Copy of the object with its OBB moved (world translation, yaw about world +y through `pivot_w`,
    default the box centre)."""
    c, R_w, e = world_box(obj)
    pivot = c if pivot_w is None else np.asarray(pivot_w, dtype=float)
    c2 = pivot + ry(yaw_rad) @ (c - pivot) + translate_w
    R2_w = ry(yaw_rad) @ R_w
    o = copy.deepcopy(obj)
    rot_raw = D @ R2_w
    centre_raw = D @ c2
    corners = np.array([[sx, sy, sz] for sx in (-.5, .5) for sy in (-.5, .5) for sz in (-.5, .5)]) * e
    pts = centre_raw + corners @ rot_raw.T
    o["obb"] = {**obj["obb"], "center": [round(float(v), 5) for v in centre_raw],
                "rotation": [[round(float(v), 6) for v in row] for row in rot_raw]}
    o["center"] = o["obb"]["center"]
    o["aabb_min"] = [round(float(v), 5) for v in pts.min(axis=0)]
    o["aabb_max"] = [round(float(v), 5) for v in pts.max(axis=0)]
    if obj.get("parts"):
        o["parts"] = [moved_obj({"obb": part}, translate_w, yaw_rad, pivot)["obb"] for part in obj["parts"]]
    return o


def _aabb_obb(lo: np.ndarray, hi: np.ndarray) -> dict:
    c_raw = D @ ((lo + hi) / 2)
    return {"center": [round(float(v), 5) for v in c_raw], "extent": [round(float(v), 5) for v in hi - lo],
            "rotation": D.tolist()}


def box_from_world_aabb(object_id: str, lo_w: list[float], hi_w: list[float],
                        parts_w: list[tuple[list[float], list[float]]] | None = None, **extra) -> dict:
    """Synthetic scene object (ply_raw OBB, like scene_objects.json) for a world-frame axis-aligned volume.
    With parts_w, the volume is the union of those boxes and the obb is their bounding box."""
    lo, hi = np.array(lo_w, dtype=float), np.array(hi_w, dtype=float)
    obj = {"object_id": object_id, **extra, "obb": _aabb_obb(lo, hi)}
    if parts_w:
        obj["parts"] = [_aabb_obb(np.array(a, dtype=float), np.array(b, dtype=float)) for a, b in parts_w]
    return obj


def transform_points(xyz_w: np.ndarray, obj: dict, translate_w: np.ndarray, yaw_rad: float) -> np.ndarray:
    c, _, _ = world_box(obj)
    return c + (xyz_w - c) @ ry(yaw_rad).T + translate_w


def footprint_distance(xz: np.ndarray, obj: dict) -> np.ndarray:
    """Distance (PLY units) from floor points (n,2) to the object's footprint (box projected onto the floor)."""
    c, R, e = world_box(obj)
    corners = np.array([[sx, sy, sz] for sx in (-.5, .5) for sy in (-.5, .5) for sz in (-.5, .5)]) * e
    pts = (c + corners @ R.T)[:, [0, 2]]
    # footprint = convex hull of projected corners; approximate by its oriented rectangle (PCA on 8 corners)
    mu = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - mu)
    local = (pts - mu) @ vt.T
    half = (local.max(axis=0) - local.min(axis=0)) / 2
    mid = (local.max(axis=0) + local.min(axis=0)) / 2
    q = np.abs((xz - mu) @ vt.T - mid) - half
    return np.linalg.norm(np.maximum(q, 0), axis=1)
