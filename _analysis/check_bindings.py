"""Fail if a binding is not a reviewed class, lacks a frame citation, or is hosted on the wrong kind of object.

    python3 _analysis/check_bindings.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FRAME = re.compile(r"frame_\S+\.jpg")
ALLOWED = {
    "PROCESS_PUMP": frozenset({"pump"}),
    "ELECTRIC_MOTOR": frozenset({"motor"}),
    "CONTROL_VALVE": frozenset({"valve"}),
    "PRESSURE_TRANSMITTER": frozenset({"gauge"}),
}
HOST_OK = frozenset({"pump", "motor", "valve", "pipe"})
HOST_REASON = {
    "VIBRATION_SENSOR": HOST_OK,
    "PRESSURE_TRANSMITTER": frozenset({"valve", "pipe", "gauge"}),
}


def main() -> None:
    import pandas as pd

    scene = json.loads((ROOT / "data/derived/scene_objects.json").read_text())
    overrides = json.loads((ROOT / "data/derived/labels_override.json").read_text()).get("overrides") or {}
    assets = pd.read_excel(
        ROOT / "Valmet_SinceAI_2026_Synthetic_Industrial_Metaverse_Builder_Pack (1) (2) (1).xlsx",
        sheet_name="Asset_Master",
    ).fillna("")
    by_asset = {str(row.asset_id): row for row in assets.itertuples(index=False)}
    failures: list[str] = []
    bound = hosted = 0
    seen: set[str] = set()

    for obj in scene["objects"]:
        entry = overrides.get(obj["object_id"]) or {}
        merged = {**obj, **entry}
        cls = merged.get("class")
        asset_id = obj.get("asset_id")
        if entry.get("asset_id"):
            asset_id = entry["asset_id"]
        elif "asset_id" in entry and not entry.get("asset_id"):
            asset_id = None
        if asset_id:
            seen.add(str(asset_id))
            bound += 1
            kind = str(getattr(by_asset.get(str(asset_id)), "asset_class", "")).upper()
            allowed = ALLOWED.get(kind, frozenset())
            if cls not in allowed:
                failures.append(f"{asset_id} on {obj['object_id']} class {cls} is outside {kind} {sorted(allowed)}")
            notes = str(merged.get("mapping_notes") or "")
            if not FRAME.search(notes):
                failures.append(f"{asset_id} on {obj['object_id']} has no frame name in its note")
        for item in obj.get("hosted_assets") or []:
            hid = str(item.get("asset_id"))
            seen.add(hid)
            hosted += 1
            kind = str(getattr(by_asset.get(hid), "asset_class", "")).upper()
            if cls not in HOST_OK:
                failures.append(f"host {obj['object_id']} for {hid} is {cls}, not a pump, motor, valve or pipe")
            if kind in HOST_REASON and cls not in HOST_REASON[kind] and cls not in HOST_OK:
                failures.append(f"{hid} hosted on {cls}")
            if not FRAME.search(str(item.get("mapping_notes") or "")):
                failures.append(f"{hid} on {obj['object_id']} has no frame name in its host note")

    missing = [str(row.asset_id) for row in assets.itertuples(index=False) if str(row.asset_id) not in seen]
    print(f"bound {bound}, hosted {hosted}, not located {len(missing)}")
    for asset_id in missing:
        row = by_asset[asset_id]
        print(f"  {row.tag} {asset_id} not located in scan")
    if failures:
        print(f"{len(failures)} binding check(s) failed:")
        for line in failures:
            print(f"  {line}")
        raise SystemExit(1)
    print("binding checks passed")


if __name__ == "__main__":
    main()
