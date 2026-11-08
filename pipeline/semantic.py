"""Multi-view fusion of 2D detections onto the 3D segments (step 2 of the vision labelling).

For every posed frame the voxel centres are projected with the COLMAP pose and the splat alignment, and a coarse
z-buffer keeps only the front surface (the OpenMask3D occlusion test, with the splat standing in for a depth image).
Each segment then collects class votes from the detection boxes that cover its visible voxels; votes are averaged
over the views that see it and weighted by a size and height prior per class. Segments that land in the same box
of the same class in at least two views are merged (view consensus, as in MaskClustering), and voxels that many
views put inside an equipment box but no segment owns become new objects.

    python3 -m pipeline.semantic --selftest
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from scipy import ndimage

from .instances import Segment

ROOT = Path(__file__).resolve().parents[1]
UNDIST = ROOT / "_analysis/sfm_full/undist"
DETECTIONS = Path("data/derived/vision/detections.json")
ALIGNMENT = Path("data/derived/splat_alignment.json")
EVIDENCE_DIR = Path("data/derived/vision/evidence")

ZBUF_DOWNSAMPLE = 8
DEPTH_TOL_M = 0.15
MIN_VISIBLE_VOXELS = 12
BACKGROUND = 0.15  # pseudo-vote per view in which the object is seen but no box claims it
MIN_SUPPORT_VIEWS = 2
MIN_POSTERIOR = 0.3
CLIP_AGREE = 0.3  # CLIP share for the phrase's class below which CLIP may veto the phrase
CLIP_VETO = 0.4  # share another specific class needs to veto; a vetoed phrase gets 0.2 of the vote instead of 0.5
CLIP_FRESH = 0.15  # share a detection's class needs before it can seed a new instance
SIBLINGS = {"pump": {"pump", "motor"}, "motor": {"pump", "motor"}}  # a circulator is both; CLIP splits them
# A vision "other" (chair, bucket, washing machine, ...) never replaces one of these geometry classes, and replaces
# any other geometry class only with support in OTHER_MIN_FRACTION of the views that see the object.
EQUIPMENT_CLASSES = {"pump", "motor", "valve", "gauge", "tank", "cabinet"}
OTHER_MIN_FRACTION = 0.3
MERGE_CLASSES = {"pump", "motor", "tank", "cabinet", "trolley", "ladder", "crate"}
NEW_INSTANCE_CLASSES = {"pump", "motor", "valve", "gauge", "tank"}

# (min, max) of the largest dimension in metres, and lowest plausible bottom height above floor.
SIZE_PRIOR: dict[str, tuple[float, float, float]] = {
    "pump": (0.15, 1.4, -0.1),
    "motor": (0.12, 1.1, -0.1),
    "valve": (0.04, 0.7, 0.0),
    "gauge": (0.03, 0.4, 0.3),
    "tank": (0.35, 3.0, -0.1),
    "cabinet": (0.25, 2.5, -0.1),
    "ladder": (0.9, 3.0, -0.1),
    "trolley": (0.35, 2.0, -0.1),
    "crate": (0.1, 1.4, -0.1),
    "pipe": (0.1, 9.0, -0.1),
    "other": (0.0, 9.0, -0.1),
}
DISPLAY = {
    "circulator pump": "Circulator pump",
    "water pump": "Pump",
    "electric motor": "Electric motor",
    "valve": "Valve",
    "valve handwheel": "Handwheel valve",
    "pressure gauge": "Pressure gauge",
    "expansion tank": "Expansion tank",
    "pressure vessel": "Pressure vessel",
    "electrical cabinet": "Electrical cabinet",
    "control panel": "Control panel",
    "ladder": "Ladder",
    "hand truck": "Hand truck",
    "cart": "Cart",
    "cardboard box": "Cardboard boxes",
    "plastic crate": "Plastic crates",
    "pipe": "Pipe",
    "chair": "Chair",
    "washing machine": "Washing machine",
    "sink": "Sink",
    "bucket": "Bucket",
    "vacuum cleaner": "Vacuum cleaner",
    "table": "Table",
}


@dataclass
class View:
    name: str
    K: np.ndarray  # fx, fy, cx, cy
    R: np.ndarray
    t: np.ndarray
    width: int
    height: int
    detections: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Frames:
    views: list[View]
    s: float
    R: np.ndarray
    t: np.ndarray

    def project(self, view: View, X_raw: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Pixels and depth (ply_raw units) of ply_raw points in `view`."""
        X_colmap = (X_raw - self.t) @ self.R / self.s
        xc = X_colmap @ view.R.T + view.t
        fx, fy, cx, cy = view.K
        z = xc[:, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            uv = np.column_stack([fx * xc[:, 0] / z + cx, fy * xc[:, 1] / z + cy])
        return uv, z * self.s


def load_frames(detections: Path, alignment: Path, undist: Path = UNDIST) -> Frames | None:
    if not detections.exists() or not alignment.exists() or not (undist / "sparse/0/images.bin").exists():
        return None
    sys.path.insert(0, str(ROOT / "_analysis"))
    from colmap_io import read_cameras, read_images  # noqa: PLC0415

    det = json.loads(detections.read_text(encoding="utf-8"))["frames"]
    al = json.loads(alignment.read_text(encoding="utf-8"))
    cams = read_cameras(undist / "sparse/0/cameras.bin")
    views = []
    for im in sorted(read_images(undist / "sparse/0/images.bin").values(), key=lambda im: im["name"]):
        if im["name"] not in det:
            continue
        cam = cams[im["camera_id"]]
        views.append(View(im["name"], np.asarray(cam["params"][:4], float), im["R"], im["t"], int(cam["width"]), int(cam["height"]),
                          det[im["name"]]["detections"]))
    return Frames(views, float(al["scale"]), np.array(al["rotation"]), np.array(al["translation"]))


def visible_mask(frames: Frames, view: View, xyz: np.ndarray, mpu: float) -> tuple[np.ndarray, np.ndarray]:
    """Front-surface voxels in `view` and their pixels. Hidden voxels are > DEPTH_TOL_M behind the z-buffer."""
    uv, z = frames.project(view, xyz)
    w, h = view.width, view.height
    inside = (z > 0.05) & (uv[:, 0] >= 0) & (uv[:, 0] < w) & (uv[:, 1] >= 0) & (uv[:, 1] < h)
    idx = np.nonzero(inside)[0]
    gw, gh = w // ZBUF_DOWNSAMPLE + 1, h // ZBUF_DOWNSAMPLE + 1
    cells = (uv[idx, 1] // ZBUF_DOWNSAMPLE).astype(int) * gw + (uv[idx, 0] // ZBUF_DOWNSAMPLE).astype(int)
    zbuf = np.full(gw * gh, np.inf)
    np.minimum.at(zbuf, cells, z[idx])
    # The splat is sparse on dark or thin surfaces; a 3x3 min keeps far voxels from leaking through holes.
    zbuf = ndimage.minimum_filter(zbuf.reshape(gh, gw), size=3, mode="nearest").ravel()
    tol = np.maximum(DEPTH_TOL_M / mpu, 0.05 * z[idx])
    vis = np.zeros(len(xyz), bool)
    vis[idx[z[idx] <= zbuf[cells] + tol]] = True
    return vis, uv


def class_dist(det: dict[str, Any]) -> dict[str, float]:
    """Detector class and CLIP re-score, half each; when CLIP gives the phrase's class little mass, CLIP dominates.

    Grounding DINO calls Grundfos circulators "vacuum cleaner" and pump-dispenser bottles "circulator pump"; the
    crop classifier disagrees in both cases.
    """
    clip = det.get("clip") or {}
    if not clip:
        return {det["class"]: 1.0}
    total = sum(clip.values()) or 1.0
    w_det = 0.2 if clip_vetoes(det) else 0.5
    dist = {det["class"]: w_det}
    for cls, p in clip.items():
        dist[cls] = dist.get(cls, 0.0) + (1.0 - w_det) * p / total
    return dist


def clip_share(det: dict[str, Any], cls: str) -> float:
    clip = det.get("clip") or {}
    total = sum(clip.values()) or 1.0
    return sum(clip.get(c, 0.0) for c in SIBLINGS.get(cls, {cls})) / total


def clip_vetoes(det: dict[str, Any]) -> bool:
    """CLIP prefers another specific class; its "other" absorbs most crops, so it is no evidence against a phrase."""
    clip = det.get("clip") or {}
    if not clip:
        return False
    top = max(clip, key=clip.get)
    return top != "other" and top not in SIBLINGS.get(det["class"], {det["class"]}) \
        and clip_share(det, top) >= CLIP_VETO and clip_share(det, det["class"]) < CLIP_AGREE


def prior(cls: str, size_m: float, bottom_m: float) -> float:
    lo, hi, min_bottom = SIZE_PRIOR.get(cls, (0.0, 9.0, -0.1))
    return 1.0 if lo <= size_m <= hi and bottom_m >= min_bottom else 0.25


def fuse(
    frames: Frames,
    xyz: np.ndarray,
    segments: list[Segment],
    descs: list[dict[str, Any]],
    mpu: float,
    structure_mask: np.ndarray | None = None,
) -> dict[str, Any]:
    """Per-segment class posteriors, merge groups and unexplained-equipment voxels from all views."""
    n_seg = len(segments)
    owner = np.full(len(xyz), -1)
    for i, seg in enumerate(segments):
        owner[seg.members] = i
    votes: list[dict[str, float]] = [{} for _ in range(n_seg)]
    phrase_votes: list[dict[str, float]] = [{} for _ in range(n_seg)]
    seen = np.zeros(n_seg, int)
    unmatched = np.zeros(n_seg, int)  # views that see the segment but in which no box claims it
    support: list[dict[str, int]] = [{} for _ in range(n_seg)]
    best_views: list[list[tuple[float, str, str, list[float]]]] = [[] for _ in range(n_seg)]
    shared: dict[tuple[str, int], list[tuple[int, str]]] = {}
    free = owner < 0 if structure_mask is None else (owner < 0) & ~structure_mask
    free_idx = np.nonzero(free)[0]
    free_seen = np.zeros(len(free_idx), int)
    free_hits = {c: np.zeros(len(free_idx), int) for c in NEW_INSTANCE_CLASSES}

    for view in frames.views:
        vis, uv = visible_mask(frames, view, xyz, mpu)
        vis_idx = np.nonzero(vis & (owner >= 0))[0]
        seg_of = owner[vis_idx]
        counts = np.bincount(seg_of, minlength=n_seg)
        boxes = np.array([d["box"] for d in view.detections]).reshape(-1, 4)
        pts = uv[vis_idx]
        in_box = (pts[:, None, 0] >= boxes[None, :, 0]) & (pts[:, None, 0] <= boxes[None, :, 2]) & \
                 (pts[:, None, 1] >= boxes[None, :, 1]) & (pts[:, None, 1] <= boxes[None, :, 3])
        for i in np.nonzero(counts >= MIN_VISIBLE_VOXELS)[0]:
            rows = seg_of == i
            seen[i] += 1
            if not len(boxes):
                unmatched[i] += 1
                continue
            p = pts[rows]
            lo, hi = np.percentile(p, 2, axis=0), np.percentile(p, 98, axis=0)
            obj_area = max(float(np.prod(hi - lo)), 1.0)
            frac = in_box[rows].mean(axis=0)  # share of the object's visible voxels inside each box
            ix = np.clip(np.minimum(hi[0], boxes[:, 2]) - np.maximum(lo[0], boxes[:, 0]), 0, None)
            iy = np.clip(np.minimum(hi[1], boxes[:, 3]) - np.maximum(lo[1], boxes[:, 1]), 0, None)
            box_area = np.maximum((boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1]), 1.0)
            explain = np.minimum(1.0, ix * iy / box_area / 0.5)  # how much of the box the object fills
            tight = np.minimum(1.0, box_area / obj_area / 0.25)  # a box far smaller than the object is a part of it
            match = frac * np.sqrt(explain) * tight
            best_per_class: dict[str, tuple[float, int]] = {}
            for k in np.nonzero(match > 0.15)[0]:
                d = view.detections[k]
                for cls, p_cls in class_dist(d).items():
                    v = float(match[k] * d["score"] * p_cls)
                    if v > best_per_class.get(cls, (0.0, -1))[0]:
                        best_per_class[cls] = (v, int(k))
            if not best_per_class:
                unmatched[i] += 1
            for cls, (v, k) in best_per_class.items():
                votes[i][cls] = votes[i].get(cls, 0.0) + v
                d = view.detections[k]
                if d["class"] == cls:
                    phrase_votes[i][d["phrase"]] = phrase_votes[i].get(d["phrase"], 0.0) + v
                if v >= 0.08:
                    support[i][cls] = support[i].get(cls, 0) + 1
                    best_views[i].append((v, cls, view.name, view.detections[k]["box"]))
                    if match[k] > 0.3:
                        shared.setdefault((view.name, k), []).append((int(i), cls))
        if len(free_idx) and len(boxes):
            fv = vis[free_idx]
            free_seen += fv
            fp = uv[free_idx[fv]]
            for k, d in enumerate(view.detections):
                if d["class"] not in NEW_INSTANCE_CLASSES or d["score"] < 0.3 or clip_share(d, d["class"]) < CLIP_FRESH:
                    continue
                b = boxes[k]
                hit = (fp[:, 0] >= b[0]) & (fp[:, 0] <= b[2]) & (fp[:, 1] >= b[1]) & (fp[:, 1] <= b[3])
                free_hits[d["class"]][np.nonzero(fv)[0][hit]] += 1

    posteriors = []
    for i in range(n_seg):
        d = descs[i]
        size = max(d["w_m"], d["d_m"], d["h_m"])
        scored = {c: v * prior(c, size, d["bottom_m"]) for c, v in votes[i].items()}
        # Background mass only from views where nothing matched; counting every view swamps well-seen objects.
        total = sum(scored.values()) + BACKGROUND * max(unmatched[i], 1)
        post = {c: v / total for c, v in sorted(scored.items(), key=lambda kv: -kv[1])}
        posteriors.append(post)

    # View consensus: segments inside the same box of the same (winning) class in >= 2 views belong together.
    winner = [next(iter(p), None) for p in posteriors]
    pair_views: dict[tuple[int, int], int] = {}
    for members in shared.values():
        ids = sorted({i for i, cls in members if cls == winner[i] and cls in MERGE_CLASSES})
        for a_pos, a in enumerate(ids):
            for b in ids[a_pos + 1:]:
                if winner[a] == winner[b]:
                    pair_views[(a, b)] = pair_views.get((a, b), 0) + 1
    parent = list(range(n_seg))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    # Strongest pairs first; a merge may not grow past the class's size prior (a roll cage box covers half a wall).
    box_lo = [np.asarray(d["aabb"][0], float) for d in descs]
    box_hi = [np.asarray(d["aabb"][1], float) for d in descs]
    for (a, b), n in sorted(pair_views.items(), key=lambda kv: -kv[1]):
        if n < 2 or _aabb_gap(descs[a], descs[b]) * mpu >= 0.25:
            continue
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        lo, hi = np.minimum(box_lo[ra], box_lo[rb]), np.maximum(box_hi[ra], box_hi[rb])
        if float((hi - lo).max()) * mpu > SIZE_PRIOR.get(winner[a], (0.0, 9.0, -0.1))[1]:
            continue
        parent[ra] = rb
        box_lo[rb], box_hi[rb] = lo, hi
    groups: dict[int, list[int]] = {}
    for i in range(n_seg):
        groups.setdefault(find(i), []).append(i)

    fresh = {}
    for cls in NEW_INSTANCE_CLASSES:
        ratio = free_hits[cls] / np.maximum(free_seen, 1)
        fresh[cls] = free_idx[(free_hits[cls] >= 3) & (ratio >= 0.6)]

    return {
        "posteriors": posteriors,
        "votes": votes,
        "phrase_votes": phrase_votes,
        "seen": seen.tolist(),
        "unmatched": unmatched.tolist(),
        "support": support,
        "best_views": [sorted(b, key=lambda x: -x[0]) for b in best_views],
        "merge_groups": [g for g in groups.values() if len(g) > 1],
        "fresh_voxels": fresh,
    }


def _aabb_gap(a: dict[str, Any], b: dict[str, Any]) -> float:
    (alo, ahi), (blo, bhi) = a["aabb"], b["aabb"]
    gap = np.maximum(0.0, np.maximum(alo - bhi, blo - ahi))
    return float(np.linalg.norm(gap))


def decide(seg: Segment, heuristic: tuple[str, float, str], post: dict[str, float], support: dict[str, int],
           phrase_votes: dict[str, float], seen: int = 0) -> tuple[str, float, str, bool]:
    """(class, confidence, display label, from_vision). Falls back to the geometry label without enough views."""
    if not post:
        return (*heuristic, False)
    cls, p = next(iter(post.items()))
    if support.get(cls, 0) < MIN_SUPPORT_VIEWS or p < MIN_POSTERIOR:
        return (*heuristic, False)
    if seg.kind == "pipe_fit" and cls != "pipe" and p < 0.5:
        return (*heuristic, False)  # a fitted cylinder is strong geometric evidence for a pipe
    if cls == "other" and heuristic[0] != "other":
        # "other" phrases are distractors (the detector calls circulators "vacuum cleaner"); they need broad support.
        if heuristic[0] in EQUIPMENT_CLASSES or support.get(cls, 0) < OTHER_MIN_FRACTION * max(seen, 1):
            return (*heuristic, False)
    phrase = best_phrase(cls, phrase_votes)
    label = DISPLAY.get(phrase, cls.capitalize()) if phrase else cls.capitalize()
    return cls, round(min(0.95, p), 3), label, True


def best_phrase(cls: str, phrase_votes: dict[str, float]) -> str | None:
    phrases = {ph: v for ph, v in phrase_votes.items() if _phrase_class(ph) == cls}
    return max(phrases, key=phrases.get) if phrases else None


def _phrase_class(phrase: str) -> str:
    from .detect2d import VOCAB

    return VOCAB.get(phrase, "other")


def merge_segments(segments: list[Segment], groups: list[list[int]]) -> tuple[list[Segment], list[list[int]]]:
    """Merged segment list and, per new segment, the old indices it came from."""
    absorbed = {i for g in groups for i in g}
    out: list[Segment] = []
    origin: list[list[int]] = []
    for g in groups:
        members = np.unique(np.concatenate([segments[i].members for i in g]))
        kinds = {segments[i].kind for i in g}
        notes = [f"merged {len(g)} fragments by multi-view detection consensus"]
        out.append(Segment(members, kinds.pop() if len(kinds) == 1 else "vision_merge", None, sum(segments[i].merged_from for i in g), notes))
        origin.append(sorted(g))
    for i, seg in enumerate(segments):
        if i not in absorbed:
            out.append(seg)
            origin.append([i])
    return out, origin


def fresh_segments(xyz: np.ndarray, fresh: dict[str, np.ndarray], mpu: float, min_voxels: int = 25) -> list[tuple[Segment, str]]:
    """Connected clusters of unexplained equipment voxels (2 cm voxel grid, 6 cm linking)."""
    from sklearn.cluster import DBSCAN

    out = []
    for cls, idx in sorted(fresh.items()):
        if len(idx) < min_voxels:
            continue
        labels = DBSCAN(eps=0.06 / mpu, min_samples=4).fit_predict(xyz[idx])
        for lab in set(labels) - {-1}:
            members = idx[labels == lab]
            if len(members) < min_voxels:
                continue
            size = float(np.ptp(xyz[members], axis=0).max()) * mpu
            lo, hi, _ = SIZE_PRIOR[cls]
            if lo <= size <= hi:
                out.append((Segment(members, "multiview_detection", notes=[f"new instance from {cls} detections no segment explained"]), cls))
    return out


def apply_vision(
    frames: Frames,
    voxels: Any,
    structure: dict[str, Any],
    segments: list[Segment],
    descs: list[dict[str, Any]],
    labels: list[tuple[str, float, str]],
    mpu: float,
    model: str,
    protected: set[int] | frozenset[int] = frozenset(),
) -> tuple[list[Segment], list[dict[str, Any]], list[tuple[str, float, str]], list[dict[str, Any] | None], dict[str, Any]]:
    """Fuse, merge fragments, add unexplained equipment, fuse again, then decide per segment.

    Segments in `protected` (reviewed or pinned in labels_override.json) are never merged.
    Returns segments, descriptors, labels and a per-segment `vision` block (None when the geometry label stays).
    """
    from .classify import describe

    xyz = voxels.xyz
    first = fuse(frames, xyz, segments, descs, mpu, structure["structure"])
    first["merge_groups"] = [g for g in ([i for i in g if i not in protected] for g in first["merge_groups"]) if len(g) > 1]
    merged, origin = merge_segments(segments, first["merge_groups"])
    merged_descs = [describe(seg, voxels, structure, mpu) if len(o) > 1 else descs[o[0]] for seg, o in zip(merged, origin)]
    merged_labels = [labels[o[0]] if len(o) == 1 else max((labels[i] for i in o), key=lambda lab: lab[1]) for o in origin]
    fresh = fresh_segments(xyz, first["fresh_voxels"], mpu)
    for seg, cls in fresh:
        merged.append(seg)
        merged_descs.append(describe(seg, voxels, structure, mpu))
        merged_labels.append(("other", 0.2, "Unclassified object"))
    second = fuse(frames, xyz, merged, merged_descs, mpu, structure["structure"])

    keep_segments, keep_descs, keep_labels, info = [], [], [], []
    report = {"model": model, "views": len(frames.views), "merged_groups": len(first["merge_groups"]),
              "fragments_merged": sum(len(g) for g in first["merge_groups"]), "fresh_candidates": len(fresh),
              "fresh_kept": 0, "vision_labelled": 0, "fallback_geometry": 0}
    for i, seg in enumerate(merged):
        cls, conf, label, from_vision = decide(seg, merged_labels[i], second["posteriors"][i], second["support"][i], second["phrase_votes"][i],
                                               second["seen"][i])
        if seg.kind == "multiview_detection":
            if not from_vision:
                continue
            report["fresh_kept"] += 1
        report["vision_labelled" if from_vision else "fallback_geometry"] += 1
        best, used = [], set()
        for v, c, frame, box in second["best_views"][i]:
            if c == cls and frame not in used:
                best.append({"frame": frame, "box": [round(float(b), 1) for b in box], "score": round(v, 3)})
                used.add(frame)
            if len(best) == 3:
                break
        post = second["posteriors"][i]
        info.append({
            "from_vision": from_vision,
            "phrase": best_phrase(cls, second["phrase_votes"][i]) if from_vision else None,
            "geometry_class": merged_labels[i][0],
            "detector": model,
            "views_seen": int(second["seen"][i]),
            "views_unmatched": int(second["unmatched"][i]),
            "support_fraction": round(second["support"][i].get(cls, 0) / max(second["seen"][i], 1), 3),
            "support_views": {c: n for c, n in sorted(second["support"][i].items(), key=lambda kv: -kv[1])},
            "posterior": {c: round(p, 3) for c, p in list(post.items())[:3]},
            "best_frames": best,
        })
        keep_segments.append(seg)
        keep_descs.append(merged_descs[i])
        keep_labels.append((cls, conf, label))
    return keep_segments, keep_descs, keep_labels, info, report


def write_evidence(frames: Frames, objects: list[dict[str, Any]], out_dir: Path, frames_dir: Path = UNDIST / "images") -> int:
    """Best two frames per vision-labelled non-pipe object: projected box (yellow) and the detection (green)."""
    import cv2

    edges = [(0, 1), (1, 3), (3, 2), (2, 0), (4, 5), (5, 7), (7, 6), (6, 4), (0, 4), (1, 5), (2, 6), (3, 7)]
    by_name = {v.name: v for v in frames.views}
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("OBJ-*.jpg"):
        old.unlink()
    written = 0
    for obj in objects:
        vision = obj.get("vision")
        if not vision or obj.get("label_source") != "vision_fusion" or obj["class"] == "pipe" or not vision.get("best_frames"):
            continue
        obb = obj["obb"]
        c, e, r = np.array(obb["center"]), np.array(obb["extent"]) / 2, np.array(obb["rotation"])
        signs = np.array([[sx, sy, sz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
        corners = c + (signs * e) @ r.T
        tiles = []
        for bf in vision["best_frames"][:2]:
            view = by_name.get(bf["frame"])
            img = cv2.imread(str(frames_dir / bf["frame"]))
            if view is None or img is None:
                continue
            uv, z = frames.project(view, corners)
            if (z > 0).all():
                for a, b in edges:
                    cv2.line(img, tuple(int(v) for v in uv[a]), tuple(int(v) for v in uv[b]), (0, 255, 255), 2, cv2.LINE_AA)
            x0, y0, x1, y1 = (int(v) for v in bf["box"])
            cv2.rectangle(img, (x0, y0), (x1, y1), (80, 220, 80), 3)
            cv2.rectangle(img, (0, 0), (img.shape[1], 40), (0, 0, 0), -1)
            cv2.putText(img, f"{obj['object_id']} {obj['display_label']} | {bf['frame']}", (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (255, 255, 255), 2, cv2.LINE_AA)
            tiles.append(cv2.resize(img, (640, 360), interpolation=cv2.INTER_AREA))
        if tiles:
            cv2.imwrite(str(out_dir / f"{obj['object_id']}.jpg"), np.hstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 80])
            written += 1
    return written


def selftest() -> None:
    """Two boxes on a synthetic posed camera: a pump split in two fragments is merged, a crate is not a pump."""
    mpu = 1.0
    rng = np.random.default_rng(0)
    pump_a = rng.uniform([-0.5, -0.2, 3.0], [-0.3, 0.2, 3.2], (200, 3))
    pump_b = rng.uniform([-0.3, -0.2, 3.0], [-0.1, 0.2, 3.2], (200, 3))
    crate = rng.uniform([0.4, -0.2, 3.0], [0.8, 0.2, 3.3], (300, 3))
    wall = np.column_stack([rng.uniform(-2, 2, 2000), rng.uniform(-1, 1, 2000), np.full(2000, 5.0)])
    xyz = np.vstack([pump_a, pump_b, crate, wall])
    segs = [Segment(np.arange(0, 200), "hdbscan"), Segment(np.arange(200, 400), "hdbscan"), Segment(np.arange(400, 700), "hdbscan")]

    def desc(m: np.ndarray) -> dict[str, Any]:
        lo, hi = xyz[m].min(0), xyz[m].max(0)
        w = hi - lo
        return {"aabb": (lo, hi), "w_m": float(max(w[0], w[2])), "d_m": float(min(w[0], w[2])), "h_m": float(w[1]), "bottom_m": 0.3}

    descs = [desc(s.members) for s in segs]
    K = np.array([500.0, 500.0, 320.0, 240.0])
    views = []
    for k, dx in enumerate((0.0, 0.05, -0.05)):
        R, t = np.eye(3), np.array([dx, 0.0, 0.0])
        uv = lambda X: np.column_stack([500 * (X[:, 0] + dx) / X[:, 2] + 320, 500 * X[:, 1] / X[:, 2] + 240])  # noqa: E731
        pb = uv(np.vstack([pump_a, pump_b]))
        cb = uv(crate)
        dets = [
            {"box": [*pb.min(0), *pb.max(0)], "phrase": "circulator pump", "class": "pump", "score": 0.5, "clip": {"pump": 0.9, "other": 0.1}},
            {"box": [*cb.min(0), *cb.max(0)], "phrase": "cardboard box", "class": "crate", "score": 0.6, "clip": {"crate": 0.95}},
        ]
        views.append(View(f"f{k}", K, R, t, 640, 480, dets))
    frames = Frames(views, 1.0, np.eye(3), np.zeros(3))
    res = fuse(frames, xyz, segs, descs, mpu)
    assert next(iter(res["posteriors"][0])) == "pump" and next(iter(res["posteriors"][2])) == "crate", res["posteriors"]
    assert res["merge_groups"] == [[0, 1]], res["merge_groups"]
    cls, conf, label, vision = decide(segs[0], ("other", 0.2, "Unclassified object"), res["posteriors"][0], res["support"][0], res["phrase_votes"][0])
    assert (cls, label, vision) == ("pump", "Circulator pump", True) and conf >= MIN_POSTERIOR, (cls, conf, label)
    vis, uv = visible_mask(frames, views[0], xyz, mpu)
    b = views[0].detections[1]["box"]
    behind = (uv[700:, 0] > b[0] + 10) & (uv[700:, 0] < b[2] - 10) & (uv[700:, 1] > b[1] + 10) & (uv[700:, 1] < b[3] - 10)
    assert vis[400:700].mean() > 0.3 and behind.any() and not vis[700:][behind].any(), "the wall behind the crate must be occluded"
    merged, origin = merge_segments(segs, res["merge_groups"])
    assert len(merged) == 2 and origin[0] == [0, 1] and len(merged[0].members) == 400

    # Many views without a matching box must not swamp a class that the matching views agree on.
    empty = [View(f"e{k}", K, np.eye(3), np.array([0.01 * k, 0.0, 0.0]), 640, 480, []) for k in range(6)]
    res = fuse(Frames(views + empty, 1.0, np.eye(3), np.zeros(3)), xyz, segs, descs, mpu)
    post = res["posteriors"][0]
    assert res["seen"][0] == 9 and res["unmatched"][0] == 6, (res["seen"][0], res["unmatched"][0])
    assert next(iter(post)) == "pump" and post["pump"] >= MIN_POSTERIOR, post
    # ...but one match in ten views is not enough.
    res = fuse(Frames(views[:1] + empty + empty[:3], 1.0, np.eye(3), np.zeros(3)), xyz, segs, descs, mpu)
    cls, *_, vision = decide(segs[0], ("other", 0.2, "Unclassified object"), res["posteriors"][0], res["support"][0], res["phrase_votes"][0])
    assert not vision, res["posteriors"][0]
    vacuum_on_pump = {"class": "other", "score": 0.4, "clip": {"pump": 0.6, "pipe": 0.2, "other": 0.2}}
    dist = class_dist(vacuum_on_pump)
    assert max(dist, key=dist.get) == "pump" and clip_vetoes(vacuum_on_pump), dist
    assert not clip_vetoes({"class": "motor", "score": 0.4, "clip": {"pump": 0.5, "motor": 0.1, "other": 0.4}})
    assert not clip_vetoes({"class": "tank", "score": 0.4, "clip": {"other": 0.7, "tank": 0.1, "crate": 0.2}})
    print("semantic selftest ok: z-buffer occlusion, class votes with CLIP, view-consensus merge, decision fallback, no dilution")


if __name__ == "__main__":
    selftest()
