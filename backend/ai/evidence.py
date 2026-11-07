"""Deterministic evidence pack for one asset: everything the copilot may cite, plus a computed confidence.

Confidence = Current_State.model_confidence minus penalties for data-quality issues on the asset and for
weak scene-mapping confidence (Builder question Q-06: reduce confidence when sensor or mapping quality is poor).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.excel import PackStore

DQ_PENALTY = {"high": 0.05, "medium": 0.02, "low": 0.01}
DQ_PENALTY_CAP = 0.25
MAPPING_PENALTY_WEIGHT = 0.2
SIGNALS = ["process_pressure_bar", "process_flow_pct", "position_setpoint_pct", "position_actual_pct",
           "pneumatic_supply_bar", "stiction_index", "load_for_opening_pct", "vibration_mm_s", "bearing_temp_c",
           "motor_current_a", "speed_rpm", "signal_quality_pct", "sensor_bias"]
TREND_WINDOW = 48  # half-hour rows = 1 day


def telemetry_trends(store: PackStore, asset_id: str, asset_class: str) -> list[dict]:
    """First day vs last day per signal, plus the healthy-peer last-day mean for the same class."""
    t = store.telemetry(asset_id)
    peers_tbl = store.tables["Current_State"]
    peers = peers_tbl[(peers_tbl["asset_class"] == asset_class) & (peers_tbl["condition_state"] == "healthy")
                      & (peers_tbl["asset_id"] != asset_id)]["asset_id"].tolist()
    out = []
    for sig in SIGNALS:
        if sig not in t.columns or t[sig].isna().all():
            continue
        series = pd.to_numeric(t[sig], errors="coerce").dropna()
        if len(series) < 2 * 4:
            continue
        first, last = series.head(TREND_WINDOW).mean(), series.tail(TREND_WINDOW).mean()
        peer_vals = [pd.to_numeric(store.telemetry(p)[sig], errors="coerce").tail(TREND_WINDOW).mean() for p in peers
                     if sig in store.telemetry(p).columns]
        peer_vals = [v for v in peer_vals if np.isfinite(v)]
        change = (last - first) / abs(first) * 100 if first else 0.0
        out.append({
            "signal": sig, "first_day_mean": round(float(first), 3), "last_day_mean": round(float(last), 3),
            "change_pct": round(float(change), 1),
            "healthy_peer_last_day_mean": round(float(np.mean(peer_vals)), 3) if peer_vals else None,
            "n_points": int(len(series)),
            "window": f"{t['timestamp'].iloc[0]:%Y-%m-%d %H:%M} .. {t['timestamp'].iloc[-1]:%Y-%m-%d %H:%M}",
        })
    out.sort(key=lambda r: -abs(r["change_pct"]))
    return out


def build_evidence(store: PackStore, asset_id: str, mapping: dict | None = None, max_events: int = 8) -> dict:
    a = store.asset(asset_id)
    master, state = a["master"], a["state"]
    events = store.events(asset_id)
    issue = state["issue_code"]
    relevant = events[(events["event_code"] == issue) | (events["severity"] == "high")].head(max_events)
    wos = store.work_orders(asset_id).head(6)
    dq = store.data_quality(asset_id)
    cases = store.cases(state["asset_class"], issue if issue != "NORMAL" else None).head(5)
    docs = store.documents(asset_id)

    penalties, rationale = 0.0, [f"Starting point: Current_State model_confidence {state['model_confidence']:.2f}."]
    dq_pen = min(DQ_PENALTY_CAP, sum(DQ_PENALTY.get(s, 0.01) for s in dq["severity"]))
    if len(dq):
        penalties += dq_pen
        rationale.append(f"-{dq_pen:.2f} for {len(dq)} open data-quality issue(s) "
                         f"({', '.join(sorted(set(dq['issue_type'])))}): {', '.join(dq['issue_id'])}.")
    map_conf = (mapping or {}).get("mapping_confidence")
    if map_conf is not None:
        m_pen = round((1 - map_conf) * MAPPING_PENALTY_WEIGHT, 3)
        penalties += m_pen
        rationale.append(f"-{m_pen:.2f} because the 3D object ↔ asset mapping is "
                         f"{(mapping or {}).get('mapping_method', 'procedural')} (confidence {map_conf:.2f}).")
    confidence = float(np.clip(state["model_confidence"] - penalties, 0.05, 0.99))
    rationale.append(f"Result: {confidence:.2f}.")

    def recs(df, cols):
        return [{c: (v.isoformat() if isinstance(v, pd.Timestamp) else v) for c, v in r.items()}
                for r in df[cols].to_dict(orient="records")]

    return {
        "asset": {"asset_id": asset_id, "tag": master["tag"], "asset_class": master["asset_class"],
                  "area_name": master["area_name"], "criticality": master["criticality"],
                  "last_service_date": master["last_service_date"], "service_interval_days": master["service_interval_days"]},
        "state": {k: state[k] for k in ("health_score", "condition_state", "issue_code", "issue_summary", "urgency",
                                        "recommended_next_check", "model_confidence", "knowledge_doc_id", "last_updated")},
        "mapping": mapping,
        "telemetry_trends": telemetry_trends(store, asset_id, master["asset_class"]),
        "events": recs(relevant, ["event_id", "timestamp", "event_type", "severity", "event_code", "description", "status"]),
        "event_counts": {k: int(v) for k, v in events["event_code"].value_counts().head(6).items()},
        "work_orders": recs(wos, ["work_order_id", "opened_at", "action", "maintenance_type", "priority", "result"]),
        "historical_cases": recs(cases, ["case_id", "historical_issue_code", "historical_interpretation",
                                         "recommended_next_check", "safe_evidence_workflow"]),
        "data_quality": recs(dq, ["issue_id", "issue_type", "severity", "recommended_handling"]),
        "documents": [{"doc_id": d["doc_id"], "title": d["title"], "content": d["content"]} for d in docs],
        "confidence": round(confidence, 2),
        "confidence_rationale": rationale,
    }


def evidence_ids_in(pack: dict) -> set[str]:
    ids = {pack["asset"]["asset_id"], pack["asset"]["tag"]}
    ids |= {e["event_id"] for e in pack["events"]} | {w["work_order_id"] for w in pack["work_orders"]}
    ids |= {c["case_id"] for c in pack["historical_cases"]} | {d["issue_id"] for d in pack["data_quality"]}
    ids |= {d["doc_id"] for d in pack["documents"]}
    ids |= {f"TELEMETRY:{t['signal']}" for t in pack["telemetry_trends"]}
    if pack.get("mapping"):
        ids.add(pack["mapping"]["object_id"])
    return ids
