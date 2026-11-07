from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from .errors import MissingArtifactError

_cache: dict[Path, tuple[float, dict[str, Any]]] = {}


def read_json(path: Path, *, required: bool = True) -> dict[str, Any] | None:
    """Read a pipeline JSON file, cached until its mtime changes. Returns a deep copy."""
    if not path.exists():
        if not required:
            return None
        raise MissingArtifactError(f"{path.name} not found; run the pipeline first (python3 -m pipeline.run)")
    mtime = path.stat().st_mtime
    cached = _cache.get(path)
    if cached is None or cached[0] != mtime:
        cached = (mtime, json.loads(path.read_text(encoding="utf-8")))
        _cache[path] = cached
    return copy.deepcopy(cached[1])


def write_json(path: Path, data: dict[str, Any]) -> None:
    """Atomic write (temp file, then rename) that also drops the read cache entry."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
    _cache.pop(path, None)
