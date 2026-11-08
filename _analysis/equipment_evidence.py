"""Rank scene objects as equipment candidates from the existing video detections, without touching the segmentation.

Every object's OBB is filled with the cleaned splat centres of Equipment Room.ply. Each COLMAP-posed frame gets a
z-buffer of those centres, so a view only counts when the object's points are on the front surface. In a view that
sees the object, a detection supports a class when it covers most of the object's visible points and the object
fills a fair share of the box (detector class and CLIP re-score, as in pipeline/semantic.class_dist).

    python3 _analysis/equipment_evidence.py            # writes data/derived/diagnostics/equipment_candidates.json

Read-only: it never changes scene_objects.json or labels_override.json. The verdicts come from the evidence sheets.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline.io_ply import load_splats  # noqa: E402
from pipeline.semantic import class_dist, load_frames, visible_mask  # noqa: E402

EQUIPMENT = ("pump", "motor", "valve", "gauge")
CONTEXT = ("tank", "cabinet", "crate", "trolley", "ladder", "pipe", "other")
MIN_VISIBLE_POINTS = 12
MIN_VISIBLE_SHARE = 0.3  # share of the object's points on the front surface
MIN_BOX_PX = 18
MIN_COVER = 0.5  # share of the visible points inside the detection box
MIN_FILL = 0.25  # share of the detection box the object's 2D box overlaps
MIN_CLASS_P = 0.4
MIN_DET_SCORE = 0.25
SKIP_CLASSES = {"pipe", "floor", "ceiling", "wall"}


def cloud_points(ply: Path, voxel_units: float) -> np.ndarray:
    data, _, col = load_splats(ply, None)
    alpha = 1.0 / (1.0 + np.exp(-data[:, col["opacity"]]))
    xyz = data[alpha > 0.5][:, [col["x"], col["y"], col["z"]]]
    keys = np.floor(xyz / voxel_units).astype(np.int64)
    _, first = np.unique(keys, axis=0, return_index=True)
    return xyz[np.sort(first)]


def inside_obb(xyz: np.ndarray, obb: dict) -> np.ndarray:
    local = (xyz - np.asarray(obb["center"])) @ np.asarray(obb["rotation"])
    return np.nonzero(np.all(np.abs(local) <= np.asarray(obb["extent"]) / 2, axis=1))[0]


def score(scene: dict, ply: Path, detections: Path, alignment: Path) -> dict:
    mpu = float(scene["metres_per_unit"])
    frames = load_frames(detections, alignment)
    if frames is None:
        raise SystemExit("missing detections, alignment or COLMAP model")
    xyz = cloud_points(ply, 0.02 / mpu)
    objects = [o for o in scene["objects"] if o.get("obb") and o.get("source") != "structure_plane" and o["class"] not in SKIP_CLASSES]
    members = {o["object_id"]: inside_obb(xyz, o["obb"]) for o in objects}
    stats = {oid: {"points": int(len(m)), "seen": 0, "support": {}, "frames": {}, "views": []} for oid, m in members.items()}
    print(f"{len(xyz)} splat centres, {len(objects)} objects, {len(frames.views)} views")

    for n, view in enumerate(frames.views):
        vis, uv = visible_mask(frames, view, xyz, mpu)
        boxes = np.array([d["box"] for d in view.detections], float).reshape(-1, 4)
        for oid, idx in members.items():
            if len(idx) < MIN_VISIBLE_POINTS:
                continue
            v = idx[vis[idx]]
            if len(v) < MIN_VISIBLE_POINTS or len(v) < MIN_VISIBLE_SHARE * len(idx):
                continue
            p = uv[v]
            lo, hi = np.percentile(p, 2, axis=0), np.percentile(p, 98, axis=0)
            if (hi - lo).max() < MIN_BOX_PX:
                continue
            st = stats[oid]
            st["seen"] += 1
            st["views"].append((len(v), view.name, [round(float(x), 1) for x in (*lo, *hi)]))
            if not len(boxes):
                continue
            cover = ((p[:, None, 0] >= boxes[None, :, 0]) & (p[:, None, 0] <= boxes[None, :, 2])
                     & (p[:, None, 1] >= boxes[None, :, 1]) & (p[:, None, 1] <= boxes[None, :, 3])).mean(axis=0)
            ix = np.clip(np.minimum(hi[0], boxes[:, 2]) - np.maximum(lo[0], boxes[:, 0]), 0, None)
            iy = np.clip(np.minimum(hi[1], boxes[:, 3]) - np.maximum(lo[1], boxes[:, 1]), 0, None)
            fill = ix * iy / np.maximum((boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1]), 1.0)
            best: dict[str, tuple[float, int]] = {}
            for k in np.nonzero((cover >= MIN_COVER) & (fill >= MIN_FILL))[0]:
                d = view.detections[k]
                if d["score"] < MIN_DET_SCORE:
                    continue
                for cls, pc in class_dist(d).items():
                    m = float(cover[k] * np.sqrt(fill[k]) * d["score"] * pc)
                    if pc >= MIN_CLASS_P and m > best.get(cls, (0.0, -1))[0]:
                        best[cls] = (m, int(k))
            for cls, (m, k) in best.items():
                st["support"][cls] = st["support"].get(cls, 0) + 1
                st["frames"].setdefault(cls, []).append({"frame": view.name, "det_box": view.detections[k]["box"], "phrase": view.detections[k]["phrase"],
                                                        "obj_box": [round(float(x), 1) for x in (*lo, *hi)], "match": round(m, 3)})
        if (n + 1) % 50 == 0:
            print(f"  {n + 1}/{len(frames.views)} views")

    by_id = {o["object_id"]: o for o in objects}
    out_objects = {}
    for oid, st in stats.items():
        o = by_id[oid]
        views = sorted(st["views"], key=lambda t: -t[0])
        picked: list[tuple] = []
        for t in views:  # best-covered views, spread over the video
            if all(abs(int(t[1][6:11]) - int(p[1][6:11])) > 12 for p in picked):
                picked.append(t)
            if len(picked) == 3:
                break
        out_objects[oid] = {
            "class": o["class"], "asset_id": o.get("asset_id"), "points": st["points"], "seen": st["seen"],
            "support": dict(sorted(st["support"].items(), key=lambda kv: -kv[1])),
            "support_fraction": {c: round(n / max(st["seen"], 1), 3) for c, n in st["support"].items()},
            "best_frames": {c: sorted(f, key=lambda x: -x["match"])[:3] for c, f in st["frames"].items() if c in EQUIPMENT + CONTEXT},
            "view_frames": [{"frame": t[1], "obj_box": t[2], "visible_points": t[0]} for t in picked],
            "dims_m": o.get("features", {}).get("dims_m"),
        }
    ranked = {}
    for cls in EQUIPMENT:
        rows = [(oid, r["support"].get(cls, 0), r["support_fraction"].get(cls, 0.0)) for oid, r in out_objects.items()]
        rows = [r for r in rows if r[1] >= 2]
        ranked[cls] = [{"object_id": oid, "support": n, "fraction": f} for oid, n, f in sorted(rows, key=lambda r: (-r[2], -r[1], r[0]))]
    return {"source": "data/derived/vision/detections.json projected onto scene_objects.json OBBs", "thresholds": {
        "min_visible_points": MIN_VISIBLE_POINTS, "min_visible_share": MIN_VISIBLE_SHARE, "min_cover": MIN_COVER, "min_fill": MIN_FILL,
        "min_class_p": MIN_CLASS_P, "min_det_score": MIN_DET_SCORE}, "ranked": ranked, "objects": out_objects}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", default="data/derived/scene_objects.json")
    ap.add_argument("--ply", default="Equipment Room.ply")
    ap.add_argument("--detections", default="data/derived/vision/detections.json")
    ap.add_argument("--alignment", default="data/derived/splat_alignment.json")
    ap.add_argument("--out", default="data/derived/diagnostics/equipment_candidates.json")
    args = ap.parse_args()
    result = score(json.loads(Path(args.scene).read_text()), Path(args.ply), Path(args.detections), Path(args.alignment))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(result, indent=1))
    for cls, rows in result["ranked"].items():
        print(cls, len(rows), [f"{r['object_id']}:{r['support']}/{r['fraction']}" for r in rows[:15]])


if __name__ == "__main__":
    main()
