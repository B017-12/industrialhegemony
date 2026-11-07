from __future__ import annotations

from collections import Counter
from typing import Any

import numpy as np
from scipy.spatial import cKDTree

from .geometry import eigen_features, oriented_box
from .instances import Segment

CLASSES = ("pump", "motor", "valve", "tank", "cabinet", "pipe", "ladder", "crate", "trolley", "sign", "door", "other")
DISPLAY = {
    "pump": "Pump-like object",
    "motor": "Motor-like object",
    "valve": "Valve or inline fitting",
    "tank": "Tank or vessel",
    "cabinet": "Cabinet or panel",
    "pipe": "Pipe segment",
    "ladder": "Ladder-like object",
    "crate": "Crate or box",
    "trolley": "Trolley or cage",
    "sign": "Sign or label plate",
    "door": "Door",
    "other": "Unclassified object",
}


def _tubular_fraction(pts: np.ndarray, k: int = 10, threshold: float = 0.8) -> float:
    """Share of voxels whose local neighbourhood is a thin line: high for rails, loops and wire frames, low for solid bodies."""
    if len(pts) <= k:
        return 0.0
    _, idx = cKDTree(pts).query(pts, k=k)
    nbr = pts[idx] - pts[idx].mean(axis=1, keepdims=True)
    ev = np.linalg.eigvalsh(np.einsum("nki,nkj->nij", nbr, nbr) / k)[:, ::-1]
    linearity = (ev[:, 0] - ev[:, 1]) / np.maximum(ev[:, 0], 1e-12)
    return float(np.mean(linearity > threshold))


def describe(seg: Segment, voxels: Any, structure: dict[str, Any], mpu: float) -> dict[str, Any]:
    pts = voxels.xyz[seg.members]
    obb = oriented_box(pts)
    lo, hi = np.percentile(pts, [2, 98], axis=0)
    floor_y = structure["floor_y"]
    ext = obb["extent"]
    horizontal = sorted([float(ext[0]), float(ext[2])], reverse=True)
    lab = np.average(voxels.lab[seg.members], axis=0, weights=voxels.weight[seg.members])
    chroma = float(np.hypot(lab[1], lab[2]))
    hue = float(np.degrees(np.arctan2(lab[2], lab[1])) % 360)
    vox_lab = voxels.lab[seg.members]
    vox_hue = np.degrees(np.arctan2(vox_lab[:, 2], vox_lab[:, 1])) % 360
    red_fraction = float(np.mean((np.hypot(vox_lab[:, 1], vox_lab[:, 2]) > 30) & ((vox_hue < 50) | (vox_hue > 330))))
    tubular_fraction = _tubular_fraction(pts)
    cells = np.unique(np.floor((pts @ obb["rotation"]) / 0.04).astype(np.int64), axis=0)
    fill = min(1.0, len(cells) / max(1.0, float(np.prod(np.maximum(ext, 0.04) / 0.04))))
    wall_gap = min(
        (abs(float(pts.mean(axis=0) @ p["normal"] + p["offset"])) - float(max(ext)) / 2 for p in structure["planes"] if p["label"].startswith("wall")),
        default=9.0,
    )
    return {
        "obb": obb,
        "aabb": (lo, hi),
        "voxels": int(len(seg.members)),
        "splats": int(voxels.count[seg.members].sum()),
        "weight": float(voxels.weight[seg.members].sum()),
        "density": float(voxels.weight[seg.members].mean()),
        "lab": lab,
        "chroma": chroma,
        "hue": hue,
        "red_fraction": red_fraction,
        "tubular_fraction": tubular_fraction,
        "eigen": eigen_features(pts),
        "fill": float(fill),
        "bottom_m": float(floor_y - hi[1]) * mpu,
        "top_m": float(floor_y - lo[1]) * mpu,
        "ceiling_gap": float(lo[1] - structure["ceiling_y"]),
        "wall_gap": float(wall_gap),
        "w_m": horizontal[0] * mpu,
        "d_m": horizontal[1] * mpu,
        "h_m": float(ext[1]) * mpu,
    }


def quality_filter(segments: list[Segment], descs: list[dict[str, Any]], points: np.ndarray) -> tuple[list[int], Counter]:
    trees = [cKDTree(points[s.members]) for s in segments]
    keep: list[int] = []
    dropped: Counter = Counter()
    for i, (seg, d) in enumerate(zip(segments, descs)):
        if d["voxels"] < 25 or d["splats"] < 60:
            dropped["too_few_splats"] += 1
            continue
        if seg.kind != "pipe_fit" and float(min(d["obb"]["extent"])) < 0.015:
            dropped["too_thin"] += 1
            continue
        if d["density"] < 0.45 and d["voxels"] < 60:
            dropped["low_density_haze"] += 1
            continue
        supported = d["bottom_m"] < 0.2 or d["wall_gap"] < 0.12 or d["ceiling_gap"] < 0.12
        if not supported:
            pts = points[seg.members]
            lo, hi = d["aabb"]
            for j, tree in enumerate(trees):
                if j == i:
                    continue
                olo, ohi = descs[j]["aabb"]
                if np.any(olo - 0.06 > hi) or np.any(lo - 0.06 > ohi):
                    continue
                if tree.query(pts, k=1, distance_upper_bound=0.06)[0].min() < 0.06:
                    supported = True
                    break
        if not supported:
            dropped["floating_unsupported"] += 1
            continue
        keep.append(i)
    return keep, dropped


def _near_pipe(i: int, descs: list[dict[str, Any]], pipe_ids: set[int], trees: list[cKDTree], points: np.ndarray, segments: list[Segment], gap: float) -> bool:
    lo, hi = descs[i]["aabb"]
    pts = points[segments[i].members]
    for j in pipe_ids:
        if j == i:
            continue
        olo, ohi = descs[j]["aabb"]
        if np.any(olo - gap > hi) or np.any(lo - gap > ohi):
            continue
        if trees[j].query(pts, k=1, distance_upper_bound=gap)[0].min() < gap:
            return True
    return False


def pipe_neighbours(segments: list[Segment], descs: list[dict[str, Any]], labels: list[tuple[str, float, str]], points: np.ndarray, gap: float = 0.06) -> list[list[int]]:
    pipes = {i for i, label in enumerate(labels) if label[0] == "pipe"}
    trees = {i: cKDTree(points[segments[i].members]) for i in pipes}
    out: list[list[int]] = []
    for i, d in enumerate(descs):
        lo, hi = d["aabb"]
        pts = points[segments[i].members]
        hits = []
        for j in sorted(pipes - {i}):
            olo, ohi = descs[j]["aabb"]
            if np.any(olo - gap > hi) or np.any(lo - gap > ohi):
                continue
            if trees[j].query(pts, k=1, distance_upper_bound=gap)[0].min() < gap:
                hits.append(j)
        out.append(hits)
    return out


def classify(segments: list[Segment], descs: list[dict[str, Any]], points: np.ndarray) -> list[tuple[str, float, str]]:
    """Rule-based labels from size (metres), shape, height above floor and Lab colour. Confidences are capped low on purpose."""
    pipe_like: set[int] = set()
    for i, (seg, d) in enumerate(zip(segments, descs)):
        cross = max(d["d_m"], min(d["w_m"], d["h_m"]))
        length = max(d["w_m"], d["h_m"])
        if seg.kind == "pipe_fit" or (d["eigen"]["linearity"] >= 0.85 and length >= 0.3 and cross <= 0.35 and length / max(cross, 0.02) >= 2.5):
            pipe_like.add(i)
    trees = [cKDTree(points[s.members]) for s in segments]

    labels: list[tuple[str, float, str]] = []
    for i, (seg, d) in enumerate(zip(segments, descs)):
        w, dd, h = d["w_m"], d["d_m"], d["h_m"]
        size = max(w, dd, h)
        on_floor = d["bottom_m"] < 0.25
        red = d["chroma"] > 25 and (d["hue"] < 50 or d["hue"] > 330)
        saturated = d["chroma"] > 20
        dark = d["lab"][0] < 30
        brown = 15 < d["chroma"] and 50 <= d["hue"] <= 95 and d["lab"][0] < 75
        neutral = d["chroma"] < 12
        planar = d["eigen"]["planarity"]
        linear = d["eigen"]["linearity"]
        solid = d["tubular_fraction"] < 0.4 and d["fill"] >= 0.15
        near_pipe = _near_pipe(i, descs, pipe_like, trees, points, segments, 0.06)

        if i in pipe_like:
            conf = 0.6 if seg.kind == "pipe_fit" else 0.5
            labels.append(("pipe", conf, "Pipe segment (cylinder fit)" if seg.kind == "pipe_fit" else "Pipe-like elongated cluster"))
        elif h >= 1.6 and 0.6 <= w <= 1.4 and dd <= 0.35 and on_floor and d["wall_gap"] < 0.2 and planar >= 0.4:
            labels.append(("door", 0.4, "Door-like tall flat panel at wall"))
        elif h >= 1.3 and 0.3 <= w <= 0.9 and d["fill"] < 0.12 and on_floor:
            labels.append(("ladder", 0.35, "Tall sparse frame (ladder-like)"))
        elif on_floor and 0.7 <= h <= 1.9 and 0.45 <= w <= 1.4 and d["fill"] < 0.25:
            labels.append(("trolley", 0.35, "Open frame on floor (trolley or cage)"))
        elif red and size >= 0.5 and h >= 0.4 and w <= 1.0 and dd / max(w, 1e-6) > 0.5:
            labels.append(("tank", 0.45, "Red vessel-like object (expansion vessel?)"))
        elif h >= 0.6 and 0.3 <= w <= 1.1 and dd / max(w, 1e-6) > 0.65 and d["bottom_m"] < 0.5 and d["fill"] >= 0.12:
            labels.append(("tank", 0.35, "Upright rounded vessel-like object"))
        elif near_pipe and size >= 0.8 and linear >= 0.55 and d["fill"] < 0.2:
            labels.append(("pipe", 0.3, "Pipe manifold or valve assembly"))
        elif near_pipe and 0.2 <= size <= 0.8 and linear < 0.8 and d["bottom_m"] < 2.0 and solid:
            labels.append(("pump", 0.45 if (saturated or dark) else 0.4, "Compact unit on pipework (pump-like)"))
        elif 0.25 <= size <= 0.8 and d["red_fraction"] >= 0.05 and d["lab"][0] < 50 and 0.2 <= d["bottom_m"] <= 1.5 and solid:
            labels.append(("pump", 0.4, "Compact dark unit with red head (inline pump-like)"))
        elif near_pipe and size < 0.3 and d["bottom_m"] > 0.1:
            labels.append(("valve", 0.4 if saturated else 0.35, "Small fitting on a pipe (valve-like)"))
        elif dd <= 0.08 and planar >= 0.6 and 0.12 <= w <= 0.8 and d["wall_gap"] < 0.15 and d["bottom_m"] > 0.6:
            labels.append(("sign", 0.35, "Thin plate on wall (sign-like)"))
        elif on_floor and 0.15 <= w <= 0.8 and h <= 0.7 and (brown or red) and d["fill"] >= 0.1:
            labels.append(("crate", 0.35, "Box on floor (crate or bin)"))
        elif 0.4 <= h <= 2.0 and 0.35 <= w <= 1.5 and (d["fill"] >= 0.15 or planar >= 0.5) and (neutral or d["lab"][0] > 70) and d["tubular_fraction"] < 0.4:
            labels.append(("cabinet", 0.35, "Boxy or flat neutral object (cabinet or panel)"))
        elif on_floor and 0.3 <= size <= 0.9 and saturated and h <= 0.9:
            labels.append(("motor", 0.25, "Compact coloured floor unit (motor-like)"))
        else:
            labels.append(("other", 0.2, DISPLAY["other"]))
    return labels
