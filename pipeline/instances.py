from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.spatial import cKDTree
from sklearn.cluster import DBSCAN, HDBSCAN

from .geometry import fit_cylinder

AXES = np.eye(3)


@dataclass
class Segment:
    members: np.ndarray
    kind: str
    cylinder: dict[str, Any] | None = None
    merged_from: int = 1
    notes: list[str] = field(default_factory=list)


def candidate_mask(points: np.ndarray, structure: dict[str, Any], margin: float = 0.03, outside_margin: float = 0.15) -> np.ndarray:
    floor_y, ceiling_y = structure["floor_y"], structure["ceiling_y"]
    mask = ~structure["structure"] & (points[:, 1] < floor_y - margin) & (points[:, 1] > ceiling_y + margin)
    centre = structure["room_centre"]
    for plane in structure["planes"]:
        if not plane["label"].startswith("wall"):
            continue
        normal, offset = plane["normal"], plane["offset"]
        inward = np.sign(centre @ normal + offset) or 1.0
        mask &= (points @ normal + offset) * inward > -outside_margin
    return mask


def local_features(points: np.ndarray, k: int = 24, radius: float = 0.1) -> dict[str, np.ndarray]:
    dist, idx = cKDTree(points).query(points, k=min(k, len(points)))
    valid = dist <= radius
    w = valid[..., None].astype(float)
    n = np.maximum(valid.sum(axis=1), 1)[:, None]
    nbr = points[idx]
    mean = (nbr * w).sum(axis=1) / n
    d = (nbr - mean[:, None]) * w
    cov = np.einsum("nki,nkj->nij", d, d) / n[..., None]
    ev, evec = np.linalg.eigh(cov)
    ev = ev[:, ::-1]
    l1 = np.maximum(ev[:, 0], 1e-12)
    return {
        "linearity": (ev[:, 0] - ev[:, 1]) / l1,
        "planarity": (ev[:, 1] - ev[:, 2]) / l1,
        "scattering": ev[:, 2] / l1,
        "direction": evec[:, :, 2],
        "neighbours": n[:, 0],
    }


def extract_pipe_seeds(
    points: np.ndarray,
    feats: dict[str, np.ndarray],
    min_linearity: float = 0.75,
    min_alignment: float = 0.92,
    min_length: float = 0.3,
    min_aspect: float = 4.0,
) -> list[Segment]:
    align = np.abs(feats["direction"] @ AXES.T)
    axis = align.argmax(axis=1)
    linear = (feats["linearity"] > min_linearity) & (align.max(axis=1) > min_alignment) & (feats["neighbours"] >= 8)
    segments: list[Segment] = []
    for a in range(3):
        sel = np.flatnonzero(linear & (axis == a))
        if len(sel) < 20:
            continue
        stretched = points[sel].copy()
        stretched[:, a] /= 3.0
        labels = DBSCAN(eps=0.03, min_samples=5).fit_predict(stretched)
        for cid in np.unique(labels[labels >= 0]):
            members = sel[labels == cid]
            if len(members) < 25:
                continue
            cyl = fit_cylinder(points[members])
            if cyl["length"] < min_length or cyl["length"] / max(2 * cyl["radius"], 0.02) < min_aspect:
                continue
            segments.append(Segment(members, "pipe_fit", cyl))
    return segments


def hdbscan_clusters(
    points: np.ndarray,
    lab: np.ndarray,
    indices: np.ndarray,
    colour_weight: float = 0.0015,
    min_cluster_size: int = 30,
    min_samples: int = 8,
    max_cluster_size: int | None = 3000,
    method: str = "eom",
) -> list[Segment]:
    if len(indices) < min_cluster_size:
        return []
    feats = np.column_stack([points[indices], colour_weight * 0.5 * lab[indices, :1], colour_weight * lab[indices, 1:]])
    labels = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        max_cluster_size=max_cluster_size,
        cluster_selection_method=method,
        n_jobs=-1,
    ).fit_predict(feats)
    return [Segment(indices[labels == cid], "auto_hdbscan") for cid in np.unique(labels[labels >= 0])]


def _aabb(points: np.ndarray, members: np.ndarray, pad: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    lo, hi = np.percentile(points[members], [2, 98], axis=0)
    return lo - pad, hi + pad


def _gap(trees: dict[int, cKDTree], points: np.ndarray, a: Segment, b: Segment, ia: int, ib: int) -> float:
    small, big, i_big = (a, b, ib) if len(a.members) <= len(b.members) else (b, a, ia)
    return float(trees[i_big].query(points[small.members], k=1)[0].min())


def absorb_edge_segments(points: np.ndarray, pipes: list[Segment], clusters: list[Segment], gap: float = 0.04) -> tuple[list[Segment], int]:
    """A 'pipe' lying inside an object's box is that object's straight edge (cage posts, frames)."""
    boxes = [_aabb(points, c.members, 0.06) for c in clusters]
    trees = {i: cKDTree(points[c.members]) for i, c in enumerate(clusters)}
    kept: list[Segment] = []
    absorbed = 0
    for pipe in pipes:
        pts = points[pipe.members]
        best = None
        for i, (lo, hi) in enumerate(boxes):
            inside = np.mean(np.all((pts >= lo) & (pts <= hi), axis=1))
            if inside < 0.9:
                continue
            d = float(trees[i].query(pts, k=1)[0].min())
            if d < gap and (best is None or d < best[1]):
                best = (i, d)
        if best is None:
            kept.append(pipe)
            continue
        target = clusters[best[0]]
        target.members = np.concatenate([target.members, pipe.members])
        target.notes.append("absorbed_edge")
        absorbed += 1
    return kept, absorbed


def split_oversized(
    points: np.ndarray,
    lab: np.ndarray,
    clusters: list[Segment],
    max_extent: float = 1.6,
    min_fill: float = 0.08,
) -> tuple[list[Segment], int]:
    out: list[Segment] = []
    splits = 0
    for seg in clusters:
        lo, hi = _aabb(points, seg.members)
        extent = hi - lo
        cells = np.unique(np.floor(points[seg.members] / 0.05).astype(np.int64), axis=0)
        fill = len(cells) / max(1.0, float(np.prod(np.maximum(extent, 0.05) / 0.05)))
        if extent.max() <= max_extent and not (extent.max() > 0.9 and fill < min_fill):
            out.append(seg)
            continue
        children = hdbscan_clusters(points, lab, seg.members, min_cluster_size=25, min_samples=6, max_cluster_size=None, method="leaf")
        if len(children) < 2:
            out.append(seg)
            continue
        for child in children:
            child.notes.append("split")
        out.extend(children)
        splits += 1
    return out, splits


def merge_fragments(
    points: np.ndarray,
    lab: np.ndarray,
    clusters: list[Segment],
    gap: float,
    max_delta_e: float = 15.0,
    max_extent: float = 1.2,
    fragment_size: int = 150,
) -> tuple[list[Segment], int]:
    trees = {i: cKDTree(points[c.members]) for i, c in enumerate(clusters)}
    boxes = [_aabb(points, c.members) for c in clusters]
    colours = [lab[c.members].mean(axis=0) for c in clusters]
    pairs: list[tuple[float, int, int]] = []
    for i in range(len(clusters)):
        for j in range(i + 1, len(clusters)):
            if min(len(clusters[i].members), len(clusters[j].members)) > fragment_size:
                continue
            if np.any(boxes[i][0] - gap > boxes[j][1]) or np.any(boxes[j][0] - gap > boxes[i][1]):
                continue
            if np.linalg.norm(colours[i] - colours[j]) > max_delta_e:
                continue
            d = _gap(trees, points, clusters[i], clusters[j], i, j)
            if d < gap:
                pairs.append((d, i, j))

    parent = list(range(len(clusters)))
    lo = [b[0].copy() for b in boxes]
    hi = [b[1].copy() for b in boxes]

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    merges = 0
    for _, i, j in sorted(pairs):
        ri, rj = find(i), find(j)
        if ri == rj:
            continue
        new_lo, new_hi = np.minimum(lo[ri], lo[rj]), np.maximum(hi[ri], hi[rj])
        if (new_hi - new_lo).max() > max_extent:
            continue
        parent[rj] = ri
        lo[ri], hi[ri] = new_lo, new_hi
        merges += 1

    groups: dict[int, list[int]] = {}
    for i in range(len(clusters)):
        groups.setdefault(find(i), []).append(i)
    merged: list[Segment] = []
    for members in groups.values():
        seg = Segment(
            np.concatenate([clusters[i].members for i in members]),
            "auto_hdbscan",
            merged_from=sum(clusters[i].merged_from for i in members),
        )
        seg.notes = sorted({n for i in members for n in clusters[i].notes} | ({"merged"} if len(members) > 1 else set()))
        merged.append(seg)
    return merged, merges


def dbscan_baseline(points: np.ndarray, indices: np.ndarray, eps: float = 0.045, min_samples: int = 12) -> np.ndarray:
    return DBSCAN(eps=eps, min_samples=min_samples).fit_predict(points[indices])


def clustering_report(points: np.ndarray, labels: np.ndarray, sample: int = 5000, seed: int = 0) -> dict[str, Any]:
    from sklearn.metrics import silhouette_score

    ids, counts = np.unique(labels[labels >= 0], return_counts=True)
    keep = np.isin(labels, ids[counts >= 25])
    extents = [float(np.ptp(np.percentile(points[labels == cid], [2, 98], axis=0), axis=0).max()) for cid in ids[counts >= 25]]
    report = {
        "clusters_ge25": int((counts >= 25).sum()),
        "noise_fraction": round(float(np.mean(labels < 0)), 4),
        "median_voxels": float(np.median(counts[counts >= 25])) if keep.any() else 0.0,
        "largest_cluster_voxels": int(counts.max()) if len(counts) else 0,
        "clusters_over_1p5_units": int(sum(e > 1.5 for e in extents)),
    }
    if keep.sum() > 50 and len(ids) > 1:
        report["silhouette_sample"] = round(float(silhouette_score(points[keep], labels[keep], sample_size=min(sample, int(keep.sum())), random_state=seed)), 4)
    return report


def extract_instances(points: np.ndarray, lab: np.ndarray, structure: dict[str, Any], metres_per_unit: float) -> dict[str, Any]:
    cand = candidate_mask(points, structure)
    idx = np.flatnonzero(cand)
    p, c = points[idx], lab[idx]
    feats = local_features(p)

    pipes = extract_pipe_seeds(p, feats)
    in_pipe = np.zeros(len(p), dtype=bool)
    for seg in pipes:
        in_pipe[seg.members] = True
    clusters = hdbscan_clusters(p, c, np.flatnonzero(~in_pipe))
    stats: dict[str, Any] = {"candidate_voxels": int(len(p)), "pipe_seed_segments": len(pipes), "hdbscan_clusters": len(clusters)}

    pipes, absorbed = absorb_edge_segments(p, pipes, clusters)
    clusters, splits = split_oversized(p, c, clusters)
    clusters, merges = merge_fragments(p, c, clusters, gap=0.05 / metres_per_unit)
    # Multi-coloured devices (red pump head on a dark body) fail the colour test; allow it when the result stays device-sized.
    clusters, assembly_merges = merge_fragments(p, c, clusters, gap=0.08 / metres_per_unit, max_delta_e=float("inf"), max_extent=0.7 / metres_per_unit, fragment_size=400)
    stats.update({"pipe_edges_absorbed": absorbed, "oversized_split": splits, "fragments_merged": merges, "assembly_merges": assembly_merges})

    final = np.full(len(p), -1)
    for k, seg in enumerate(pipes + clusters):
        final[seg.members] = k
    stats["noise_fraction"] = round(float(np.mean(final < 0)), 4)
    stats["comparison"] = {
        "dbscan_eps0.045_ms12": clustering_report(p, dbscan_baseline(p, np.arange(len(p)))),
        "pipes_then_hdbscan_merge_split": clustering_report(p, final),
    }

    for seg in pipes + clusters:
        seg.members = idx[seg.members]
    return {"segments": pipes + clusters, "candidate_indices": idx, "stats": stats}
