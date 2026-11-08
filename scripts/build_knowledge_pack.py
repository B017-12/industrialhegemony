"""Excel builder pack -> src/data/excelKnowledgePack.js (the diagnostic assistant's corpus).

Run:  uv run python scripts/build_knowledge_pack.py

Everything in the output comes from data/raw/builder_pack.xlsx. The only derived values are
telemetry summaries (window means, trend, deviation from the median of *healthy* assets of the
same class) so the in-browser engine can evaluate decision-tree branches without shipping the
full 4,320-row telemetry sheet.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

from pipeline.excel import PackStore, _records  # noqa: E402

OUT = ROOT / "src" / "data" / "excelKnowledgePack.js"
SIGNALS = [
    "process_pressure_bar", "process_flow_pct", "position_setpoint_pct", "position_actual_pct",
    "pneumatic_supply_bar", "stiction_index", "load_for_opening_pct", "vibration_mm_s",
    "bearing_temp_c", "motor_current_a", "speed_rpm", "signal_quality_pct", "sensor_bias",
]
WINDOW = 12          # 12 x 30 min = last / first 6 h
SPARK_POINTS = 24    # downsampled trend points per signal
RECENT_EVENTS = 8
RECENT_WOS = 8


def _r(v, nd=3):
    return None if v is None or pd.isna(v) else round(float(v), nd)


def telemetry_summary(tel: pd.DataFrame, condition: dict[str, str]) -> dict[str, dict]:
    tel = tel.copy()
    tel["position_error_pct"] = (tel["position_actual_pct"] - tel["position_setpoint_pct"]).abs()
    signals = SIGNALS + ["position_error_pct"]
    healthy = tel[tel["asset_id"].map(condition) == "healthy"]
    baseline = healthy.groupby("asset_class")[signals].median()

    out: dict[str, dict] = {}
    for asset_id, g in tel.groupby("asset_id"):
        cls = g["asset_class"].iloc[0]
        per: dict[str, dict] = {}
        for sig in signals:
            v = g[sig].dropna()
            if v.empty:
                continue
            last, first = v.tail(WINDOW).mean(), v.head(WINDOW).mean()
            base = baseline.loc[cls, sig] if cls in baseline.index else None
            dev = None
            if base is not None and not pd.isna(base) and abs(base) > 1e-6:
                dev = (last - base) / abs(base) * 100
            step = max(1, len(v) // SPARK_POINTS)
            per[sig] = {
                "last": _r(last), "first": _r(first), "min": _r(v.min()), "max": _r(v.max()),
                "baseline": _r(base), "dev_pct": _r(dev, 1), "trend": _r(last - first),
                "spark": [_r(x, 2) for x in v.iloc[::step].tolist()[:SPARK_POINTS]],
            }
        out[asset_id] = {
            "window": {"from": g["timestamp"].min().isoformat(), "to": g["timestamp"].max().isoformat(),
                       "samples": int(len(g))},
            "signals": per,
        }
    return out


def main() -> None:
    store = PackStore.load()
    t = store.tables
    condition = dict(zip(t["Current_State"]["asset_id"], t["Current_State"]["condition_state"]))

    assets = {}
    for asset_id in store.asset_ids():
        a = store.asset(asset_id)
        m, s, an = a["master"], a["state"], a["anchor"]
        assets[asset_id] = {
            **{k: m[k] for k in ("asset_id", "tag", "asset_class", "area_id", "area_name", "process_context",
                                 "criticality", "installation_date", "last_service_date",
                                 "service_interval_days", "connectivity_profile", "qr_id", "nfc_id")},
            **{k: s[k] for k in ("health_score", "condition_state", "issue_code", "issue_summary", "urgency",
                                 "recommended_next_check", "model_confidence", "knowledge_doc_id")},
            "anchor": {k: an[k] for k in ("scene_anchor_id", "x_local_m", "y_local_m", "z_local_m",
                                          "scene_path", "mapping_status", "mapping_confidence",
                                          "identity_methods")},
        }

    work_orders, wo_stats = {}, {}
    for asset_id in store.asset_ids():
        wos = store.work_orders(asset_id)
        work_orders[asset_id] = _records(wos.head(RECENT_WOS))
        wo_stats[asset_id] = {
            "count": int(len(wos)),
            "downtime_h": _r(wos["downtime_h"].sum(), 1),
            "by_result": dict(Counter(wos["result"])),
        }
    # Outcome priors per (class, action) across the fleet: how often an action finds nothing.
    mh = t["Maintenance_History"].merge(t["Asset_Master"][["asset_id", "asset_class"]], on="asset_id")
    action_outcomes: dict[str, dict] = {}
    for (cls, action), g in mh.groupby(["asset_class", "action"]):
        action_outcomes.setdefault(cls, {})[action] = {
            "n": int(len(g)), "results": dict(Counter(g["result"])),
            "avg_duration_h": _r(g["duration_h"].mean(), 1), "avg_downtime_h": _r(g["downtime_h"].mean(), 1),
            "roles": dict(Counter(g["role"])),
        }

    events = {}
    for asset_id in store.asset_ids():
        ev = store.events(asset_id)
        events[asset_id] = {
            "recent": _records(ev.head(RECENT_EVENTS)),
            "by_severity": dict(Counter(ev["severity"])),
            "by_type": dict(Counter(ev["event_type"])),
            "open": int((ev["status"] == "open").sum()),
        }

    data_quality = {aid: _records(store.data_quality(aid)) for aid in store.asset_ids()}

    pack = {
        "source": "Valmet x Since AI 2026 - Synthetic Industrial Metaverse Builder Data Pack (builder_pack.xlsx)",
        "assets": assets,
        "cases": _records(t["Historical_Service_Cases"]),
        "docs": _records(t["Knowledge_Docs"]),
        "ragIndex": _records(t["RAG_Corpus_Index"]),
        "workOrders": work_orders,
        "workOrderStats": wo_stats,
        "actionOutcomes": action_outcomes,
        "events": events,
        "dataQuality": data_quality,
        "telemetry": telemetry_summary(t["Telemetry_Sample_3d"], condition),
    }

    body = json.dumps(pack, ensure_ascii=False, separators=(",", ":"), default=str)
    OUT.write_text(
        "// GENERATED by scripts/build_knowledge_pack.py from data/raw/builder_pack.xlsx — do not edit by hand.\n"
        f"export const PACK = {body};\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB): "
          f"{len(assets)} assets, {len(pack['cases'])} cases, {len(pack['docs'])} docs")


if __name__ == "__main__":
    main()
