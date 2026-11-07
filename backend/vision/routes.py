"""/api/vision/* routes (included by backend/app.py)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.vision import agent, cache, manifest
from backend.vision.crosscheck import crosscheck
from backend.vision.evaluate import evaluate
from backend.vision.schema import CrossCheck, VisionFinding

router = APIRouter(prefix="/api/vision", tags=["vision"])


def _store():
    from backend.app import store  # late import: app owns the PackStore

    return store()


@router.get("/health")
def health() -> dict:
    return {"model": agent.configured_model(), "prompt_version": agent.PROMPT_VERSION,
            "frames": len(manifest.merged_frames()), "cached_findings": len(cache.all_findings())}


@router.get("/frames")
def frames() -> dict:
    return {"frames": manifest.merged_frames(), "note": manifest.load_manifest()["note"]}


class InspectIn(BaseModel):
    region_id: str | None = None
    frame_id: str | None = None
    bbox_px: list[int] | None = Field(None, min_length=4, max_length=4)
    question: str | None = None
    force: bool = Field(False, description="Bypass the cache and call the model again")


@router.post("/inspect", response_model=VisionFinding)
def inspect(body: InspectIn) -> VisionFinding:
    if body.region_id:
        hit = manifest.region(body.region_id)
        if not hit:
            raise HTTPException(404, f"unknown region {body.region_id}")
        f, r = hit
        return agent.inspect(f["frame_id"], r["bbox_px"], r, body.question, body.force)
    if body.frame_id and body.bbox_px:
        if not manifest.frame(body.frame_id):
            raise HTTPException(404, f"unknown frame {body.frame_id}")
        return agent.inspect(body.frame_id, body.bbox_px, None, body.question, body.force)
    if body.frame_id:  # whole-frame question
        return agent.inspect(body.frame_id, [0, 0, 1280, 720], {"kind": "other", "description": "whole frame"},
                             body.question, body.force)
    raise HTTPException(422, "give region_id, or frame_id (+ optional bbox_px)")


def _for(object_id: str | None, asset_id: str | None) -> dict:
    regions = [{**r, "frame_id": f["frame_id"], "file": f["file"]} for f in manifest.merged_frames()
               for r in f["regions"]
               if (object_id and r.get("object_id") == object_id) or (asset_id and r.get("asset_id") == asset_id)]
    if object_id is None and asset_id:
        o = next((o for o in manifest.scene_objects().values() if o.get("asset_id") == asset_id), None)
        object_id = o["object_id"] if o else None
    ids = {r["region_id"] for r in regions}
    findings = [f for f in cache.all_findings() if f.get("region_id") in ids]
    return {"object_id": object_id, "asset_id": asset_id, "linked_regions": regions,
            "near_frames": manifest.frames_near_object(object_id) if object_id else [],
            "findings": sorted(findings, key=lambda f: -f["confidence"])}


@router.get("/object/{object_id}")
def for_object(object_id: str) -> dict:
    o = manifest.scene_objects().get(object_id)
    if not o:
        raise HTTPException(404, f"unknown object {object_id}")
    return _for(object_id, o.get("asset_id"))


@router.get("/asset/{asset_id}")
def for_asset(asset_id: str) -> dict:
    return _for(None, asset_id)


@router.get("/crosscheck/{asset_id}", response_model=CrossCheck)
def get_crosscheck(asset_id: str) -> CrossCheck:
    if asset_id not in _store().asset_ids():
        raise HTTPException(404, f"unknown asset {asset_id}")
    return crosscheck(_store(), asset_id)


@router.get("/findings")
def findings() -> list[dict]:
    return cache.all_findings()


class LinkIn(BaseModel):
    object_id: str | None = None
    asset_id: str | None = None
    by: str = "technician"


@router.post("/regions/{region_id}/link")
def link(region_id: str, body: LinkIn) -> dict:
    if not manifest.region(region_id):
        raise HTTPException(404, f"unknown region {region_id}")
    if body.object_id and body.object_id not in manifest.scene_objects():
        raise HTTPException(422, f"unknown object {body.object_id}")
    if body.asset_id and body.asset_id not in _store().asset_ids():
        raise HTTPException(422, f"unknown asset {body.asset_id}")
    ann = manifest.load_annotations()
    ann["regions"].setdefault(region_id, {})["link"] = {**body.model_dump(),
                                                        "at": datetime.now(timezone.utc).isoformat()}
    manifest.save_annotations(ann)
    return manifest.region(region_id)[1]


class LabelIn(BaseModel):
    state: Literal["open", "closed", "partially_open", "unknown", "not_applicable"] | None = None
    gauge_value: float | None = None
    gauge_unit: str | None = None
    labelled_by: str = Field(min_length=2, description="Who looked at the photo (ground truth is human-only)")


@router.post("/regions/{region_id}/label")
def label(region_id: str, body: LabelIn) -> dict:
    if not manifest.region(region_id):
        raise HTTPException(404, f"unknown region {region_id}")
    if body.labelled_by.lower().startswith("claude"):
        raise HTTPException(422, "ground truth must come from a human")
    ann = manifest.load_annotations()
    ann["regions"].setdefault(region_id, {})["gt"] = {**body.model_dump(),
                                                      "at": datetime.now(timezone.utc).isoformat()}
    manifest.save_annotations(ann)
    return manifest.region(region_id)[1]


class RegionIn(BaseModel):
    frame_id: str
    bbox_px: list[int] = Field(min_length=4, max_length=4)
    kind: Literal["manual_valve", "control_valve", "gauge", "pump", "motor", "other"] = "other"
    description: str = "user-drawn region"


@router.post("/regions")
def add_region(body: RegionIn) -> dict:
    if not manifest.frame(body.frame_id):
        raise HTTPException(404, f"unknown frame {body.frame_id}")
    ann = manifest.load_annotations()
    n = sum(1 for u in ann["user_regions"] if u["frame_id"] == body.frame_id) + 1
    r = {"region_id": f"{body.frame_id}-U{n:02d}", "frame_id": body.frame_id, "bbox_px": body.bbox_px,
         "kind": body.kind, "description": body.description, "object_id": None, "asset_id": None,
         "link_method": None, "link_confidence": None, "proposed": None, "gt": None, "note": "user-drawn"}
    ann["user_regions"].append(r)
    manifest.save_annotations(ann)
    return r


@router.get("/eval")
def get_eval() -> dict:
    return evaluate()
