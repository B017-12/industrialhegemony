from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app

TARGET = config.TARGET_ASSET_ID


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def offline(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """No LLM key and an empty per-test cache dir, so tests never touch the network or backend/cache/."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    cache_dir = tmp_path / "cache"
    monkeypatch.setattr(config, "CACHE_DIR", cache_dir)
    return cache_dir


def parse_sse(body: str) -> list[tuple[str, object]]:
    events = []
    for block in body.strip().split("\n\n"):
        name, data = None, None
        for line in block.splitlines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = json.loads(line.split(":", 1)[1].strip())
        if name:
            events.append((name, data))
    return events
