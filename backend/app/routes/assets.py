from __future__ import annotations

import sqlite3
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query

from .. import scene_index
from ..db import connect, row_to_dict
from ..errors import UnknownAssetError
from ..evidence import prioritised_events
from ..models import AssetDetail, AssetSummary, DocumentsResponse, EventsResponse, TelemetryResponse
from ..telemetry import METRICS, available_metrics, class_baseline, first_last_day, load_asset_telemetry

router = APIRouter(prefix="/api", tags=["assets"])


def _master(conn: sqlite3.Connection, asset_id: str) -> dict[str, Any]:
    master = row_to_dict(conn.execute("SELECT * FROM Asset_Master WHERE asset_id = ?", (asset_id,)).fetchone())
    if master is None:
        raise UnknownAssetError(asset_id)
    return master


def asset_documents(conn: sqlite3.Connection, asset_id: str, asset_class: str | None) -> list[dict[str, Any]]:
    """The asset's own card, its class guidance and the plant-wide docs, from RAG_Corpus_Index + Knowledge_Docs."""
    rows = conn.execute(
        """
        SELECT r.doc_id, k.title, r.scope, r.document_role, r.file_name, r.mime_type, k.content
        FROM RAG_Corpus_Index r
        LEFT JOIN Knowledge_Docs k USING(doc_id)
        WHERE r.asset_id = ? OR (r.asset_id IS NULL AND r.scope IN (?, 'ALL'))
        ORDER BY CASE WHEN r.asset_id IS NOT NULL THEN 0 WHEN r.scope = 'ALL' THEN 2 ELSE 1 END, r.doc_id
        """,
        (asset_id, asset_class or ""),
    ).fetchall()
    docs = []
    for row in rows:
        doc = row_to_dict(row)
        doc["content_available"] = bool(doc.get("content"))
        docs.append(doc)
    return docs


@router.get("/assets", response_model=list[AssetSummary])
def assets() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT a.*, c.health_score, c.condition_state, c.issue_code, c.issue_summary, c.urgency
            FROM Asset_Master a
            LEFT JOIN Current_State c USING(asset_id)
            ORDER BY a.asset_id
            """
        ).fetchall()
    bindings = scene_index.bindings()
    result = []
    for row in rows:
        item = row_to_dict(row)
        binding = bindings.get(item["asset_id"])
        item["scene_object_id"] = binding["object_id"] if binding else None
        item["mapping_method"] = binding["mapping_method"] if binding else None
        item["mapping_confidence"] = binding["mapping_confidence"] if binding else None
        result.append(item)
    return result


@router.get("/assets/{asset_id}", response_model=AssetDetail)
def asset(asset_id: str) -> dict[str, Any]:
    with connect() as conn:
        master = _master(conn, asset_id)
        current = row_to_dict(conn.execute("SELECT * FROM Current_State WHERE asset_id = ?", (asset_id,)).fetchone())
        events = [
            row_to_dict(row)
            for row in conn.execute(
                "SELECT * FROM Alarms_Events WHERE asset_id = ? ORDER BY timestamp DESC LIMIT 10",
                (asset_id,),
            ).fetchall()
        ]
        work_orders = [
            row_to_dict(row)
            for row in conn.execute(
                "SELECT * FROM Maintenance_History WHERE asset_id = ? ORDER BY opened_at DESC LIMIT 10",
                (asset_id,),
            ).fetchall()
        ]
        documents = asset_documents(conn, asset_id, master.get("asset_class"))
    return {
        "master": master,
        "current": current,
        "events": events,
        "work_orders": work_orders,
        "documents": documents,
        "scene": scene_index.binding(asset_id),
    }


@router.get("/assets/{asset_id}/telemetry", response_model=TelemetryResponse, response_model_by_alias=True)
def telemetry(
    asset_id: str,
    metric: str | None = Query(None, description="Comma-separated metric names; default: every metric with data"),
    from_: str | None = Query(None, alias="from", description="ISO timestamp, inclusive"),
    to: str | None = Query(None, description="ISO timestamp, inclusive"),
) -> dict[str, Any]:
    with connect() as conn:
        master = _master(conn, asset_id)
        df = load_asset_telemetry(conn, asset_id)
        present = available_metrics(df)
        if metric:
            requested = [m.strip() for m in metric.split(",") if m.strip()]
            unknown = [m for m in requested if m not in METRICS]
            if unknown:
                raise HTTPException(status_code=422, detail=f"Unknown metric(s) {unknown}; known: {list(METRICS)}")
            metrics = [m for m in requested if m in present]
        else:
            metrics = present
        stamps = df["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%S")
        mask = stamps.notna()
        if from_:
            mask &= stamps >= from_
        if to:
            mask &= stamps <= to
        window = df[mask]
        baselines = class_baseline(conn, str(master.get("asset_class") or ""), asset_id, metrics)
    return {
        "asset_id": asset_id,
        "tag": master.get("tag"),
        "asset_class": master.get("asset_class"),
        "from": from_,
        "to": to,
        "metrics": [{"metric": m, **METRICS[m]} for m in metrics],
        "timestamps": stamps[mask].tolist(),
        "series": {m: [None if v != v else round(float(v), 3) for v in window[m]] for m in metrics},
        "trends": {m: s for m in metrics if not window.empty and (s := first_last_day(window, m))},
        "baselines": baselines,
    }


@router.get("/assets/{asset_id}/events", response_model=EventsResponse)
def events(
    asset_id: str,
    status: str | None = Query(None, description="open, acknowledged or closed"),
    order: Literal["priority", "recent"] = "priority",
    limit: int = Query(50, ge=1, le=500),
) -> dict[str, Any]:
    with connect() as conn:
        _master(conn, asset_id)
        current = row_to_dict(conn.execute("SELECT issue_code FROM Current_State WHERE asset_id = ?", (asset_id,)).fetchone()) or {}
        rows = prioritised_events(conn, asset_id, current.get("issue_code"))
    if order == "recent":
        rows.sort(key=lambda e: str(e.get("timestamp") or ""), reverse=True)
    if status:
        rows = [e for e in rows if str(e.get("status")).lower() == status.lower()]
    return {"asset_id": asset_id, "order": order, "total": len(rows), "events": rows[:limit]}


@router.get("/assets/{asset_id}/documents", response_model=DocumentsResponse)
def documents(asset_id: str) -> dict[str, Any]:
    with connect() as conn:
        master = _master(conn, asset_id)
        docs = asset_documents(conn, asset_id, master.get("asset_class"))
    return {"asset_id": asset_id, "documents": docs}
