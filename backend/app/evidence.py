from __future__ import annotations

import sqlite3
from typing import Any

from . import scene_index
from .db import connect, row_to_dict
from .errors import UnknownAssetError
from .telemetry import METRICS, available_metrics, class_baseline, first_last_day, load_asset_telemetry

GLOBAL_DOC_IDS = ("DOC-FIELD-SAFETY", "DOC-RAG-GUIDE", "DOC-3D-MAPPING")
NO_ISSUE_CODES = {"", "NONE", "NORMAL"}
STATUS_RANK = {"open": 0, "acknowledged": 1, "closed": 2}
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
MAX_EVENTS = 8
MAX_WORK_ORDERS = 5
MAX_CASES = 5


def event_priority(event: dict[str, Any], issue_code: str | None) -> tuple[int, int]:
    status = STATUS_RANK.get(str(event.get("status")).lower(), 3)
    matches = 0 if issue_code and event.get("event_code") == issue_code else 1
    return (status, matches)


def prioritised_events(conn: sqlite3.Connection, asset_id: str, issue_code: str | None) -> list[dict[str, Any]]:
    """Open before acknowledged before closed, then the current issue code first, then newest first."""
    rows = [row_to_dict(r) for r in conn.execute("SELECT * FROM Alarms_Events WHERE asset_id = ?", (asset_id,))]
    rows.sort(key=lambda e: str(e.get("timestamp") or ""), reverse=True)
    rows.sort(key=lambda e: event_priority(e, issue_code))
    return rows


def matching_cases(conn: sqlite3.Connection, asset_class: str, issue_code: str | None, issue_summary: str | None) -> list[dict[str, Any]]:
    if not issue_code or issue_code.upper() in NO_ISSUE_CODES:
        return []
    rows = [
        row_to_dict(r)
        for r in conn.execute(
            """
            SELECT * FROM Historical_Service_Cases
            WHERE asset_class = ? AND (historical_issue_code = ? OR historical_interpretation = ?)
            """,
            (asset_class, issue_code, issue_summary or ""),
        )
    ]
    rows.sort(key=lambda c: (
        0 if c.get("historical_issue_code") == issue_code else 1,
        SEVERITY_RANK.get(str(c.get("severity")).lower(), 3),
        str(c.get("case_id")),
    ))
    return rows[:MAX_CASES]


def _item(eid: str, source: str, kind: str, text: str, record: dict[str, Any] | None = None, values: dict[str, Any] | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {"id": eid, "source": source, "kind": kind, "text": text}
    if record is not None:
        item["record"] = record
    if values is not None:
        item["values"] = values
    return item


def _trend_text(tag: str, stats: dict[str, Any]) -> str:
    meta = METRICS[stats["metric"]]
    unit = f" {meta['unit']}" if meta["unit"] else ""
    if stats["delta"] > 0:
        verb = "rose"
    elif stats["delta"] < 0:
        verb = "fell"
    else:
        verb = "was unchanged"
    pct = f", {stats['delta_pct']:+}%" if stats["delta_pct"] is not None else ""
    return (
        f"{tag} {meta['label'].lower()} daily mean {verb} from {stats['first_day_mean']}{unit} on {stats['first_day']} "
        f"to {stats['last_day_mean']}{unit} on {stats['last_day']} ({stats['delta']:+}{unit}{pct}); "
        f"range {stats['min']} to {stats['max']}{unit} over {stats['samples']} samples."
    )


def _baseline_text(stats: dict[str, Any]) -> str:
    meta = METRICS[stats["metric"]]
    unit = f" {meta['unit']}" if meta["unit"] else ""
    return (
        f"Healthy {stats['asset_class']} peers ({', '.join(stats['peer_asset_ids'])}) average {stats['mean']}{unit} "
        f"{meta['label'].lower()} (10th to 90th percentile {stats['p10']} to {stats['p90']}{unit}) over {stats['samples']} samples."
    )


def _mapping_text(asset_id: str, tag: str, binding: dict[str, Any] | None) -> str:
    if binding is None:
        return f"No scene object is bound to {tag} ({asset_id}); its 3D location is unknown."
    notes = f" {binding['mapping_notes']}" if binding.get("mapping_notes") else ""
    reviewed = ""
    if binding.get("label_source") == "human" and binding.get("reviewer"):
        reviewed = f" The object's class label was {binding.get('review_status') or 'reviewed'} by a person ({binding['reviewer']})."
    return (
        f"{tag} is bound to scene object {binding['object_id']} (class {binding['class']}, class confidence "
        f"{binding['class_confidence']}, label source {binding['label_source']}) by {binding['mapping_method']} "
        f"with mapping confidence {binding['mapping_confidence']}.{notes}{reviewed} Identity is not visually verified."
    )


def evidence_bundle(asset_id: str) -> dict[str, Any]:
    with connect() as conn:
        asset = row_to_dict(conn.execute("SELECT * FROM Asset_Master WHERE asset_id = ?", (asset_id,)).fetchone())
        if asset is None:
            raise UnknownAssetError(asset_id)
        current = row_to_dict(conn.execute("SELECT * FROM Current_State WHERE asset_id = ?", (asset_id,)).fetchone()) or {}
        asset_class = str(asset.get("asset_class") or "")
        issue_code = current.get("issue_code")

        telemetry = load_asset_telemetry(conn, asset_id)
        metrics = available_metrics(telemetry)
        trends = {m: s for m in metrics if (s := first_last_day(telemetry, m))}
        baselines = class_baseline(conn, asset_class, asset_id, metrics)

        events = prioritised_events(conn, asset_id, issue_code)
        work_orders = [
            row_to_dict(r)
            for r in conn.execute(
                "SELECT * FROM Maintenance_History WHERE asset_id = ? ORDER BY opened_at DESC LIMIT ?",
                (asset_id, MAX_WORK_ORDERS),
            )
        ]
        cases = matching_cases(conn, asset_class, issue_code, current.get("issue_summary"))
        dq = sorted(
            (row_to_dict(r) for r in conn.execute("SELECT * FROM Data_Quality WHERE asset_id = ?", (asset_id,))),
            key=lambda d: (SEVERITY_RANK.get(str(d.get("severity")).lower(), 3), str(d.get("issue_id"))),
        )
        doc_ids = [d for d in (current.get("knowledge_doc_id"), *GLOBAL_DOC_IDS) if d]
        placeholders = ",".join("?" for _ in doc_ids)
        docs = {
            r["doc_id"]: r
            for r in (row_to_dict(x) for x in conn.execute(f"SELECT * FROM Knowledge_Docs WHERE doc_id IN ({placeholders})", doc_ids))
        }

    tag = str(asset.get("tag") or asset_id)
    binding = scene_index.binding(asset_id)

    evidence: list[dict[str, Any]] = [
        _item(
            f"ASSET:{asset_id}", "Asset_Master", "asset",
            f"{tag} ({asset_id}) is a {asset_class} in {asset.get('area_name')} ({asset.get('area_id')}), "
            f"criticality {asset.get('criticality')}, last serviced {asset.get('last_service_date')}, "
            f"service interval {asset.get('service_interval_days')} days.",
            record=asset,
        ),
    ]
    if current:
        evidence.append(_item(
            f"STATE:{asset_id}", "Current_State", "state",
            f"{tag} health score {current.get('health_score')}, condition {current.get('condition_state')}, "
            f"issue {issue_code}: {current.get('issue_summary')}. Urgency {current.get('urgency')}. "
            f"Workbook model confidence {current.get('model_confidence')}. "
            f"Recommended next check: {current.get('recommended_next_check')}. Last updated {current.get('last_updated')}.",
            record=current,
        ))
    evidence.append(_item(
        f"MAP:{asset_id}", "scene_objects.json", "mapping", _mapping_text(asset_id, tag, binding),
        record=binding, values={"mapping_confidence": binding["mapping_confidence"]} if binding else None,
    ))
    for metric, stats in trends.items():
        evidence.append(_item(f"TEL:{asset_id}:{metric}", "computed", "telemetry", _trend_text(tag, stats), values=stats))
    for metric, stats in baselines.items():
        evidence.append(_item(f"BASELINE:{asset_class}:{metric}", "computed", "baseline", _baseline_text(stats), values=stats))

    if events:
        counts = {s: sum(1 for e in events if e.get("status") == s) for s in ("open", "acknowledged", "closed")}
        matching = [e for e in events if issue_code and e.get("event_code") == issue_code]
        summary = {
            "total": len(events), **counts,
            "issue_code": issue_code,
            "matching_issue_code": len(matching),
            "matching_open": sum(1 for e in matching if e.get("status") == "open"),
        }
        evidence.append(_item(
            f"EVENTS:{asset_id}:summary", "computed", "event_summary",
            f"{tag} has {summary['total']} events: {counts['open']} open, {counts['acknowledged']} acknowledged, "
            f"{counts['closed']} closed. {summary['matching_issue_code']} carry the current issue code {issue_code}, "
            f"{summary['matching_open']} of them open.",
            values=summary,
        ))
    for event in events[:MAX_EVENTS]:
        evidence.append(_item(
            str(event["event_id"]), "Alarms_Events", "event",
            f"{event.get('timestamp')} {event.get('status')} {event.get('severity')} {event.get('event_code')} "
            f"({event.get('event_type')}): {event.get('description')}",
            record=event,
        ))
    for wo in work_orders:
        evidence.append(_item(
            str(wo["work_order_id"]), "Maintenance_History", "work_order",
            f"{wo.get('opened_at')} {wo.get('maintenance_type')} work order, priority {wo.get('priority')}: "
            f"{wo.get('action')} -> {wo.get('result')} ({wo.get('duration_h')} h, downtime {wo.get('downtime_h')} h).",
            record=wo,
        ))
    for case in cases:
        evidence.append(_item(
            str(case["case_id"]), "Historical_Service_Cases", "case",
            f"{case.get('asset_class')} case {case.get('historical_issue_code')}, severity {case.get('severity')}: "
            f"{case.get('historical_interpretation')}. Recommended check: {case.get('recommended_next_check')}. "
            f"Safe workflow: {case.get('safe_evidence_workflow')}",
            record=case,
        ))
    for issue in dq:
        evidence.append(_item(
            str(issue["issue_id"]), "Data_Quality", "data_quality",
            f"{issue.get('severity')} data-quality issue {issue.get('issue_type')} in {issue.get('source_sheet')}: "
            f"recommended handling {issue.get('recommended_handling')}.",
            record=issue,
        ))
    for doc_id in doc_ids:
        doc = docs.get(doc_id)
        if doc:
            evidence.append(_item(doc_id, "Knowledge_Docs", "document", f"{doc.get('title')}: {doc.get('content')}", record=doc))

    return {
        "asset": asset,
        "current": current,
        "binding": binding,
        "trends": trends,
        "baselines": baselines,
        "events": events,
        "cases": cases,
        "data_quality": dq,
        "work_orders": work_orders,
        "evidence": evidence,
    }
