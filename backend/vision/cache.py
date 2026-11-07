"""Findings cache keyed by (image bytes, question, model, prompt version) so the demo replays offline and a
repeated click costs nothing. Stored next to the frames so teammates get the same replays."""

from __future__ import annotations

import hashlib
import json
import threading

from backend.vision.manifest import VISION

CACHE = VISION / "findings_cache.json"
_LOCK = threading.Lock()


def key(*parts: bytes | str | None) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p if isinstance(p, bytes) else str(p).encode())
        h.update(b"\x00")
    return h.hexdigest()[:20]


def _load() -> dict:
    return json.loads(CACHE.read_text()) if CACHE.exists() else {}


def get(k: str) -> dict | None:
    return _load().get(k)


def put(k: str, value: dict) -> None:
    with _LOCK:
        d = _load()
        d[k] = value
        tmp = CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, indent=1))
        tmp.replace(CACHE)


def all_findings() -> list[dict]:
    return list(_load().values())
