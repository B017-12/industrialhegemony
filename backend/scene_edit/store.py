"""Edit log persisted in data/derived/scene_edits.json (served by the backend, so the whole team sees it)."""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone

from pipeline.common import DERIVED

EDITS = DERIVED / "scene_edits.json"
_LOCK = threading.Lock()


def load() -> list[dict]:
    """Edit log; edits recorded before the whole-object rule (on fixed objects/parts) are dropped."""
    from backend.scene_edit.engine import resolve

    edits = json.loads(EDITS.read_text())["edits"] if EDITS.exists() else []
    out = []
    for e in edits:
        mid = resolve(e["object_id"])
        if mid:
            out.append({**e, "object_id": mid})
    return out


def save(edits: list[dict]) -> None:
    with _LOCK:
        tmp = EDITS.with_suffix(".tmp")
        tmp.write_text(json.dumps({"schema_version": 1, "frame": "world (x, -y_ply, -z_ply), PLY units",
                                   "edits": edits}, indent=1))
        tmp.replace(EDITS)


def new_edit(object_id: str, translate_w: list[float], yaw_deg: float, by: str | None) -> dict:
    return {"edit_id": f"EDIT-{uuid.uuid4().hex[:8]}", "object_id": object_id,
            "translate_world": [round(float(v), 4) for v in translate_w], "yaw_deg": round(float(yaw_deg), 2),
            "by": by, "ts": datetime.now(timezone.utc).isoformat()}
