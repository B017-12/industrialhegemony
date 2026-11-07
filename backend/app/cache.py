from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config

log = logging.getLogger("valmet.cache")

CACHED_MODES = {"arrival_diagnosis"}
ANSWER_FIELDS = ("summary", "observations", "hypotheses", "next_safe_checks", "caveats")


def path_for(asset_id: str, mode: str) -> Path:
    return Path(config.CACHE_DIR) / f"{asset_id}_{mode}.json"


def load(asset_id: str, mode: str) -> dict[str, Any] | None:
    path = path_for(asset_id, mode)
    if mode not in CACHED_MODES or not path.exists():
        return None
    try:
        entry = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        log.warning("unreadable cache file %s: %s", path, exc)
        return None
    if not all(field in entry.get("answer", {}) for field in ANSWER_FIELDS):
        return None
    return entry


def save(asset_id: str, mode: str, response: dict[str, Any]) -> Path | None:
    if mode not in CACHED_MODES:
        return None
    path = path_for(asset_id, mode)
    entry = {
        "asset_id": asset_id,
        "mode": mode,
        "source_generation": response["generation"],
        "model": response.get("model"),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "answer": {field: response[field] for field in ANSWER_FIELDS},
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(entry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        tmp.replace(path)
    except OSError as exc:
        log.warning("could not write cache file %s: %s", path, exc)
        return None
    return path


def warm(asset_ids: list[str]) -> list[Path]:
    """Write the deterministic arrival diagnosis for each asset so the demo works offline."""
    from .copilot import deterministic_response
    from .models import CopilotQuery

    written = []
    for asset_id in asset_ids:
        response = deterministic_response(CopilotQuery(asset_id=asset_id, mode="arrival_diagnosis"))
        if not response["validation"]["ok"]:
            raise SystemExit(f"{asset_id}: deterministic answer failed validation: {response['validation']['errors']}")
        path = save(asset_id, "arrival_diagnosis", response)
        if path:
            written.append(path)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Copilot answer cache")
    parser.add_argument("--warm", nargs="+", metavar="ASSET_ID", default=[config.TARGET_ASSET_ID])
    args = parser.parse_args()
    for path in warm(args.warm):
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
