from __future__ import annotations

import base64
import binascii
import copy
import threading
from collections import Counter
from datetime import datetime, timezone
from typing import Any

import numpy as np

from . import config, scene_index
from .artifacts import read_json, write_json

INSTANCE_CLASSES = ("pump", "motor", "valve", "tank", "cabinet", "pipe", "ladder", "crate", "trolley", "sign", "door", "other")
STRUCTURE_CLASSES = ("floor", "ceiling", "wall")
CLASSES = INSTANCE_CLASSES + STRUCTURE_CLASSES
ACTIONS = ("confirm", "relabel", "reject", "merge", "bind", "unbind")

DEFAULT_CLASS_CONFIDENCE = 0.9
HUMAN_MAPPING_CONFIDENCE = 0.45
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_CROP_BYTES = 8_000_000

_lock = threading.Lock()


class ReviewError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def class_title(cls: str) -> str:
    return cls.replace("_", " ").capitalize()


def _base_objects() -> dict[str, dict[str, Any]]:
    scene = read_json(config.SCENE_OBJECTS)
    return {o["object_id"]: o for o in scene["objects"]}


def _assets() -> dict[str, dict[str, Any]]:
    from .db import connect, row_to_dict

    with connect() as conn:
        rows = conn.execute("SELECT asset_id, tag, asset_class FROM Asset_Master").fetchall()
    return {r["asset_id"]: row_to_dict(r) for r in rows}


def obb_corners(obb: dict[str, Any]) -> np.ndarray:
    """world = center + R @ (local * extent), local in [-0.5, 0.5]^3 (contract convention)."""
    signs = np.array([[x, y, z] for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (-0.5, 0.5)])
    rotation = np.asarray(obb["rotation"], float)
    return np.asarray(obb["center"], float) + (signs * np.asarray(obb["extent"], float)) @ rotation.T


def merged_geometry(parent: dict[str, Any], child: dict[str, Any]) -> dict[str, Any]:
    """Union box of two objects, kept in the parent's yaw frame."""
    rotation = np.asarray(parent["obb"]["rotation"], float)
    centre = np.asarray(parent["obb"]["center"], float)
    points = np.vstack([obb_corners(parent["obb"]), obb_corners(child["obb"])])
    local = (points - centre) @ rotation
    lo, hi = local.min(axis=0), local.max(axis=0)
    new_centre = centre + rotation @ ((lo + hi) / 2)
    r = lambda values, digits=5: [round(float(v), digits) for v in values]  # noqa: E731
    aabb_min = np.minimum(np.asarray(parent["aabb_min"], float), np.asarray(child["aabb_min"], float))
    aabb_max = np.maximum(np.asarray(parent["aabb_max"], float), np.asarray(child["aabb_max"], float))
    return {
        "obb": {**parent["obb"], "center": r(new_centre), "extent": r(hi - lo)},
        "center": r(new_centre),
        "aabb_min": r(aabb_min),
        "aabb_max": r(aabb_max),
    }


def apply_action(
    base: dict[str, dict[str, Any]],
    overrides: dict[str, dict[str, Any]],
    object_id: str,
    request: dict[str, Any],
    assets: dict[str, dict[str, Any]],
    stamp: str | None = None,
) -> tuple[dict[str, dict[str, Any] | None], dict[str, dict[str, Any] | None], list[str]]:
    """Apply one review action to `overrides` in place. Returns (changed, previous, notes) keyed by object id."""
    reviewer = str(request.get("reviewer") or "").strip()
    if not reviewer:
        raise ReviewError(422, "reviewer is required; only a named person can write a review")
    action = request.get("action")
    if action not in ACTIONS:
        raise ReviewError(422, f"action must be one of {', '.join(ACTIONS)}")
    if object_id not in base:
        raise ReviewError(404, f"Unknown scene object {object_id}")
    stamp = stamp or now_iso()

    def effective(oid: str) -> dict[str, Any]:
        return {**base[oid], **overrides.get(oid, {})}

    previous: dict[str, dict[str, Any] | None] = {}
    notes: list[str] = []

    def update(oid: str, fields: dict[str, Any]) -> None:
        if oid not in previous:
            previous[oid] = copy.deepcopy(overrides.get(oid))
        entry = {**overrides.get(oid, {}), **fields, "reviewer": reviewer, "reviewed_at": stamp}
        overrides[oid] = entry

    def unbind_fields(obj: dict[str, Any], why: str) -> dict[str, Any]:
        return {
            "asset_id": None,
            "mapping_method": None,
            "mapping_confidence": None,
            "mapping_notes": why,
            "display_label": class_title(obj["class"]),
        }

    target = effective(object_id)
    if target.get("review_status") == "merged":
        raise ReviewError(409, f"{object_id} is merged into {target.get('merged_into')}; undo the merge first")
    note = str(request.get("notes") or "").strip()
    label_fields: dict[str, Any] = {"label_source": "human"}
    if note:
        label_fields["review_notes"] = note

    if action in ("confirm", "relabel"):
        cls = request.get("class") or target["class"]
        if cls not in CLASSES:
            raise ReviewError(422, f"class '{cls}' is not in the vocabulary: {', '.join(CLASSES)}")
        if action == "relabel" and not (request.get("class") or request.get("display_label")):
            raise ReviewError(422, "relabel needs a new class or display_label")
        confidence = request.get("class_confidence")
        confidence = DEFAULT_CLASS_CONFIDENCE if confidence is None else float(confidence)
        if not 0.0 <= confidence <= 1.0:
            raise ReviewError(422, "class_confidence must be between 0 and 1")
        changed_class = cls != base[object_id]["class"]
        fields = {**label_fields, "class": cls, "class_confidence": round(confidence, 3)}
        display = str(request.get("display_label") or "").strip()
        if display:
            fields["display_label"] = display
        elif changed_class and not target.get("asset_id"):
            fields["display_label"] = class_title(cls)
        relabelled = action == "relabel" or changed_class or bool(display and display != base[object_id]["display_label"])
        fields["review_status"] = "relabelled" if relabelled else "confirmed"
        update(object_id, fields)

    elif action == "reject":
        if target.get("merged_from"):
            raise ReviewError(409, f"{object_id} has merged children {target['merged_from']}; undo those merges first")
        fields = {**label_fields, "review_status": "rejected"}
        if target.get("asset_id"):
            fields.update(unbind_fields(target, f"Unbound by {reviewer}: object rejected in review."))
            notes.append(f"{target['asset_id']} is now unbound; rerun python3 -m pipeline.run to bind it procedurally and refresh nav_targets.json.")
        update(object_id, fields)

    elif action == "merge":
        parent_id = request.get("merge_into")
        if not parent_id:
            raise ReviewError(422, "merge needs merge_into")
        if parent_id not in base:
            raise ReviewError(404, f"Unknown scene object {parent_id}")
        if parent_id == object_id:
            raise ReviewError(409, "cannot merge an object into itself")
        parent = effective(parent_id)
        if scene_index.is_hidden(parent):
            raise ReviewError(409, f"{parent_id} is {parent['review_status']}; choose a visible parent")
        if target.get("asset_id"):
            raise ReviewError(409, f"{object_id} is bound to {target['asset_id']}; unbind it before merging")
        if target.get("source") == "structure_plane" or parent.get("source") == "structure_plane":
            raise ReviewError(409, "structure planes cannot be merged")
        if target.get("merged_from"):
            raise ReviewError(409, f"{object_id} already has merged children; merge into it instead")
        update(object_id, {**label_fields, "review_status": "merged", "merged_into": parent_id})
        update(parent_id, {**merged_geometry(parent, target), "merged_from": sorted({*(parent.get("merged_from") or []), object_id})})

    elif action == "bind":
        asset_id = request.get("asset_id")
        if not asset_id:
            raise ReviewError(422, "bind needs asset_id")
        asset = assets.get(asset_id)
        if asset is None:
            raise ReviewError(404, f"Unknown asset {asset_id}")
        if scene_index.is_hidden(target):
            raise ReviewError(409, f"{object_id} is {target['review_status']}; it cannot hold an asset")
        if target.get("source") == "structure_plane":
            raise ReviewError(409, "structure planes cannot hold an asset")
        for oid in base:
            other = effective(oid)
            if oid != object_id and other.get("asset_id") == asset_id:
                update(oid, unbind_fields(other, f"Unbound by {reviewer}: {asset_id} moved to {object_id}."))
                notes.append(f"{asset_id} moved from {oid} to {object_id}; rerun python3 -m pipeline.run so its mission targets the new object.")
        if target.get("asset_id") and target["asset_id"] != asset_id:
            notes.append(f"{target['asset_id']} was bound to {object_id} and is now unbound.")
        tag = asset.get("tag") or asset_id
        update(object_id, {
            "asset_id": asset_id,
            "mapping_method": "human_assigned",
            "mapping_confidence": HUMAN_MAPPING_CONFIDENCE,
            "mapping_notes": (
                f"Assigned by reviewer {reviewer}. The workbook's Scene_Anchors coordinates are placeholders, "
                "so the asset identity is not verified against a nameplate."
            ),
            "display_label": f"{tag} ({asset.get('asset_class') or 'asset'}) - reviewer-assigned",
        })

    elif action == "unbind":
        if not target.get("asset_id"):
            raise ReviewError(409, f"{object_id} has no asset to unbind")
        notes.append(f"{target['asset_id']} is now unbound; rerun python3 -m pipeline.run to bind it procedurally and refresh nav_targets.json.")
        update(object_id, unbind_fields(target, f"Unbound by {reviewer} in review."))

    changed = {oid: copy.deepcopy(overrides.get(oid)) for oid in previous}
    return changed, previous, notes


def _read_file() -> dict[str, Any]:
    return scene_index.load_overrides()


def review(object_id: str, request: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        data = _read_file()
        changed, previous, notes = apply_action(_base_objects(), data["overrides"], object_id, request, _assets())
        write_json(config.LABELS_OVERRIDE, data)
    return {"overrides": data, "changed": changed, "previous": previous, "notes": notes}


def restore(reviewer: str, entries: dict[str, dict[str, Any] | None]) -> dict[str, Any]:
    """Write entries back verbatim (None removes one). Used to undo a review action."""
    if not str(reviewer or "").strip():
        raise ReviewError(422, "reviewer is required")
    base = _base_objects()
    unknown = [oid for oid in entries if oid not in base]
    if unknown:
        raise ReviewError(404, f"Unknown scene objects {unknown}")
    with _lock:
        data = _read_file()
        previous = {oid: copy.deepcopy(data["overrides"].get(oid)) for oid in entries}
        for oid, entry in entries.items():
            if entry is None:
                data["overrides"].pop(oid, None)
            else:
                data["overrides"][oid] = entry
        write_json(config.LABELS_OVERRIDE, data)
    return {"overrides": data, "changed": {oid: data["overrides"].get(oid) for oid in entries}, "previous": previous, "notes": []}


def delete(object_id: str) -> dict[str, Any]:
    with _lock:
        data = _read_file()
        if object_id not in data["overrides"]:
            raise ReviewError(404, f"No override for {object_id}")
        previous = {object_id: data["overrides"].pop(object_id)}
        write_json(config.LABELS_OVERRIDE, data)
    return {"overrides": data, "changed": {object_id: None}, "previous": previous, "notes": []}


def summary() -> dict[str, Any]:
    objects = scene_index.objects_with_overrides()
    overrides = _read_file()["overrides"]
    statuses = Counter(e.get("review_status") for e in overrides.values() if e.get("review_status"))
    human = [oid for oid, e in overrides.items() if e.get("label_source") == "human"]
    bound = [o for o in objects if o.get("asset_id") and not scene_index.is_hidden(o)]
    return {
        "objects": len(objects),
        "visible": sum(not scene_index.is_hidden(o) for o in objects),
        "by_label_source": dict(Counter(o.get("label_source") for o in objects)),
        "by_review_status": dict(statuses),
        "human_reviewed": len(human),
        "reviewers": sorted({e["reviewer"] for e in overrides.values() if e.get("reviewer")}),
        "bound_assets": len(bound),
        "bound_reviewed": sum(o.get("label_source") == "human" for o in bound),
        "crops": len(crop_index()["crops"]),
        "vlm": config.VLM_LABELS.exists(),
    }


def crop_index() -> dict[str, Any]:
    data = read_json(config.CROPS_DIR / "index.json", required=False) or {}
    return {"crops": data.get("crops") or {}}


def save_crop(object_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if object_id not in _base_objects():
        raise ReviewError(404, f"Unknown scene object {object_id}")
    image = str(payload.get("image") or "")
    prefix = "data:image/png;base64,"
    if not image.startswith(prefix):
        raise ReviewError(422, "image must be a data:image/png;base64 URL")
    try:
        raw = base64.b64decode(image[len(prefix):], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ReviewError(422, f"image is not valid base64: {exc}") from exc
    if not raw.startswith(PNG_MAGIC) or len(raw) > MAX_CROP_BYTES:
        raise ReviewError(422, "image must be a PNG under 8 MB")
    width, height = int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
    with _lock:
        config.CROPS_DIR.mkdir(parents=True, exist_ok=True)
        path = config.CROPS_DIR / f"{object_id}.png"
        tmp = path.with_name(f".{path.name}.tmp")
        tmp.write_bytes(raw)
        tmp.replace(path)
        index = crop_index()
        entry = {
            "file": path.name,
            "captured_at": now_iso(),
            "camera": payload.get("camera"),
            "bbox_px": payload.get("bbox_px"),
            "viewport_px": payload.get("viewport_px"),
            "width": width,
            "height": height,
        }
        index["crops"][object_id] = entry
        write_json(config.CROPS_DIR / "index.json", index)
    return entry
