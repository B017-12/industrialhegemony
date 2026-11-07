"""Vision vs telemetry cross-check for one asset. Vision can only corroborate what is visible; a procedural
3D binding or an unlinked photo caps the verdict at 'unverifiable' (DOC-3D-MAPPING)."""

from __future__ import annotations

import pandas as pd

from backend.vision import cache, manifest
from backend.vision.schema import CrossCheck, TelemetryPoint
from pipeline.excel import PackStore

DEVIATION_FLAG_PCT = 3.0
LINK_MIN_CONF = 0.6
ADVICE = ("Verify on site: compare the local position indicator / gauge with the control-system value before any "
          "action; record the observation in a draft work order (DOC-FIELD-SAFETY).")


def _last(t: pd.DataFrame, sig: str) -> TelemetryPoint | None:
    if sig not in t.columns:
        return None
    s = t[["timestamp", sig]].dropna()
    if s.empty:
        return None
    row = s.iloc[-1]
    return TelemetryPoint(signal=sig, value=round(float(row[sig]), 2), timestamp=str(row["timestamp"]),
                          evidence_id=f"TELEMETRY:{sig}")


def best_finding(asset_id: str, object_id: str | None) -> dict | None:
    fs = [f for f in cache.all_findings() if f.get("question") is None and
          (f.get("asset_id") == asset_id or (object_id and f.get("object_id") == object_id))]
    return max(fs, key=lambda f: f["confidence"], default=None)


def crosscheck(store: PackStore, asset_id: str) -> CrossCheck:
    st = store.asset(asset_id)["state"]
    cls = st["asset_class"]
    obj = next((o for o in manifest.scene_objects().values() if o.get("asset_id") == asset_id), None)
    binding = ({"object_id": obj["object_id"], "mapping_method": obj.get("mapping_method"),
                "mapping_confidence": obj.get("mapping_confidence")} if obj else None)
    t = store.telemetry(asset_id)
    rationale, flag, tel = [], None, []
    if cls == "CONTROL_VALVE":
        sp, act = _last(t, "position_setpoint_pct"), _last(t, "position_actual_pct")
        tel = [p for p in (sp, act) if p]
        if sp and act:
            dev = act.value - sp.value
            day = (pd.to_numeric(t["position_actual_pct"], errors="coerce")
                   - pd.to_numeric(t["position_setpoint_pct"], errors="coerce")).tail(48).mean()
            rationale.append(f"Telemetry: setpoint {sp.value}%, actual {act.value}% (deviation {dev:+.1f} pp; "
                             f"last-day mean {day:+.1f} pp).")
            if abs(day) > DEVIATION_FLAG_PCT:
                flag = f"actual deviates from setpoint by {day:+.1f} pp over the last day (possible sticking)"
    else:
        p = _last(t, "process_pressure_bar")
        tel = [p] if p else []
        if p:
            rationale.append(f"Telemetry: process pressure {p.value} bar.")

    f = best_finding(asset_id, obj["object_id"] if obj else None)
    verdict = "unverifiable"
    if f is None:
        rationale.append("No inspected photo region is linked to this asset or its 3D object. Link a region in the "
                         "inspector (technician confirmation) and run Inspect.")
    else:
        state, conf = f["state"], f["confidence"]
        link_ok = f.get("link_method") == "technician_confirmed" or (f.get("link_confidence") or 0) >= LINK_MIN_CONF
        rationale.append(f"Vision {f['finding_id']}: state '{state}', confidence {conf:.2f}, "
                         f"region link {f.get('link_method')} ({f.get('link_confidence')}).")
        gauge = (f.get("draft") or {}).get("gauge") or {}
        if not link_ok:
            rationale.append("The photo-to-asset link is not confirmed, so vision cannot verify this asset.")
        elif cls == "CONTROL_VALVE" and state in ("open", "closed", "partially_open") and tel:
            act = next((p.value for p in tel if p.signal == "position_actual_pct"), None)
            if act is not None:
                bad = (state == "closed" and act > 5) or (state == "open" and act < 2)
                verdict = "mismatch" if bad else "consistent"
                rationale.append(f"Visual '{state}' vs telemetry actual {act}% → {verdict}.")
        elif gauge.get("readable") and gauge.get("value") is not None and tel and tel[0].signal == "process_pressure_bar":
            if (gauge.get("unit") or "").lower().startswith("bar"):
                diff = abs(gauge["value"] - tel[0].value)
                verdict = "consistent" if diff <= max(0.3, 0.1 * abs(tel[0].value)) else "mismatch"
                rationale.append(f"Gauge reads {gauge['value']} bar vs telemetry {tel[0].value} bar → {verdict}.")
            else:
                rationale.append(f"Gauge unit '{gauge.get('unit')}' is not bar; not comparable.")
        else:
            rationale.append("The visual state is unknown or not comparable with this asset's telemetry.")
    if binding and binding["mapping_method"] and "procedural" in binding["mapping_method"]:
        rationale.append(f"The 3D binding {binding['object_id']} is procedural "
                         f"({binding['mapping_confidence']}); confirm identity on site.")
    ev = [asset_id] + [p.evidence_id for p in tel] + ([f["finding_id"], f["frame_id"]] if f else [])
    return CrossCheck(asset_id=asset_id, tag=st.get("tag"), asset_class=cls,
                      object_id=obj["object_id"] if obj else None, binding=binding, telemetry=tel,
                      telemetry_flag=flag, finding_id=f["finding_id"] if f else None,
                      vision_state=f["state"] if f else None, verdict=verdict, rationale=rationale,
                      advice=ADVICE, evidence_ids=ev)
