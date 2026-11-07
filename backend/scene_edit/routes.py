"""/api/scene/edits* and /api/scene/replan routes (included by backend/app.py)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.scene_edit import engine, store

router = APIRouter(prefix="/api/scene", tags=["scene-edit"])


class EditIn(BaseModel):
    object_id: str
    translate_world: list[float] = Field(min_length=3, max_length=3,
                                         description="world frame (x, -y_ply, -z_ply), PLY units; y is ignored")
    yaw_deg: float = Field(0.0, ge=-360, le=360, description="rotation about world +y through the box centre")
    target_asset_id: str | None = Field(None, description="asset whose route length change is reported")
    by: str | None = None


def _norm(body: EditIn) -> dict:
    t = list(body.translate_world)
    t[1] = 0.0  # objects slide on the floor
    return {"object_id": engine.resolve(body.object_id) or body.object_id, "translate_world": t,
            "yaw_deg": body.yaw_deg}


def _known(object_id: str) -> bool:
    return object_id in engine.base()[2] or object_id in engine.movables()


def _payload(target: str | None = None) -> dict:
    edits = store.load()
    return {"edits": edits, "replan": engine.replan(edits, target)}


@router.get("/edits")
def get_edits(target_asset_id: str | None = Query(None)) -> dict:
    return _payload(target_asset_id)


@router.post("/edits/preview")
def preview(body: EditIn) -> dict:
    if not _known(body.object_id):
        raise HTTPException(404, f"unknown object {body.object_id}")
    return engine.preview(store.load(), _norm(body), body.target_asset_id)


@router.post("/edits")
def commit(body: EditIn):
    if not _known(body.object_id):
        raise HTTPException(404, f"unknown object {body.object_id}")
    edits = store.load()
    pv = engine.preview(edits, _norm(body), body.target_asset_id)
    if pv["verdict"] == "blocked":
        return JSONResponse(status_code=409, content={"detail": "move is blocked", "preview": pv})
    n = _norm(body)
    edits.append(store.new_edit(n["object_id"], n["translate_world"], n["yaw_deg"], body.by))
    store.save(edits)
    return {**_payload(body.target_asset_id), "preview": pv}


@router.delete("/edits/{edit_id}")
def undo(edit_id: str) -> dict:
    edits = store.load()
    if not any(e["edit_id"] == edit_id for e in edits):
        raise HTTPException(404, f"unknown edit {edit_id}")
    store.save([e for e in edits if e["edit_id"] != edit_id])
    return _payload()


@router.delete("/edits")
def reset() -> dict:
    store.save([])
    return _payload()


@router.get("/movables")
def get_movables() -> dict:
    """Whole freestanding objects that may be moved (original poses); current poses are in replan['movables']."""
    return {"movables": list(engine.movables().values())}


@router.get("/replan")
def replan(target_asset_id: str | None = Query(None)) -> dict:
    return engine.replan(store.load(), target_asset_id)
