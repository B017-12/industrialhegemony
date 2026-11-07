from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import numpy as np
from scipy import ndimage
from scipy.optimize import linear_sum_assignment

from .config import TARGET_ASSET_ID
from .geometry import obb_iou

MAX_MAPPING_CONFIDENCE = 0.5
HIDDEN_REVIEW_STATUSES = {"rejected", "merged"}
# Methods an override entry may carry. video_evidence: chosen by projecting the box into the
# COLMAP-posed video frames (_analysis/project_objects.py), not yet confirmed by a person.
PINNED_METHODS = {"human_assigned", "video_evidence"}
LABEL_SUFFIX = {"human_assigned": "reviewer-assigned", "video_evidence": "video evidence"}

# Scene classes compatible with each Excel asset class, best first, with the mapping confidence for that tier.
ASSET_CLASS_TIERS: dict[str, list[tuple[tuple[str, ...], float, str]]] = {
    "PROCESS_PUMP": [(("pump",), 0.45, "procedural_class_match"), (("motor", "other"), 0.25, "procedural_fallback")],
    "ELECTRIC_MOTOR": [(("motor",), 0.45, "procedural_class_match"), (("pump", "other"), 0.25, "procedural_fallback")],
    "CONTROL_VALVE": [(("valve",), 0.45, "procedural_class_match"), (("other",), 0.2, "procedural_fallback")],
    "PRESSURE_TRANSMITTER": [(("valve",), 0.3, "procedural_class_match"), (("other", "sign"), 0.2, "procedural_fallback")],
    "VIBRATION_SENSOR": [(("other",), 0.2, "procedural_fallback"), (("valve",), 0.2, "procedural_fallback")],
}


def load_assets(workbook: Path | None) -> list[dict[str, Any]]:
    if workbook is None or not workbook.exists():
        return [{"asset_id": TARGET_ASSET_ID, "tag": "P-002", "asset_class": "PROCESS_PUMP"}]
    try:
        import pandas as pd

        df = pd.read_excel(workbook, sheet_name="Asset_Master")
        return df.fillna("").to_dict(orient="records")
    except Exception:
        return [{"asset_id": TARGET_ASSET_ID, "tag": "P-002", "asset_class": "PROCESS_PUMP"}]


def load_previous_objects(paths: list[Path]) -> tuple[list[dict[str, Any]], str | None]:
    for path in paths:
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8")).get("objects", []), str(path)
            except (OSError, json.JSONDecodeError):
                continue
    return [], None


def _as_obb(obj: dict[str, Any]) -> dict[str, Any]:
    obb = obj["obb"]
    return {"center": np.asarray(obb["center"], float), "extent": np.asarray(obb["extent"], float), "rotation": np.asarray(obb["rotation"], float)}


def assign_stable_ids(objects: list[dict[str, Any]], previous: list[dict[str, Any]], min_iou: float = 0.2) -> dict[str, Any]:
    """Hungarian matching on 3D IoU of yaw OBBs keeps OBJ-xxxx ids attached to the same physical object across reruns."""
    old = [o for o in previous if str(o.get("object_id", "")).startswith("OBJ-") and "obb" in o]
    new = [o for o in objects if o["object_id"] is None]
    matched = 0
    if old and new:
        iou = np.array([[obb_iou(_as_obb(n), _as_obb(o)) for o in old] for n in new])
        rows, cols = linear_sum_assignment(-iou)
        for r, c in zip(rows, cols):
            if iou[r, c] >= min_iou:
                new[r]["object_id"] = old[c]["object_id"]
                new[r]["stable_id_iou"] = round(float(iou[r, c]), 3)
                matched += 1
    used = {int(m.group(1)) for o in old + objects if o["object_id"] and (m := re.match(r"OBJ-(\d+)", o["object_id"]))}
    next_id = max(used, default=0) + 1
    for obj in sorted(new, key=lambda o: (-o["splat_count"])):
        if obj["object_id"] is None:
            obj["object_id"] = f"OBJ-{next_id:04d}"
            obj["stable_id_iou"] = None
            next_id += 1
    return {"previous_objects": len(old), "matched": matched, "new_ids": len(new) - matched}


def reachable_floor(points: np.ndarray, floor_mask: np.ndarray, obstacle_mask: np.ndarray, cell: float = 0.05, inflate: int = 4) -> dict[str, Any]:
    """Coarse walkable-floor estimate used only to rank binding candidates; navigation.py owns the real planner."""
    xz = points[:, [0, 2]]
    origin = xz.min(axis=0)
    shape = tuple((np.ptp(xz, axis=0) / cell).astype(int) + 1)
    ij = ((xz - origin) / cell).astype(int)
    support = np.zeros(shape, dtype=bool)
    support[ij[floor_mask, 0], ij[floor_mask, 1]] = True
    support = ndimage.binary_closing(support, iterations=2)
    blocked = np.zeros(shape, dtype=bool)
    blocked[ij[obstacle_mask, 0], ij[obstacle_mask, 1]] = True
    free = support & ~ndimage.binary_dilation(blocked, iterations=inflate)
    labels, count = ndimage.label(free)
    if count == 0:
        return {"origin": origin, "cell": cell, "distance": None}
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    walkable = labels == int(sizes.argmax())
    distance = ndimage.distance_transform_edt(~walkable) * cell
    return {"origin": origin, "cell": cell, "distance": distance, "area_units2": float(walkable.sum() * cell * cell)}


def distance_to_walkable(obj: dict[str, Any], floor: dict[str, Any]) -> float:
    if floor["distance"] is None:
        return float("inf")
    lo, hi = np.asarray(obj["aabb_min"]), np.asarray(obj["aabb_max"])
    grid = floor["distance"]
    i0, k0 = np.clip(((lo[[0, 2]] - floor["origin"]) / floor["cell"]).astype(int), 0, np.array(grid.shape) - 1)
    i1, k1 = np.clip(((hi[[0, 2]] - floor["origin"]) / floor["cell"]).astype(int), 0, np.array(grid.shape) - 1)
    pad = 2
    window = grid[max(i0 - pad, 0) : i1 + pad + 1, max(k0 - pad, 0) : k1 + pad + 1]
    return float(window.min()) if window.size else float("inf")


def _bind(obj: dict[str, Any], asset: dict[str, Any], method: str, confidence: float, note: str) -> None:
    obj["asset_id"] = str(asset["asset_id"])
    obj["mapping_method"] = method
    obj["mapping_confidence"] = round(min(confidence, MAX_MAPPING_CONFIDENCE), 3)
    obj["mapping_notes"] = note
    tag = asset.get("tag") or asset["asset_id"]
    suffix = LABEL_SUFFIX.get(method, "procedural")
    obj["display_label"] = f"{tag} ({asset.get('asset_class', 'asset')}) - {suffix}"


def load_overrides(path: Path) -> dict[str, dict[str, Any]]:
    """Person-confirmed entries from labels_override.json (Tab 8 review mode), or {}."""
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("overrides") or {}
    except (OSError, json.JSONDecodeError):
        return {}


def bind_assets(
    objects: list[dict[str, Any]],
    assets: list[dict[str, Any]],
    floor: dict[str, Any],
    mpu: float,
    overrides: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Procedural binding, after pinning every binding a reviewer set in labels_override.json.

    Class matching uses the pipeline's own heuristic classes, not reviewed ones, so a relabel alone never
    moves a binding; only an explicit bind or unbind in the review mode does.
    """
    overrides = overrides or {}
    by_id = {o["object_id"]: o for o in objects}
    hidden = {oid for oid, e in overrides.items() if e.get("review_status") in HIDDEN_REVIEW_STATUSES}
    pinned = {oid: e for oid, e in overrides.items() if "asset_id" in e and oid in by_id}
    asset_by_id = {str(a.get("asset_id")): a for a in assets}
    pinned_assets: set[str] = set()
    for oid, entry in sorted(pinned.items()):
        asset_id = entry.get("asset_id")
        if not asset_id or oid in hidden or asset_id in pinned_assets:
            continue
        asset = asset_by_id.get(str(asset_id), {"asset_id": asset_id})
        method = entry.get("mapping_method") if entry.get("mapping_method") in PINNED_METHODS else "human_assigned"
        _bind(by_id[oid], asset, method, float(entry.get("mapping_confidence") or 0.45),
              entry.get("mapping_notes") or "Assigned by a reviewer in the label review mode.")
        pinned_assets.add(str(asset_id))

    candidates = [
        o for o in objects
        if o["label_source"] == "heuristic" and o["class"] != "pipe" and o["object_id"] not in hidden and o["object_id"] not in pinned
    ]
    for obj in candidates:
        obj["_reach"] = distance_to_walkable(obj, floor)
    available = {o["object_id"]: o for o in candidates}
    report: dict[str, Any] = {"bound": 0, "by_method": {}, "human_pinned": len(pinned_assets), "review_excluded": len(hidden | set(pinned))}

    def pump_score(o: dict[str, Any]) -> float:
        dims = o["features"]["dims_m"]
        size = max(dims.values())
        score = {"pump": 1.0, "motor": 0.6, "other": 0.2}.get(o["class"], 0.0) * o["class_confidence"] * 2
        score += 0.3 if 0.25 <= size <= 0.8 else 0.0
        score += 0.2 if o["relations"] else 0.0
        return score - 0.5 * max(0.0, o["_reach"] - 0.4)

    reach_limit = 0.8
    target_pool = [o for o in available.values() if o["class"] in {"pump", "motor", "other"} and o["_reach"] <= reach_limit]
    target = None if TARGET_ASSET_ID in pinned_assets else max(target_pool or available.values(), key=pump_score, default=None)
    if target is not None:
        asset = next((a for a in assets if str(a.get("asset_id")) == TARGET_ASSET_ID), {"asset_id": TARGET_ASSET_ID, "tag": "P-002", "asset_class": "PROCESS_PUMP"})
        _bind(target, asset, "procedural_demo_target", 0.5, f"Most pump-like object within {reach_limit} units of the walkable floor (distance {target['_reach']:.2f}).")
        report["target"] = {"object_id": target["object_id"], "class": target["class"], "reach_units": round(target["_reach"], 3), "score": round(pump_score(target), 3)}
        available.pop(target["object_id"])

    # Reachable objects are preferred so the robot can visit bound assets; ties broken by id for determinism.
    def order(o: dict[str, Any]) -> tuple[float, float, str]:
        return (round(min(o["_reach"], 5.0), 1), -o["class_confidence"], o["object_id"])

    for asset in assets:
        asset_id = str(asset.get("asset_id", ""))
        if not asset_id or asset_id == TARGET_ASSET_ID or asset_id in pinned_assets:
            continue
        for classes, confidence, method in ASSET_CLASS_TIERS.get(str(asset.get("asset_class", "")).upper(), [(("other",), 0.2, "procedural_fallback")]):
            pool = sorted((o for o in available.values() if o["class"] in classes), key=order)
            if pool:
                chosen = pool[0]
                _bind(chosen, asset, method, confidence, f"Scene class '{chosen['class']}' matched to {asset.get('asset_class')} (tier {classes}).")
                available.pop(chosen["object_id"])
                break
    for obj in objects:
        obj.pop("_reach", None)
        if obj.get("asset_id"):
            report["bound"] += 1
            report["by_method"][obj["mapping_method"]] = report["by_method"].get(obj["mapping_method"], 0) + 1
    return report


def selftest() -> None:
    """Review pins on synthetic objects: a human bind wins, unbound and rejected objects get no procedural asset."""
    def obj(oid: str, cls: str) -> dict[str, Any]:
        return {"object_id": oid, "class": cls, "class_confidence": 0.4, "label_source": "heuristic", "relations": [],
                "aabb_min": [0, 0, 0], "aabb_max": [0.1, 0.1, 0.1], "features": {"dims_m": {"width": 0.4, "depth": 0.3, "height": 0.5}}}

    assets = [{"asset_id": TARGET_ASSET_ID, "tag": "P-002", "asset_class": "PROCESS_PUMP"},
              {"asset_id": "ASSET-001", "tag": "CV-001", "asset_class": "CONTROL_VALVE"}]
    floor = {"distance": None}
    objects = [obj("OBJ-0001", "pump"), obj("OBJ-0002", "valve"), obj("OBJ-0003", "other"), obj("OBJ-0004", "valve")]
    bind_assets(objects, assets, floor, 1.0)
    assert objects[0]["asset_id"] == TARGET_ASSET_ID and objects[1]["asset_id"] == "ASSET-001"

    objects = [obj("OBJ-0001", "pump"), obj("OBJ-0002", "valve"), obj("OBJ-0003", "other"), obj("OBJ-0004", "valve")]
    overrides = {
        "OBJ-0003": {"asset_id": TARGET_ASSET_ID, "mapping_method": "human_assigned", "mapping_confidence": 0.45},
        "OBJ-0001": {"asset_id": None},
        "OBJ-0002": {"review_status": "rejected"},
    }
    report = bind_assets(objects, assets, floor, 1.0, overrides)
    by_id = {o["object_id"]: o for o in objects}
    assert by_id["OBJ-0003"]["asset_id"] == TARGET_ASSET_ID and by_id["OBJ-0003"]["mapping_method"] == "human_assigned"
    assert by_id["OBJ-0003"]["display_label"].endswith("reviewer-assigned")
    assert by_id["OBJ-0001"].get("asset_id") is None, "a reviewer unbind must not be undone procedurally"
    assert by_id["OBJ-0002"].get("asset_id") is None, "a rejected object must not be bound"
    assert by_id["OBJ-0004"]["asset_id"] == "ASSET-001"
    assert report["human_pinned"] == 1 and report["bound"] == 2

    objects = [obj("OBJ-0001", "pump"), obj("OBJ-0002", "other")]
    overrides = {"OBJ-0002": {"asset_id": TARGET_ASSET_ID, "mapping_method": "video_evidence", "mapping_confidence": 0.9}}
    bind_assets(objects, assets, floor, 1.0, overrides)
    pinned = objects[1]
    assert pinned["mapping_method"] == "video_evidence" and pinned["mapping_confidence"] == MAX_MAPPING_CONFIDENCE
    assert pinned["display_label"].endswith("video evidence")
    print("mapping selftest ok: human and video-evidence pins, unbinds and rejections respected")


if __name__ == "__main__":
    selftest()
