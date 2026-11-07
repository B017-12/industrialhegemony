from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import config, labels
from ..artifacts import read_json
from ..models import CropEntry, CropIndex, CropUpload, LabelSummary, Open, OverridesFile, RestoreRequest, ReviewAction, ReviewResponse
from ..scene_index import load_overrides

router = APIRouter(prefix="/api/labels", tags=["labels"])


def _run(fn, *args: Any) -> Any:
    try:
        return fn(*args)
    except labels.ReviewError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc


@router.get("/overrides", response_model=OverridesFile)
def get_overrides() -> dict[str, Any]:
    return load_overrides()


@router.patch("/overrides/{object_id}", response_model=ReviewResponse)
def patch_override(object_id: str, body: ReviewAction) -> dict[str, Any]:
    """One review action by a named person. Only this route (and restore) writes label_source 'human'."""
    request = body.model_dump(by_alias=True)
    return _run(labels.review, object_id, request)


@router.post("/restore", response_model=ReviewResponse)
def restore_overrides(body: RestoreRequest) -> dict[str, Any]:
    return _run(labels.restore, body.reviewer, body.entries)


@router.delete("/overrides/{object_id}", response_model=ReviewResponse)
def delete_override(object_id: str) -> dict[str, Any]:
    return _run(labels.delete, object_id)


@router.get("/summary", response_model=LabelSummary)
def label_summary() -> dict[str, Any]:
    return labels.summary()


@router.get("/crops", response_model=CropIndex)
def list_crops() -> dict[str, Any]:
    return labels.crop_index()


@router.post("/crops/{object_id}", response_model=CropEntry)
def upload_crop(object_id: str, body: CropUpload) -> dict[str, Any]:
    return _run(labels.save_crop, object_id, body.model_dump())


@router.get("/crops/{object_id}.png")
def get_crop(object_id: str) -> FileResponse:
    path = config.CROPS_DIR / f"{object_id}.png"
    if not object_id.replace("-", "").isalnum() or not path.exists():
        raise HTTPException(status_code=404, detail=f"No crop for {object_id}; run the crop tour first")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-cache"})


@router.get("/vlm", response_model=Open)
def vlm_labels() -> dict[str, Any]:
    data = read_json(config.VLM_LABELS, required=False)
    if data is None:
        raise HTTPException(status_code=404, detail="vlm_labels.json not found; the VLM labeller has not been run (needs OPENAI_API_KEY)")
    return data
