"""FastAPI backend — routes follow the builder pack's API_Contract sheet, plus scene/simulation routes.

Run:  uv run uvicorn backend.app:app --reload --port 8000
Data: Excel store loaded once at startup (pipeline.excel.PackStore); scene files from public/assets/
      (written by `uv run python -m pipeline.run_all`).
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from itertools import count
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.ai.agent import answer, configured_model
from backend.ai.schema import CopilotAnswer
from pipeline.common import ROOT, WEB_ASSETS
from pipeline.excel import PackStore

load_dotenv(ROOT / ".env")

STATE: dict[str, Any] = {}
SCENE_FILES = ("objects", "registry", "path", "rails", "timeline")


def _load_scene() -> dict:
    scene = {}
    for name in SCENE_FILES:
        f: Path = WEB_ASSETS / f"{name}.json"
        scene[name] = json.loads(f.read_text()) if f.exists() else None
    return scene


@asynccontextmanager
async def lifespan(_: FastAPI):
    STATE["store"] = PackStore.load()
    STATE["scene"] = _load_scene()
    STATE["wo_seq"] = count(1)
    yield


app = FastAPI(title="Valmet SpatialSense backend", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


def store() -> PackStore:
    return STATE["store"]


def scene(name: str):
    data = STATE["scene"].get(name)
    if data is None:
        raise HTTPException(503, f"{name}.json not generated yet — run `uv run python -m pipeline.run_all`")
    return data


def binding(asset_id: str) -> dict | None:
    reg = STATE["scene"].get("registry") or {}
    return next((e for e in reg.get("entries", []) if e["asset_id"] == asset_id), None)


def _require(asset_id: str) -> None:
    if asset_id not in store().asset_ids():
        raise HTTPException(404, f"unknown asset {asset_id}")


# ---------------- API_Contract routes ----------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "assets": len(store().asset_ids()), "llm_model": configured_model(),
            "scene_loaded": {k: v is not None for k, v in STATE["scene"].items()}}


@app.get("/api/assets")
def list_assets() -> list[dict]:
    """Asset hierarchy, scene binding and criticality (Asset_Master + Current_State + 3D binding)."""
    return [{**c, "scene_binding": binding(c["asset_id"])} for c in store().asset_cards()]


@app.get("/api/assets/{asset_id}")
def get_asset(asset_id: str) -> dict:
    _require(asset_id)
    a = store().asset(asset_id)
    return {**a, "scene_binding": binding(asset_id), "documents": store().documents(asset_id)}


@app.get("/api/assets/{asset_id}/telemetry")
def get_telemetry(asset_id: str, last_n: int | None = Query(None, ge=1, le=5000)) -> list[dict]:
    _require(asset_id)
    df = store().telemetry(asset_id, last_n)
    return json.loads(df.to_json(orient="records", date_format="iso"))


class TelemetryAppend(BaseModel):
    values: dict[str, float | str | None] = Field(description="Telemetry_Sample_3d column -> value; timestamp optional")


@app.post("/api/assets/{asset_id}/telemetry")
def append_telemetry(asset_id: str, body: TelemetryAppend) -> dict:
    _require(asset_id)
    try:
        return store().append_telemetry(asset_id, body.values)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/assets/{asset_id}/events")
def get_events(asset_id: str, limit: int = Query(50, ge=1, le=1000)) -> list[dict]:
    _require(asset_id)
    return json.loads(store().events(asset_id).head(limit).to_json(orient="records", date_format="iso"))


@app.get("/api/assets/{asset_id}/documents")
def get_documents(asset_id: str) -> dict:
    _require(asset_id)
    st = store().asset(asset_id)["state"]
    return {"documents": store().documents(asset_id),
            "historical_cases": json.loads(store().cases(st["asset_class"]).to_json(orient="records")),
            "missing_asset_card": f"DOC-{asset_id}.md is listed in RAG_Corpus_Index but was not provided"}


@app.get("/api/scene/anchors")
def scene_anchors() -> list[dict]:
    """3D mapping and confidence: Excel placeholder anchors replaced by extracted-object bindings."""
    objs = {o["object_id"]: o for o in scene("objects")["objects"]}
    out = []
    for a in store().tables["Scene_Anchors"].to_dict(orient="records"):
        b = binding(a["asset_id"])
        o = objs.get(b["object_id"]) if b else None
        out.append({
            "scene_anchor_id": a["scene_anchor_id"], "asset_id": a["asset_id"], "tag": a["tag"],
            "object_id": b["object_id"] if b else None,
            "center": o["center"] if o else None, "extents": o["extents"] if o else None, "yaw": o["yaw"] if o else None,
            "mapping_method": b["mapping_method"] if b else "unmapped",
            "mapping_confidence": b["mapping_confidence"] if b else 0.0,
            "placeholder": {"x_local_m": a["x_local_m"], "y_local_m": a["y_local_m"], "z_local_m": a["z_local_m"],
                            "mapping_status": a["mapping_status"], "mapping_confidence": a["mapping_confidence"]},
        })
    return out


class CopilotQuery(BaseModel):
    asset_id: str | None = Field(None, description="Defaults to the faulty target")
    question: str | None = None


@app.post("/api/copilot/query", response_model=CopilotAnswer)
def copilot_query(q: CopilotQuery) -> CopilotAnswer:
    asset_id = q.asset_id or scene("registry")["target"]["asset_id"]
    _require(asset_id)
    reg = {**scene("registry"), "path": STATE["scene"].get("path")}
    return answer(store(), asset_id, q.question, reg, binding(asset_id))


class WorkOrderDraftIn(BaseModel):
    asset_id: str
    action: str = Field(description="Inspection / verification action, e.g. 'inspect hydraulic path'")
    priority: str = "medium"
    evidence_ids: list[str] = []
    note: str | None = None


@app.post("/api/work-orders/draft")
def work_order_draft(body: WorkOrderDraftIn) -> dict:
    """DRAFT only — nothing is sent to a CMMS and no control action is taken."""
    _require(body.asset_id)
    valid = store().evidence_ids()
    st = store().asset(body.asset_id)["state"]
    return {
        "work_order_id": f"WO-DRAFT-{next(STATE['wo_seq']):04d}",
        "status": "DRAFT",
        "asset_id": body.asset_id, "tag": st["tag"], "area_name": st["area_name"],
        "action": body.action, "maintenance_type": "inspection", "priority": body.priority,
        "role": "field_technician", "knowledge_doc_id": st["knowledge_doc_id"],
        "evidence_ids": [i for i in body.evidence_ids if i in valid],
        "rejected_evidence_ids": [i for i in body.evidence_ids if i not in valid],
        "note": body.note,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "Draft for human review. Follow site procedures, LOTO, permits and OEM instructions (DOC-FIELD-SAFETY).",
    }


# ---------------- scene & simulation ------------------------------------------------------------------
@app.get("/api/scene/objects")
def scene_objects() -> dict:
    return scene("objects")


@app.get("/api/sim/rails")
def sim_rails() -> dict:
    return scene("rails")


@app.get("/api/sim/path")
def sim_path() -> dict:
    return scene("path")


@app.get("/api/sim/timeline")
def sim_timeline() -> dict:
    return scene("timeline")


@app.get("/api/assets/{asset_id}/status-line")
def status_line(asset_id: str) -> dict:
    """Short templated status for the proximity overlay while walking (no LLM latency)."""
    _require(asset_id)
    st = store().asset(asset_id)["state"]
    b = binding(asset_id)
    return {
        "asset_id": asset_id, "tag": st["tag"], "condition_state": st["condition_state"],
        "health_score": st["health_score"],
        "text": f"{st['tag']} · {st['asset_class'].replace('_', ' ').lower()} · health {st['health_score']} · "
                f"{st['condition_state']}" + ("" if st["issue_code"] == "NORMAL" else f" · {st['issue_summary']}"),
        "mapping_confidence": b["mapping_confidence"] if b else None,
    }


@app.post("/api/admin/reload-scene")
def reload_scene() -> dict:
    STATE["scene"] = _load_scene()
    return {k: v is not None for k, v in STATE["scene"].items()}
