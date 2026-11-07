from __future__ import annotations

from typing import Any

from . import config
from .artifacts import read_json

BINDING_FIELDS = (
    "object_id", "class", "display_label", "class_confidence", "label_source",
    "center", "obb", "aabb_min", "aabb_max", "mapping_method", "mapping_confidence", "mapping_notes",
    "review_status", "reviewer", "reviewed_at",
)

# Review outcomes that remove an object from the scene for every consumer.
HIDDEN_REVIEW_STATUSES = frozenset({"rejected", "merged"})


def is_hidden(obj: dict[str, Any]) -> bool:
    return obj.get("review_status") in HIDDEN_REVIEW_STATUSES


def load_overrides() -> dict[str, Any]:
    data = read_json(config.LABELS_OVERRIDE, required=False) or {}
    return {"schema_version": data.get("schema_version", "1.0"), **data, "overrides": data.get("overrides") or {}}


def objects_with_overrides(*, include_hidden: bool = True) -> list[dict[str, Any]]:
    """Scene objects with person-confirmed entries from labels_override.json merged in."""
    scene = read_json(config.SCENE_OBJECTS, required=False) or {"objects": []}
    overrides = load_overrides()["overrides"]
    objects = []
    for obj in scene.get("objects", []):
        override = overrides.get(obj.get("object_id"))
        merged = {**obj, **override} if override else obj
        if include_hidden or not is_hidden(merged):
            objects.append(merged)
    return objects


def bindings() -> dict[str, dict[str, Any]]:
    """asset_id -> the scene object it is bound to (only the fields consumers need)."""
    result: dict[str, dict[str, Any]] = {}
    for obj in objects_with_overrides(include_hidden=False):
        asset_id = obj.get("asset_id")
        if asset_id:
            result[asset_id] = {key: obj.get(key) for key in BINDING_FIELDS}
    return result


def binding(asset_id: str) -> dict[str, Any] | None:
    return bindings().get(asset_id)


def metres_per_unit() -> float | None:
    scene = read_json(config.SCENE_OBJECTS, required=False)
    return scene.get("metres_per_unit") if scene else None
