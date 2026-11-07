from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from .. import config, scene_index
from ..artifacts import read_json
from ..db import connect, row_to_dict
from ..models import AnchorsResponse, NavResponse, Open

router = APIRouter(prefix="/api/scene", tags=["scene"])

MISSION_KEYS = ("path", "path_raw", "path_shortcut", "samples", "stats")


@router.get("/objects", response_model=Open)
def scene_objects() -> dict[str, Any]:
    return read_json(config.SCENE_OBJECTS)


def _targets() -> dict[str, dict[str, Any]]:
    data = read_json(config.NAV_TARGETS, required=False) or {}
    return {t["asset_id"]: t for t in data.get("targets", [])}


@router.get("/nav", response_model=NavResponse)
def scene_nav(target: str = config.TARGET_ASSET_ID) -> dict[str, Any]:
    """The default mission, or a precomputed mission to `target`. Never fabricates a path."""
    nav = read_json(config.NAV)
    if not target or target == nav.get("target_asset_id"):
        return {**nav, "reachable": True}

    entry = _targets().get(target)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No scene binding or mission for target {target}")
    base = {k: v for k, v in nav.items() if k not in (*MISSION_KEYS, "goal", "approach", "path_length_units", "path_length_m")}
    merged = {
        **base,
        "target_asset_id": entry["asset_id"],
        "target_object_id": entry["object_id"],
        "target_display_label": entry.get("display_label"),
        "reachable": bool(entry.get("reachable")),
        "distance_to_walkable_m": entry.get("distance_to_walkable_m"),
        "approach": entry.get("approach"),
    }
    mission = entry.get("mission")
    if not merged["reachable"] or not mission:
        return {**merged, "reachable": False, "goal": None, "path_length_m": None, "path_length_units": None,
                **{k: None for k in MISSION_KEYS}}
    length_m = (mission.get("stats") or {}).get("path_length_m")
    mpu = nav.get("metres_per_unit")
    return {
        **merged,
        **{k: mission.get(k) for k in MISSION_KEYS},
        "goal": entry["approach"]["position"],
        "path_length_m": length_m,
        "path_length_units": round(length_m / mpu, 5) if length_m is not None and mpu else None,
    }


@router.get("/anchors", response_model=AnchorsResponse)
def scene_anchors() -> dict[str, Any]:
    """Scene_Anchors remapped onto the real scan: Excel placeholder coordinates kept, real object geometry added."""
    with connect() as conn:
        rows = [row_to_dict(r) for r in conn.execute("SELECT * FROM Scene_Anchors ORDER BY asset_id")]
    bindings = scene_index.bindings()
    targets = _targets()
    anchors = []
    for row in rows:
        binding = bindings.get(row["asset_id"])
        target = targets.get(row["asset_id"], {})
        anchors.append({
            "scene_anchor_id": row.get("scene_anchor_id"),
            "asset_id": row["asset_id"],
            "tag": row.get("tag"),
            "remapped": binding is not None,
            "mapping_status": binding["mapping_method"] if binding else "unmapped",
            "scene": binding,
            "reachable": target.get("reachable"),
            "distance_to_walkable_m": target.get("distance_to_walkable_m"),
            "excel_placeholder": {k: v for k, v in row.items() if k not in ("scene_anchor_id", "asset_id", "tag")},
        })
    remapped = sum(a["remapped"] for a in anchors)
    return {
        "frame": "ply_raw",
        "metres_per_unit": scene_index.metres_per_unit(),
        "summary": {
            "anchors": len(anchors),
            "remapped": remapped,
            "unmapped": len(anchors) - remapped,
            "reachable": sum(1 for a in anchors if a["reachable"]),
        },
        "anchors": anchors,
    }
